import { z } from "astro/zod";
import rawSources from "../data/sources.json";

export const sectors = ["dairy", "meat", "bovine-genetics"] as const;
export const signals = ["new", "continuing", "accelerating", "easing"] as const;

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

const sourceSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(3),
  domain: z.string().min(3),
  url: z.url(),
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
  publishedAt: z.string().regex(datePattern)
});

const itemSchema = z.object({
  rank: z.number().int().positive(),
  headline: z.string().min(12),
  sectors: z.array(z.enum(sectors)).min(1),
  regions: z.array(z.string().min(2)).min(1),
  signal: z.enum(signals),
  summary: z.string().min(40),
  whyItMatters: z.string().min(30),
  watchNext: z.string().min(15),
  confidence: z.enum(["high", "medium"]),
  citations: z.array(citationSchema).min(1)
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
  executiveSummary: z.string().min(60),
  editorNote: z.string().optional(),
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

  for (const item of report.items) {
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
