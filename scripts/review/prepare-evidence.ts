import { load } from "cheerio";
import { parse } from "csv-parse/sync";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { candidateFileSchema, type Candidate } from "../collection/types";

export type EvidenceItem = {
  candidateId: string;
  reviewId: string;
  sourceId: string;
  publisherGroup: string;
  contentClass: string;
  reviewTier: string;
  selectionBasis: string;
  independentPublisherCount: number;
  language: string;
  relevanceScore: number;
  title: string;
  publishedAt: string;
  citationUrl: string;
  canonicalUrl: string;
  evidenceUrl?: string;
  landingUrl?: string;
  relatedUrls: string[];
  releaseId?: string;
  sectors: string[];
  geographies: string[];
  observations: string[];
  evidenceLimitations: string[];
};

export type EvidenceBundle = {
  schemaVersion: 1;
  issueDate: string;
  sourceSha: string;
  items: EvidenceItem[];
};

type JsonSection = { reportSection?: string; results?: Array<Record<string, unknown>> };
type FetchText = (url: string) => Promise<string>;

const maximumBytes = 2_000_000;

function nonempty(value: unknown) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function row(section: JsonSection[], name: string) {
  return section.find((entry) => entry.reportSection === name)?.results?.[0] ?? {};
}

function rows(section: JsonSection[], name: string) {
  return section.find((entry) => entry.reportSection === name)?.results ?? [];
}

function money(value: unknown) {
  return nonempty(value) ? `$${String(value)}/cwt` : "not reported";
}

function releaseDate(candidate: Candidate) {
  return candidate.releaseId ?? candidate.publishedAt.slice(0, 10);
}

function previousReleaseUrl(candidate: Candidate) {
  if (!candidate.releaseId || !/^\d{2}\/\d{2}\/\d{4}$/.test(candidate.releaseId)) return undefined;
  const [month, day, year] = candidate.releaseId.split("/").map(Number);
  const previous = new Date(Date.UTC(year, month - 1, day - 7));
  const date = `${String(previous.getUTCMonth() + 1).padStart(2, "0")}/${String(previous.getUTCDate()).padStart(2, "0")}/${previous.getUTCFullYear()}`;
  const url = new URL(candidate.canonicalUrl);
  url.searchParams.set("q", `report_date=${date}`);
  url.searchParams.set("allSections", "true");
  return url.toString();
}

function allSectionsUrl(candidate: Candidate) {
  const url = new URL(candidate.canonicalUrl);
  url.searchParams.set("allSections", "true");
  return url.toString();
}

export function extractAmsEvidence(candidate: Candidate, current: JsonSection[], previous: JsonSection[] = []) {
  const reportId = new URL(candidate.canonicalUrl).pathname.match(/\/reports\/(\d+)/)?.[1];
  if (reportId === "2461") {
    const average = row(current, "Weekly Average Cutout Values");
    const change = row(current, "Change From Prior Week");
    const volume = row(current, "Current Volume");
    const choice = Number(average.choice_600_900_simple_avg);
    const select = Number(average.select_600_900_simple_avg);
    return [
      `Release ${releaseDate(candidate)}: Choice 600-900 lb weekly cutout averaged ${money(average.choice_600_900_simple_avg)}; Select averaged ${money(average.select_600_900_simple_avg)}.`,
      `Change from prior week: Choice ${money(change.choice_600_900_change)}; Select ${money(change.select_600_900_change)}.`,
      Number.isFinite(choice) && Number.isFinite(select)
        ? `Choice-Select spread: $${(choice - select).toFixed(2)}/cwt.`
        : "Choice-Select spread could not be calculated.",
      `Negotiated volume: ${volume.choice_volume_loads ?? "not reported"} Choice loads and ${volume.select_volume_loads ?? "not reported"} Select loads.`
    ];
  }
  if (reportId === "2462") {
    const currentVolume = row(current, "Current Volume");
    const previousVolume = row(previous, "Current Volume");
    const currentNational = rows(current, "National");
    const previousNational = rows(previous, "National");
    const line = (input: Array<Record<string, unknown>>, description: string) =>
      input.find((entry) => String(entry.item_desc).replace(/\s+/g, " ").trim() === description);
    const current90 = line(currentNational, "Chemical Lean, Fresh 90%");
    const previous90 = line(previousNational, "Chemical Lean, Fresh 90%");
    const current50 = line(currentNational, "Chemical Lean, Fresh 50%");
    const previous50 = line(previousNational, "Chemical Lean, Fresh 50%");
    return [
      `Release ${releaseDate(candidate)}: fresh 90% lean processing beef averaged ${money(current90?.price_range_avg)} across ${current90?.number_trades ?? "not reported"} trades and ${current90?.total_pounds ?? "not reported"} pounds.`,
      `Previous release comparison: fresh 90% lean averaged ${money(previous90?.price_range_avg)}.`,
      `Fresh 50% lean trim averaged ${money(current50?.price_range_avg)} across ${current50?.number_trades ?? "not reported"} trades and ${current50?.total_pounds ?? "not reported"} pounds; previous release ${money(previous50?.price_range_avg)}.`,
      `National volume was ${currentVolume.national_volume_pounds ?? "not reported"} pounds; previous release ${previousVolume.national_volume_pounds ?? "not reported"} pounds.`
    ];
  }
  if (reportId === "2477") {
    const summary = row(current, "Summary");
    const history = rows(current, "History").filter((entry) =>
      ["WEEKLY WEIGHTED AVERAGES", "SAME PERIOD LAST WEEK"].includes(String(entry.current_period))
    );
    const observations = [
      `Release ${releaseDate(candidate)} lists ${summary.previous_week_head_count ?? "not reported"} head for the latest completed week, ${summary.week_before_prev_head_count ?? "not reported"} a week earlier, and ${summary.previous_year_head_count ?? "not reported"} in the comparable year-earlier period.`
    ];
    for (const entry of history) {
      observations.push(
        `${entry.current_period}: ${entry.selling_basis_desc} ${entry.class_description}, ${entry.head_count} head, weighted average ${money(entry.weighted_avg_price)}, average weight ${entry.weight_range_avg} lb.`
      );
    }
    return observations;
  }
  return [];
}

function csvRecords(input: string) {
  return parse(input, { columns: true, bom: true, skip_empty_lines: true, relax_column_count: true }) as Record<string, string>[];
}

export function extractDairyEvidence(input: string, publicationYear: number) {
  const records = csvRecords(input).filter((entry) => entry.Year === String(publicationYear) && entry.Value !== "NA");
  const latestPeriod = records.at(-1)?.Period;
  const selected = records.filter((entry) => entry.Period === latestPeriod);
  const previous = csvRecords(input).filter((entry) => entry.Year === String(publicationYear - 1) && entry.Period === latestPeriod);
  return selected.map((entry) => {
    const comparison = previous.find((prior) => prior.Data_item === entry.Data_item);
    return `${publicationYear} ${latestPeriod} ${entry.Data_item}: ${entry.Value} ${entry.Units}${comparison ? `; ${publicationYear - 1} ${latestPeriod}: ${comparison.Value} ${comparison.Units}` : ""}.`;
  });
}

export function extractMeatSpreadEvidence(input: string, publicationYear: number) {
  const wanted = new Set([
    "Choice beef retail value", "Choice beef wholesale value", "Choice beef net farm value",
    "Choice beef price spread, wholesale to retail", "Choice beef farmers' share of retail beef dollar",
    "Cattle 5-market steer price", "All-fresh beef retail value"
  ]);
  const records = csvRecords(input).filter((entry) => entry.Year === String(publicationYear) && wanted.has(entry.Data_Item));
  const latestMonth = Math.max(...records.map((entry) => Number(entry.Period_Number)).filter(Number.isFinite));
  return records
    .filter((entry) => Number(entry.Period_Number) >= latestMonth - 1)
    .map((entry) => `${entry.Year} ${entry.Period} ${entry.Data_Item}: ${entry.Value} ${entry.Units}.`);
}

async function defaultFetchText(url: string) {
  const originalHost = new URL(url).hostname.replace(/^www\./, "");
  let current = new URL(url);
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    if (current.protocol !== "https:" || current.hostname.replace(/^www\./, "") !== originalHost) {
      throw new Error(`${current}: evidence requests must remain on the candidate host over HTTPS`);
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    let response: Response;
    try {
      response = await fetch(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: { "user-agent": "ProterraIntelligenceEvidence/1.0", accept: "application/json,text/csv,text/html" }
      });
    } finally {
      clearTimeout(timeout);
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || redirect === 3) throw new Error(`${current}: redirect limit exceeded`);
      current = new URL(location, current);
      continue;
    }
    if (!response.ok) throw new Error(`${current}: HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maximumBytes) throw new Error(`${current}: response exceeds ${maximumBytes} bytes`);
    return new TextDecoder().decode(bytes);
  }
  throw new Error(`${url}: redirect limit exceeded`);
}

function articleExcerpt(html: string) {
  const $ = load(html);
  $("script,style,nav,footer,header,form,aside").remove();
  const description = $('meta[name="description"]').attr("content")?.trim();
  const paragraphs = $("article p, main p").toArray()
    .map((node) => $(node).text().replace(/\s+/g, " ").trim())
    .filter((text) => text.length >= 40)
    .slice(0, 8);
  return [description, ...paragraphs].filter((text): text is string => Boolean(text)).map((text) => text.slice(0, 600));
}

async function linkedCsv(pageUrl: string, filename: string, fetchText: FetchText) {
  const html = await fetchText(pageUrl);
  const $ = load(html);
  const href = $(`a[href*="${filename}"]`).first().attr("href");
  if (!href) throw new Error(`${pageUrl}: could not locate ${filename}`);
  const csvUrl = new URL(href, pageUrl);
  if (csvUrl.protocol !== "https:" || csvUrl.hostname.replace(/^www\./, "") !== new URL(pageUrl).hostname.replace(/^www\./, "")) {
    throw new Error(`${pageUrl}: linked evidence file must remain on the candidate host over HTTPS`);
  }
  return fetchText(csvUrl.toString());
}

async function evidenceFor(candidate: Candidate, fetchText: FetchText): Promise<EvidenceItem> {
  const limitations: string[] = [];
  let observations: string[] = [];
  const url = new URL(candidate.canonicalUrl);
  const amsReport = url.hostname === "mpr.datamart.ams.usda.gov" && /\/reports\/\d+/.test(url.pathname);
  if (amsReport) {
    const current = JSON.parse(await fetchText(allSectionsUrl(candidate))) as JsonSection[];
    const previousUrl = previousReleaseUrl(candidate);
    const previous = previousUrl && url.pathname.endsWith("/2462")
      ? JSON.parse(await fetchText(previousUrl)) as JsonSection[]
      : [];
    observations = extractAmsEvidence(candidate, current, previous);
  } else if (candidate.sourceId === "usda-ers-dairy") {
    const csv = await linkedCsv(candidate.canonicalUrl, "us-milk-production-and-related-data-quarterly-and-annual.csv", fetchText);
    observations = extractDairyEvidence(csv, Number(candidate.publishedAt.slice(0, 4)));
  } else if (candidate.sourceId === "usda-ers-livestock") {
    const csv = await linkedCsv(candidate.canonicalUrl, "choice-beef-values-and-spreads-and-the-all-fresh-retail-value.csv", fetchText);
    observations = extractMeatSpreadEvidence(csv, Number(candidate.publishedAt.slice(0, 4)));
  } else {
    observations = articleExcerpt(await fetchText(candidate.canonicalUrl));
    limitations.push("Generic deterministic page excerpt; verify ambiguous claims during human review.");
  }
  if (observations.length === 0) throw new Error(`${candidate.candidateId}: no deterministic evidence was extracted`);
  return {
    candidateId: candidate.candidateId,
    reviewId: `story-${candidate.candidateId.slice(0, 16)}`,
    sourceId: candidate.sourceId,
    publisherGroup: candidate.publisherGroup ?? candidate.sourceId,
    contentClass: candidate.contentClass,
    reviewTier: candidate.reviewTier ?? (candidate.contentClass === "dataset" ? "supporting-data" : "also-review"),
    selectionBasis: candidate.selectionBasis ?? (candidate.contentClass === "dataset" ? "official-data" : "eligible-news"),
    independentPublisherCount: candidate.scoreBreakdown?.factors.corroboration.supportingSources ?? 0,
    language: candidate.language,
    relevanceScore: candidate.relevanceScore,
    title: candidate.title,
    publishedAt: candidate.publishedAt,
    citationUrl: candidate.citationUrl,
    canonicalUrl: candidate.canonicalUrl,
    ...(candidate.evidenceUrl ? { evidenceUrl: candidate.evidenceUrl } : {}),
    ...(candidate.landingUrl ? { landingUrl: candidate.landingUrl } : {}),
    relatedUrls: candidate.relatedUrls,
    ...(candidate.releaseId ? { releaseId: candidate.releaseId } : {}),
    sectors: candidate.sectors,
    geographies: candidate.geographies,
    observations: observations.slice(0, 20),
    evidenceLimitations: limitations
  };
}

export async function prepareEvidence(candidateInput: string, sourceSha: string, fetchText: FetchText = defaultFetchText) {
  const candidates = candidateFileSchema.parse(JSON.parse(candidateInput));
  const items: EvidenceItem[] = [];
  for (const candidate of candidates.candidates) items.push(await evidenceFor(candidate, fetchText));
  return { schemaVersion: 1, issueDate: candidates.issueDate, sourceSha, items } satisfies EvidenceBundle;
}

async function main() {
  const arguments_ = process.argv.slice(2);
  const value = (flag: string) => arguments_[arguments_.indexOf(flag) + 1];
  const candidatesPath = value("--candidates");
  const sourceSha = value("--source-sha");
  const outputPath = value("--output");
  if (!candidatesPath || !/^[a-f0-9]{40}$/.test(sourceSha ?? "") || !outputPath) {
    throw new Error("Usage: prepare-evidence --candidates FILE --source-sha SHA --output FILE");
  }
  const bundle = await prepareEvidence(await readFile(candidatesPath, "utf8"), sourceSha);
  await writeFile(outputPath, `${JSON.stringify(bundle, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`Prepared ${bundle.items.length} compact evidence records for ${bundle.issueDate}.\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
