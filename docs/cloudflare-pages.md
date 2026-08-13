# Cloudflare Pages setup

## Project

Connect the GitHub repository to Cloudflare Pages with these settings:

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | Leave blank (repository root) |
| Node.js version | `22.22.0` (pinned by `.nvmrc`) |

Set `SITE_URL` to the final production URL. The build is static and requires no server runtime or database.

## Access

Keep the proof of concept private with Cloudflare Access:

1. Protect both the production hostname and preview deployments.
2. Allow only the two approved email addresses or their identity-provider group.
3. Require one-time PIN or the organization's identity provider.
4. Recheck access before sharing a preview link.

The repository also ships `robots.txt`, an `X-Robots-Tag` header, and page-level `noindex` metadata. Those reduce accidental indexing but do not replace access control.

## Review flow

1. The weekly automation opens a branch or pull request containing one draft JSON file.
2. GitHub Actions validates the content model and builds the site.
3. Reviewers inspect the Cloudflare preview and complete the pull-request checklist.
4. An editor changes the report status to `approved` and merges it.
5. Cloudflare deploys `main`; draft reports remain excluded from the production build.
