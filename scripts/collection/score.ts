import { topicStrength } from "./normalize";
import type { CollectionSource, NormalizedCandidate } from "./types";

// Deterministic authority weight by trust tier. Official primary bodies rank
// above vetted trade press, which ranks above aggregator-surfaced discovery.
const tierAuthority: Record<NonNullable<CollectionSource["trustTier"]>, number> = {
  official: 0.9,
  "trade-press": 0.7,
  aggregator: 0.45
};

export function authorityWeightOf(source: Pick<CollectionSource, "authorityWeight" | "trustTier">) {
  if (typeof source.authorityWeight === "number") return source.authorityWeight;
  return source.trustTier ? tierAuthority[source.trustTier] : 0.6;
}

export type ScoreContext = {
  authorityWeight: number;
  clusterSize: number;
  windowEnd: string;
};

const halfLifeDays = 3.5;
const topicCap = 12;

// Pure, reproducible relevance score in roughly [0, 1.3]. Higher is more
// report-worthy. Recency, source authority, news-vs-dataset class, keyword
// density, and cross-outlet corroboration combine, with a small correcting
// boost for the historically under-represented bovine-genetics and
// non-United-States coverage.
export function scoreCandidate(candidate: NormalizedCandidate, context: ScoreContext) {
  const ageDays = Math.max(0, (Date.parse(context.windowEnd) - Date.parse(candidate.publishedAt)) / 86_400_000);
  const recency = Math.exp(-ageDays / halfLifeDays);
  const authority = context.authorityWeight;
  const classWeight = candidate.contentClass === "news" ? 1 : 0.5;
  const topicSignal = Math.min(topicStrength(candidate.title, candidate.summary), topicCap) / topicCap;
  const corroboration = Math.min(context.clusterSize - 1, 3) / 3;

  let score = 0.34 * recency
    + 0.24 * authority
    + 0.18 * classWeight
    + 0.14 * topicSignal
    + 0.10 * corroboration;

  if (candidate.sectors.includes("bovine-genetics")) score += 0.08;
  if (candidate.geographies.some((geography) => geography !== "United States")) score += 0.06;
  // The reel is an English-reading brief that links out to the source. Confident
  // non-English items are down-ranked so English-native reporting leads, but not
  // dropped: a strong international story can still climb.
  if (candidate.language !== "en" && candidate.language !== "und") score -= 0.07;

  return Math.round(score * 1_000_000) / 1_000_000;
}
