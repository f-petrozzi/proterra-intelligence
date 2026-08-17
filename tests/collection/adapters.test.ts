import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { parseCsvApi } from "../../scripts/collection/adapters/csv-api";
import { parseHtmlList } from "../../scripts/collection/adapters/html-list";
import { parseJsonApi } from "../../scripts/collection/adapters/json-api";
import { parseRss } from "../../scripts/collection/adapters/rss";
import type { CollectionSource } from "../../scripts/collection/types";

const fixture = (name: string) => readFile(resolve("tests/collection/fixtures", name), "utf8");
const base: Omit<CollectionSource, "method"> = {
  sourceId: "fao-americas", enabled: true, collectionRole: "evidence", endpoint: "https://example.org/releases",
  allowedHosts: ["example.org"], sectors: ["dairy"], geographies: ["International"], lookbackDays: 10,
  rateLimitMs: 0, timeoutMs: 1000, maxResponseBytes: 100_000, minimumItemsSeen: 1,
  notes: "Fixture source for adapter tests."
};

test("parses RSS and Atom feeds", async () => {
  const rss = parseRss(await fixture("feed.xml"));
  const atom = parseRss(await fixture("feed.atom"));
  assert.equal(rss[0].title, "Weekly dairy release");
  assert.equal(rss[0].summary, "<p>Source supplied summary.</p>");
  assert.equal(atom[0].url, "https://example.org/evaluations/august");
});

test("parses configured JSON fields", async () => {
  const source: CollectionSource = {
    ...base, method: "json-api",
    jsonMapping: { itemsPath: "data.releases", title: "headline", url: "href", publishedAt: "date", summary: "abstract" }
  };
  assert.equal(parseJsonApi(await fixture("releases.json"), source)[0].title, "Official market report");
});

test("uses a configured report URL when API rows omit their own URL", async () => {
  const fixedUrl = "https://example.org/services/reports/2461?lastReports=2";
  const source: CollectionSource = {
    ...base, method: "json-api",
    jsonMapping: { itemsPath: "data.releases", title: "headline", fixedUrl, publishedAt: "date" }
  };
  assert.equal(parseJsonApi(await fixture("releases.json"), source)[0].url, fixedUrl);
});

test("builds immutable release URLs and metadata from API row fields", () => {
  const source: CollectionSource = {
    ...base, method: "json-api",
    jsonMapping: {
      itemsPath: "results", title: "report_title", publishedAt: "published_date", releaseId: "report_date",
      urlTemplate: "https://example.org/reports/2461?q=report_date={report_date}",
      landingUrl: "https://example.org/viewReport/2461"
    }
  };
  const item = parseJsonApi(JSON.stringify({ results: [{
    report_title: "Weekly boxed beef", report_date: "08/14/2026", published_date: "08/14/2026 14:55:20"
  }] }), source)[0];
  assert.equal(item.url, "https://example.org/reports/2461?q=report_date=08%2F14%2F2026");
  assert.equal(item.releaseId, "08/14/2026");
  assert.equal(item.landingUrl, "https://example.org/viewReport/2461");
});

test("parses configured CSV fields", async () => {
  const source: CollectionSource = {
    ...base, method: "csv-api",
    csvMapping: { title: "headline", url: "href", publishedAt: "date", summary: "abstract" }
  };
  assert.equal(parseCsvApi(await fixture("releases.csv"), source)[0].title, "Official cattle report");
});

test("parses a scoped HTML listing", async () => {
  const source: CollectionSource = {
    ...base, method: "html-list",
    htmlMapping: {
      itemSelector: ".release", titleSelector: "h2", linkSelector: ".release-link",
      dateSelector: "time", dateAttribute: "datetime", summarySelector: "p"
    }
  };
  const item = parseHtmlList(await fixture("releases.html"), source)[0];
  assert.equal(item.url, "https://example.org/news/regional");
  assert.equal(item.publishedAt, "2026-08-22T10:00:00Z");
});
