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
  corroboratingPublisherCount: number;
  windowEnd: string;
};

export type ScoreFactor<Weight extends number = number> = {
  signal: number;
  weight: Weight;
  contribution: number;
};

export type ScoreBreakdown = {
  version: 1;
  factors: {
    recency: ScoreFactor<0.34> & { ageDays: number };
    authority: ScoreFactor<0.24>;
    contentClass: Omit<ScoreFactor<0.18>, "signal"> & { signal: 0.5 | 1 };
    topic: ScoreFactor<0.14> & { keywordHits: number };
    corroboration: ScoreFactor<0.10> & { supportingSources: number };
  };
  adjustments: {
    bovineGenetics: 0 | 0.08;
    international: 0 | 0.06;
    nonEnglish: -0.07 | 0;
  };
  total: number;
};

const halfLifeDays = 3.5;
const topicCap = 12;

function round(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

// Pure, reproducible relevance score in roughly [0, 1.3]. Higher is more
// report-worthy. Recency, source authority, news-vs-dataset class, keyword
// density, and cross-outlet corroboration combine, with a small correcting
// boost for the historically under-represented bovine-genetics and
// non-United-States coverage.
export function scoreCandidateBreakdown(candidate: NormalizedCandidate, context: ScoreContext): ScoreBreakdown {
  const ageDays = Math.max(0, (Date.parse(context.windowEnd) - Date.parse(candidate.publishedAt)) / 86_400_000);
  const recency = Math.exp(-ageDays / halfLifeDays);
  const authority = context.authorityWeight;
  const classWeight: 0.5 | 1 = candidate.contentClass === "news" ? 1 : 0.5;
  const keywordHits = topicStrength(candidate.title, candidate.summary);
  const topicSignal = Math.min(keywordHits, topicCap) / topicCap;
  const corroboration = Math.min(context.corroboratingPublisherCount, 3) / 3;
  const bovineGenetics: 0 | 0.08 = candidate.sectors.includes("bovine-genetics") ? 0.08 : 0;
  const international: 0 | 0.06 = candidate.geographies.some((geography) => geography !== "United States") ? 0.06 : 0;
  // The reel is an English-reading brief that links out to the source. Confident
  // non-English items are down-ranked so English-native reporting leads, but not
  // dropped: a strong international story can still climb.
  const nonEnglish: -0.07 | 0 = candidate.language !== "en" && candidate.language !== "und" ? -0.07 : 0;
  const contributions = {
    recency: 0.34 * recency,
    authority: 0.24 * authority,
    contentClass: 0.18 * classWeight,
    topic: 0.14 * topicSignal,
    corroboration: 0.10 * corroboration
  };
  const total = Object.values(contributions).reduce((sum, value) => sum + value, 0)
    + bovineGenetics + international + nonEnglish;

  return {
    version: 1,
    factors: {
      recency: { signal: round(recency), weight: 0.34, contribution: round(contributions.recency), ageDays: round(ageDays) },
      authority: { signal: round(authority), weight: 0.24, contribution: round(contributions.authority) },
      contentClass: { signal: classWeight, weight: 0.18, contribution: round(contributions.contentClass) },
      topic: { signal: round(topicSignal), weight: 0.14, contribution: round(contributions.topic), keywordHits },
      corroboration: {
        signal: round(corroboration), weight: 0.10, contribution: round(contributions.corroboration),
        supportingSources: context.corroboratingPublisherCount
      }
    },
    adjustments: { bovineGenetics, international, nonEnglish },
    total: round(total)
  };
}

export function scoreCandidate(candidate: NormalizedCandidate, context: ScoreContext) {
  return scoreCandidateBreakdown(candidate, context).total;
}
