import assert from "node:assert/strict";
import test from "node:test";
import { fetchWithPolicy } from "../../scripts/collection/fetch";
import type { CollectionSource } from "../../scripts/collection/types";

const source: CollectionSource = {
  sourceId: "fao-americas", enabled: true, collectionRole: "evidence", method: "rss",
  endpoint: "https://example.org/feed", allowedHosts: ["example.org"], sectors: ["dairy"], geographies: ["International"],
  lookbackDays: 10, rateLimitMs: 0, timeoutMs: 1000, maxResponseBytes: 8, minimumItemsSeen: 1,
  notes: "Fixture source for fetch tests."
};

test("rejects oversized responses", async () => {
  const fetcher: typeof fetch = async () => new Response("123456789", { status: 200 });
  await assert.rejects(fetchWithPolicy(source, fetcher), /too large/);
});

test("rejects redirects to an unconfigured host", async () => {
  const fetcher: typeof fetch = async () => new Response(null, { status: 302, headers: { location: "https://evil.example/feed" } });
  await assert.rejects(fetchWithPolicy(source, fetcher), /not allowed/);
});
