# Editorial rubric

Use this rubric to rank candidate signals. Score each dimension from 0 to 5, multiply by its weight, and normalize to 100. When a deterministic candidate queue is supplied, its `relevanceScore` and `contentClass` are the starting order; this rubric is the editorial judgment applied on top of them.

| Dimension | Weight | What earns a high score |
| --- | ---: | --- |
| Source authority | 25% | Primary or authoritative publisher, exact publication date, and a direct canonical link |
| Materiality | 25% | Meaningful effect on producers, processors, breeding programs, trade, cost, supply, or demand |
| Timeliness | 20% | New publication in the reporting window or a material update to an active development |
| Specificity | 15% | Concrete facts, methods, dates, or figures that can be summarized without speculation |
| Coverage value | 10% | Adds useful sector or geographic breadth, including Latin America and Puerto Rico |
| Novelty | 5% | Adds information not already covered in recent reports |

## Selection rules

- Publish 8 to 10 signals only when the evidence supports them.
- Cover dairy, meat, and bovine genetics; aim for at least two signals per sector.
- Include both US and international developments; aim for at least three of each.
- Run a dedicated Latin America and Puerto Rico search every week. Select regional items only when they meet the same threshold as the rest of the list.
- Lead with news-led developments (`contentClass: "news"`). A recurring dataset or market release (`contentClass: "dataset"`) supports a story or the dashboard and enters the reel only when the release itself is materially newsworthy.
- Consolidate articles about the same underlying development into one signal; when the queue already clustered them, keep the representative and treat `relatedUrls` as corroboration.
- Treat approved trade press as first-class news reporting, but anchor statistics, regulatory, and market claims to an approved primary source.
- Cite the reader-facing `citationUrl` as the readable link and keep the raw dated release in `evidenceUrl` with its `releaseId`; never make a raw API response or PDF the primary reader link when a readable citation exists.
- The brief is English and links out to sources; write every field in English. For a non-English candidate (`language` other than `en`), prefer an English citation for the same development when one exists, and otherwise note the source language in `sourceNote`. Non-English items are ranked lower by default but may still lead when the development is materially stronger.
- Treat press releases as claims by the issuing organization, not independent validation.
- Treat LinkedIn as manual discovery only. Do not scrape it. Official organization posts may support attributed announcements, but material claims require approved primary evidence.
- Do not infer causation, commercial impact, or scientific consensus beyond the evidence.
- Explain why each selected development matters to Proterra using conditional language and public market context. Do not imply knowledge of Proterra animals, customers, sales, or performance.
- Compare candidates with the previous eight reports to avoid repetition.

## Confidence labels

- **High:** authoritative primary evidence, or multiple independent reliable sources that agree.
- **Medium:** credible evidence with a material limitation, an early-stage development, or only one reliable source.

Low-confidence candidates do not enter the published report.

## Editorial images

- Choose an image ID from `src/data/editorial-images.json` for every selected story.
- Match the image to the specific subject of the headline using the registry's `subjects`, not only to its sector or to a secondary detail in the summary.
- Use each image ID at most once per automated report. A different story in the same sector needs a different, still-relevant image.
- Product images are literal: `butter-output` is only for a butter-led headline, while milk-powder stories use `milk-powder`.
- Use only assets with a recorded creator, license, and original file page.
- Treat an editorial image as presentation, never as evidence for the story.
