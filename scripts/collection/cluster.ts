import { createHash } from "node:crypto";
import type { NormalizedCandidate } from "./types";

// Near-duplicate clustering so one development reported by several outlets
// collapses into a single ranked story with the others attached as related
// links. Fully deterministic: SimHash fingerprint for fast similarity plus a
// token Jaccard gate to avoid over-clustering unrelated short headlines.

const stopwords = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "at", "by", "from",
  "as", "is", "are", "was", "were", "new", "report", "reports", "update", "updates", "news",
  "de", "la", "el", "los", "las", "y", "o", "en", "para", "con", "por", "del", "un", "una"
]);

export function tokenize(text: string) {
  return new Set(
    text.toLowerCase().replace(/[^a-z0-9áéíóúñç]+/g, " ").split(" ")
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

export type CandidateCluster = { clusterId: string; members: NormalizedCandidate[] };

const maxHamming = 3;
const minJaccard = 0.5;

export function clusterCandidates(candidates: NormalizedCandidate[]): CandidateCluster[] {
  const clusters: Array<{ fingerprint: bigint; tokens: Set<string>; members: NormalizedCandidate[] }> = [];
  for (const candidate of candidates) {
    const tokens = tokenize(`${candidate.title} ${candidate.summary ?? ""}`);
    const fingerprint = simhash(tokens);
    const match = clusters.find((cluster) =>
      hammingDistance(cluster.fingerprint, fingerprint) <= maxHamming
      && jaccard(cluster.tokens, tokens) >= minJaccard
      && cluster.members.some((member) => member.sectors.some((sector) => candidate.sectors.includes(sector)))
    );
    if (match) match.members.push(candidate);
    else clusters.push({ fingerprint, tokens, members: [candidate] });
  }
  return clusters.map((cluster) => ({
    clusterId: createHash("sha256")
      .update(cluster.members.map((member) => member.candidateId).sort().join("\n"))
      .digest("hex"),
    members: cluster.members
  }));
}
