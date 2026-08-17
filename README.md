# Proterra Intelligence

An internal weekly research publication covering dairy, meat, and bovine genetics in the US and internationally.

The proof of concept is deliberately small: a static Astro site, structured JSON reports, an approved source registry, automated validation, Cloudflare preview deployments, and human approval before publication. It has no database, CMS, or server runtime.

## Local development

Requirements: Node.js 22.19 or newer. If you use `nvm`, run `nvm use` in the repository.

```sh
npm install
npm run dev
```

Before opening a pull request:

```sh
npm run verify
```

## Content workflow

1. A scheduled research run follows `automation/weekly-report-prompt.md` and opens a pull request with one draft JSON report.
2. The schema verifies report size, rank order, source IDs, source status, and citation domains.
3. Cloudflare branch previews include the draft and identify it clearly as unpublished.
4. Reviewers inspect the rendered issue and complete the editorial checklist.
5. A guarded GitHub workflow marks the issue approved and validates it on the pull-request branch.
6. The reviewer merges the pull request; only approved reports appear in production.

Reports live in `src/data/reports/`; the source registry lives in `src/data/sources.json`. Approved, credited images live in `src/data/editorial-images.json`. Editorial rules are in `config/editorial-rubric.md`.

## Market dashboard

The dashboard is intentionally separate from the weekly article feed. Recurring official FAO and USDA datasets power the historical charts; reviewed articles provide interpretation in the weekly brief. Refresh the normalized dashboard data with:

```sh
npm run data:refresh-dashboard
```

The scheduled dashboard workflow runs the same command, validates the site, and opens a review pull request when official values change. It never publishes newly fetched data directly to production.

## Deployment

Use Cloudflare Pages with GitHub integration, `npm run build`, and output directory `dist`. Protect production and preview URLs with Cloudflare Access while the brief is internal. See `docs/cloudflare-pages.md` for the complete setup.

## Weekly email

The repository includes a responsive React Email edition of every approved brief. Render it locally with `npm run email:preview`; test and production delivery use Gmail through a guarded GitHub Actions workflow. See `docs/weekly-email.md` for setup and operating instructions.

## Design principles

- A useful 30-second scan before deeper reading
- Evidence before volume
- Direct links and visible confidence
- Human approval before publication
- Immutable, reviewable history
- Minimal operational surface area

The publication uses Astro components for editorial layouts. Web Awesome is loaded only on report pages for the accessible evidence disclosure; all other pages remain static HTML and CSS.
