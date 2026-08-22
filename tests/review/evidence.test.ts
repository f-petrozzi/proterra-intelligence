import assert from "node:assert/strict";
import test from "node:test";
import { evidenceFor, extractAmsEvidence, extractDairyEvidence, extractMeatSpreadEvidence } from "../../scripts/review/prepare-evidence";
import type { Candidate } from "../../scripts/collection/types";

const candidate = {
  candidateId: "a".repeat(64),
  sourceId: "usda-ams-livestock",
  collectionRole: "evidence",
  discoveredBy: "json-api",
  canonicalUrl: "https://mpr.datamart.ams.usda.gov/services/v1.1/reports/2461?q=report_date%3D08%2F14%2F2026",
  title: "Boxed beef",
  publishedAt: "2026-08-14T14:55:20.000Z",
  releaseId: "08/14/2026",
  sectors: ["meat"],
  geographies: ["United States"],
  retrievedAt: "2026-08-17T12:00:00.000Z"
} as Candidate;

test("AMS evidence keeps only compact release-specific observations", () => {
  const evidence = extractAmsEvidence(candidate, [
    { reportSection: "Weekly Average Cutout Values", results: [{ choice_600_900_simple_avg: "373.24", select_600_900_simple_avg: "350.18" }] },
    { reportSection: "Change From Prior Week", results: [{ choice_600_900_change: "6.73", select_600_900_change: "1.95" }] },
    { reportSection: "Current Volume", results: [{ choice_volume_loads: "292.70", select_volume_loads: "85.74" }] }
  ]);
  assert.equal(evidence.length, 4);
  assert.match(evidence.join(" "), /Release 08\/14\/2026/);
  assert.match(evidence.join(" "), /\$23\.06\/cwt/);
  assert.ok(JSON.stringify(evidence).length < 1_000);
});

test("ERS dairy evidence compares the latest quarter with the prior year", () => {
  const csv = [
    "Year,Period,Timeperiod_id,Timeperiod_name,Aggregation,Data_item,Value,Units",
    '2025,"APR-JUN",14,"Quarter 2","Not applicable","Milk production",58783,"Million pounds"',
    '2026,"JAN-MAR",13,"Quarter 1","Not applicable","Milk production",58603,"Million pounds"',
    '2026,"APR-JUN",14,"Quarter 2","Not applicable","Milk production",60194,"Million pounds"'
  ].join("\n");
  assert.deepEqual(extractDairyEvidence(csv, 2026), [
    "2026 APR-JUN Milk production: 60194 Million pounds; 2025 APR-JUN: 58783 Million pounds."
  ]);
});

test("ERS meat evidence limits output to the latest two periods and editorial measures", () => {
  const csv = [
    "Year,Period,Period_Number,Data_Item,Value,Units",
    "2026,May,5,Choice beef retail value,1034.7,Cents per pound",
    "2026,June,6,Choice beef retail value,1045.0,Cents per pound",
    "2026,July,7,Choice beef retail value,1048.7,Cents per pound",
    "2026,July,7,Unrelated pork series,999,Cents per pound"
  ].join("\n");
  const evidence = extractMeatSpreadEvidence(csv, 2026);
  assert.equal(evidence.length, 2);
  assert.doesNotMatch(evidence.join(" "), /pork/i);
});

test("blocked article pages fall back only to explicitly source-supplied feed text", async () => {
  const news = {
    ...candidate,
    candidateId: "b".repeat(64),
    sourceId: "feedstuffs",
    publisherGroup: "farm-progress",
    collectionRole: "discovery",
    contentClass: "news",
    language: "en",
    canonicalUrl: "https://feedstuffs.com/dairy/example",
    citationUrl: "https://feedstuffs.com/dairy/example",
    summary: "Publisher-provided description of the reported dairy development.",
    summaryOrigin: "source-supplied",
    relevanceScore: 0.7,
    clusterId: "b".repeat(64),
    relatedUrls: []
  } as Candidate;
  const evidence = await evidenceFor(news, async () => { throw new Error("HTTP 403"); });
  assert.deepEqual(evidence.observations, [
    "Source-supplied feed summary: Publisher-provided description of the reported dairy development."
  ]);
  assert.match(evidence.evidenceLimitations.join(" "), /do not infer details beyond them/);

  await assert.rejects(
    evidenceFor({ ...news, summary: undefined, summaryOrigin: undefined }, async () => { throw new Error("HTTP 403"); }),
    /HTTP 403/
  );
});
