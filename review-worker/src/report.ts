import { z } from "zod";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const httpsUrl = z.url().refine((value) => new URL(value).protocol === "https:", "HTTPS is required");

export const reviewCitationSchema = z.object({
  sourceId: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string().min(5).max(500),
  url: httpsUrl,
  evidenceUrl: httpsUrl.optional(),
  releaseId: z.string().min(1).max(100).optional(),
  publishedAt: z.string().regex(datePattern),
  sourceNote: z.string().min(20).max(2000)
});

export const reviewItemSchema = z.object({
  rank: z.number().int().positive(),
  reviewId: z.string().regex(/^story-[a-z0-9-]{8,80}$/),
  headline: z.string().min(12).max(500),
  imageId: z.string().regex(/^[a-z0-9-]+$/),
  documentType: z.string().min(2).max(50),
  sectors: z.array(z.string().min(2).max(100)).min(1).max(10),
  regions: z.array(z.string().min(2).max(100)).min(1).max(20),
  signal: z.string().min(2).max(50),
  summary: z.string().min(40).max(5000),
  keyPoints: z.array(z.string().min(15).max(3000)).min(2).max(4),
  whyItMatters: z.string().min(30).max(5000),
  businessRelevance: z.string().min(30).max(5000),
  uncertainty: z.string().min(30).max(5000).optional(),
  watchNext: z.string().min(15).max(3000),
  confidence: z.enum(["high", "medium"]),
  citations: z.array(reviewCitationSchema).min(1).max(10)
}).passthrough();

export const reviewReportSchema = z.object({
  slug: z.string().regex(datePattern),
  issueNumber: z.number().int().positive(),
  title: z.string().min(5).max(500),
  status: z.enum(["draft", "approved"]),
  period: z.object({ start: z.string().regex(datePattern), end: z.string().regex(datePattern) }),
  publishedAt: z.string().regex(datePattern),
  scope: z.object({ basis: z.string().min(3).max(100), disclosure: z.string().min(30).max(5000) }),
  executiveSummary: z.string().min(60).max(10_000),
  editorNote: z.string().max(10_000).optional(),
  overview: z.object({
    headline: z.string().min(12).max(1000),
    points: z.array(z.object({ label: z.string().min(2).max(100), text: z.string().min(20).max(3000) })).max(10)
  }).optional(),
  items: z.array(reviewItemSchema).min(5).max(10)
}).passthrough().superRefine((report, context) => {
  if (report.slug !== report.publishedAt) {
    context.addIssue({ code: "custom", path: ["publishedAt"], message: "Snapshot date must match its slug" });
  }
  const ranks = report.items.map((item) => item.rank);
  if (ranks.some((rank, index) => rank !== index + 1)) {
    context.addIssue({ code: "custom", path: ["items"], message: "Story ranks must be consecutive" });
  }
  if (new Set(report.items.map((item) => item.reviewId)).size !== report.items.length) {
    context.addIssue({ code: "custom", path: ["items"], message: "Story review IDs must be unique" });
  }
});

export type ReviewReport = z.infer<typeof reviewReportSchema>;
export type ReviewItem = z.infer<typeof reviewItemSchema>;
