import type { CollectionSource } from "./types";

export type FetchLike = typeof fetch;

export async function fetchWithPolicy(source: CollectionSource, fetcher: FetchLike = fetch) {
  if (!source.endpoint) throw new Error(`${source.sourceId}: endpoint is missing`);
  let url = new URL(source.endpoint);
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    if (url.protocol !== "https:") throw new Error(`${source.sourceId}: only HTTPS endpoints are allowed`);
    if (!source.allowedHosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) {
      throw new Error(`${source.sourceId}: host ${url.hostname} is not allowed`);
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), source.timeoutMs);
    let response: Response;
    try {
      response = await fetcher(url, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          accept: "application/atom+xml, application/rss+xml, application/json, text/csv, text/html;q=0.9",
          "user-agent": "ProterraIntelligenceCollector/1.0 (+https://github.com/f-petrozzi/proterra-intelligence)"
        }
      });
    } finally {
      clearTimeout(timeout);
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || redirect === 3) throw new Error(`${source.sourceId}: redirect limit exceeded`);
      url = new URL(location, url);
      continue;
    }
    if (!response.ok) throw new Error(`${source.sourceId}: HTTP ${response.status}`);
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength > source.maxResponseBytes) throw new Error(`${source.sourceId}: response is too large`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > source.maxResponseBytes) throw new Error(`${source.sourceId}: response is too large`);
    return { bytes, contentType: response.headers.get("content-type") ?? "", finalUrl: url.toString() };
  }
  throw new Error(`${source.sourceId}: redirect limit exceeded`);
}
