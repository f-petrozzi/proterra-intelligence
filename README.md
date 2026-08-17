# Proterra Intelligence

An internal weekly research publication covering dairy, meat, and bovine genetics in the US and internationally.

The publication remains a small static Astro site with structured JSON reports, an approved source registry, automated validation, Cloudflare preview deployments, and human approval before publication. Editorial state lives in a separate, main-only Cloudflare Worker and D1 control plane; preview code never receives its bindings or credentials.

## Local development

Requirements: Node.js 24.19 or newer. If you use `nvm`, run `nvm use` in the repository.

```sh
npm install
npm run dev
```

Before opening a pull request:

```sh
npm run verify
```

## Content workflow

1. GitHub Actions deterministically collects configured sources and emails the operator.
2. The operator runs `npm run weekly:draft`; locally authenticated Codex prepares or revises the report in an isolated worktree.
3. Cloudflare branch previews contain only an unprivileged annotation bridge. A stable main-only Review Worker owns D1 feedback and approval state.
4. Reviewers attach field-level comments, batch change requests, confirm addressed threads, and approve an exact deployed SHA.
5. GitHub validates and merges that SHA automatically; Cloudflare production success is confirmed before publication email.

Reports live in `src/data/reports/`; the source registry lives in `src/data/sources.json`. Approved, credited images live in `src/data/editorial-images.json`. Editorial rules are in `config/editorial-rubric.md`.

See `docs/weekly-automation-plan.md` for architecture and `docs/weekly-research-operations.md` for setup and the weekly runbook.

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
