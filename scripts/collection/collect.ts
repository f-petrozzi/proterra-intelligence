import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import rawRegistry from "../../config/collection-sources.json" with { type: "json" };
import rawEditorialSources from "../../src/data/sources.json" with { type: "json" };
import { parseCsvApi } from "./adapters/csv-api";
import { parseHtmlList } from "./adapters/html-list";
import { parseJsonApi } from "./adapters/json-api";
import { parseRss } from "./adapters/rss";
import { fetchWithPolicy, type FetchLike } from "./fetch";
import { deduplicateCandidates, normalizeCandidate, stableCandidateSort } from "./normalize";
import {
  candidateFileSchema, collectionRegistrySchema, rawCandidateSchema, runManifestSchema,
  type Candidate, type CandidateFile, type CollectionSource, type RunManifest
} from "./types";

const timezone = "America/New_York" as const;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function argument(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function zonedMidnight(date: string) {
  const guess = new Date(`${date}T05:00:00.000Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  }).formatToParts(guess);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const displayed = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), Number(values.hour), Number(values.minute), Number(values.second));
  const target = Date.UTC(...date.split("-").map(Number).map((value, index) => index === 1 ? value - 1 : value) as [number, number, number]);
  return new Date(guess.valueOf() + target - displayed);
}

export function reportingWindow(issueDate: string) {
  if (!datePattern.test(issueDate)) throw new Error("--issue-date must use YYYY-MM-DD");
  const end = zonedMidnight(issueDate);
  const startDate = new Date(`${issueDate}T00:00:00.000Z`);
  startDate.setUTCDate(startDate.getUTCDate() - 7);
  const start = zonedMidnight(startDate.toISOString().slice(0, 10));
  return { start: start.toISOString(), end: end.toISOString(), timezone };
}

function parseAdapter(source: CollectionSource, input: string) {
  switch (source.method) {
    case "rss": return parseRss(input);
    case "json-api": return parseJsonApi(input, source);
    case "csv-api": return parseCsvApi(input, source);
    case "html-list": return parseHtmlList(input, source);
    default: return [];
  }
}

function assertContentType(source: CollectionSource, contentType: string) {
  const normalized = contentType.toLowerCase().split(";", 1)[0].trim();
  const allowed: Record<string, string[]> = {
    rss: ["application/atom+xml", "application/rss+xml", "application/xml", "text/xml"],
    "json-api": ["application/json", "application/geo+json"],
    "csv-api": ["text/csv", "application/csv", "application/vnd.ms-excel"],
    "html-list": ["text/html", "application/xhtml+xml"]
  };
  if (!allowed[source.method]?.includes(normalized)) {
    throw new Error(`${source.sourceId}: unexpected content type ${normalized || "missing"}`);
  }
}

function counts(values: string[]) {
  return Object.fromEntries([...new Set(values)].sort().map((value) => [value, values.filter((candidate) => candidate === value).length]));
}

export async function collectSources(options: {
  issueDate: string;
  now?: Date;
  fetcher?: FetchLike;
  registry?: unknown;
}) {
  const registry = collectionRegistrySchema.parse(options.registry ?? rawRegistry);
  const editorialIds = new Set(rawEditorialSources.map((source) => source.id));
  for (const source of registry.sources) {
    if (!editorialIds.has(source.sourceId)) throw new Error(`collection source ${source.sourceId} is not registered editorially`);
  }
  const window = reportingWindow(options.issueDate);
  const startedAt = (options.now ?? new Date()).toISOString();
  const retrievedAt = startedAt;
  const collected: Candidate[] = [];
  const adapters: RunManifest["adapters"] = [];
  const manualSources = registry.sources.filter((source) => source.collectionRole === "manual").map((source) => source.sourceId).sort();

  for (const source of registry.sources.filter((candidate) => candidate.enabled && !["manual", "disabled"].includes(candidate.method))) {
    const adapterId = source.adapterId ?? source.sourceId;
    const started = performance.now();
    let seen = 0;
    let accepted = 0;
    try {
      const response = await fetchWithPolicy(source, options.fetcher);
      assertContentType(source, response.contentType);
      const input = new TextDecoder().decode(response.bytes);
      const rawItems = parseAdapter(source, input);
      seen = rawItems.length;
      if (seen < source.minimumItemsSeen) {
        throw new Error(`${source.sourceId}: parsed ${seen} items; expected at least ${source.minimumItemsSeen} (the source layout or feed may have changed)`);
      }
      for (const raw of rawItems) {
        const parsed = rawCandidateSchema.safeParse(raw);
        if (!parsed.success) continue;
        try {
          const candidate = normalizeCandidate(parsed.data, source, retrievedAt);
          if (candidate.publishedAt >= window.start && candidate.publishedAt < window.end) {
            collected.push(candidate);
            accepted += 1;
          }
        } catch {
          // A malformed item must not fail the source adapter.
        }
      }
      adapters.push({ sourceId: adapterId, status: "success", itemsSeen: seen, itemsAccepted: accepted, durationMs: Math.round(performance.now() - started) });
    } catch (error) {
      adapters.push({
        sourceId: adapterId, status: "failed", itemsSeen: seen, itemsAccepted: accepted,
        durationMs: Math.round(performance.now() - started),
        error: error instanceof Error ? error.message.slice(0, 500) : "unknown adapter error"
      });
    }
    if (source.rateLimitMs) await new Promise((resolveDelay) => setTimeout(resolveDelay, source.rateLimitMs));
  }

  const candidates = deduplicateCandidates(collected).sort(stableCandidateSort);
  const completedAt = (options.now ?? new Date()).toISOString();
  const failed = adapters.filter((adapter) => adapter.status === "failed").length;
  const status = adapters.length === 0 || failed === adapters.length ? "failed" : failed > 0 ? "partial" : "success";
  const candidateFile: CandidateFile = candidateFileSchema.parse({
    schemaVersion: 1, issueDate: options.issueDate, window, generatedAt: completedAt, candidates
  });
  const sectorCounts = counts(candidates.flatMap((candidate) => candidate.sectors));
  const geographyCounts = counts(candidates.flatMap((candidate) => candidate.geographies));
  const hasInternationalCoverage = candidates.some((candidate) =>
    candidate.geographies.some((geography) => geography !== "United States")
  );
  const coverageGaps = [
    ...(candidates.length < 5 ? [`Only ${candidates.length} relevant candidates were collected; at least 5 are required for a brief.`] : []),
    ...(["dairy", "meat", "bovine-genetics"] as const)
      .filter((sector) => !sectorCounts[sector])
      .map((sector) => `No relevant ${sector} candidate was collected.`),
    ...(!hasInternationalCoverage ? ["No relevant candidate outside the United States was collected."] : [])
  ];
  const warnings = [
    ...(manualSources.length ? [`${manualSources.length} manual sources were not fetched.`] : []),
    ...(candidates.length < 8 ? [`The preferred eight-item editorial target is unavailable; publish only if at least five strong items clear review.`] : []),
    ...coverageGaps
  ];
  const manifest: RunManifest = runManifestSchema.parse({
    schemaVersion: 1, issueDate: options.issueDate, startedAt, completedAt, status,
    candidateCount: candidates.length, candidatesBeforeDeduplication: collected.length, adapters, manualSources,
    editorialReadiness: coverageGaps.length === 0 ? "ready" : "coverage-gap",
    coverageGaps,
    coverage: {
      sectors: sectorCounts,
      geographies: geographyCounts
    },
    warnings
  });
  return { candidateFile, manifest };
}

async function main() {
  const issueDate = argument("issue-date") ?? new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
  const dryRun = process.argv.includes("--dry-run");
  const result = await collectSources({ issueDate });
  if (dryRun) {
    process.stdout.write(`${JSON.stringify({
      issueDate, status: result.manifest.status, editorialReadiness: result.manifest.editorialReadiness,
      candidates: result.manifest.candidateCount, coverageGaps: result.manifest.coverageGaps,
      adapters: result.manifest.adapters
    }, null, 2)}\n`);
    return;
  }
  const output = resolve("src", "data", "research-runs");
  await mkdir(output, { recursive: true });
  await writeFile(resolve(output, `${issueDate}.candidates.json`), `${JSON.stringify(result.candidateFile, null, 2)}\n`);
  await writeFile(resolve(output, `${issueDate}.run.json`), `${JSON.stringify(result.manifest, null, 2)}\n`);
  process.stdout.write(`Collected ${result.manifest.candidateCount} candidates (${result.manifest.status}).\n`);
  if (result.manifest.status === "failed") process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  await main();
}
