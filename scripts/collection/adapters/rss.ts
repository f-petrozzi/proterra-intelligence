import { XMLParser } from "fast-xml-parser";
import type { RawCandidate } from "../types";

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", trimValues: true });

function list<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function atomLink(value: unknown) {
  for (const candidate of list(value as Record<string, unknown> | Array<Record<string, unknown>>)) {
    if (candidate?.["@_rel"] === "alternate" || !candidate?.["@_rel"]) {
      return String(candidate?.["@_href"] ?? "");
    }
  }
  return "";
}

export function parseRss(input: string): RawCandidate[] {
  const document = parser.parse(input) as Record<string, any>;
  const rssItems = list(document.rss?.channel?.item);
  if (rssItems.length > 0) {
    return rssItems.map((item: any) => ({
      title: String(item.title ?? ""),
      url: String(item.link ?? item.guid?.["#text"] ?? item.guid ?? ""),
      publishedAt: String(item.pubDate ?? item["dc:date"] ?? ""),
      ...(item.description ? { summary: String(item.description) } : {})
    }));
  }
  return list(document.feed?.entry).map((entry: any) => ({
    title: String(entry.title?.["#text"] ?? entry.title ?? ""),
    url: atomLink(entry.link) || String(entry.id ?? ""),
    publishedAt: String(entry.published ?? entry.updated ?? ""),
    ...(entry.summary || entry.content
      ? { summary: String(entry.summary?.["#text"] ?? entry.summary ?? entry.content?.["#text"] ?? entry.content) }
      : {})
  }));
}

