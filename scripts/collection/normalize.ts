import { createHash } from "node:crypto";
import { languageTags } from "./types";
import type { Candidate, CollectionSource, NormalizedCandidate, RawCandidate } from "./types";

export function contentClassOf(source: Pick<CollectionSource, "collectionRole" | "contentClass">) {
  if (source.contentClass) return source.contentClass;
  return source.collectionRole === "discovery" ? "news" : "dataset";
}

export function publisherGroupOf(source: Pick<CollectionSource, "publisherGroup" | "sourceId">) {
  return source.publisherGroup ?? source.sourceId;
}

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

// Fold accents so Spanish and Portuguese regional feeds (OIRSA, FAO Americas,
// IICA) classify: "genómica" -> "genomica", "México" -> "mexico".
function foldDiacritics(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function searchableText(value: string) {
  return ` ${foldDiacritics(normalizeText(value).toLowerCase()).replace(/[^a-z0-9]+/g, " ").trim()} `;
}

function containsTerm(haystack: string, term: string) {
  const needle = searchableText(term);
  return needle.trim().length > 0 && haystack.includes(needle);
}

// Keywords are matched after accents are folded, so Spanish and Portuguese
// terms are listed without diacritics (e.g. "genomica", "leche", "ganado").
const sectorTerms: Record<Candidate["sectors"][number], string[]> = {
  dairy: ["dairy", "milk", "cheese", "butter", "whey", "lactation", "mastitis", "holstein", "jersey",
    "leche", "lecheria", "lacteo", "lacteos", "queso", "leite", "leiteiro"],
  meat: ["beef", "meat", "cattle", "cow", "calf", "calves", "livestock", "slaughter", "feedlot", "bovine", "animal health", "foot and mouth", "brucellosis",
    "carne", "ganado", "ganaderia", "bovino", "bovinos", "res", "vacuno", "vaca", "becerro", "ternero", "sacrificio", "fiebre aftosa", "brucelosis", "gado", "abate"],
  "bovine-genetics": ["genetic", "genomic", "breeding", "sire", "bull", "semen", "embryo", "germplasm", "pedigree", "phenotype", "animal recording", "breeding value",
    "genetica", "genetico", "genomica", "genomico", "mejoramiento", "embrion", "toro", "raza", "reproduccion", "melhoramento"]
};

const geographyTerms: Record<string, string[]> = {
  "United States": ["united states", "u s", "american", "usda"],
  "Latin America & Caribbean": ["latin america", "caribbean", "americas", "america latina", "latinoamerica", "caribe"],
  "Puerto Rico": ["puerto rico", "puertorican"],
  Mexico: ["mexico", "mexican", "mexicano", "mexicana"],
  "Central America": ["central america", "centroamerica", "belize", "belice", "costa rica", "el salvador", "guatemala", "honduras", "nicaragua", "panama"],
  "Dominican Republic": ["dominican republic", "dominican", "republica dominicana", "dominicana"],
  "European Union": ["european union", "eu dairy", "eu beef"],
  International: ["global", "world", "international", "worldwide", "mundial", "internacional"]
};

// Deterministic keyword-density signal used by relevance scoring: title hits
// weigh double body hits. Reuses the same dictionaries as classification.
export function topicStrength(title: string, summary?: string) {
  const titleText = searchableText(title);
  const bodyText = searchableText(`${title} ${summary ?? ""}`);
  let hits = 0;
  for (const terms of Object.values(sectorTerms)) {
    for (const term of terms) {
      if (containsTerm(titleText, term)) hits += 2;
      else if (containsTerm(bodyText, term)) hits += 1;
    }
  }
  return hits;
}

// Deterministic language tag over a small, known set (English plus the Spanish,
// Portuguese, and French that appear in the Americas feeds). High precision, not
// breadth: unclear or too-short text returns "und". Swap in a trigram detector
// like franc only if a non-romance-language source is ever added.
const stopwordsByLanguage: Record<Exclude<(typeof languageTags)[number], "und">, Set<string>> = {
  en: new Set(["the", "and", "of", "to", "in", "for", "on", "with", "as", "is", "are", "was", "were", "by", "from", "at", "that", "this", "an"]),
  es: new Set(["el", "la", "los", "las", "de", "del", "y", "en", "para", "con", "por", "un", "una", "que", "se", "su", "es", "al", "como", "mas"]),
  pt: new Set(["o", "os", "as", "de", "do", "da", "dos", "das", "e", "em", "para", "com", "por", "um", "uma", "que", "se", "no", "na", "nao", "mais"]),
  fr: new Set(["le", "la", "les", "de", "des", "du", "et", "pour", "avec", "par", "une", "dans", "au", "aux", "est", "sur", "sont", "cette", "ces", "leur"])
};

export function detectLanguage(title: string, summary?: string): (typeof languageTags)[number] {
  const raw = `${title} ${summary ?? ""}`.toLowerCase();
  const tokens = foldDiacritics(raw).replace(/[^a-z ]+/g, " ").split(/\s+/).filter(Boolean);
  const score: Record<string, number> = { en: 0, es: 0, pt: 0, fr: 0 };
  for (const token of tokens) {
    for (const language of Object.keys(stopwordsByLanguage) as Array<keyof typeof stopwordsByLanguage>) {
      if (stopwordsByLanguage[language].has(token)) score[language] += 1;
    }
  }
  if (/ñ/.test(raw)) score.es += 2;
  if (/[ãõ]/.test(raw)) score.pt += 2;
  if (/ç/.test(raw)) { score.pt += 1; score.fr += 1; }
  if (/[àâèêëîïôùû]/.test(raw)) score.fr += 1;
  const best = Math.max(...Object.values(score));
  if (best < 2) return "und";
  if (score.en === best) return "en";
  return (Object.keys(score).find((language) => score[language] === best) ?? "und") as (typeof languageTags)[number];
}

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
  if (geographies.length === 0) {
    if (source.sourceId.startsWith("usda-") && source.geographies.includes("United States")) {
      geographies = ["United States"];
    } else if (["fao-americas", "iica", "oirsa"].includes(source.sourceId) && source.geographies.includes("Latin America & Caribbean")) {
      geographies = ["Latin America & Caribbean"];
    } else if (source.geographies.includes("United States")) {
      // United-States-based publications default to domestic coverage unless a
      // more specific geography term is present in the article text.
      geographies = ["United States"];
    } else if (source.geographies.length === 1) {
      geographies = [...source.geographies];
    } else if (source.geographies.includes("International")) {
      geographies = ["International"];
    } else {
      geographies = [source.geographies[0]];
    }
  }

  return {
    sectors: [...new Set(sectors)].sort() as Candidate["sectors"],
    geographies: [...new Set(geographies)].sort()
  };
}

// English, Spanish, and Portuguese month names — the enabled international
// listings (FAO Americas, IICA, OIRSA) publish dates in all three languages.
const months = new Map<string, number>([
  ["january", 0], ["february", 1], ["march", 2], ["april", 3], ["may", 4], ["june", 5],
  ["july", 6], ["august", 7], ["september", 8], ["october", 9], ["november", 10], ["december", 11],
  ["enero", 0], ["febrero", 1], ["marzo", 2], ["abril", 3], ["mayo", 4], ["junio", 5],
  ["julio", 6], ["agosto", 7], ["septiembre", 8], ["setiembre", 8], ["octubre", 9], ["noviembre", 10], ["diciembre", 11],
  ["janeiro", 0], ["fevereiro", 1], ["março", 2], ["marco", 2], ["maio", 4], ["junho", 5],
  ["julho", 6], ["setembro", 8], ["outubro", 9], ["novembro", 10], ["dezembro", 11]
]);

function monthIndex(name: string) {
  return months.get(name.toLowerCase());
}

export function parsePublicationDate(value: string) {
  const normalized = normalizeText(value);
  const isoDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  const dayFirst = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(normalized);
  const shortMonthFirst = /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/.exec(normalized);
  // "August 17, 2026" (month-first) or "17 August 2026" / "17 de agosto de 2026" (day-first, multilingual).
  const monthFirstWritten = /^([A-Za-zÀ-ÿ]+)\s+(\d{1,2}),\s*(\d{4})$/.exec(normalized);
  const dayFirstWritten = /^(\d{1,2})\s+(?:de\s+)?([A-Za-zÀ-ÿ]+)\s+(?:de\s+)?(\d{4})$/.exec(normalized);
  const offsetlessIso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(normalized);
  let date: Date;
  let monthName: string | undefined;
  if (isoDate) {
    date = new Date(Date.UTC(Number(isoDate[1]), Number(isoDate[2]) - 1, Number(isoDate[3]), 12));
  } else if (dayFirst) {
    date = new Date(Date.UTC(Number(dayFirst[3]), Number(dayFirst[2]) - 1, Number(dayFirst[1]), 12));
  } else if (shortMonthFirst) {
    date = new Date(Date.UTC(2000 + Number(shortMonthFirst[3]), Number(shortMonthFirst[1]) - 1, Number(shortMonthFirst[2]), 12));
  } else if (monthFirstWritten && (monthName = monthFirstWritten[1], monthIndex(monthName) !== undefined)) {
    date = new Date(Date.UTC(Number(monthFirstWritten[3]), monthIndex(monthName)!, Number(monthFirstWritten[2]), 12));
  } else if (dayFirstWritten && (monthName = dayFirstWritten[2], monthIndex(monthName) !== undefined)) {
    date = new Date(Date.UTC(Number(dayFirstWritten[3]), monthIndex(monthName)!, Number(dayFirstWritten[1]), 12));
  } else if (offsetlessIso) {
    date = new Date(`${normalized}Z`);
  } else {
    date = new Date(normalized);
  }
  if (Number.isNaN(date.valueOf())) throw new Error("invalid publication date");
  return date;
}

export function deduplicateCandidates(candidates: NormalizedCandidate[]) {
  const urls = new Map<string, number>();
  const result: NormalizedCandidate[] = [];
  for (const candidate of candidates) {
    const existingIndex = urls.get(candidate.canonicalUrl);
    if (existingIndex !== undefined) {
      const existing = result[existingIndex];
      existing.sectors = [...new Set([...existing.sectors, ...candidate.sectors])].sort() as Candidate["sectors"];
      existing.geographies = [...new Set([...existing.geographies, ...candidate.geographies])].sort();
      continue;
    }
    urls.set(candidate.canonicalUrl, result.length);
    result.push(candidate);
  }
  return result;
}

export function normalizeCandidate(
  raw: RawCandidate,
  source: CollectionSource,
  retrievedAt: string
): NormalizedCandidate {
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
  // Reader-facing citation prefers a readable landing/synopsis page; the raw
  // API/PDF response stays attached as the auditable evidence link for datasets.
  const contentClass = contentClassOf(source);
  const landingUrl = raw.landingUrl ? canonicalizeUrl(raw.landingUrl) : undefined;
  const citationUrl = landingUrl ?? canonicalUrl;
  const evidenceUrl = contentClass === "dataset" ? canonicalUrl : undefined;
  return {
    candidateId: candidateId(canonicalUrl),
    sourceId: source.sourceId,
    publisherGroup: publisherGroupOf(source),
    collectionRole: source.collectionRole,
    contentClass,
    language: detectLanguage(raw.title, raw.summary),
    discoveredBy: source.method,
    canonicalUrl,
    citationUrl,
    ...(evidenceUrl ? { evidenceUrl } : {}),
    title: normalizeText(raw.title),
    publishedAt: publishedAt.toISOString(),
    ...(summary ? { summary, summaryOrigin: "source-supplied" as const } : {}),
    ...(raw.releaseId ? { releaseId: normalizeText(raw.releaseId) } : {}),
    ...(landingUrl ? { landingUrl } : {}),
    sectors: classification.sectors,
    geographies: classification.geographies,
    retrievedAt
  };
}

export function stableCandidateSort(a: NormalizedCandidate, b: NormalizedCandidate) {
  return b.publishedAt.localeCompare(a.publishedAt)
    || a.sourceId.localeCompare(b.sourceId)
    || a.canonicalUrl.localeCompare(b.canonicalUrl);
}
