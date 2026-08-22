import { createHash } from "node:crypto";
import type { NormalizedCandidate } from "./types";

// Near-duplicate clustering so one development reported by several outlets
// collapses into a single ranked story with the others attached as related
// links. Fully deterministic: a strict SimHash/Jaccard match handles close
// rewrites, while a conservative event-signature fallback catches differently
// worded coverage that shares several non-generic anchors across publishers.

const stopwords = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "at", "by", "from",
  "as", "is", "are", "was", "were", "new", "report", "reports", "update", "updates", "news",
  "de", "la", "el", "los", "las", "y", "o", "en", "para", "con", "por", "del", "un", "una"
]);

const tokenAliases = new Map([
  ["announced", "announce"], ["announces", "announce"], ["announcing", "announce"],
  ["closed", "close"], ["closes", "close"], ["closing", "close"], ["closures", "closure"],
  ["exported", "export"], ["exporters", "exporter"], ["exports", "export"],
  ["imported", "import"], ["importing", "import"], ["imports", "import"],
  ["prices", "price"], ["producers", "producer"], ["ranchers", "rancher"],
  ["tariffs", "tariff"], ["tonnes", "ton"], ["tons", "ton"]
]);

// These words establish sector overlap but are too common to prove that two
// articles cover the same event. The event fallback must share other anchors.
const genericIndustryTokens = new Set([
  "beef", "bovine", "calf", "calves", "cattle", "cow", "dairy", "farm", "farmer",
  "ground", "herd", "industry", "livestock", "market", "meat", "milk", "price",
  "producer", "production", "ranch", "rancher", "say", "says", "sector", "united", "states"
]);

function normalizeToken(token: string) {
  const folded = token.normalize("NFD").replace(/[̀-ͯ]/g, "");
  return tokenAliases.get(folded) ?? folded;
}

export function tokenize(text: string) {
  return new Set(
    text.toLowerCase().replace(/[’']/g, " ").replace(/[^a-z0-9áéíóúñç]+/g, " ").split(" ")
      .map(normalizeToken)
      .filter((token) => token.length >= 3 && !stopwords.has(token))
  );
}

function tokenHash(token: string) {
  return BigInt(`0x${createHash("sha256").update(token).digest("hex").slice(0, 16)}`);
}

export function simhash(tokens: Set<string>) {
  const bits = new Array<number>(64).fill(0);
  for (const token of tokens) {
    const hash = tokenHash(token);
    for (let bit = 0n; bit < 64n; bit += 1n) {
      bits[Number(bit)] += (hash >> bit) & 1n ? 1 : -1;
    }
  }
  let fingerprint = 0n;
  for (let bit = 0; bit < 64; bit += 1) if (bits[bit] > 0) fingerprint |= 1n << BigInt(bit);
  return fingerprint;
}

export function hammingDistance(a: bigint, b: bigint) {
  let value = a ^ b;
  let distance = 0;
  while (value > 0n) {
    distance += Number(value & 1n);
    value >>= 1n;
  }
  return distance;
}

function jaccard(a: Set<string>, b: Set<string>) {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

export type DuplicateMatch = {
  matched: boolean;
  method?: "strict-text" | "event-signature" | "recurring-series";
  sharedTerms: string[];
};

export type DuplicateLink = {
  leftCandidateId: string;
  rightCandidateId: string;
  method: NonNullable<DuplicateMatch["method"]>;
  sharedTerms: string[];
};

export type CandidateCluster = {
  clusterId: string;
  members: NormalizedCandidate[];
  matches: DuplicateLink[];
};

const maxHamming = 3;
const minJaccard = 0.5;
const maxEventDistanceHours = 72;

function intersection(a: Set<string>, b: Set<string>) {
  return [...a].filter((token) => b.has(token)).sort();
}

function sectorsOverlap(a: NormalizedCandidate, b: NormalizedCandidate) {
  return a.sectors.some((sector) => b.sectors.includes(sector));
}

export function duplicateMatch(a: NormalizedCandidate, b: NormalizedCandidate): DuplicateMatch {
  if (!sectorsOverlap(a, b)) return { matched: false, sharedTerms: [] };
  const aTokens = tokenize(`${a.title} ${a.summary ?? ""}`);
  const bTokens = tokenize(`${b.title} ${b.summary ?? ""}`);
  const sharedTerms = intersection(aTokens, bTokens);
  if (a.contentClass === "dataset" && b.contentClass === "dataset"
    && a.sourceId === b.sourceId && a.citationUrl === b.citationUrl
    && a.releaseId && b.releaseId && a.releaseId !== b.releaseId) {
    return { matched: true, method: "recurring-series", sharedTerms: [] };
  }
  if (hammingDistance(simhash(aTokens), simhash(bTokens)) <= maxHamming
    && jaccard(aTokens, bTokens) >= minJaccard) {
    return { matched: true, method: "strict-text", sharedTerms };
  }

  // The fallback is deliberately cross-publisher and news-only. It requires a
  // close publication window plus multiple shared anchors in both headlines and
  // full source text, preventing generic weekly cattle coverage from collapsing.
  if (a.sourceId === b.sourceId || a.contentClass !== "news" || b.contentClass !== "news") {
    return { matched: false, sharedTerms };
  }
  const hoursApart = Math.abs(Date.parse(a.publishedAt) - Date.parse(b.publishedAt)) / 3_600_000;
  if (!Number.isFinite(hoursApart) || hoursApart > maxEventDistanceHours) return { matched: false, sharedTerms };
  const informativeShared = sharedTerms.filter((token) => !genericIndustryTokens.has(token));
  const headlineShared = intersection(tokenize(a.title), tokenize(b.title))
    .filter((token) => !genericIndustryTokens.has(token));
  const matched = informativeShared.length >= 3 && headlineShared.length >= 2;
  return { matched, ...(matched ? { method: "event-signature" as const } : {}), sharedTerms: informativeShared };
}

export function clusterCandidates(candidates: NormalizedCandidate[]): CandidateCluster[] {
  const clusters: Array<{ members: NormalizedCandidate[]; matches: DuplicateLink[] }> = [];
  for (const candidate of candidates) {
    const connections = clusters.flatMap((cluster, index) => {
      for (const member of cluster.members) {
        const match = duplicateMatch(member, candidate);
        if (match.matched && match.method) return [{ index, member, match }];
      }
      return [];
    });
    if (connections.length === 0) {
      clusters.push({ members: [candidate], matches: [] });
      continue;
    }

    // A bridge item may match members of two previously separate clusters.
    // Merge every connected cluster so results do not depend on which match was
    // encountered first.
    const targetIndex = connections[0].index;
    const target = clusters[targetIndex];
    for (const connection of connections) {
      target.matches.push({
        leftCandidateId: connection.member.candidateId,
        rightCandidateId: candidate.candidateId,
        method: connection.match.method!,
        sharedTerms: connection.match.sharedTerms
      });
    }
    for (const index of [...new Set(connections.slice(1).map((connection) => connection.index))].sort((a, b) => b - a)) {
      target.members.push(...clusters[index].members);
      target.matches.push(...clusters[index].matches);
      clusters.splice(index, 1);
    }
    target.members.push(candidate);
  }
  return clusters.map((cluster) => ({
    clusterId: createHash("sha256")
      .update(cluster.members.map((member) => member.candidateId).sort().join("\n"))
      .digest("hex"),
    members: cluster.members,
    matches: cluster.matches
  }));
}
