import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import rawRegistry from "../../config/collection-sources.json" with { type: "json" };
import { authorityWeightOf } from "./score";
import { candidateFileSchema, collectionRegistrySchema, runManifestSchema, type CandidateFile, type RunManifest } from "./types";

function escapeCell(value: unknown) {
  return String(value ?? "")
    .replaceAll("\\", "\\\\")
    .replaceAll("|", "\\|")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\n", " ")
    .trim();
}

function escapeLinkLabel(value: string) {
  return escapeCell(value).replace(/([\[\]*_`])/g, "\\$1");
}

function markdownLink(label: string, url: string) {
  return `[${escapeLinkLabel(label)}](<${url}>)`;
}

function fixed(value: number, digits = 3) {
  return value.toFixed(digits);
}

function contributionMath(candidate: CandidateFile["candidates"][number]) {
  if (!candidate.scoreBreakdown) throw new Error(`Candidate ${candidate.candidateId} does not include a score breakdown.`);
  const { factors, adjustments } = candidate.scoreBreakdown;
  const adjustment = adjustments.bovineGenetics + adjustments.international + adjustments.nonEnglish;
  return [
    `R ${fixed(factors.recency.contribution)}`,
    `A ${fixed(factors.authority.contribution)}`,
    `N ${fixed(factors.contentClass.contribution)}`,
    `T ${fixed(factors.topic.contribution)}`,
    `C ${fixed(factors.corroboration.contribution)}`,
    `Adj ${adjustment >= 0 ? "+" : ""}${fixed(adjustment)}`
  ].join(" + ");
}

export function renderSourceAudit(candidates: CandidateFile, manifest: RunManifest) {
  if (candidates.candidates.some((candidate) => !candidate.scoreBreakdown)) {
    throw new Error("The candidate queue predates deterministic score breakdowns; rerun collection before rendering its audit.");
  }
  if (candidates.candidates.some((candidate) => !candidate.duplicateMatches)) {
    throw new Error("The candidate queue predates duplicate-match diagnostics; rerun collection before rendering its audit.");
  }
  const registry = collectionRegistrySchema.parse(rawRegistry);
  const adapters = new Map(manifest.adapters.map((adapter) => [adapter.sourceId, adapter]));
  const duplicateCount = candidates.candidates.reduce((count, candidate) =>
    count + (candidate.duplicateMatches?.length ?? 0), 0);
  const exactUrlRepeats = Math.max(0, manifest.candidatesBeforeDeduplication - candidates.candidates.length - duplicateCount);
  const scoresBySource = new Map<string, number[]>();
  for (const candidate of candidates.candidates) {
    const scores = scoresBySource.get(candidate.sourceId) ?? [];
    scores.push(candidate.relevanceScore);
    scoresBySource.set(candidate.sourceId, scores);
  }

  const lines = [
    "## Deterministic source audit",
    "",
    `Generated for **${escapeCell(candidates.issueDate)}** before any Codex editorial pass. Scores rank the accepted queue; they are not probabilities or factual-confidence ratings.`,
    "",
    `**Run:** ${escapeCell(manifest.status)} · **Editorial readiness:** ${escapeCell(manifest.editorialReadiness)} · **Accepted links:** ${manifest.candidatesBeforeDeduplication} · **Ranked stories:** ${manifest.candidateCount} · **Related coverage:** ${duplicateCount} · **Exact URL repeats removed:** ${exactUrlRepeats}`,
    "",
    "### Scoring formula",
    "",
    "| Factor | Rule | Maximum contribution |",
    "| --- | --- | ---: |",
    "| Recency (R) | Exponential decay with a 3.5-day half-life | 0.340 |",
    "| Authority (A) | Configured source authority × 0.24 | 0.240 |",
    "| Content class (N) | News = 1.0; routine dataset = 0.5 | 0.180 |",
    "| Topic signal (T) | Capped deterministic sector-keyword hits | 0.140 |",
    "| Corroboration (C) | Up to three additional sources in the same cluster | 0.100 |",
    "| Adjustments | Bovine genetics +0.08; non-US +0.06; confident non-English −0.07 | varies |",
    "",
    "### Source diagnostics",
    "",
    "Accepted counts are before deduplication. Score ranges use the surviving representative candidates.",
    "",
    "| Adapter | Mode | Health | Seen / accepted | Rejected: window / scope / date | Authority | Candidate score range | Configured rationale |",
    "| --- | --- | --- | ---: | ---: | ---: | ---: | --- |"
  ];

  for (const source of registry.sources) {
    const adapterId = source.adapterId ?? source.sourceId;
    const adapter = adapters.get(adapterId);
    const manual = source.method === "manual" || source.collectionRole === "manual";
    const disabled = source.method === "disabled" || source.collectionRole === "disabled";
    const health = manual ? "Manual; not fetched" : disabled ? "Disabled" : adapter?.status === "failed"
      ? `Failed: ${adapter.error ?? "unknown error"}` : adapter ? "Healthy" : "Not run";
    const observed = adapter ? `${adapter.itemsSeen} / ${adapter.itemsAccepted}` : "—";
    const rejected = adapter
      ? `${adapter.rejectedOutOfWindow} / ${adapter.rejectedByScope} / ${adapter.rejectedByDate}` : "—";
    const scores = scoresBySource.get(source.sourceId) ?? [];
    const scoreRange = scores.length
      ? `${fixed(Math.min(...scores), 6)}–${fixed(Math.max(...scores), 6)} (${scores.length})` : "—";
    const authority = manual || disabled ? "—" : fixed(authorityWeightOf(source), 2);
    lines.push(`| ${escapeCell(adapterId)} | ${escapeCell(source.contentClass ?? (source.collectionRole === "evidence" ? "dataset" : source.collectionRole))} | ${escapeCell(health)} | ${observed} | ${rejected} | ${authority} | ${scoreRange} | ${escapeCell(source.notes)} |`);
  }

  lines.push(
    "",
    "### Ranked candidates",
    "",
    "The final column is the exact additive score calculation: recency + authority + news/dataset + topic + corroboration + adjustments.",
    "",
    "| Rank | Score | Source | Candidate | Published | Coverage | Grouped | Deterministic calculation |",
    "| ---: | ---: | --- | --- | --- | --- | ---: | --- |"
  );
  candidates.candidates.forEach((candidate, index) => {
    const coverage = [...candidate.sectors, ...candidate.geographies].join(", ");
    lines.push(`| ${index + 1} | ${fixed(candidate.relevanceScore, 6)} | ${escapeCell(candidate.sourceId)} | ${markdownLink(candidate.title, candidate.citationUrl)} | ${candidate.publishedAt.slice(0, 10)} | ${escapeCell(coverage)} | ${candidate.duplicateMatches?.length ?? 0} | ${contributionMath(candidate)} |`);
  });

  lines.push("", "### Duplicate decisions", "");
  if (duplicateCount === 0) {
    lines.push("No accepted candidates were collapsed as duplicate coverage.");
  } else {
    lines.push("Every collapsed item remains linked below with its deterministic match method. Same-source recurring releases are queue consolidation, not corroboration.", "");
    for (const candidate of candidates.candidates) {
      for (const match of candidate.duplicateMatches ?? []) {
        const relatedLabel = `${match.title}${match.releaseId ? ` (release ${match.releaseId})` : ""}`;
        const reason = match.method === "recurring-series"
          ? "same source and report landing page; distinct dated release"
          : `anchors: ${escapeCell(match.sharedTerms.join(", ") || "strict full-text similarity")}`;
        lines.push(`- ${markdownLink(candidate.title, candidate.citationUrl)} grouped ${markdownLink(relatedLabel, match.evidenceUrl ?? match.citationUrl)} from ${escapeCell(match.sourceId)} using \`${match.method}\`; ${reason}.`);
      }
    }
  }

  if (manifest.warnings.length) {
    lines.push("", "### Run warnings", "");
    for (const warning of manifest.warnings) lines.push(`- ${escapeCell(warning)}`);
  }
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const issueDate = process.argv[2];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(issueDate ?? "")) {
    throw new Error("Usage: render-audit.ts YYYY-MM-DD");
  }
  const directory = resolve("src", "data", "research-runs");
  const [candidateText, manifestText] = await Promise.all([
    readFile(resolve(directory, `${issueDate}.candidates.json`), "utf8"),
    readFile(resolve(directory, `${issueDate}.run.json`), "utf8")
  ]);
  const candidates = candidateFileSchema.parse(JSON.parse(candidateText));
  const manifest = runManifestSchema.parse(JSON.parse(manifestText));
  if (candidates.issueDate !== issueDate || manifest.issueDate !== issueDate) {
    throw new Error("Source audit artifacts do not match the requested issue date.");
  }
  process.stdout.write(`${renderSourceAudit(candidates, manifest)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
