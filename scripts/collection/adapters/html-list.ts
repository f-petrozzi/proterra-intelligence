import { load } from "cheerio";
import type { CollectionSource, RawCandidate } from "../types";

export function parseHtmlList(input: string, source: CollectionSource): RawCandidate[] {
  if (!source.htmlMapping || !source.endpoint) throw new Error(`${source.sourceId}: HTML mapping is missing`);
  const $ = load(input);
  return $(source.htmlMapping.itemSelector).toArray().map((element) => {
    const item = $(element);
    const title = item.find(source.htmlMapping!.titleSelector).first();
    const link = item.find(source.htmlMapping!.linkSelector).first();
    const date = item.find(source.htmlMapping!.dateSelector).first();
    const rawDate = source.htmlMapping!.dateAttribute
      ? date.attr(source.htmlMapping!.dateAttribute) ?? date.text()
      : date.text();
    const summary = source.htmlMapping!.summarySelector
      ? item.find(source.htmlMapping!.summarySelector).first().text()
      : undefined;
    return {
      title: title.text() || link.text(),
      url: new URL(link.attr("href") ?? "", source.endpoint).toString(),
      publishedAt: rawDate ?? "",
      ...(summary ? { summary } : {})
    };
  });
}
