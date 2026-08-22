import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { candidateFileSchema, runManifestSchema } from "./types";

function parseJson(label: string, text: string) {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error instanceof Error ? error.message : error}`);
  }
}

function counts(values: string[]) {
  return Object.fromEntries([...new Set(values)].sort().map((value) => [
    value, values.filter((item) => item === value).length
  ]));
}

function sameRecord(left: Record<string, number>, right: Record<string, number>) {
  return JSON.stringify(Object.entries(left).sort()) === JSON.stringify(Object.entries(right).sort());
}

export function validateCollectionOutput(candidateText: string, manifestText: string, expectedIssueDate: string) {
  const candidates = candidateFileSchema.parse(parseJson("Candidate artifact", candidateText));
  const manifest = runManifestSchema.parse(parseJson("Run manifest", manifestText));
  if (candidates.issueDate !== expectedIssueDate || manifest.issueDate !== expectedIssueDate) {
    throw new Error("Generated artifacts do not match the requested issue date.");
  }
  if (manifest.candidateCount !== candidates.candidates.length) {
    throw new Error("Run manifest candidate count does not match the candidate artifact.");
  }
  if (manifest.reviewSelection) {
    const selection = manifest.reviewSelection;
    if (candidates.candidates.some((candidate) => !candidate.publisherGroup || !candidate.reviewTier || !candidate.selectionBasis)) {
      throw new Error("Publisher-aware review metadata is incomplete.");
    }
    const selected = candidates.candidates.filter((candidate) => candidate.reviewTier === "review-first");
    if (selected.length !== selection.selectedCount || selected.length > selection.target) {
      throw new Error("Review-first count does not match the run manifest policy.");
    }
    if (selected.some((candidate) => candidate.contentClass !== "news")
      || candidates.candidates.some((candidate) => candidate.reviewTier === "supporting-data" && candidate.contentClass !== "dataset")) {
      throw new Error("Review tiers do not match candidate content classes.");
    }
    const tierOrder = { "review-first": 0, "also-review": 1, "supporting-data": 2 } as const;
    if (candidates.candidates.some((candidate, index, all) => index > 0
      && tierOrder[candidate.reviewTier!] < tierOrder[all[index - 1].reviewTier!])) {
      throw new Error("Candidate artifact review tiers are not in review order.");
    }
    const publisherGroups = counts(selected.map((candidate) => candidate.publisherGroup!));
    if (!sameRecord(publisherGroups, selection.publisherGroups)
      || Object.keys(publisherGroups).length !== selection.distinctPublisherGroups) {
      throw new Error("Review-first publisher mix does not match the run manifest.");
    }
    const sectorCounts = counts(selected.flatMap((candidate) => candidate.sectors));
    const sectors = {
      dairy: sectorCounts.dairy ?? 0,
      meat: sectorCounts.meat ?? 0,
      "bovine-genetics": sectorCounts["bovine-genetics"] ?? 0
    };
    const international = selected.filter((candidate) =>
      candidate.geographies.some((geography) => geography !== "United States")).length;
    if (!sameRecord(sectors, selection.coverage.sectors) || international !== selection.coverage.international) {
      throw new Error("Review-first coverage does not match the run manifest.");
    }
    for (const [group, count] of Object.entries(publisherGroups)) {
      if (count > selection.publisherFamilyCap && !selected.some((candidate) =>
        candidate.publisherGroup === group && candidate.selectionBasis === "publisher-cap-exception")) {
        throw new Error(`Publisher group ${group} exceeds the cap without an explicit exception.`);
      }
    }
  }
  return { status: manifest.status, readiness: manifest.editorialReadiness };
}

async function main() {
  const [issueDate, candidatesPath, manifestPath] = process.argv.slice(2);
  if (!issueDate || !candidatesPath || !manifestPath) {
    throw new Error("Usage: validate-output.ts ISSUE_DATE CANDIDATES_PATH MANIFEST_PATH");
  }
  const [candidateText, manifestText] = await Promise.all([
    readFile(candidatesPath, "utf8"),
    readFile(manifestPath, "utf8")
  ]);
  const result = validateCollectionOutput(candidateText, manifestText, issueDate);
  process.stdout.write(`status=${result.status}\nreadiness=${result.readiness}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
