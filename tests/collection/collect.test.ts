import assert from "node:assert/strict";
import test from "node:test";
import { collectSources, reportingWindow } from "../../scripts/collection/collect";

const source = (id: "fao-americas" | "iica", endpoint: string) => ({
  sourceId: id, enabled: true, collectionRole: "evidence" as const, method: "rss" as const, endpoint,
  allowedHosts: ["example.org"], sectors: ["dairy" as const], geographies: ["International"], lookbackDays: 10,
  rateLimitMs: 0, timeoutMs: 1000, maxResponseBytes: 100_000, minimumItemsSeen: 1,
  notes: "Fixture source for collection tests."
});

test("uses Eastern midnight across the reporting window", () => {
  assert.deepEqual(reportingWindow("2026-08-24"), {
    start: "2026-08-17T04:00:00.000Z", end: "2026-08-24T04:00:00.000Z", timezone: "America/New_York"
  });
});

test("continues after an adapter failure and emits a partial manifest", async () => {
  const feed = `<?xml version="1.0"?><rss><channel><item><title>Weekly dairy release</title><link>https://example.org/a</link><pubDate>2026-08-22T12:00:00Z</pubDate></item></channel></rss>`;
  const fetcher: typeof fetch = async (input) => {
    if (String(input).endsWith("bad.xml")) return new Response("failure", { status: 500 });
    return new Response(feed, { status: 200, headers: { "content-type": "application/rss+xml" } });
  };
  const result = await collectSources({
    issueDate: "2026-08-24", now: new Date("2026-08-24T11:00:00Z"), fetcher,
    registry: { version: 1, sources: [source("fao-americas", "https://example.org/feed.xml"), source("iica", "https://example.org/bad.xml")] }
  });
  assert.equal(result.manifest.status, "partial");
  assert.equal(result.candidateFile.candidates.length, 1);
  assert.equal(result.manifest.adapters[1].status, "failed");
});

test("treats an unexpectedly empty adapter as failed instead of silently healthy", async () => {
  const fetcher: typeof fetch = async () => new Response("<?xml version=\"1.0\"?><rss><channel></channel></rss>", {
    status: 200, headers: { "content-type": "application/rss+xml" }
  });
  const result = await collectSources({
    issueDate: "2026-08-24", now: new Date("2026-08-24T11:00:00Z"), fetcher,
    registry: { version: 1, sources: [source("fao-americas", "https://example.org/feed.xml")] }
  });
  assert.equal(result.manifest.status, "failed");
  assert.match(result.manifest.adapters[0].error ?? "", /expected at least 1/);
});

test("five domestic candidates still produce a coverage gap without every sector and international coverage", async () => {
  const items = Array.from({ length: 5 }, (_, index) =>
    `<item><title>Dairy release ${index + 1}</title><link>https://example.org/dairy-${index + 1}</link><pubDate>2026-08-22T12:00:00Z</pubDate></item>`
  ).join("");
  const fetcher: typeof fetch = async () => new Response(`<?xml version="1.0"?><rss><channel>${items}</channel></rss>`, {
    status: 200, headers: { "content-type": "application/rss+xml" }
  });
  const result = await collectSources({
    issueDate: "2026-08-24", now: new Date("2026-08-24T11:00:00Z"), fetcher,
    registry: { version: 1, sources: [{
      sourceId: "usda-ers-dairy", enabled: true, collectionRole: "evidence", method: "rss",
      endpoint: "https://example.org/feed.xml", allowedHosts: ["example.org"], sectors: ["dairy"],
      geographies: ["United States"], lookbackDays: 10, rateLimitMs: 0, timeoutMs: 1000,
      maxResponseBytes: 100_000, minimumItemsSeen: 1, notes: "Domestic dairy fixture source."
    }] }
  });
  assert.equal(result.manifest.candidateCount, 5);
  assert.equal(result.manifest.editorialReadiness, "coverage-gap");
  assert.ok(result.manifest.coverageGaps.some((gap) => gap.includes("bovine-genetics")));
  assert.ok(result.manifest.coverageGaps.some((gap) => gap.includes("outside the United States")));
});
