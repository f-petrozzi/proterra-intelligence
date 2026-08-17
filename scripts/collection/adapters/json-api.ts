import type { CollectionSource, RawCandidate } from "../types";

function getPath(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => {
    if (Array.isArray(current) && /^\d+$/.test(key)) return current[Number(key)];
    if (typeof current === "object" && current !== null) return (current as Record<string, unknown>)[key];
    return undefined;
  }, value);
}

export function parseJsonApi(input: string, source: CollectionSource): RawCandidate[] {
  if (!source.jsonMapping) throw new Error(`${source.sourceId}: JSON mapping is missing`);
  const document: unknown = JSON.parse(input);
  const items = getPath(document, source.jsonMapping.itemsPath);
  if (!Array.isArray(items)) throw new Error(`${source.sourceId}: itemsPath did not resolve to an array`);
  return items.map((item) => {
    const mapping = source.jsonMapping!;
    const url = mapping.urlTemplate
      ? mapping.urlTemplate.replace(/\{([^}]+)\}/g, (_match, path: string) =>
          encodeURIComponent(String(getPath(item, path) ?? "")))
      : mapping.fixedUrl ?? String(getPath(item, mapping.url!) ?? "");
    return {
      title: String(getPath(item, mapping.title) ?? ""),
      url,
      publishedAt: String(getPath(item, mapping.publishedAt) ?? ""),
      ...(mapping.summary && getPath(item, mapping.summary)
        ? { summary: String(getPath(item, mapping.summary)) }
        : {}),
      ...(mapping.releaseId && getPath(item, mapping.releaseId)
        ? { releaseId: String(getPath(item, mapping.releaseId)) }
        : {}),
      ...(mapping.landingUrl ? { landingUrl: mapping.landingUrl } : {})
    };
  });
}
