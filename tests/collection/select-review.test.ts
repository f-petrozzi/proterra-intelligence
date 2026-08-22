import assert from "node:assert/strict";
import test from "node:test";
import { buildReviewQueue } from "../../scripts/collection/select-review";
import type { Candidate } from "../../scripts/collection/types";

function candidate(index: number, group: string, options: {
  sector?: Candidate["sectors"][number];
  geography?: string;
  contentClass?: Candidate["contentClass"];
} = {}): Candidate {
  const id = index.toString(16).padStart(64, "0");
  return {
    candidateId: id,
    sourceId: `${group}-${index}`,
    publisherGroup: group,
    collectionRole: options.contentClass === "dataset" ? "evidence" : "discovery",
    contentClass: options.contentClass ?? "news",
    language: "en",
    discoveredBy: "rss",
    canonicalUrl: `https://example.org/${index}`,
    citationUrl: `https://example.org/${index}`,
    title: `Cattle market development ${index}`,
    publishedAt: `2026-08-${String(20 - (index % 5)).padStart(2, "0")}T12:00:00.000Z`,
    sectors: [options.sector ?? "meat"],
    geographies: [options.geography ?? "United States"],
    retrievedAt: "2026-08-22T12:00:00.000Z",
    relevanceScore: 1 - index / 100,
    clusterId: id,
    relatedUrls: []
  };
}

test("review-first balances coverage and publisher families before raw rank", () => {
  const ranked = [
    ...Array.from({ length: 8 }, (_, index) => candidate(index + 1, "farm-progress", {
      sector: index === 1 ? "dairy" : index === 2 ? "bovine-genetics" : "meat"
    })),
    candidate(20, "ag-proud", { sector: "dairy" }),
    candidate(21, "fao", { geography: "International" }),
    candidate(22, "iica", { sector: "bovine-genetics", geography: "Latin America & Caribbean" }),
    candidate(23, "usda", { sector: "dairy" }),
    candidate(24, "ag-proud"),
    candidate(25, "fao", { geography: "International" }),
    candidate(26, "iica", { geography: "Latin America & Caribbean" })
  ];
  const result = buildReviewQueue(ranked);
  const selected = result.candidates.filter((item) => item.reviewTier === "review-first");
  assert.equal(selected.length, 10);
  assert.ok(selected.filter((item) => item.publisherGroup === "farm-progress").length <= 3);
  assert.ok(new Set(selected.map((item) => item.publisherGroup)).size >= 4);
  assert.ok(selected.some((item) => item.sectors.includes("dairy")));
  assert.ok(selected.some((item) => item.sectors.includes("bovine-genetics")));
  assert.ok(selected.some((item) => item.geographies.some((geography) => geography !== "United States")));
});

test("a concentrated pool relaxes the family cap only to the eight-item minimum", () => {
  const result = buildReviewQueue(Array.from({ length: 12 }, (_, index) => candidate(index + 1, "one-family")));
  const selected = result.candidates.filter((item) => item.reviewTier === "review-first");
  assert.equal(selected.length, 8);
  assert.equal(selected.filter((item) => item.selectionBasis === "publisher-cap-exception").length, 5);
  assert.equal(result.summary.sourceConcentrated, true);
  assert.ok(result.summary.warnings.some((warning) => warning.includes("cap was relaxed")));
});

test("datasets remain supporting material outside the news shortlist", () => {
  const result = buildReviewQueue([
    candidate(1, "publisher-a"),
    candidate(2, "usda", { contentClass: "dataset" })
  ]);
  assert.equal(result.candidates[0].reviewTier, "review-first");
  assert.equal(result.candidates[1].reviewTier, "supporting-data");
  assert.equal(result.candidates[1].selectionBasis, "official-data");
});
