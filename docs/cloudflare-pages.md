# Cloudflare Pages setup

## Project

Connect the GitHub repository to Cloudflare Pages with these settings:

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | Leave blank (repository root) |
| Node.js version | `24.19.0` (pinned by `.nvmrc`) |

Set `SITE_URL` to the final production URL. The publication build is static. The separate Review Worker and D1 database are deployed only from `main` as described in the weekly operations runbook.

## Access

Apply separate Cloudflare Access policies to each surface:

1. Protect the production hostname with the company identity-provider group that may read published briefs.
2. Protect preview deployments and the Review Worker with the smaller reviewer/publisher group (two people for the proof of concept).
3. Add a Service Auth policy on the Review Worker for the GitHub Actions and homelab service token. Do not add that policy to the Pages preview.
4. Require the organization identity provider or one-time PIN for interactive users, and recheck the policies before sharing a preview link.

The repository also ships `robots.txt`, an `X-Robots-Tag` header, and page-level `noindex` metadata. Those reduce accidental indexing but do not replace access control.

## Review flow

1. The weekly automation opens a branch and pull request containing one draft JSON file. Draft reports do not belong on `main`.
2. GitHub Actions validates the content model and builds the site.
3. Cloudflare builds the branch. Preview code has no D1 or GitHub-secret binding; it only reports semantic field selections to the stable Review Worker.
4. A GitHub workflow polls the Pages deployments API for the exact commit and records its immutable URL before emailing reviewers.
5. Reviewers comment and approve in the stable Worker shell, which is deployed only from `main` and owns D1 plus the workflow-dispatch credential.
6. Approval validates and merges the exact reviewed SHA without an administrative bypass.
7. A second deployment watcher confirms the exact production merge before the issue is marked published.

GitHub Actions sends all email with the existing Gmail integration. Cloudflare never receives the Gmail credential.

### Issue status

| Location | Draft visible | Purpose |
| --- | --- | --- |
| Local development | Yes | Writing and checking the issue |
| Cloudflare branch preview | Yes | Editorial review |
| Production branch (`main`) | No | Approved publication only |

To approve locally for testing, run `npm run report:approve -- YYYY-MM-DD`. Do not commit that change until the editorial review is complete.
