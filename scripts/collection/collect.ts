import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import rawRegistry from "../../config/collection-sources.json" with { type: "json" };
import rawEditorialSources from "../../src/data/sources.json" with { type: "json" };
import { parseCsvApi } from "./adapters/csv-api";
import { parseHtmlList } from "./adapters/html-list";
import { parseJsonApi } from "./adapters/json-api";
import { parseRss } from "./adapters/rss";
import { fetchWithPolicy, type FetchLike } from "./fetch";
import { clusterCandidates } from "./cluster";
import { deduplicateCandidates, normalizeCandidate, stableCandidateSort } from "./normalize";
import { authorityWeightOf, scoreCandidate } from "./score";
import {
  candidateFileSchema, collectionRegistrySchema, rawCandidateSchema, runManifestSchema,
  type Candidate, type CandidateFile, type CollectionSource, type NormalizedCandidate, type RunManifest
} from "./types";

const minimumNewsCandidates = 5;
const preferredNewsCandidates = 8;

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

export function windowFor(issueDate: string, lookbackDays: number) {
  if (!datePattern.test(issueDate)) throw new Error("--issue-date must use YYYY-MM-DD");
  const end = zonedMidnight(issueDate);
  const startDate = new Date(`${issueDate}T00:00:00.000Z`);
  startDate.setUTCDate(startDate.getUTCDate() - lookbackDays);
  const start = zonedMidnight(startDate.toISOString().slice(0, 10));
  return { start: start.toISOString(), end: end.toISOString(), timezone };
}

// The seven-day reporting window anchors readiness and the default lookback;
// individual sources may reach further back via their own lookbackDays.
export function reportingWindow(issueDate: string) {
  return windowFor(issueDate, 7);
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
  const startedAt = (options.now ?? new Date()).toISOString();
  const retrievedAt = startedAt;
  const collected: NormalizedCandidate[] = [];
  const adapters: RunManifest["adapters"] = [];
  const manualSources = registry.sources.filter((source) => source.collectionRole === "manual").map((source) => source.sourceId).sort();

  const fetchable = registry.sources.filter((candidate) => candidate.enabled && !["manual", "disabled"].includes(candidate.method));
  const maxLookback = Math.max(7, ...fetchable.map((source) => source.lookbackDays));
  const window = windowFor(options.issueDate, maxLookback);

  for (const source of fetchable) {
    const adapterId = source.adapterId ?? source.sourceId;
    const sourceWindow = windowFor(options.issueDate, source.lookbackDays);
    const started = performance.now();
    let seen = 0;
    let accepted = 0;
    let rejectedOutOfWindow = 0;
    let rejectedByScope = 0;
    let rejectedByDate = 0;
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
        if (!parsed.success) {
          if (parsed.error.issues.some((issue) => issue.path[0] === "publishedAt")) rejectedByDate += 1;
          else rejectedByScope += 1;
          continue;
        }
        let candidate: NormalizedCandidate;
        try {
          candidate = normalizeCandidate(parsed.data, source, retrievedAt);
        } catch (error) {
          if (error instanceof Error && error.message.endsWith("invalid publication date")) rejectedByDate += 1;
          else rejectedByScope += 1;
          continue;
        }
        if (candidate.publishedAt >= sourceWindow.start && candidate.publishedAt < sourceWindow.end) {
          collected.push(candidate);
          accepted += 1;
        } else {
          rejectedOutOfWindow += 1;
        }
      }
      adapters.push({
        sourceId: adapterId, status: "success", itemsSeen: seen, itemsAccepted: accepted,
        rejectedOutOfWindow, rejectedByScope, rejectedByDate, durationMs: Math.round(performance.now() - started)
      });
    } catch (error) {
      adapters.push({
        sourceId: adapterId, status: "failed", itemsSeen: seen, itemsAccepted: accepted,
        rejectedOutOfWindow, rejectedByScope, rejectedByDate, durationMs: Math.round(performance.now() - started),
        error: error instanceof Error ? error.message.slice(0, 500) : "unknown adapter error"
      });
    }
    if (source.rateLimitMs) await new Promise((resolveDelay) => setTimeout(resolveDelay, source.rateLimitMs));
  }

  // Collapse near-duplicate stories, then rank every surviving cluster
  // representative by deterministic relevance so the queue leads with the most
  // report-worthy developments instead of the most recent dataset release.
  const clusters = clusterCandidates(deduplicateCandidates(collected));
  const authority = new Map(registry.sources.map((source) => [source.sourceId, authorityWeightOf(source)]));
  const scoreOf = new Map<string, number>();
  for (const cluster of clusters) {
    for (const member of cluster.members) {
      scoreOf.set(member.candidateId, scoreCandidate(member, {
        authorityWeight: authority.get(member.sourceId) ?? 0.6,
        clusterSize: cluster.members.length,
        windowEnd: window.end
      }));
    }
  }
  const candidates: Candidate[] = clusters.map((cluster) => {
    const ranked = [...cluster.members].sort((a, b) =>
      (scoreOf.get(b.candidateId)! - scoreOf.get(a.candidateId)!) || stableCandidateSort(a, b));
    const [representative, ...rest] = ranked;
    return {
      ...representative,
      relevanceScore: scoreOf.get(representative.candidateId)!,
      clusterId: cluster.clusterId,
      relatedUrls: [...new Set(rest.map((member) => member.citationUrl))].sort()
    };
  }).sort((a, b) => (b.relevanceScore - a.relevanceScore) || stableCandidateSort(a, b));

  const completedAt = (options.now ?? new Date()).toISOString();
  const failed = adapters.filter((adapter) => adapter.status === "failed").length;
  const status = adapters.length === 0 || failed === adapters.length ? "failed" : failed > 0 ? "partial" : "success";
  const candidateFile: CandidateFile = candidateFileSchema.parse({
    schemaVersion: 1, issueDate: options.issueDate, window, generatedAt: completedAt, candidates
  });
  const newsCandidateCount = candidates.filter((candidate) => candidate.contentClass === "news").length;
  const datasetCandidateCount = candidates.length - newsCandidateCount;
  const sectorCounts = counts(candidates.flatMap((candidate) => candidate.sectors));
  const geographyCounts = counts(candidates.flatMap((candidate) => candidate.geographies));
  const languageCounts = counts(candidates.map((candidate) => candidate.language));
  const hasInternationalCoverage = candidates.some((candidate) =>
    candidate.geographies.some((geography) => geography !== "United States")
  );
  // Coverage gaps are waivable by an editorial override; the news-led minimum is not.
  const coverageGaps = [
    ...(["dairy", "meat", "bovine-genetics"] as const)
      .filter((sector) => !sectorCounts[sector])
      .map((sector) => `No relevant ${sector} candidate was collected.`),
    ...(!hasInternationalCoverage ? ["No relevant candidate outside the United States was collected."] : [])
  ];
  const newsReadiness = newsCandidateCount >= minimumNewsCandidates ? "ready" : "insufficient-news";
  const newsShortfall = newsReadiness === "insufficient-news"
    ? [`Only ${newsCandidateCount} news-led candidates were collected; at least ${minimumNewsCandidates} are required for a brief. Routine dataset releases support stories but do not satisfy this minimum.`]
    : [];
  const silentAdapters = adapters
    .filter((adapter) => adapter.status === "success" && adapter.itemsSeen > 0 && adapter.itemsAccepted === 0)
    .map((adapter) => `${adapter.sourceId} saw ${adapter.itemsSeen} items but accepted none (window ${adapter.rejectedOutOfWindow}, scope ${adapter.rejectedByScope}, date ${adapter.rejectedByDate}); verify its filters, date selector, or lookback.`);
  const warnings = [
    ...(manualSources.length ? [`${manualSources.length} manual sources were not fetched.`] : []),
    ...(newsCandidateCount < preferredNewsCandidates ? [`The preferred ${preferredNewsCandidates} news-item editorial target is unavailable; publish only if at least ${minimumNewsCandidates} strong news items clear review.`] : []),
    ...newsShortfall,
    ...coverageGaps,
    ...silentAdapters
  ];
  const manifest: RunManifest = runManifestSchema.parse({
    schemaVersion: 1, issueDate: options.issueDate, startedAt, completedAt, status,
    candidateCount: candidates.length, candidatesBeforeDeduplication: collected.length,
    newsCandidateCount, datasetCandidateCount, clusterCount: clusters.length, adapters, manualSources,
    editorialReadiness: coverageGaps.length === 0 && newsReadiness === "ready" ? "ready" : "coverage-gap",
    newsReadiness,
    coverageGaps,
    coverage: {
      sectors: sectorCounts,
      geographies: geographyCounts,
      languages: languageCounts
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
      issueDate, status: result.manifest.status,
      editorialReadiness: result.manifest.editorialReadiness, newsReadiness: result.manifest.newsReadiness,
      candidates: result.manifest.candidateCount, newsCandidates: result.manifest.newsCandidateCount,
      datasetCandidates: result.manifest.datasetCandidateCount, clusters: result.manifest.clusterCount,
      coverage: result.manifest.coverage, coverageGaps: result.manifest.coverageGaps,
      warnings: result.manifest.warnings, adapters: result.manifest.adapters
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
