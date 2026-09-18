import { z } from "zod";
import registry from "../../src/data/sources.json";
import collection from "../../config/collection-sources.json";

export const regions = ["Puerto Rico", "United States", "Latin America & Caribbean", "International"] as const;
export const topics = ["dairy", "meat", "bovine-genetics"] as const;
export const areas = [...regions, ...topics] as const;
export const dateSchema = z.iso.date();
export const linkSchema = z.url().max(2000).refine(value => {
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password;
}, "Use a public HTTPS link without a username or password.");
export function cleanLink(value: string) {
  const url = new URL(linkSchema.parse(value));
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  url.hostname = url.hostname.replace(/^www\./, "");
  return url.toString().replace(/\/$/, "");
}
export const submissionSchema = z.object({
  kind: z.enum(["source", "story"]),
  url: linkSchema.transform(cleanLink),
  name: z.string().trim().min(3).max(200),
  notes: z.string().trim().max(2000).default(""),
  regions: z.array(z.enum(regions)).min(1).max(4),
  sectors: z.array(z.enum(topics)).min(1).max(3),
  sourceId: z.string().regex(/^[a-z0-9-]+$/).max(100).optional(),
  issueDate: dateSchema.optional(),
  // A reviewer may type a plain date; midday Atlantic keeps it inside the day it was published.
  publishedAt: z.union([z.iso.datetime({ offset: true }), z.iso.date().transform(value => `${value}T12:00:00-04:00`)]).optional(),
  summary: z.string().trim().max(2000).default(""),
  evidenceUrl: linkSchema.optional()
});
export type Submission = z.infer<typeof submissionSchema>;
export type Publisher = typeof registry[number];
export function publisherFor(url: string) {
  const { hostname, pathname } = new URL(url);
  const host = hostname.replace(/^www\./, "");
  // Several registry entries share a domain, so the entry whose allowed path
  // matches most of the link wins, then the most specific domain.
  return registry
    .filter(source => source.status === "approved" && (host === source.domain || host.endsWith(`.${source.domain}`)))
    .map(source => ({ source, depth: !source.allowedPaths ? 0
      : Math.max(-1, ...source.allowedPaths.filter(prefix => pathname.startsWith(prefix)).map(prefix => prefix.length)) }))
    .filter(match => match.depth >= 0)
    .sort((a, b) => b.depth - a.depth || b.source.domain.length - a.source.domain.length)[0]?.source;
}
export function acceptedStory(input: Submission) {
  const url = input.evidenceUrl || input.url;
  const publisher = publisherFor(url);
  if (!publisher) throw new Error("Accept this publisher first, then wait for it to appear in the registry. For a social post, add a direct link to an approved publisher as evidence.");
  if (!input.issueDate || !input.publishedAt || input.summary.length < 40) throw new Error("A story needs an issue date, publication timestamp, and factual summary of at least 40 characters before acceptance.");
  if (!collection.sources.some(source => source.sourceId === publisher.id)) throw new Error("This publisher needs collection setup before accepting stories.");
  return { sourceId: publisher.id, url, title: input.name, publishedAt: input.publishedAt, summary: input.summary };
}
export function acceptedPublisher(input: Submission, tier: "A" | "B" | "C"): Publisher {
  const domain = new URL(input.url).hostname.replace(/^www\./, "");
  const existing = input.sourceId ? registry.find(source => source.id === input.sourceId) : undefined;
  if (input.sourceId && !existing) throw new Error("Source no longer exists.");
  if (existing && existing.domain !== domain) throw new Error("A source correction cannot change its domain. Add a new publisher instead.");
  if (!existing && registry.some(source => source.domain === domain)) throw new Error("This publisher is already registered. Use Suggest a change on its source page.");
  if (input.notes.length < 10) throw new Error("Add a short explanation of why this publisher is trusted.");
  return {
    ...existing, id: existing?.id ?? domain.replace(/[^a-z0-9]+/g, "-"), name: input.name,
    domain, url: input.url, tier, status: "approved", regions: input.regions, sectors: input.sectors,
    cadence: existing?.cadence ?? "Daily discovery; manual stories until a feed is verified", notes: input.notes
  };
}
export const decisionSchema = z.object({
  version: z.coerce.number().int().positive(), action: z.enum(["accept", "decline", "save"]),
  reason: z.string().trim().max(2000).default(""), tier: z.enum(["A", "B", "C"]).default("B")
});
