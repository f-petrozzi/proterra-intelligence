import { z } from "astro/zod";
import rawSources from "../data/sources.json";
import { imageById } from "./images";

export const sectors = ["dairy", "meat", "bovine-genetics"] as const;
export const signals = ["new", "continuing", "accelerating", "easing"] as const;
export const dashboardDirections = ["up", "down", "new", "stable"] as const;
export const documentTypes = ["report", "dataset", "announcement", "evaluation", "calendar", "news", "social-post"] as const;
export const reviewStatuses = ["new", "shortlisted", "reviewed", "dismissed"] as const;
export const discoveryChannels = ["official-site", "rss", "api", "linkedin", "manual"] as const;

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

const sourceSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(3),
  domain: z.string().min(3),
  url: z.url(),
  allowedPaths: z.array(z.string().startsWith("/")).min(1).optional(),
  tier: z.enum(["A", "B", "C"]),
  status: z.enum(["approved", "probationary", "blocked"]),
  regions: z.array(z.string()).min(1),
  sectors: z.array(z.enum(sectors)).min(1),
  cadence: z.string().min(2),
  notes: z.string().min(10)
});

const citationSchema = z.object({
  sourceId: z.string(),
  title: z.string().min(5),
  url: z.url(),
  publishedAt: z.string().regex(datePattern),
  sourceNote: z.string().min(20)
});

const itemSchema = z.object({
  rank: z.number().int().positive(),
  headline: z.string().min(12),
  imageId: z.string().regex(/^[a-z0-9-]+$/),
  documentType: z.enum(documentTypes),
  reviewStatus: z.enum(reviewStatuses),
  discoveryChannel: z.enum(discoveryChannels),
  sectors: z.array(z.enum(sectors)).min(1),
  regions: z.array(z.string().min(2)).min(1),
  signal: z.enum(signals),
  summary: z.string().min(40),
  keyPoints: z.array(z.string().min(15)).min(2).max(4),
  whyItMatters: z.string().min(30),
  businessRelevance: z.string().min(30).optional(),
  uncertainty: z.string().min(30).optional(),
  watchNext: z.string().min(15),
  confidence: z.enum(["high", "medium"]),
  citations: z.array(citationSchema).min(1)
});

const itemRankSchema = z.number().int().positive();

const comparisonChartSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string().min(3),
  description: z.string().min(10),
  unit: z.literal("percent"),
  itemRanks: z.array(itemRankSchema).min(1),
  sourceIds: z.array(z.string()).min(1),
  values: z.array(z.object({
    label: z.string().min(3),
    value: z.number(),
    displayValue: z.string().min(2)
  })).min(2).max(6)
});

const dashboardSchema = z.object({
  sectorPulses: z.array(z.object({
    sector: z.enum(sectors),
    label: z.string().min(3),
    value: z.string().min(1),
    basis: z.string().min(3),
    direction: z.enum(dashboardDirections),
    note: z.string().min(20),
    itemRank: itemRankSchema
  })).length(3),
  keyMetrics: z.array(z.object({
    label: z.string().min(3),
    value: z.string().min(1),
    basis: z.string().min(3),
    itemRank: itemRankSchema
  })).min(3).max(5),
  charts: z.array(comparisonChartSchema).min(1).max(3).optional()
});

const overviewSchema = z.object({
  headline: z.string().min(12),
  points: z.array(z.object({
    label: z.string().min(3),
    text: z.string().min(25)
  })).length(3)
});

const reportSchema = z.object({
  slug: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  issueNumber: z.number().int().positive(),
  title: z.string().min(5),
  status: z.enum(["draft", "approved"]),
  period: z.object({
    start: z.string().regex(datePattern),
    end: z.string().regex(datePattern)
  }),
  publishedAt: z.string().regex(datePattern),
  scope: z.object({
    basis: z.enum(["public-sources-only", "public-and-internal"]),
    disclosure: z.string().min(30)
  }),
  executiveSummary: z.string().min(60),
  editorNote: z.string().optional(),
  overview: overviewSchema.optional(),
  dashboard: dashboardSchema.optional(),
  items: z.array(itemSchema).min(8).max(10)
});

export type Source = z.infer<typeof sourceSchema>;
export type SignalItem = z.infer<typeof itemSchema>;
export type Report = z.infer<typeof reportSchema>;

export const sources = sourceSchema.array().parse(rawSources) satisfies Source[];
export const sourceById = new Map(sources.map((source) => [source.id, source]));

const reportModules = import.meta.glob<{ default: unknown }>("../data/reports/*.json", {
  eager: true
});

function assertReportIntegrity(report: Report, path: string) {
  const ranks = report.items.map((item) => item.rank);
  const expectedRanks = report.items.map((_, index) => index + 1);

  if (JSON.stringify(ranks) !== JSON.stringify(expectedRanks)) {
    throw new Error(`${path}: item ranks must be consecutive and start at 1.`);
  }

  if (report.items.some((item) => item.reviewStatus === "dismissed")) {
    throw new Error(`${path}: dismissed candidates cannot appear in a report.`);
  }

  if (report.status === "approved" && report.items.some((item) => item.reviewStatus !== "reviewed")) {
    throw new Error(`${path}: every item in an approved report must be reviewed.`);
  }

  if (report.dashboard) {
    const pulseSectors = report.dashboard.sectorPulses.map((pulse) => pulse.sector);
    if (new Set(pulseSectors).size !== sectors.length) {
      throw new Error(`${path}: dashboard must contain one pulse for each sector.`);
    }

    const dashboardReferences = [
      ...report.dashboard.sectorPulses,
      ...report.dashboard.keyMetrics
    ];
    for (const reference of dashboardReferences) {
      if (!ranks.includes(reference.itemRank)) {
        throw new Error(
          `${path}: dashboard references missing item rank ${reference.itemRank}.`
        );
      }
    }

    for (const chart of report.dashboard.charts ?? []) {
      const chartItems = chart.itemRanks.map((rank) => report.items.find((item) => item.rank === rank));
      if (chartItems.some((item) => !item)) {
        throw new Error(`${path}: chart "${chart.id}" references a missing report item.`);
      }

      for (const sourceId of chart.sourceIds) {
        if (!sourceById.has(sourceId)) {
          throw new Error(`${path}: chart "${chart.id}" references unknown source "${sourceId}".`);
        }
        if (!chartItems.some((item) => item?.citations.some((citation) => citation.sourceId === sourceId))) {
          throw new Error(`${path}: chart "${chart.id}" source "${sourceId}" is not cited by its supporting items.`);
        }
      }
    }
  }

  if (report.scope.basis === "public-sources-only") {
    const unsupportedInternalClaim = /\bProterra(?:'s)?\s+(?:animals?|bulls?|sires?|customers?|sales|catalog|performance)\b/i;
    for (const item of report.items) {
      const analysis = [item.businessRelevance, item.uncertainty].filter(Boolean).join(" ");
      if (unsupportedInternalClaim.test(analysis)) {
        throw new Error(`${path}: item ${item.rank} implies internal Proterra knowledge in a public-source-only report.`);
      }
    }
  }

  for (const item of report.items) {
    if (!imageById.has(item.imageId)) {
      throw new Error(`${path}: item ${item.rank} references unknown editorial image "${item.imageId}".`);
    }

    const citesLinkedIn = item.citations.some((citation) => citation.sourceId === "linkedin-org-post");
    const primaryIsLinkedIn = item.citations[0].sourceId === "linkedin-org-post";
    if (item.discoveryChannel === "linkedin" && !citesLinkedIn) {
      throw new Error(`${path}: LinkedIn-discovered item ${item.rank} must retain its submitted organization post as a citation.`);
    }
    if (item.documentType === "social-post" && !primaryIsLinkedIn) {
      throw new Error(`${path}: social-post item ${item.rank} must use the LinkedIn organization post as its primary citation.`);
    }
    if (primaryIsLinkedIn && (item.discoveryChannel !== "linkedin" || item.documentType !== "social-post")) {
      throw new Error(`${path}: item ${item.rank} must identify a primary LinkedIn post as its channel and document type.`);
    }

    for (const citation of item.citations) {
      const source = sourceById.get(citation.sourceId);
      if (!source) {
        throw new Error(`${path}: citation references unknown source "${citation.sourceId}".`);
      }
      if (source.status === "blocked") {
        throw new Error(`${path}: citation references blocked source "${citation.sourceId}".`);
      }

      const hostname = new URL(citation.url).hostname.replace(/^www\./, "");
      const approvedDomain = source.domain.replace(/^www\./, "");
      if (hostname !== approvedDomain && !hostname.endsWith(`.${approvedDomain}`)) {
        throw new Error(
          `${path}: citation host "${hostname}" does not match source "${approvedDomain}".`
        );
      }

      const pathname = new URL(citation.url).pathname;
      if (source.allowedPaths && !source.allowedPaths.some((prefix) => pathname.startsWith(prefix))) {
        throw new Error(
          `${path}: citation path "${pathname}" is not approved for source "${source.id}".`
        );
      }
    }
  }
}

const parsedReports = Object.entries(reportModules).map(([path, module]) => {
  const report = reportSchema.parse(module.default);
  assertReportIntegrity(report, path);
  return report;
});

const branch = import.meta.env.CF_PAGES_BRANCH;
const includeDrafts = import.meta.env.DEV || (branch && branch !== "main");

export const reports = parsedReports
  .filter((report) => report.status === "approved" || includeDrafts)
  .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));

export function formatDate(value: string, options?: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
    ...options
  }).format(new Date(`${value}T00:00:00Z`));
}

export function sectorLabel(sector: (typeof sectors)[number]) {
  return sector === "bovine-genetics" ? "Bovine genetics" : `${sector[0].toUpperCase()}${sector.slice(1)}`;
}

const latinAmericaRegions = new Set([
  "Latin America", "Latin America & Caribbean", "Puerto Rico", "Mexico", "Central America",
  "South America", "Caribbean", "Argentina", "Belize", "Bolivia", "Brazil", "Chile",
  "Colombia", "Costa Rica", "Cuba", "Dominican Republic", "Ecuador", "El Salvador",
  "Guatemala", "Guyana", "Haiti", "Honduras", "Jamaica", "Nicaragua", "Panama",
  "Paraguay", "Peru", "Suriname", "Trinidad and Tobago", "Uruguay", "Venezuela"
]);

export function isLatinAmericaRegion(regions: string[]) {
  return regions.some((region) => latinAmericaRegions.has(region));
}
