# Weekly report automation

You are preparing the next Weekly Brief for Proterra Intelligence. Work only in this repository and create a draft for human review. Never publish, merge, send, or alter an approved report.

## Inputs

Before researching, read:

1. `config/editorial-rubric.md`
2. `config/excluded-domains.json`
3. `src/data/sources.json`
4. `config/social-watchlist.json`
5. `src/data/history.json`
6. `templates/report.template.json`
7. The eight most recent files in `src/data/reports/`

Use the current date as the issue date. The primary reporting window is the preceding seven calendar days. Use the preceding 30 days only to establish context or confirm that a trend is accelerating, easing, or continuing.

## Research and selection

1. Search approved primary sources first for dairy, meat, and bovine genetics developments in the US and internationally. Run a separate coverage pass for Latin America and Puerto Rico using the regional sources in the registry.
2. Build an internal candidate list of at least 20 distinct developments when the available evidence allows.
3. Verify the event date, publication date, geography, material numbers, and direct canonical URL for every candidate.
4. Consult reputable secondary reporting only to discover a primary source or add independently verified context. Never cite an excluded domain.
5. Score candidates using the editorial rubric. Remove duplicates, promotional announcements without material evidence, opinion pieces, and developments already covered without a meaningful update.
6. Select 8 to 10 publications that a reader may reasonably want to open. Aim for at least two per sector and at least three US and three international items. Include relevant Latin America or Puerto Rico coverage when it clears the same evidence threshold; do not use a weak item merely to meet a quota.

LinkedIn is a manual discovery channel, not a feed to scrape. Do not use bots, crawlers, browser automation, or unauthorized APIs to collect LinkedIn content. Review only links supplied by a person or accounts explicitly listed in `config/social-watchlist.json`. An official organization post may be cited with `sourceId: "linkedin-org-post"`, `documentType: "social-post"`, and `discoveryChannel: "linkedin"` as an attributed announcement, but it does not independently verify its own claims. Trace statistics, research findings, regulatory claims, and market claims to an approved primary source. Do not copy LinkedIn images or reproduce post text beyond a short factual paraphrase.

## Drafting

Create `src/data/reports/YYYY-MM-DD.json` from the template with:

- `status` set to `draft`;
- a `documentType`, `reviewStatus`, and `discoveryChannel` for every selected item;
- concise, neutral headlines;
- a two- or three-sentence factual summary, two to four source-supported key points, a specific explanation of industry relevance, and a specific “watch next” for each publication;
- optional business context or uncertainty only when it materially helps the reader interpret the source;
- one plain-language overview headline and three labeled overview points;
- one dashboard pulse for each sector and three to five key metrics, all taken from selected items;
- an explicit comparison basis for every dashboard number, such as month over month, year over year, or forecast date;
- an `itemRank` on every dashboard entry that points to its supporting report item;
- one to three comparison charts only when every value has an explicit basis, a supporting item, and a cited approved source;
- `high` or `medium` confidence based on the rubric;
- direct citations whose `sourceId` exists in `src/data/sources.json` and whose URL belongs to that registered domain;
- a one- or two-sentence `sourceNote` for every citation that explains exactly what the document contributes and, when useful, what it does not establish;
- no unsupported claims, invented data, vague citations, marketing language, or confidential information.

Do not infer a dashboard direction from tone. Use `up`, `down`, `new`, or `stable` only when the cited item establishes that direction. Avoid repeating a sector-pulse number in the key-metrics strip unless it is essential to the issue.

Treat `keyPoints` as reported facts, not interpretation. Treat `businessRelevance` as optional conditional editorial analysis about the market or decisions an industry business may need to monitor. Use `uncertainty` when needed to prevent a source announcement, forecast, or calendar from being presented as an observed outcome. Target 130 to 220 words across all visible digest fields so the source list remains easy to scan.

This automation uses public sources. Do not imply access to Proterra's catalog, animals, customers, sales, rankings, strategy, or commercial performance. Do not write phrases such as “Proterra animals,” “Proterra customers,” or “Proterra sales” unless the report scope explicitly declares internal data and the reviewer supplies that evidence. The brief is prepared for Proterra; it is not a report about Proterra.

Charts are a secondary appendix, not the lead presentation. They must compare like with like, show the period in the description, preserve the sign of each value, and identify supporting `itemRanks` and `sourceIds`. Do not convert a single observation into a trend line. If honest comparison data is unavailable, omit charts rather than filling the space.

Update `src/data/history.json` only when an approved recurring dataset publishes a new observation for an existing series. Preserve the chart's unit, cadence, and comparison basis; apply official revisions when the source updates earlier values and explain the revision policy in the chart note. Never interpolate a missing period or combine monthly and annual observations in one chart. A new series requires at least two comparable observations and a direct registered source URL.

If fewer than eight signals meet the threshold, do not create a schema-invalid report. Instead, write a short run summary explaining the coverage gaps and the strongest verified candidates.

## Validation and handoff

Run `npm run verify`. Correct validation or build failures caused by the draft. Finish with a review summary containing:

- the draft path;
- selected coverage by sector and geography;
- Latin America and Puerto Rico candidates reviewed, selected, and omitted;
- any reviewer-submitted LinkedIn leads and the primary evidence used to verify them;
- medium-confidence items and their caveats;
- candidates excluded after review;
- any sources that should be considered for the registry.

The human reviewer owns factual approval and the change from `draft` to `approved`.
