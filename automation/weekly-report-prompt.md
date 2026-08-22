# Weekly report automation

You are preparing the next Weekly Brief for Proterra Intelligence. Work only in this repository and create a draft for human review. Never publish, merge, send, approve, or alter an approved report. Draft work must be committed to a dedicated branch and presented through a pull request; it must not be committed directly to `main`.

When this policy is invoked by `automation/source-review-prompt.md`, that wrapper's deterministic candidate and feedback boundaries supersede the open-ended discovery instructions below. The standalone instructions remain available for the documented manual rollback path.

## Inputs

Before researching, read:

1. `config/editorial-rubric.md`
2. `config/excluded-domains.json`
3. `src/data/sources.json`
4. `config/social-watchlist.json`
5. `src/data/history.json`
6. `templates/report.template.json`
7. `src/data/editorial-images.json`
8. The eight most recent files in `src/data/reports/`

Use the current date as the issue date. The primary reporting window is the preceding seven calendar days. Use the preceding 30 days only to establish context or confirm that a trend is accelerating, easing, or continuing.

## Research and selection

1. The weekly reel is news-led. Prioritize genuinely newsworthy dairy, meat, and bovine-genetics developments from approved trade-press and official news sources in the US and internationally, and treat recurring dataset or market releases as supporting evidence and dashboard material rather than lead stories. Run a separate coverage pass for Latin America and Puerto Rico using the regional sources in the registry.
2. Build an internal candidate list of at least 20 distinct developments when the available evidence allows.
3. Verify the event date, publication date, geography, material numbers, and direct canonical URL for every candidate.
4. Consult reputable secondary reporting only to discover a primary source or add independently verified context. Never cite an excluded domain.
5. Score candidates using the editorial rubric. Remove duplicates, promotional announcements without material evidence, opinion pieces, and developments already covered without a meaningful update.
6. Select 5 to 10 news-led publications that a reader may reasonably want to open; a routine dataset release enters the reel only when the release itself is materially newsworthy, and otherwise supports a story or the dashboard. Prefer 8 to 10 when the evidence supports that volume, but never weaken relevance to reach a fixed count. Seek meaningful coverage across all three sectors and both US and international developments. Include relevant Latin America or Puerto Rico coverage when it clears the same evidence threshold; do not use a weak item merely to meet a quota.

LinkedIn is a controlled discovery channel, not an unrestricted feed. For each account in `config/social-watchlist.json`, run targeted public-web searches for posts or account updates published during the reporting window. Also review links supplied by a person or open GitHub issues labeled `linkedin-lead` when repository issue access is available. Extract only the organization, public title or opening claim, publication date, public URL when indexed, entities, geography, and sector needed to evaluate the lead. Do not sign in, reuse session cookies, bypass access controls, solve CAPTCHAs, call private endpoints, or use bots, crawlers, browser automation, or unauthorized APIs against LinkedIn. Stop when content is gated.

Prefer a stable public post URL. If a public index exposes the post but not a stable post URL, link the official organization's `/posts/` feed and state that limitation in `sourceNote`. Then search for the underlying official release, report, dataset, or paper. An official organization post may be cited with `sourceId: "linkedin-org-post"`, `documentType: "social-post"`, and `discoveryChannel: "linkedin"` as an attributed announcement, but it does not independently verify its own claims. Trace statistics, research findings, regulatory claims, and market claims to an approved primary source. Do not copy LinkedIn images or reproduce post text beyond a short factual paraphrase. Select only material leads; routine hiring, awards, event promotion, and general brand posts should not enter the brief.

Use the official LinkedIn API only if a reviewer has separately configured an approved LinkedIn application, valid access token, and the required organization permissions. API access must remain limited to organizations and actions authorized by LinkedIn. The absence of approved API access never permits scraping.

## Drafting

Create `src/data/reports/YYYY-MM-DD.json` from the template with:

- `status` set to `draft`;
- a persistent `reviewId` for every story, using `story-` plus the first 16 characters of its accepted candidate ID; preserve an existing `reviewId` during revisions even if its citation URL changes;
- a `documentType`, `reviewStatus`, and `discoveryChannel` for every selected item;
- concise, neutral headlines;
- a two- or three-sentence factual summary, two to four source-supported key points, a specific explanation of industry relevance, and a specific “watch next” for each publication;
- a concise `businessRelevance` for every item, explaining why the development matters to Proterra using conditional language and public market context;
- one plain-language overview headline and three labeled overview points;
- one dashboard pulse for each sector and three to five key metrics, all taken from selected items;
- an explicit comparison basis for every dashboard number, such as month over month, year over year, or forecast date;
- an `itemRank` on every dashboard entry that points to its supporting report item;
- one to three comparison charts only when every value has an explicit basis, a supporting item, and a cited approved source;
- `high` or `medium` confidence based on the rubric;
- direct citations whose `sourceId` exists in `src/data/sources.json` and whose URLs belong to that registered domain;
- a human-readable `url` for each citation, using the evidence bundle's `citationUrl` when present (otherwise a readable landing or synopsis page), plus the immutable dated release in `evidenceUrl` and its identifier in `releaseId`; never make a raw JSON API response or PDF the primary reader-facing link when a readable citation URL is supplied;
- English copy in every field even when the underlying source is not in English; for a non-English source prefer an English citation covering the same development when one exists, and otherwise note the source language in `sourceNote` so the reader knows the linked page is not in English;
- one unique editorial `imageId` per story, selected by matching the story headline to the registry's `subjects`; when `.review/image-context.json` is supplied, use it to prefer assets newly introduced for this issue during library growth or the least-recently-used compatible assets during rotation; never select an image merely because a secondary detail appears elsewhere in the story;
- a one- or two-sentence `sourceNote` for every citation that explains exactly what the document contributes and, when useful, what it does not establish;
- no unsupported claims, invented data, vague citations, marketing language, or confidential information.

Do not infer a dashboard direction from tone. Use `up`, `down`, `new`, or `stable` only when the cited item establishes that direction. Avoid repeating a sector-pulse number in the key-metrics strip unless it is essential to the issue.

Treat `keyPoints` as reported facts, not interpretation. Treat `businessRelevance` as conditional editorial analysis, not evidence of internal Proterra conditions. Use `uncertainty` when needed to prevent a source announcement, forecast, or calendar from being presented as an observed outcome. Target 130 to 220 words across all visible digest fields so the source list remains easy to scan.

This automation uses public sources. Do not imply access to Proterra's catalog, animals, customers, sales, rankings, strategy, or commercial performance. Do not write phrases such as “Proterra animals,” “Proterra customers,” or “Proterra sales” unless the report scope explicitly declares internal data and the reviewer supplies that evidence. The brief is prepared for Proterra; it is not a report about Proterra.

Charts are a secondary appendix, not the lead presentation. They must compare like with like, show the period in the description, preserve the sign of each value, and identify supporting `itemRanks` and `sourceIds`. Do not convert a single observation into a trend line. If honest comparison data is unavailable, omit charts rather than filling the space.

Update `src/data/history.json` only when an approved recurring dataset publishes a new observation for an existing series. Preserve the chart's unit, cadence, and comparison basis; apply official revisions when the source updates earlier values and explain the revision policy in the chart note. Never interpolate a missing period or combine monthly and annual observations in one chart. A new series requires at least two comparable observations and a direct registered source URL.

If fewer than five signals meet the threshold, do not create a schema-invalid report. Instead, write a short run summary explaining the coverage gaps and the strongest verified candidates.

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

When repository and GitHub access are available, finish by pushing the draft branch and opening or updating its pull request. Include the coverage summary in the pull-request body. Do not merge the pull request or invoke the approval workflow.
