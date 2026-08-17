import assert from "node:assert/strict";
import test from "node:test";
import { candidateId, canonicalizeUrl, classifyCandidate, deduplicateCandidates, normalizeCandidate, parsePublicationDate } from "../../scripts/collection/normalize";
import type { Candidate, CollectionSource } from "../../scripts/collection/types";

const source: CollectionSource = {
  sourceId: "fao-americas", enabled: true, collectionRole: "evidence", method: "rss",
  endpoint: "https://example.org/feed.xml", allowedHosts: ["example.org"], sectors: ["dairy"],
  geographies: ["International"], lookbackDays: 10, rateLimitMs: 0, timeoutMs: 1000,
  maxResponseBytes: 100_000, minimumItemsSeen: 1, notes: "Fixture source for normalization tests."
};

test("canonical URLs remove tracking, fragments, duplicate slashes, and www", () => {
  const value = canonicalizeUrl("https://www.example.org//news/item/?utm_source=x&b=2&a=1#top");
  assert.equal(value, "https://example.org/news/item?a=1&b=2");
  assert.equal(candidateId(value).length, 64);
});

test("source summaries remain labeled and markup is stripped", () => {
  const candidate = normalizeCandidate({
    title: "  New   report ", url: "https://example.org/report", publishedAt: "2026-08-22", summary: "<p>Reported facts.</p>"
  }, source, "2026-08-24T11:00:00.000Z");
  assert.equal(candidate.title, "New report");
  assert.equal(candidate.summary, "Reported facts.");
  assert.equal(candidate.summaryOrigin, "source-supplied");
});

test("deduplicates exact canonical URLs and conservatively identical titles", () => {
  const base = normalizeCandidate({ title: "New dairy report", url: "https://example.org/a", publishedAt: "2026-08-22" }, source, "2026-08-24T11:00:00.000Z");
  const candidates: Candidate[] = [
    base,
    { ...base },
    { ...base, candidateId: "b".repeat(64), canonicalUrl: "https://example.org/b", title: "New dairy report!" },
    { ...base, candidateId: "c".repeat(64), canonicalUrl: "https://example.org/c", title: "Different official report" }
  ];
  assert.deepEqual(deduplicateCandidates(candidates).map((candidate) => candidate.canonicalUrl), ["https://example.org/a", "https://example.org/c"]);
});

test("deduplication preserves merged sector and geography coverage", () => {
  const dairy = normalizeCandidate({ title: "Livestock and dairy outlook", url: "https://example.org/outlook", publishedAt: "2026-08-22" }, source, "2026-08-24T11:00:00.000Z");
  const meat = { ...dairy, sourceId: "usda-ers-livestock", sectors: ["meat" as const], geographies: ["United States"] };
  const [merged] = deduplicateCandidates([dairy, meat]);
  assert.deepEqual(merged.sectors, ["dairy", "meat"]);
  assert.deepEqual(merged.geographies, ["International", "United States"]);
});

test("normalizes the explicit date formats used by configured HTML listings", () => {
  assert.equal(parsePublicationDate("13/08/2026").toISOString(), "2026-08-13T12:00:00.000Z");
  assert.equal(parsePublicationDate("August 17, 2026").toISOString(), "2026-08-17T12:00:00.000Z");
  assert.equal(parsePublicationDate("8/13/26").toISOString(), "2026-08-13T12:00:00.000Z");
  assert.equal(parsePublicationDate("2026-08-13T11:00:00").toISOString(), "2026-08-13T11:00:00.000Z");
});

test("classifies sectors and geography from each article instead of copying all source tags", () => {
  const broad: CollectionSource = {
    ...source,
    sectors: ["dairy", "meat", "bovine-genetics"],
    geographies: ["United States", "Latin America & Caribbean", "Puerto Rico", "International"],
    includeTerms: ["dairy", "cattle", "genomic"]
  };
  assert.deepEqual(classifyCandidate({
    title: "Puerto Rico dairy genomic evaluation released",
    url: "https://example.org/release",
    publishedAt: "2026-08-22"
  }, broad), { sectors: ["bovine-genetics", "dairy"], geographies: ["Puerto Rico"] });
  assert.equal(classifyCandidate({
    title: "Pollinator and tree beetle census",
    url: "https://example.org/unrelated",
    publishedAt: "2026-08-22"
  }, broad), undefined);
});
