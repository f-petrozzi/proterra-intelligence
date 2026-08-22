import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import rawRegistry from "../../config/collection-sources.json" with { type: "json" };
import rawEditorialSources from "../../src/data/sources.json" with { type: "json" };
import {
  candidateFileSchema, collectionRegistrySchema, runManifestSchema,
  type Candidate, type CandidateFile, type CollectionSource, type RunManifest
} from "./types";

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

function publisherGroup(candidate: Candidate) {
  return candidate.publisherGroup ?? candidate.sourceId;
}

function titleCase(value: string) {
  return value.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function groupName(value: string) {
  if (value === "usda") return "USDA";
  if (value === "fao") return "FAO";
  return titleCase(value);
}

function contributionMath(candidate: Candidate) {
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

function coverageLabel(candidate: Candidate) {
  const sectors = candidate.sectors.map((sector) => sector === "bovine-genetics" ? "genetics" : sector);
  const international = candidate.geographies.some((geography) => geography !== "United States");
  return `${sectors.join(", ")}${international ? "; non-US" : ""}`;
}

function whySurfaced(candidate: Candidate, source: CollectionSource | undefined) {
  const reasons: string[] = [];
  const basis = candidate.selectionBasis;
  if (basis === "coverage-balance") reasons.push(`Fills ${coverageLabel(candidate)} coverage`);
  else if (basis === "publisher-diversity") reasons.push("Adds an independent publisher");
  else if (basis === "queue-order") reasons.push("High in the eligible news queue");
  else if (basis === "publisher-cap-exception") reasons.push("Added to reach the eight-story review minimum");
  else if (basis === "official-data") reasons.push("Official supporting data");
  else reasons.push(`Eligible ${coverageLabel(candidate)} news`);
  if (source?.trustTier === "official") reasons.push("official source");
  else if (source?.trustTier === "trade-press") reasons.push("vetted trade source");
  const confirmations = candidate.scoreBreakdown?.factors.corroboration.supportingSources ?? 0;
  if (confirmations > 0) reasons.push(`${confirmations} independent publisher${confirmations === 1 ? "" : "s"} also covered it`);
  const sameGroupCoverage = (candidate.duplicateMatches ?? []).filter((match) =>
    (match.publisherGroup ?? match.sourceId) === publisherGroup(candidate) && match.sourceId !== candidate.sourceId).length;
  if (sameGroupCoverage > 0) reasons.push(`${sameGroupCoverage} related item${sameGroupCoverage === 1 ? "" : "s"} from the same publisher group`);
  return reasons.join("; ");
}

function sourceLabel(candidate: Candidate, sourceNames: Map<string, string>) {
  const name = sourceNames.get(candidate.sourceId) ?? titleCase(candidate.sourceId);
  const group = publisherGroup(candidate);
  return group === candidate.sourceId ? name : `${name} · ${groupName(group)} group`;
}

function candidateTable(
  lines: string[], candidates: Candidate[], sourceNames: Map<string, string>, sources: Map<string, CollectionSource>
) {
  lines.push("| Source | Story | Published | Why it surfaced |", "| --- | --- | --- | --- |");
  for (const candidate of candidates) {
    lines.push(`| ${escapeCell(sourceLabel(candidate, sourceNames))} | ${markdownLink(candidate.title, candidate.citationUrl)} | ${candidate.publishedAt.slice(0, 10)} | ${escapeCell(whySurfaced(candidate, sources.get(candidate.sourceId)))} |`);
  }
}

export function renderSourceAudit(candidates: CandidateFile, manifest: RunManifest) {
  if (candidates.candidates.some((candidate) => !candidate.scoreBreakdown || !candidate.duplicateMatches)) {
    throw new Error("The candidate queue predates deterministic audit details; rerun collection before rendering its audit.");
  }
  if (candidates.candidates.some((candidate) => !candidate.publisherGroup || !candidate.reviewTier || !candidate.selectionBasis)) {
    throw new Error("The candidate queue predates publisher-aware review selection; rerun collection before rendering its audit.");
  }
  if (!manifest.reviewSelection) {
    throw new Error("The run manifest predates publisher-aware review selection; rerun collection before rendering its audit.");
  }
  const registry = collectionRegistrySchema.parse(rawRegistry);
  const sources = new Map<string, CollectionSource>();
  for (const source of registry.sources) if (!sources.has(source.sourceId)) sources.set(source.sourceId, source);
  const sourceNames = new Map(rawEditorialSources.map((source) => [source.id, source.name]));
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
  const reviewFirst = candidates.candidates.filter((candidate) => candidate.reviewTier === "review-first");
  const alsoReview = candidates.candidates.filter((candidate) => candidate.reviewTier === "also-review");
  const supportingData = candidates.candidates.filter((candidate) => candidate.reviewTier === "supporting-data");
  const selection = manifest.reviewSelection;
  const groupMix = Object.entries(selection.publisherGroups)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([group, count]) => `${groupName(group)} ${count}`)
    .join(" · ");

  const lines = [
    "## Source review",
    "",
    `Week of **${escapeCell(candidates.issueDate)}**. Start with the ${reviewFirst.length} stories below. This is a deterministic review order, not an editorial verdict.`,
    "",
    `**Collected:** ${manifest.candidatesBeforeDeduplication} links · **Distinct stories:** ${manifest.candidateCount} · **Review first:** ${reviewFirst.length} · **Supporting data:** ${supportingData.length}`,
    "",
    `**Publisher mix in review first:** ${escapeCell(groupMix || "No news items selected")}`
  ];

  if (selection.sourceConcentrated) {
    lines.push("", `> **Publisher mix needs attention.** ${escapeCell(selection.warnings.join(" ") || "The review-first list is concentrated among too few publisher groups.")}`);
  }

  lines.push("", "### Review first", "");
  if (reviewFirst.length) candidateTable(lines, reviewFirst, sourceNames, sources);
  else lines.push("No eligible news items were selected.");

  lines.push("", `<details><summary>Also worth reviewing (${alsoReview.length})</summary>`, "");
  if (alsoReview.length) candidateTable(lines, alsoReview, sourceNames, sources);
  else lines.push("No additional news items.");
  lines.push("", "</details>");

  lines.push("", `<details><summary>Supporting data (${supportingData.length})</summary>`, "");
  if (supportingData.length) candidateTable(lines, supportingData, sourceNames, sources);
  else lines.push("No supporting datasets were collected.");
  lines.push("", "</details>");

  if (manifest.warnings.length) {
    lines.push("", "### Collection notes", "");
    for (const warning of manifest.warnings) lines.push(`- ${escapeCell(warning)}`);
  }

  lines.push(
    "", "<details><summary>Source health and collection diagnostics</summary>", "",
    "Accepted counts are before story grouping. Score ranges use surviving representative items.", "",
    "| Adapter | Publisher group | Mode | Health | Seen / accepted | Rejected: window / scope / date | Score range |",
    "| --- | --- | --- | --- | ---: | ---: | ---: |"
  );
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
      ? `${fixed(Math.min(...scores), 3)}–${fixed(Math.max(...scores), 3)} (${scores.length})` : "—";
    lines.push(`| ${escapeCell(adapterId)} | ${escapeCell(groupName(source.publisherGroup ?? source.sourceId))} | ${escapeCell(source.contentClass ?? (source.collectionRole === "evidence" ? "dataset" : source.collectionRole))} | ${escapeCell(health)} | ${observed} | ${rejected} | ${scoreRange} |`);
  }
  lines.push("", "</details>");

  lines.push("", `<details><summary>Grouped coverage (${duplicateCount} related items; ${exactUrlRepeats} exact repeats removed)</summary>`, "");
  if (duplicateCount === 0) {
    lines.push("No accepted items were grouped as coverage of the same story.");
  } else {
    lines.push("Related coverage is retained here. Brands in the same publisher group do not count as independent confirmation.", "");
    for (const candidate of candidates.candidates) {
      for (const match of candidate.duplicateMatches ?? []) {
        const relatedLabel = `${match.title}${match.releaseId ? ` (release ${match.releaseId})` : ""}`;
        const independence = (match.publisherGroup ?? match.sourceId) === publisherGroup(candidate)
          ? "same publisher group" : "independent publisher group";
        const reason = match.method === "recurring-series"
          ? "same report series; distinct dated release"
          : `anchors: ${escapeCell(match.sharedTerms.join(", ") || "strict full-text similarity")}`;
        lines.push(`- ${markdownLink(candidate.title, candidate.citationUrl)} grouped ${markdownLink(relatedLabel, match.evidenceUrl ?? match.citationUrl)} from ${escapeCell(sourceNames.get(match.sourceId) ?? match.sourceId)}; ${independence}; ${reason}.`);
      }
    }
  }
  lines.push("", "</details>");

  lines.push(
    "", "<details><summary>Technical ranking and score math</summary>", "",
    "Scores order eligible inputs. They are not probabilities, confidence ratings, or the final shortlist.", "",
    "| Factor | Rule | Maximum contribution |", "| --- | --- | ---: |",
    "| Recency (R) | Exponential decay with a 3.5-day half-life | 0.340 |",
    "| Authority (A) | Configured source authority × 0.24 | 0.240 |",
    "| Content class (N) | News = 1.0; routine dataset = 0.5 | 0.180 |",
    "| Topic signal (T) | Capped deterministic sector-keyword hits | 0.140 |",
    "| Independent coverage (C) | Up to three additional publisher groups in the same story cluster | 0.100 |",
    "| Adjustments | Bovine genetics +0.08; non-US +0.06; confident non-English −0.07 | varies |",
    "", "| Rank | Score | Source | Candidate | Published | Coverage | Calculation |",
    "| ---: | ---: | --- | --- | --- | --- | --- |"
  );
  [...candidates.candidates]
    .sort((a, b) => b.relevanceScore - a.relevanceScore || a.canonicalUrl.localeCompare(b.canonicalUrl))
    .forEach((candidate, index) => {
      lines.push(`| ${index + 1} | ${fixed(candidate.relevanceScore, 6)} | ${escapeCell(sourceLabel(candidate, sourceNames))} | ${markdownLink(candidate.title, candidate.citationUrl)} | ${candidate.publishedAt.slice(0, 10)} | ${escapeCell(coverageLabel(candidate))} | ${contributionMath(candidate)} |`);
    });
  lines.push("", "</details>", "");
  return lines.join("\n");
}

async function main() {
  const issueDate = process.argv[2];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(issueDate ?? "")) throw new Error("Usage: render-audit.ts YYYY-MM-DD");
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
