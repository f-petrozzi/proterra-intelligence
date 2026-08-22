import type { Candidate, RunManifest } from "./types";

export const reviewSelectionPolicy = {
  target: 10,
  minimum: 8,
  publisherFamilyCap: 3,
  preferredPublisherGroups: 4
} as const;

type SelectionSummary = NonNullable<RunManifest["reviewSelection"]>;
type SelectionBasis = NonNullable<Candidate["selectionBasis"]>;

function publisherGroup(candidate: Candidate) {
  return candidate.publisherGroup ?? candidate.sourceId;
}

function isInternational(candidate: Candidate) {
  return candidate.geographies.some((geography) => geography !== "United States");
}

function countBy(values: string[]) {
  return Object.fromEntries([...new Set(values)].sort().map((value) => [
    value, values.filter((candidate) => candidate === value).length
  ]));
}

/**
 * Builds an editorial triage order without changing the underlying relevance
 * score. Coverage and publisher variety choose the small "review first" set;
 * every other eligible item remains visible for editorial judgment.
 */
export function buildReviewQueue(rankedCandidates: Candidate[]): {
  candidates: Candidate[];
  summary: SelectionSummary;
} {
  const news = rankedCandidates.filter((candidate) => candidate.contentClass === "news");
  const data = rankedCandidates.filter((candidate) => candidate.contentClass === "dataset");
  const selected: Candidate[] = [];
  const selectedIds = new Set<string>();
  const groupCounts = new Map<string, number>();

  const select = (candidate: Candidate, basis: SelectionBasis) => {
    if (selectedIds.has(candidate.candidateId)) return;
    selected.push({ ...candidate, reviewTier: "review-first", selectionBasis: basis });
    selectedIds.add(candidate.candidateId);
    const group = publisherGroup(candidate);
    groupCounts.set(group, (groupCounts.get(group) ?? 0) + 1);
  };
  const underCap = (candidate: Candidate) =>
    (groupCounts.get(publisherGroup(candidate)) ?? 0) < reviewSelectionPolicy.publisherFamilyCap;

  const coverageTargets = { dairy: 2, meat: 2, "bovine-genetics": 1, international: 1 } as const;
  const coverageNow = () => ({
    dairy: selected.filter((candidate) => candidate.sectors.includes("dairy")).length,
    meat: selected.filter((candidate) => candidate.sectors.includes("meat")).length,
    "bovine-genetics": selected.filter((candidate) => candidate.sectors.includes("bovine-genetics")).length,
    international: selected.filter(isInternational).length
  });
  const coverageGain = (candidate: Candidate) => {
    const current = coverageNow();
    return Number(candidate.sectors.includes("dairy") && current.dairy < coverageTargets.dairy)
      + Number(candidate.sectors.includes("meat") && current.meat < coverageTargets.meat)
      + Number(candidate.sectors.includes("bovine-genetics") && current["bovine-genetics"] < coverageTargets["bovine-genetics"])
      + Number(isInternational(candidate) && current.international < coverageTargets.international);
  };

  // The input is already relevance-ranked, so first() preserves score order for
  // every tie while filling the most important coverage gaps.
  while (selected.length < reviewSelectionPolicy.target) {
    const eligible = news.filter((candidate) => !selectedIds.has(candidate.candidateId) && underCap(candidate));
    const bestGain = Math.max(0, ...eligible.map(coverageGain));
    if (bestGain === 0) break;
    const candidate = eligible.find((item) => coverageGain(item) === bestGain);
    if (!candidate) break;
    select(candidate, "coverage-balance");
  }

  const availableGroups = [...new Set(news.map(publisherGroup))];
  const desiredGroups = Math.min(reviewSelectionPolicy.preferredPublisherGroups, availableGroups.length);
  while (new Set(selected.map(publisherGroup)).size < desiredGroups && selected.length < reviewSelectionPolicy.target) {
    const represented = new Set(selected.map(publisherGroup));
    const candidate = news.find((item) =>
      !selectedIds.has(item.candidateId) && !represented.has(publisherGroup(item)) && underCap(item));
    if (!candidate) break;
    select(candidate, "publisher-diversity");
  }

  for (const candidate of news) {
    if (selected.length >= reviewSelectionPolicy.target) break;
    if (!selectedIds.has(candidate.candidateId) && underCap(candidate)) select(candidate, "queue-order");
  }

  // A thin source pool may not support the cap. Relax it only far enough to
  // offer the requested minimum, never to manufacture a full ten-item list.
  for (const candidate of news) {
    if (selected.length >= reviewSelectionPolicy.minimum) break;
    if (!selectedIds.has(candidate.candidateId)) select(candidate, "publisher-cap-exception");
  }

  const remainingNews = news
    .filter((candidate) => !selectedIds.has(candidate.candidateId))
    .map((candidate) => ({ ...candidate, reviewTier: "also-review" as const, selectionBasis: "eligible-news" as const }));
  const supportingData = data.map((candidate) => ({
    ...candidate, reviewTier: "supporting-data" as const, selectionBasis: "official-data" as const
  }));
  const selectedGroupCounts = countBy(selected.map(publisherGroup));
  const selectedCoverage = coverageNow();
  const distinctPublisherGroups = Object.keys(selectedGroupCounts).length;
  const sourceConcentrated = selected.length > 0 && (
    distinctPublisherGroups < Math.min(reviewSelectionPolicy.preferredPublisherGroups, selected.length)
    || Object.values(selectedGroupCounts).some((count) => count > reviewSelectionPolicy.publisherFamilyCap)
  );
  const warnings = [
    ...(availableGroups.length < reviewSelectionPolicy.preferredPublisherGroups
      ? [`Only ${availableGroups.length} publisher groups supplied eligible news; the preferred ${reviewSelectionPolicy.preferredPublisherGroups}-group mix was unavailable.`]
      : []),
    ...(Object.values(selectedGroupCounts).some((count) => count > reviewSelectionPolicy.publisherFamilyCap)
      ? [`The ${reviewSelectionPolicy.publisherFamilyCap}-item publisher-group cap was relaxed to reach the ${reviewSelectionPolicy.minimum}-item review minimum.`]
      : []),
    ...(selected.length < reviewSelectionPolicy.minimum
      ? [`Only ${selected.length} eligible news items were available for the review-first list.`]
      : [])
  ];

  return {
    candidates: [...selected, ...remainingNews, ...supportingData],
    summary: {
      selectedCount: selected.length,
      ...reviewSelectionPolicy,
      distinctPublisherGroups,
      sourceConcentrated,
      publisherGroups: selectedGroupCounts,
      coverage: {
        sectors: {
          dairy: selectedCoverage.dairy,
          meat: selectedCoverage.meat,
          "bovine-genetics": selectedCoverage["bovine-genetics"]
        },
        international: selectedCoverage.international
      },
      warnings
    }
  };
}
