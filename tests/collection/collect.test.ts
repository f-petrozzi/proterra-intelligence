import assert from "node:assert/strict";
import test from "node:test";
import { collectSources, reportingWindow } from "../../scripts/collection/collect";
import { renderSourceAudit } from "../../scripts/collection/render-audit";
import { candidateFileSchema } from "../../scripts/collection/types";

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

test("renders a complete pre-Codex audit with source health and score reasoning", async () => {
  const feed = `<?xml version="1.0"?><rss><channel><item><title>International dairy genetics update</title>`
    + `<link>https://example.org/genetics</link><pubDate>2026-08-22T12:00:00Z</pubDate></item></channel></rss>`;
  const fetcher: typeof fetch = async () => new Response(feed, {
    status: 200, headers: { "content-type": "application/rss+xml" }
  });
  const result = await collectSources({
    issueDate: "2026-08-24", now: new Date("2026-08-24T11:00:00Z"), fetcher,
    registry: { version: 1, sources: [source("fao-americas", "https://example.org/feed.xml")] }
  });
  const audit = renderSourceAudit(result.candidateFile, result.manifest);
  assert.match(audit, /## Deterministic source audit/);
  assert.match(audit, /Scores rank the accepted queue; they are not probabilities/);
  assert.match(audit, /### Scoring formula/);
  assert.match(audit, /fao-americas.*Healthy.*1 \/ 1/s);
  assert.match(audit, /linkedin-org-post.*Manual; not fetched/s);
  assert.match(audit, /### Ranked candidates/);
  assert.match(audit, /R \d\.\d{3} \+ A \d\.\d{3} \+ N \d\.\d{3} \+ T \d\.\d{3} \+ C \d\.\d{3} \+ Adj/);
  assert.match(audit, /### Duplicate decisions/);
  assert.match(audit, /No accepted candidates were collapsed/);
  const candidate = result.candidateFile.candidates[0];
  assert.throws(() => candidateFileSchema.parse({
    ...result.candidateFile,
    candidates: [{
      ...candidate,
      scoreBreakdown: { ...candidate.scoreBreakdown!, total: candidate.relevanceScore + 0.1 }
    }]
  }), /total does not equal factor contributions/);
});

test("duplicate links from one publisher do not count as independent corroboration", async () => {
  const titles = [
    "Dairy cattle disease response announced for northern herds",
    "Dairy cattle disease response announces for northern herds"
  ];
  const items = titles.map((title, index) =>
    `<item><title>${title}</title><link>https://example.org/${index + 1}</link><pubDate>2026-08-22T12:00:00Z</pubDate></item>`
  ).join("");
  const fetcher: typeof fetch = async () => new Response(`<?xml version="1.0"?><rss><channel>${items}</channel></rss>`, {
    status: 200, headers: { "content-type": "application/rss+xml" }
  });
  const result = await collectSources({
    issueDate: "2026-08-24", now: new Date("2026-08-24T11:00:00Z"), fetcher,
    registry: { version: 1, sources: [source("fao-americas", "https://example.org/feed.xml")] }
  });
  const [candidate] = result.candidateFile.candidates;
  assert.equal(result.candidateFile.candidates.length, 1);
  assert.equal(candidate.relatedUrls.length, 0);
  assert.equal(candidate.duplicateMatches?.[0].method, "strict-text");
  assert.equal(candidate.scoreBreakdown?.factors.corroboration.supportingSources, 0);
  assert.equal(candidate.scoreBreakdown?.factors.corroboration.contribution, 0);
});

test("honors per-source lookbackDays and reports out-of-window rejections", async () => {
  const feed = `<?xml version="1.0"?><rss><channel><item><title>Cattle news from nine days ago</title>`
    + `<link>https://example.org/cattle-nine</link><pubDate>2026-08-15T12:00:00Z</pubDate></item></channel></rss>`;
  const fetcher: typeof fetch = async () => new Response(feed, { status: 200, headers: { "content-type": "application/rss+xml" } });
  const base = {
    enabled: true, collectionRole: "discovery" as const, method: "rss" as const, endpoint: "https://example.org/feed.xml",
    allowedHosts: ["example.org"], sectors: ["meat" as const], geographies: ["United States"], rateLimitMs: 0,
    timeoutMs: 1000, maxResponseBytes: 100_000, minimumItemsSeen: 1, notes: "Per-source lookback fixture."
  };
  const wide = await collectSources({
    issueDate: "2026-08-24", now: new Date("2026-08-24T11:00:00Z"), fetcher,
    registry: { version: 1, sources: [{ ...base, sourceId: "usda-nass", lookbackDays: 10 }] }
  });
  assert.equal(wide.manifest.candidateCount, 1);
  const narrow = await collectSources({
    issueDate: "2026-08-24", now: new Date("2026-08-24T11:00:00Z"), fetcher,
    registry: { version: 1, sources: [{ ...base, sourceId: "usda-nass", lookbackDays: 7 }] }
  });
  assert.equal(narrow.manifest.candidateCount, 0);
  assert.equal(narrow.manifest.adapters[0].rejectedOutOfWindow, 1);
  assert.ok(narrow.manifest.warnings.some((warning) => warning.includes("accepted none")));
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

test("five news-led domestic candidates are news-ready but still flag missing sector and international coverage", async () => {
  const titles = [
    "Milk production climbs across the Midwest",
    "Cheese exports reach a record high",
    "Butter inventories tighten sharply",
    "Whey prices rally on export demand",
    "Farm milk margins improve for producers"
  ];
  const items = titles.map((title, index) =>
    `<item><title>${title}</title><link>https://example.org/dairy-${index + 1}</link><pubDate>2026-08-22T12:00:00Z</pubDate></item>`
  ).join("");
  const fetcher: typeof fetch = async () => new Response(`<?xml version="1.0"?><rss><channel>${items}</channel></rss>`, {
    status: 200, headers: { "content-type": "application/rss+xml" }
  });
  const result = await collectSources({
    issueDate: "2026-08-24", now: new Date("2026-08-24T11:00:00Z"), fetcher,
    registry: { version: 1, sources: [{
      sourceId: "usda-nass", enabled: true, collectionRole: "discovery", method: "rss",
      endpoint: "https://example.org/feed.xml", allowedHosts: ["example.org"], sectors: ["dairy"],
      geographies: ["United States"], lookbackDays: 10, rateLimitMs: 0, timeoutMs: 1000,
      maxResponseBytes: 100_000, minimumItemsSeen: 1, notes: "Domestic dairy fixture source."
    }] }
  });
  assert.equal(result.manifest.candidateCount, 5);
  assert.equal(result.manifest.newsCandidateCount, 5);
  assert.equal(result.manifest.newsReadiness, "ready");
  assert.equal(result.manifest.editorialReadiness, "coverage-gap");
  assert.ok(result.manifest.coverageGaps.some((gap) => gap.includes("bovine-genetics")));
  assert.ok(result.manifest.coverageGaps.some((gap) => gap.includes("outside the United States")));
});

test("a dataset-only queue is never news-ready even at five candidates", async () => {
  const titles = [
    "Weekly boxed beef cutout report",
    "Monthly milk production dataset",
    "Cattle slaughter summary release",
    "Dairy products price dataset",
    "Meat price spreads data product"
  ];
  const items = titles.map((title, index) =>
    `<item><title>${title}</title><link>https://example.org/set-${index + 1}</link><pubDate>2026-08-22T12:00:00Z</pubDate></item>`
  ).join("");
  const fetcher: typeof fetch = async () => new Response(`<?xml version="1.0"?><rss><channel>${items}</channel></rss>`, {
    status: 200, headers: { "content-type": "application/rss+xml" }
  });
  const result = await collectSources({
    issueDate: "2026-08-24", now: new Date("2026-08-24T11:00:00Z"), fetcher,
    registry: { version: 1, sources: [{
      sourceId: "usda-ers-dairy", enabled: true, collectionRole: "evidence", method: "rss",
      endpoint: "https://example.org/feed.xml", allowedHosts: ["example.org"], sectors: ["dairy", "meat"],
      geographies: ["United States"], lookbackDays: 10, rateLimitMs: 0, timeoutMs: 1000,
      maxResponseBytes: 100_000, minimumItemsSeen: 1, notes: "Domestic dataset fixture source."
    }] }
  });
  assert.equal(result.manifest.datasetCandidateCount, 5);
  assert.equal(result.manifest.newsCandidateCount, 0);
  assert.equal(result.manifest.newsReadiness, "insufficient-news");
  assert.equal(result.manifest.editorialReadiness, "coverage-gap");
  assert.ok(result.manifest.warnings.some((warning) => warning.includes("news-led candidates")));
});
