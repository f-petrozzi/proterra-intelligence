import assert from "node:assert/strict";
import test from "node:test";
import { clusterCandidates, duplicateMatch, hammingDistance, simhash, tokenize } from "../../scripts/collection/cluster";
import { normalizeCandidate } from "../../scripts/collection/normalize";
import type { CollectionSource } from "../../scripts/collection/types";

const retrievedAt = "2026-08-24T11:00:00.000Z";
const source = (host: string): CollectionSource => ({
  sourceId: "usda-nass", enabled: true, collectionRole: "discovery", method: "rss",
  endpoint: `https://${host}/feed`, allowedHosts: [host], sectors: ["dairy", "meat", "bovine-genetics"],
  geographies: ["United States", "International"], lookbackDays: 10, rateLimitMs: 0, timeoutMs: 1000,
  maxResponseBytes: 100_000, minimumItemsSeen: 1, notes: "Fixture discovery source for clustering tests."
});
const item = (host: string, title: string, path: string) =>
  normalizeCandidate({ title, url: `https://${host}/${path}`, publishedAt: "2026-08-22T12:00:00Z" }, source(host), retrievedAt);

test("SimHash fingerprints match for identical token sets and differ for unrelated text", () => {
  assert.equal(simhash(tokenize("cattle disease outbreak confirmed")), simhash(tokenize("cattle disease outbreak confirmed")));
  const distance = hammingDistance(
    simhash(tokenize("cattle disease outbreak confirmed in herds")),
    simhash(tokenize("dairy cheese exports reach new record high"))
  );
  assert.ok(distance > 3);
});

test("the same story from two outlets collapses into one cluster with related links", () => {
  const candidates = [
    item("a.example.org", "Cattle disease outbreak confirmed in northern herds", "a"),
    item("b.example.org", "Cattle disease outbreak confirmed in northern herds", "b"),
    item("c.example.org", "Dairy cheese exports reach a new record high", "c")
  ];
  const clusters = clusterCandidates(candidates);
  assert.equal(clusters.length, 2);
  const outbreak = clusters.find((cluster) => cluster.members.length === 2);
  assert.ok(outbreak);
  assert.equal(outbreak!.members.length, 2);
  assert.equal(outbreak!.matches.length, 1);
  assert.equal(outbreak!.matches[0].method, "strict-text");
  assert.match(outbreak!.clusterId, /^[a-f0-9]{64}$/);
});

test("distinct stories are not clustered together", () => {
  const candidates = [
    item("a.example.org", "Milk production climbs across the Midwest", "a"),
    item("a.example.org", "Beef exports decline on tariff pressure", "b"),
    item("a.example.org", "Genomic evaluation adds new fertility traits", "c")
  ];
  assert.equal(clusterCandidates(candidates).length, 3);
});

test("event signatures cluster differently worded coverage of the same beef-import announcement", () => {
  const beefMagazine = normalizeCandidate({
    title: "Cattle groups react to Trump’s beef import post",
    summary: "Trump says U.S. will allow up to 300K metric tons of beef to be imported tariff free for 90 days.",
    url: "https://beef.example.org/import-post", publishedAt: "2026-08-21T17:14:42Z"
  }, { ...source("beef.example.org"), sourceId: "beef-magazine" }, retrievedAt);
  const farmProgress = normalizeCandidate({
    title: "Trump announces tariff relief for ground beef imports",
    summary: "President says exporters have committed to selling 25% below current market prices.",
    url: "https://farm.example.org/tariff-relief", publishedAt: "2026-08-21T18:37:03Z"
  }, { ...source("farm.example.org"), sourceId: "farm-progress" }, retrievedAt);
  const match = duplicateMatch(beefMagazine, farmProgress);
  assert.equal(match.matched, true);
  assert.equal(match.method, "event-signature");
  assert.deepEqual(match.sharedTerms, ["import", "tariff", "trump"]);
  const [cluster] = clusterCandidates([beefMagazine, farmProgress]);
  assert.equal(cluster.members.length, 2);
  assert.equal(cluster.matches[0].method, "event-signature");
});

test("event signatures do not merge adjacent Trump tariff and cattle-import developments", () => {
  const beefTariff = normalizeCandidate({
    title: "Trump announces tariff relief for ground beef imports",
    summary: "Foreign beef imports will avoid the out of quota tariff for 90 days.",
    url: "https://farm.example.org/beef-tariff", publishedAt: "2026-08-21T18:37:03Z"
  }, { ...source("farm.example.org"), sourceId: "farm-progress" }, retrievedAt);
  const mexicanCattle = normalizeCandidate({
    title: "Is the U.S. ready for Mexican cattle imports?",
    summary: "Trump administration officials discuss reopening southern ports after screwworm controls.",
    url: "https://other.example.org/mexican-cattle", publishedAt: "2026-08-20T17:21:58Z"
  }, { ...source("other.example.org"), sourceId: "feedstuffs" }, retrievedAt);
  assert.equal(duplicateMatch(beefTariff, mexicanCattle).matched, false);
  assert.equal(clusterCandidates([beefTariff, mexicanCattle]).length, 2);
});

test("dated releases from one recurring dataset are consolidated without claiming corroboration", () => {
  const datasetSource: CollectionSource = {
    ...source("data.example.org"), sourceId: "usda-ams-livestock", collectionRole: "evidence"
  };
  const release = (date: string) => normalizeCandidate({
    title: "National Weekly Boxed Beef Cutout Report",
    url: `https://data.example.org/reports/2461?q=report_date=${encodeURIComponent(date)}`,
    landingUrl: "https://data.example.org/viewReport/2461",
    releaseId: date,
    publishedAt: "2026-08-21T12:00:00Z"
  }, datasetSource, retrievedAt);
  const match = duplicateMatch(release("08/21/2026"), release("08/14/2026"));
  assert.equal(match.matched, true);
  assert.equal(match.method, "recurring-series");
  assert.deepEqual(match.sharedTerms, []);
});
