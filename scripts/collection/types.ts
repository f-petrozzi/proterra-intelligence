import { z } from "zod";

export const sectors = ["dairy", "meat", "bovine-genetics"] as const;
export const collectionRoles = ["evidence", "discovery", "manual", "disabled"] as const;
export const collectionMethods = ["rss", "json-api", "csv-api", "html-list", "manual", "disabled"] as const;
export const trustTiers = ["official", "trade-press", "aggregator"] as const;
export const contentClasses = ["news", "dataset"] as const;
export const languageTags = ["en", "es", "pt", "fr", "und"] as const;
export const reviewTiers = ["review-first", "also-review", "supporting-data"] as const;
export const selectionBases = [
  "coverage-balance", "publisher-diversity", "queue-order", "publisher-cap-exception",
  "eligible-news", "official-data"
] as const;

const baseSourceSchema = z.object({
  sourceId: z.string().regex(/^[a-z0-9-]+$/),
  adapterId: z.string().regex(/^[a-z0-9-]+$/).optional(),
  publisherGroup: z.string().regex(/^[a-z0-9-]+$/).optional(),
  enabled: z.boolean(),
  collectionRole: z.enum(collectionRoles),
  trustTier: z.enum(trustTiers).optional(),
  authorityWeight: z.number().min(0).max(1).optional(),
  contentClass: z.enum(contentClasses).optional(),
  method: z.enum(collectionMethods),
  endpoint: z.url().optional(),
  allowedHosts: z.array(z.string().min(3)).default([]),
  sectors: z.array(z.enum(sectors)).min(1),
  geographies: z.array(z.string().min(2)).min(1),
  lookbackDays: z.number().int().min(1).max(45).default(10),
  rateLimitMs: z.number().int().min(0).max(30_000).default(750),
  timeoutMs: z.number().int().min(1_000).max(60_000).default(15_000),
  maxResponseBytes: z.number().int().min(1_024).max(10_000_000).default(2_000_000),
  minimumItemsSeen: z.number().int().min(0).max(10_000).default(1),
  includeTitleTerms: z.array(z.string().min(2)).min(1).optional(),
  includeTerms: z.array(z.string().min(2)).min(1).optional(),
  excludeTerms: z.array(z.string().min(2)).min(1).optional(),
  notes: z.string().min(8)
});

const jsonMappingSchema = z.object({
  itemsPath: z.string().min(1),
  title: z.string().min(1),
  url: z.string().min(1).optional(),
  fixedUrl: z.url().optional(),
  urlTemplate: z.string().min(1).optional(),
  publishedAt: z.string().min(1),
  summary: z.string().min(1).optional(),
  releaseId: z.string().min(1).optional(),
  landingUrl: z.url().optional()
}).refine((mapping) => Boolean(mapping.url || mapping.fixedUrl || mapping.urlTemplate),
  "JSON mappings require url, fixedUrl, or urlTemplate");

const csvMappingSchema = z.object({
  title: z.string().min(1),
  url: z.string().min(1),
  publishedAt: z.string().min(1),
  summary: z.string().min(1).optional()
});

const htmlMappingSchema = z.object({
  itemSelector: z.string().min(1),
  titleSelector: z.string().min(1),
  linkSelector: z.string().min(1),
  dateSelector: z.string().min(1),
  summarySelector: z.string().min(1).optional(),
  dateAttribute: z.string().min(1).optional()
});

export const collectionSourceSchema = baseSourceSchema.extend({
  jsonMapping: jsonMappingSchema.optional(),
  csvMapping: csvMappingSchema.optional(),
  htmlMapping: htmlMappingSchema.optional()
}).superRefine((source, context) => {
  const fetchable = !["manual", "disabled"].includes(source.method);
  if (fetchable && !source.endpoint) {
    context.addIssue({ code: "custom", message: "fetchable sources require endpoint" });
  }
  if (fetchable && source.allowedHosts.length === 0) {
    context.addIssue({ code: "custom", message: "fetchable sources require allowedHosts" });
  }
  if (source.method === "json-api" && !source.jsonMapping) {
    context.addIssue({ code: "custom", message: "json-api sources require jsonMapping" });
  }
  if (source.method === "csv-api" && !source.csvMapping) {
    context.addIssue({ code: "custom", message: "csv-api sources require csvMapping" });
  }
  if (source.method === "html-list" && !source.htmlMapping) {
    context.addIssue({ code: "custom", message: "html-list sources require htmlMapping" });
  }
  if (source.collectionRole === "manual" && source.method !== "manual") {
    context.addIssue({ code: "custom", message: "manual role requires manual method" });
  }
  if (source.collectionRole === "disabled" && source.method !== "disabled") {
    context.addIssue({ code: "custom", message: "disabled role requires disabled method" });
  }
});

export const collectionRegistrySchema = z.object({
  version: z.literal(1),
  sources: z.array(collectionSourceSchema).min(1)
}).superRefine((registry, context) => {
  const seen = new Set<string>();
  const publisherGroups = new Map<string, string>();
  for (const [index, source] of registry.sources.entries()) {
    const id = source.adapterId ?? source.sourceId;
    if (seen.has(id)) context.addIssue({ code: "custom", path: ["sources", index, "adapterId"], message: `duplicate adapter identity ${id}` });
    seen.add(id);
    const publisherGroup = source.publisherGroup ?? source.sourceId;
    const existingGroup = publisherGroups.get(source.sourceId);
    if (existingGroup && existingGroup !== publisherGroup) {
      context.addIssue({
        code: "custom", path: ["sources", index, "publisherGroup"],
        message: `source ${source.sourceId} has conflicting publisher groups`
      });
    }
    publisherGroups.set(source.sourceId, publisherGroup);
  }
});

export const rawCandidateSchema = z.object({
  title: z.string().min(1),
  url: z.string().min(1),
  publishedAt: z.string().min(1),
  summary: z.string().min(1).optional(),
  releaseId: z.string().min(1).max(200).optional(),
  landingUrl: z.url().optional()
});

export const normalizedCandidateSchema = z.object({
  candidateId: z.string().regex(/^[a-f0-9]{64}$/),
  sourceId: z.string().regex(/^[a-z0-9-]+$/),
  publisherGroup: z.string().regex(/^[a-z0-9-]+$/).optional(),
  collectionRole: z.enum(["evidence", "discovery"]),
  contentClass: z.enum(contentClasses),
  language: z.enum(languageTags),
  discoveredBy: z.enum(["rss", "json-api", "csv-api", "html-list"]),
  canonicalUrl: z.url(),
  citationUrl: z.url(),
  evidenceUrl: z.url().optional(),
  title: z.string().min(1),
  publishedAt: z.iso.datetime(),
  summary: z.string().min(1).optional(),
  summaryOrigin: z.literal("source-supplied").optional(),
  releaseId: z.string().min(1).max(200).optional(),
  landingUrl: z.url().optional(),
  sectors: z.array(z.enum(sectors)).min(1),
  geographies: z.array(z.string().min(2)).min(1),
  retrievedAt: z.iso.datetime()
});

const scoreBreakdownSchema = z.object({
    version: z.literal(1),
    factors: z.object({
      recency: z.object({ signal: z.number().min(0).max(1), weight: z.literal(0.34), contribution: z.number().nonnegative(), ageDays: z.number().nonnegative() }),
      authority: z.object({ signal: z.number().min(0).max(1), weight: z.literal(0.24), contribution: z.number().nonnegative() }),
      contentClass: z.object({ signal: z.union([z.literal(0.5), z.literal(1)]), weight: z.literal(0.18), contribution: z.number().nonnegative() }),
      topic: z.object({ signal: z.number().min(0).max(1), weight: z.literal(0.14), contribution: z.number().nonnegative(), keywordHits: z.number().int().nonnegative() }),
      corroboration: z.object({
        signal: z.number().min(0).max(1), weight: z.literal(0.10), contribution: z.number().nonnegative(), supportingSources: z.number().int().nonnegative()
      })
    }),
    adjustments: z.object({
      bovineGenetics: z.union([z.literal(0), z.literal(0.08)]),
      international: z.union([z.literal(0), z.literal(0.06)]),
      nonEnglish: z.union([z.literal(0), z.literal(-0.07)])
    }),
    total: z.number()
  });

const duplicateMatchSchema = z.object({
  candidateId: z.string().regex(/^[a-f0-9]{64}$/),
  sourceId: z.string().regex(/^[a-z0-9-]+$/),
  publisherGroup: z.string().regex(/^[a-z0-9-]+$/).optional(),
  title: z.string().min(1),
  citationUrl: z.url(),
  evidenceUrl: z.url().optional(),
  releaseId: z.string().min(1).max(200).optional(),
  method: z.enum(["strict-text", "event-signature", "recurring-series"]),
  sharedTerms: z.array(z.string().min(1)),
  linkedToCandidateId: z.string().regex(/^[a-f0-9]{64}$/)
});

function closeEnough(a: number, b: number) {
  return Math.abs(a - b) <= 0.000003;
}

export const candidateSchema = normalizedCandidateSchema.extend({
  relevanceScore: z.number(),
  scoreBreakdown: scoreBreakdownSchema.optional(),
  clusterId: z.string().regex(/^[a-f0-9]{64}$/),
  reviewTier: z.enum(reviewTiers).optional(),
  selectionBasis: z.enum(selectionBases).optional(),
  relatedUrls: z.array(z.url()),
  duplicateMatches: z.array(duplicateMatchSchema).optional()
}).superRefine((candidate, context) => {
  // schemaVersion 1 queues created before score auditing remain readable. New
  // queues must carry both structures, and their arithmetic must reconcile.
  if (!candidate.scoreBreakdown && !candidate.duplicateMatches) return;
  const issue = (path: PropertyKey[], message: string) => context.addIssue({ code: "custom", path, message });
  if (!candidate.scoreBreakdown || !candidate.duplicateMatches) {
    issue([], "scoreBreakdown and duplicateMatches must be supplied together");
    return;
  }
  const { factors, adjustments, total } = candidate.scoreBreakdown;
  for (const [name, factor] of Object.entries(factors)) {
    if (!closeEnough(factor.contribution, factor.signal * factor.weight)) {
      issue(["scoreBreakdown", "factors", name, "contribution"], "factor contribution does not equal signal × weight");
    }
  }
  if (factors.contentClass.signal !== (candidate.contentClass === "news" ? 1 : 0.5)) {
    issue(["scoreBreakdown", "factors", "contentClass", "signal"], "content-class signal does not match candidate contentClass");
  }
  if (!closeEnough(factors.topic.signal, Math.min(factors.topic.keywordHits, 12) / 12)) {
    issue(["scoreBreakdown", "factors", "topic", "signal"], "topic signal does not match keywordHits");
  }
  const candidatePublisherGroup = candidate.publisherGroup ?? candidate.sourceId;
  const distinctRelatedPublishers = new Set(candidate.duplicateMatches.map((match) => match.publisherGroup ?? match.sourceId));
  distinctRelatedPublishers.delete(candidatePublisherGroup);
  if (factors.corroboration.supportingSources !== distinctRelatedPublishers.size) {
    issue(["scoreBreakdown", "factors", "corroboration", "supportingSources"], "corroboration must count distinct additional publisher groups");
  }
  if (!closeEnough(factors.corroboration.signal, Math.min(distinctRelatedPublishers.size, 3) / 3)) {
    issue(["scoreBreakdown", "factors", "corroboration", "signal"], "corroboration signal does not match distinct additional publisher groups");
  }
  const expectedAdjustments = {
    bovineGenetics: candidate.sectors.includes("bovine-genetics") ? 0.08 : 0,
    international: candidate.geographies.some((geography) => geography !== "United States") ? 0.06 : 0,
    nonEnglish: candidate.language !== "en" && candidate.language !== "und" ? -0.07 : 0
  };
  for (const [name, expected] of Object.entries(expectedAdjustments)) {
    if (adjustments[name as keyof typeof adjustments] !== expected) {
      issue(["scoreBreakdown", "adjustments", name], "adjustment does not match candidate metadata");
    }
  }
  const expectedTotal = Object.values(factors).reduce((sum, factor) => sum + factor.contribution, 0)
    + Object.values(adjustments).reduce<number>((sum, adjustment) => sum + adjustment, 0);
  if (!closeEnough(total, expectedTotal)) issue(["scoreBreakdown", "total"], "total does not equal factor contributions plus adjustments");
  if (candidate.relevanceScore !== total) issue(["relevanceScore"], "relevanceScore must equal scoreBreakdown.total");
  const relatedUrls = [...new Set(candidate.relatedUrls)].sort();
  const diagnosticUrls = [...new Set(candidate.duplicateMatches
    .filter((match) => match.sourceId !== candidate.sourceId)
    .map((match) => match.citationUrl))].sort();
  if (JSON.stringify(relatedUrls) !== JSON.stringify(diagnosticUrls)) {
    issue(["duplicateMatches"], "duplicate diagnostics must account for every related URL");
  }
});

export const candidateFileSchema = z.object({
  schemaVersion: z.literal(1),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  window: z.object({
    start: z.iso.datetime(),
    end: z.iso.datetime(),
    timezone: z.literal("America/New_York")
  }),
  generatedAt: z.iso.datetime(),
  candidates: z.array(candidateSchema)
});

export const adapterResultSchema = z.object({
  sourceId: z.string(),
  status: z.enum(["success", "failed"]),
  itemsSeen: z.number().int().nonnegative(),
  itemsAccepted: z.number().int().nonnegative(),
  rejectedOutOfWindow: z.number().int().nonnegative().default(0),
  rejectedByScope: z.number().int().nonnegative().default(0),
  rejectedByDate: z.number().int().nonnegative().default(0),
  durationMs: z.number().int().nonnegative(),
  error: z.string().optional()
});

export const runManifestSchema = z.object({
  schemaVersion: z.literal(1),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime(),
  status: z.enum(["success", "partial", "failed"]),
  candidateCount: z.number().int().nonnegative(),
  candidatesBeforeDeduplication: z.number().int().nonnegative(),
  newsCandidateCount: z.number().int().nonnegative(),
  datasetCandidateCount: z.number().int().nonnegative(),
  clusterCount: z.number().int().nonnegative(),
  adapters: z.array(adapterResultSchema),
  manualSources: z.array(z.string()),
  editorialReadiness: z.enum(["ready", "coverage-gap"]),
  newsReadiness: z.enum(["ready", "insufficient-news"]),
  coverageGaps: z.array(z.string()),
  coverage: z.object({
    sectors: z.record(z.string(), z.number().int().nonnegative()),
    geographies: z.record(z.string(), z.number().int().nonnegative()),
    languages: z.record(z.string(), z.number().int().nonnegative())
  }),
  reviewSelection: z.object({
    selectedCount: z.number().int().nonnegative(),
    target: z.number().int().positive(),
    minimum: z.number().int().positive(),
    publisherFamilyCap: z.number().int().positive(),
    preferredPublisherGroups: z.number().int().positive(),
    distinctPublisherGroups: z.number().int().nonnegative(),
    sourceConcentrated: z.boolean(),
    publisherGroups: z.record(z.string(), z.number().int().nonnegative()),
    coverage: z.object({
      sectors: z.record(z.string(), z.number().int().nonnegative()),
      international: z.number().int().nonnegative()
    }),
    warnings: z.array(z.string())
  }).optional(),
  warnings: z.array(z.string())
});

export type CollectionSource = z.infer<typeof collectionSourceSchema>;
export type RawCandidate = z.infer<typeof rawCandidateSchema>;
export type NormalizedCandidate = z.infer<typeof normalizedCandidateSchema>;
export type Candidate = z.infer<typeof candidateSchema>;
export type CandidateFile = z.infer<typeof candidateFileSchema>;
export type RunManifest = z.infer<typeof runManifestSchema>;
