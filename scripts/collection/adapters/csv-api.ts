import { parse } from "csv-parse/sync";
import type { CollectionSource, RawCandidate } from "../types";

export function parseCsvApi(input: string, source: CollectionSource): RawCandidate[] {
  if (!source.csvMapping) throw new Error(`${source.sourceId}: CSV mapping is missing`);
  const records = parse(input, { columns: true, bom: true, skip_empty_lines: true, relax_column_count: true }) as Record<string, string>[];
  return records.map((record) => ({
    title: record[source.csvMapping!.title] ?? "",
    url: record[source.csvMapping!.url] ?? "",
    publishedAt: record[source.csvMapping!.publishedAt] ?? "",
    ...(source.csvMapping!.summary && record[source.csvMapping!.summary]
      ? { summary: record[source.csvMapping!.summary!] }
      : {})
  }));
}

