import assert from "node:assert/strict";
import test from "node:test";
import { clusterCandidates, hammingDistance, simhash, tokenize } from "../../scripts/collection/cluster";
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
