# Weekly report automation

You are preparing the next Weekly Brief for Proterra Intelligence. Work only in this repository and create a draft for human review. Never publish, merge, send, or alter an approved report.

## Inputs

Before researching, read:

1. `config/editorial-rubric.md`
2. `config/excluded-domains.json`
3. `src/data/sources.json`
4. `templates/report.template.json`
5. The eight most recent files in `src/data/reports/`

Use the current date as the issue date. The primary reporting window is the preceding seven calendar days. Use the preceding 30 days only to establish context or confirm that a trend is accelerating, easing, or continuing.

## Research and selection

1. Search approved primary sources first for dairy, meat, and bovine genetics developments in the US and internationally.
2. Build an internal candidate list of at least 20 distinct developments when the available evidence allows.
3. Verify the event date, publication date, geography, material numbers, and direct canonical URL for every candidate.
4. Consult reputable secondary reporting only to discover a primary source or add independently verified context. Never cite an excluded domain.
5. Score candidates using the editorial rubric. Remove duplicates, promotional announcements without material evidence, opinion pieces, and developments already covered without a meaningful update.
6. Select 8 to 10 signals. Aim for at least two per sector and at least three US and three international signals. Do not use a weak item merely to meet a quota.

## Drafting

Create `src/data/reports/YYYY-MM-DD.json` from the template with:

- `status` set to `draft`;
- concise, neutral headlines;
- a two- or three-sentence factual summary, two to four source-supported key points, a specific explanation of industry relevance, and a specific “watch next” for each signal;
- a Proterra-specific relevance statement and an explicit statement of what remains unclear for each of the three lead signals;
- one plain-language overview headline and three labeled overview points;
- one dashboard pulse for each sector and three to five key metrics, all taken from selected items;
- an explicit comparison basis for every dashboard number, such as month over month, year over year, or forecast date;
- an `itemRank` on every dashboard entry that points to its supporting report item;
- `high` or `medium` confidence based on the rubric;
- direct citations whose `sourceId` exists in `src/data/sources.json` and whose URL belongs to that registered domain;
- a one- or two-sentence `sourceNote` for every citation that explains exactly what the document contributes and, when useful, what it does not establish;
- no unsupported claims, invented data, vague citations, marketing language, or confidential information.

Do not infer a dashboard direction from tone. Use `up`, `down`, `new`, or `stable` only when the cited item establishes that direction. Avoid repeating a sector-pulse number in the key-metrics strip unless it is essential to the issue.

Treat `keyPoints` as reported facts, not interpretation. Treat `proterraRelevance` as editorial analysis and keep it specific to genetics, customers, positioning, or commercial decisions. Use `uncertainty` to prevent a source announcement, forecast, or calendar from being presented as an observed outcome. Target 200 to 300 words across all fields for each lead signal and 100 to 150 words for each remaining signal.

If fewer than eight signals meet the threshold, do not create a schema-invalid report. Instead, write a short run summary explaining the coverage gaps and the strongest verified candidates.

## Validation and handoff

Run `npm run verify`. Correct validation or build failures caused by the draft. Finish with a review summary containing:

- the draft path;
- selected coverage by sector and geography;
- medium-confidence items and their caveats;
- candidates excluded after review;
- any sources that should be considered for the registry.

The human reviewer owns factual approval and the change from `draft` to `approved`.
