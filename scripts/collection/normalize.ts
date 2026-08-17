import { createHash } from "node:crypto";
import type { Candidate, CollectionSource, RawCandidate } from "./types";

const trackingParameters = new Set([
  "fbclid", "gclid", "mc_cid", "mc_eid", "ref", "ref_src", "source",
  "utm_campaign", "utm_content", "utm_medium", "utm_source", "utm_term"
]);

export function normalizeText(value: string) {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

export function canonicalizeUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("candidate URL must use HTTPS");
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (trackingParameters.has(key.toLowerCase()) || key.toLowerCase().startsWith("utm_")) {
      url.searchParams.delete(key);
    }
  }
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  url.pathname = url.pathname.replace(/\/{2,}/g, "/");
  if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/$/, "");
  url.searchParams.sort();
  return url.toString();
}

export function candidateId(canonicalUrl: string) {
  return createHash("sha256").update(canonicalUrl).digest("hex");
}

function normalizedTitle(value: string) {
  return normalizeText(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function searchableText(value: string) {
  return ` ${normalizeText(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
}

function containsTerm(haystack: string, term: string) {
  const needle = searchableText(term);
  return needle.trim().length > 0 && haystack.includes(needle);
}

const sectorTerms: Record<Candidate["sectors"][number], string[]> = {
  dairy: ["dairy", "milk", "cheese", "butter", "whey", "lactation", "mastitis", "holstein", "jersey"],
  meat: ["beef", "meat", "cattle", "cow", "calf", "calves", "livestock", "slaughter", "feedlot", "bovine", "animal health", "foot and mouth", "brucellosis"],
  "bovine-genetics": ["genetic", "genomic", "breeding", "sire", "bull", "semen", "embryo", "germplasm", "pedigree", "phenotype", "animal recording", "breeding value"]
};

const geographyTerms: Record<string, string[]> = {
  "United States": ["united states", "u s", "american", "usda"],
  "Latin America & Caribbean": ["latin america", "caribbean", "americas"],
  "Puerto Rico": ["puerto rico", "puertorican"],
  Mexico: ["mexico", "mexican"],
  "Central America": ["central america", "belize", "costa rica", "el salvador", "guatemala", "honduras", "nicaragua", "panama"],
  "Dominican Republic": ["dominican republic", "dominican"],
  "European Union": ["european union", "eu dairy", "eu beef"],
  International: ["global", "world", "international", "worldwide"]
};

export function classifyCandidate(raw: RawCandidate, source: CollectionSource) {
  const title = searchableText(raw.title);
  const text = searchableText(`${raw.title} ${raw.summary ?? ""}`);
  if (source.includeTitleTerms && !source.includeTitleTerms.some((term) => containsTerm(title, term))) return undefined;
  if (source.includeTerms && !source.includeTerms.some((term) => containsTerm(text, term))) return undefined;
  if (source.excludeTerms?.some((term) => containsTerm(text, term))) return undefined;

  let sectors = source.sectors.filter((sector) => sectorTerms[sector].some((term) => containsTerm(text, term)));
  if (sectors.length === 0 && source.sectors.length === 1) sectors = [...source.sectors];
  if (sectors.length === 0) return undefined;

  let geographies = source.geographies.filter((geography) =>
    geographyTerms[geography]?.some((term) => containsTerm(text, term))
  );
  if (geographies.length === 0 && source.sourceId.startsWith("usda-") && source.geographies.includes("United States")) {
    geographies = ["United States"];
  } else if (geographies.length === 0 && source.geographies.length === 1) {
    geographies = [...source.geographies];
  } else if (geographies.length === 0 && ["fao-americas", "iica", "oirsa"].includes(source.sourceId)
    && source.geographies.includes("Latin America & Caribbean")) {
    geographies = ["Latin America & Caribbean"];
  } else if (geographies.length === 0 && source.geographies.includes("International")) {
    geographies = ["International"];
  } else if (geographies.length === 0) {
    geographies = [source.geographies[0]];
  }

  return {
    sectors: [...new Set(sectors)].sort() as Candidate["sectors"],
    geographies: [...new Set(geographies)].sort()
  };
}

const months = new Map([
  ["january", 0], ["february", 1], ["march", 2], ["april", 3], ["may", 4], ["june", 5],
  ["july", 6], ["august", 7], ["september", 8], ["october", 9], ["november", 10], ["december", 11]
]);

export function parsePublicationDate(value: string) {
  const normalized = normalizeText(value);
  const isoDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  const dayFirst = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(normalized);
  const shortMonthFirst = /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/.exec(normalized);
  const written = /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/.exec(normalized);
  const offsetlessIso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(normalized);
  let date: Date;
  if (isoDate) {
    date = new Date(Date.UTC(Number(isoDate[1]), Number(isoDate[2]) - 1, Number(isoDate[3]), 12));
  } else if (dayFirst) {
    date = new Date(Date.UTC(Number(dayFirst[3]), Number(dayFirst[2]) - 1, Number(dayFirst[1]), 12));
  } else if (shortMonthFirst) {
    date = new Date(Date.UTC(2000 + Number(shortMonthFirst[3]), Number(shortMonthFirst[1]) - 1, Number(shortMonthFirst[2]), 12));
  } else if (written && months.has(written[1].toLowerCase())) {
    date = new Date(Date.UTC(Number(written[3]), months.get(written[1].toLowerCase())!, Number(written[2]), 12));
  } else if (offsetlessIso) {
    date = new Date(`${normalized}Z`);
  } else {
    date = new Date(normalized);
  }
  if (Number.isNaN(date.valueOf())) throw new Error("invalid publication date");
  return date;
}

export function deduplicateCandidates(candidates: Candidate[]) {
  const urls = new Map<string, number>();
  const titles = new Map<string, number>();
  const result: Candidate[] = [];
  for (const candidate of candidates) {
    const title = normalizedTitle(candidate.title);
    const existingIndex = urls.get(candidate.canonicalUrl) ?? titles.get(title);
    if (existingIndex !== undefined) {
      const existing = result[existingIndex];
      existing.sectors = [...new Set([...existing.sectors, ...candidate.sectors])].sort() as Candidate["sectors"];
      existing.geographies = [...new Set([...existing.geographies, ...candidate.geographies])].sort();
      continue;
    }
    urls.set(candidate.canonicalUrl, result.length);
    titles.set(title, result.length);
    result.push(candidate);
  }
  return result;
}

export function normalizeCandidate(
  raw: RawCandidate,
  source: CollectionSource,
  retrievedAt: string
): Candidate {
  if (source.collectionRole !== "evidence" && source.collectionRole !== "discovery") {
    throw new Error(`${source.sourceId}: non-collectable source role`);
  }
  if (source.method === "manual" || source.method === "disabled") {
    throw new Error(`${source.sourceId}: non-collectable source method`);
  }
  const canonicalUrl = canonicalizeUrl(new URL(raw.url, source.endpoint).toString());
  const hostname = new URL(canonicalUrl).hostname;
  if (!source.allowedHosts.some((allowed) => hostname === allowed || hostname.endsWith(`.${allowed}`))) {
    throw new Error(`${source.sourceId}: candidate redirected outside allowed hosts`);
  }
  let publishedAt: Date;
  try {
    publishedAt = parsePublicationDate(raw.publishedAt);
  } catch {
    throw new Error(`${source.sourceId}: invalid publication date`);
  }
  const summary = raw.summary ? normalizeText(raw.summary) : undefined;
  const classification = classifyCandidate(raw, source);
  if (!classification) throw new Error(`${source.sourceId}: candidate is outside the configured editorial scope`);
  return {
    candidateId: candidateId(canonicalUrl),
    sourceId: source.sourceId,
    collectionRole: source.collectionRole,
    discoveredBy: source.method,
    canonicalUrl,
    title: normalizeText(raw.title),
    publishedAt: publishedAt.toISOString(),
    ...(summary ? { summary, summaryOrigin: "source-supplied" as const } : {}),
    ...(raw.releaseId ? { releaseId: normalizeText(raw.releaseId) } : {}),
    ...(raw.landingUrl ? { landingUrl: canonicalizeUrl(raw.landingUrl) } : {}),
    sectors: classification.sectors,
    geographies: classification.geographies,
    retrievedAt
  };
}

export function stableCandidateSort(a: Candidate, b: Candidate) {
  return b.publishedAt.localeCompare(a.publishedAt)
    || a.sourceId.localeCompare(b.sourceId)
    || a.canonicalUrl.localeCompare(b.canonicalUrl);
}
