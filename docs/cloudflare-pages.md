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

1. The weekly automation opens a branch and pull request containing one draft JSON file. Draft reports do not belong on `main`.
2. GitHub Actions validates the content model and builds the site.
3. Cloudflare builds the branch. Preview deployments include draft reports and display a visible draft notice; production excludes them.
4. Reviewers inspect the preview on desktop and mobile, open every source link, and complete the pull-request checklist.
5. An editor opens **Actions → Approve weekly brief**, enters the pull-request number and issue date, and repeats the issue date as confirmation.
6. The approval workflow verifies that the pull request is open, targets `main`, and comes from this repository. It marks the report and every included item as reviewed, runs the full validation suite, and commits the approval back to the pull-request branch.
7. Reviewers inspect the refreshed preview and merge the pull request.
8. Cloudflare deploys `main`; the newly approved issue becomes public within the protected site.

The approval workflow never merges the pull request or sends email. Those remain separate human actions.

### Issue status

| Location | Draft visible | Purpose |
| --- | --- | --- |
| Local development | Yes | Writing and checking the issue |
| Cloudflare branch preview | Yes | Editorial review |
| Production branch (`main`) | No | Approved publication only |

To approve locally for testing, run `npm run report:approve -- YYYY-MM-DD`. Do not commit that change until the editorial review is complete.
