import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCandidate } from "../../scripts/collection/normalize";
import { authorityWeightOf, scoreCandidate, scoreCandidateBreakdown } from "../../scripts/collection/score";
import type { CollectionSource } from "../../scripts/collection/types";

const windowEnd = "2026-08-24T04:00:00.000Z";
const retrievedAt = "2026-08-24T11:00:00.000Z";
const discovery: CollectionSource = {
  sourceId: "usda-nass", enabled: true, collectionRole: "discovery", method: "rss",
  endpoint: "https://example.org/feed", allowedHosts: ["example.org"],
  sectors: ["dairy", "meat", "bovine-genetics"], geographies: ["United States", "International"],
  lookbackDays: 10, rateLimitMs: 0, timeoutMs: 1000, maxResponseBytes: 100_000, minimumItemsSeen: 1,
  notes: "Fixture discovery source for scoring tests."
};
const evidence: CollectionSource = { ...discovery, sourceId: "usda-ers-dairy", collectionRole: "evidence" };

const build = (source: CollectionSource, title: string, publishedAt: string) =>
  normalizeCandidate({ title, url: `https://example.org/${encodeURIComponent(title)}`, publishedAt }, source, retrievedAt);

const context = (clusterSize = 1) => ({
  authorityWeight: 0.7, corroboratingSourceCount: Math.max(0, clusterSize - 1), windowEnd
});

test("authority weight falls back to trust tier then a neutral default", () => {
  assert.equal(authorityWeightOf({ authorityWeight: 0.5, trustTier: "aggregator" }), 0.5);
  assert.equal(authorityWeightOf({ trustTier: "official" }), 0.9);
  assert.equal(authorityWeightOf({ trustTier: "trade-press" }), 0.7);
  assert.equal(authorityWeightOf({}), 0.6);
});

test("scoring is deterministic for identical input", () => {
  const candidate = build(discovery, "Milk production climbs in the Midwest", "2026-08-22T12:00:00Z");
  assert.equal(scoreCandidate(candidate, context()), scoreCandidate(candidate, context()));
});

test("score breakdown exposes the exact deterministic inputs and contributions", () => {
  const candidate = build(discovery, "International bovine genomic breeding evaluation advances", "2026-08-22T12:00:00Z");
  const breakdown = scoreCandidateBreakdown(candidate, context(2));
  assert.equal(breakdown.total, scoreCandidate(candidate, context(2)));
  assert.equal(breakdown.factors.authority.signal, 0.7);
  assert.equal(breakdown.factors.authority.weight, 0.24);
  assert.equal(breakdown.factors.corroboration.supportingSources, 1);
  assert.equal(breakdown.factors.corroboration.contribution, 0.033333);
  assert.ok(breakdown.factors.recency.ageDays > 1);
  assert.ok(breakdown.factors.topic.keywordHits >= 2);
  assert.equal(breakdown.adjustments.bovineGenetics, 0.08);
  assert.equal(breakdown.adjustments.international, 0.06);
  const recomputed = Object.values(breakdown.factors).reduce((sum, factor) => sum + factor.contribution, 0)
    + Object.values(breakdown.adjustments).reduce<number>((sum, adjustment) => sum + adjustment, 0);
  assert.ok(Math.abs(breakdown.total - recomputed) < 0.000003);
});

test("news-led items outrank an otherwise identical dataset release", () => {
  const news = build(discovery, "Cattle market shifts on export demand", "2026-08-22T12:00:00Z");
  const dataset = build(evidence, "Cattle market shifts on export demand", "2026-08-22T12:00:00Z");
  assert.ok(scoreCandidate(news, context()) > scoreCandidate(dataset, context()));
});

test("fresher items and corroborated clusters score higher", () => {
  const fresh = build(discovery, "Beef cattle prices rise sharply", "2026-08-23T12:00:00Z");
  const stale = build(discovery, "Beef cattle prices rise sharply", "2026-08-18T12:00:00Z");
  assert.ok(scoreCandidate(fresh, context()) > scoreCandidate(stale, context()));
  assert.ok(scoreCandidate(fresh, context(4)) > scoreCandidate(fresh, context(1)));
});

test("confident non-English items are down-ranked below an otherwise identical English item", () => {
  const base = build(discovery, "Cattle market shifts on export demand", "2026-08-22T12:00:00Z");
  const english = { ...base, language: "en" as const };
  const spanish = { ...base, language: "es" as const };
  const unknown = { ...base, language: "und" as const };
  assert.ok(scoreCandidate(english, context()) > scoreCandidate(spanish, context()));
  assert.equal(scoreCandidate(unknown, context()), scoreCandidate(english, context()));
});

test("under-represented bovine-genetics and international coverage receive a correcting boost", () => {
  const plain = build(discovery, "Dairy cattle milk output rises", "2026-08-22T12:00:00Z");
  const boosted = build(discovery, "International bovine genomic breeding evaluation advances", "2026-08-22T12:00:00Z");
  assert.ok(boosted.sectors.includes("bovine-genetics"));
  assert.ok(boosted.geographies.some((geography) => geography !== "United States"));
  assert.ok(scoreCandidate(boosted, context()) > scoreCandidate(plain, context()));
});
