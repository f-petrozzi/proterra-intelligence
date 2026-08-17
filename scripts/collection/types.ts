import { z } from "zod";

export const sectors = ["dairy", "meat", "bovine-genetics"] as const;
export const collectionRoles = ["evidence", "discovery", "manual", "disabled"] as const;
export const collectionMethods = ["rss", "json-api", "csv-api", "html-list", "manual", "disabled"] as const;

const baseSourceSchema = z.object({
  sourceId: z.string().regex(/^[a-z0-9-]+$/),
  adapterId: z.string().regex(/^[a-z0-9-]+$/).optional(),
  enabled: z.boolean(),
  collectionRole: z.enum(collectionRoles),
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
  for (const [index, source] of registry.sources.entries()) {
    const id = source.adapterId ?? source.sourceId;
    if (seen.has(id)) context.addIssue({ code: "custom", path: ["sources", index, "adapterId"], message: `duplicate adapter identity ${id}` });
    seen.add(id);
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

export const candidateSchema = z.object({
  candidateId: z.string().regex(/^[a-f0-9]{64}$/),
  sourceId: z.string().regex(/^[a-z0-9-]+$/),
  collectionRole: z.enum(["evidence", "discovery"]),
  discoveredBy: z.enum(["rss", "json-api", "csv-api", "html-list"]),
  canonicalUrl: z.url(),
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
  adapters: z.array(adapterResultSchema),
  manualSources: z.array(z.string()),
  editorialReadiness: z.enum(["ready", "coverage-gap"]),
  coverageGaps: z.array(z.string()),
  coverage: z.object({
    sectors: z.record(z.string(), z.number().int().nonnegative()),
    geographies: z.record(z.string(), z.number().int().nonnegative())
  }),
  warnings: z.array(z.string())
});

export type CollectionSource = z.infer<typeof collectionSourceSchema>;
export type RawCandidate = z.infer<typeof rawCandidateSchema>;
export type Candidate = z.infer<typeof candidateSchema>;
export type CandidateFile = z.infer<typeof candidateFileSchema>;
export type RunManifest = z.infer<typeof runManifestSchema>;
