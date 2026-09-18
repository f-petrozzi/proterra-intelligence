# Source review service

Two people run this: the owner and the COO. Either can submit a link; either can accept it. Accepting a source or a story never publishes anything — the weekly brief keeps its own separate approval.

The service lives on the stable, main-only Review Worker at `/sources`. It never fetches a submitted link; it only stores what a person typed and what a person decided.

## What the pages do

| Page | Purpose |
| --- | --- |
| `/sources` | The approved publisher directory, with each entry's collection state |
| `/sources/new` | Submit a publisher or a story. `?kind=source` opens the publisher form; `?source=<id>` pre-fills from a known publisher |
| `/sources/review` | Everything submitted. A reviewer sees all of it; anyone else sees their own |
| `/sources/submission/<id>` | Complete the details, then Accept, Save, or Decline. Decisions are version-checked, so a stale page cannot overwrite a newer decision |
| `/sources/coverage` | The weekly check. Puerto Rico is its own area, never inferred from Latin America |

Coverage shows how many news candidates collection already found for the selected week next to the human check, so recording *checked* is a judgement about that week, not a blind confirmation. A quiet week is a valid result; an unchecked area is not the same as no news, and neither claims complete coverage.

## Deployment order

Nothing here works until the Worker is live, so deploy in this order.

1. **Apply the migration.** `0007_sources.sql` creates the submission, decision-event, coverage-check, and daily-archive tables. The Deploy review worker workflow applies migrations before deploying; to do it by hand:

   ```sh
   npx wrangler d1 migrations apply proterra-intelligence-review --remote --config review-worker/wrangler.jsonc
   ```

2. **Deploy the Worker** (`.github/workflows/deploy-review-worker.yml`, or `npx wrangler deploy --config review-worker/wrangler.jsonc`). That workflow now also runs when `src/data/sources.json` or `config/collection-sources.json` changes, because the Worker bundles both registries.

3. **Confirm Access covers `/sources/*`.** The existing Worker application policy already covers the whole hostname; check that both reviewer emails are on it and that the Service Auth policy is still limited to `/api/internal/*` consumers. Interactive users must present an identity, not a service token.

4. **Make sure both people are reviewers.** Submitting needs only an Access identity; deciding needs an active row:

   ```sql
   INSERT INTO review_users (email, role, active) VALUES ('you@example.com', 'publisher', 1)
     ON CONFLICT(email) DO UPDATE SET active = 1;
   ```

5. **Publish the site links last.** `src/pages/sources.astro` and `SourceCard.astro` link to `PUBLIC_REVIEW_ORIGIN` (default `https://proterra-intelligence-review.petrozzi.workers.dev`). Set that Pages variable if the Worker hostname differs, and deploy the site only once step 2 succeeded, so the links do not lead to a 404.

6. **Turn the workflows on** by setting `WEEKLY_COLLECTION_ENABLED=true`. Both new workflows also accept `workflow_dispatch` for a rehearsal while that variable is still `false`.

## Workflows

| Workflow | Schedule | What it does |
| --- | --- | --- |
| Collect daily discoveries | 10:00 UTC daily | Runs the collector for tomorrow's window and posts the candidates and run manifest to `/api/internal/sources/archive` |
| Add reviewed publishers | hourly at :30 | Applies accepted publisher decisions to `src/data/sources.json` and `config/collection-sources.json`, runs `npm run verify`, then opens and merges one automation pull request |
| Collect weekly sources | existing weekly schedule | Loads accepted stories and saved daily discoveries before collecting, then posts a receipt for each story it used |

All three need `REVIEW_API_URL`, `REVIEW_SERVICE_KEY`, `REVIEW_ACCESS_CLIENT_ID`, and `REVIEW_ACCESS_CLIENT_SECRET`.

Weekly collection runs Mondays at 11:00 UTC. Record the Puerto Rico and Latin America checks for the upcoming issue before then: a missing check on either of those two areas is reported as a coverage gap on the manifest, which holds the draft until someone records the check or deliberately waives it with `npm run weekly:draft -- --allow-coverage-gap`. The other areas on the coverage page are useful notes but do not gate anything. If the Review Worker is unreachable when the weekly job starts, that step is allowed to fail and collection continues with live sources only; accepted stories then carry over to the next run instead of being lost.

A day's archive row keeps the richer snapshot: a later, thinner rerun records its health without erasing discoveries already saved for that day. Rows older than 60 days are dropped, and collection only ever reads back the last three weeks — longer than the longest configured lookback.

## How a decision reaches the registry

A publisher accepted in the Worker is applied by the hourly workflow, not by the Worker itself. The workflow rewrites both registry files from the reviewed snapshot, validates them, and merges a single automation pull request. Because a merge made with `GITHUB_TOKEN` does not trigger push-event workflows, the job dispatches the Worker deployment explicitly; Cloudflare Pages builds the site from its own Git integration, so the publication site needs no extra trigger. If `main` requires status checks that the automation branch cannot satisfy, the merge fails and the next hourly run retries — it never bypasses branch protection.

The submission stays **Accepted · waiting for collection** until the following run confirms the registry matches the reviewed snapshot; it then becomes **Added** with the commit that carried it. Accepting a publisher creates a *manual* collection entry: stories from it can be submitted immediately, and automatic collection is enabled only after someone verifies a public feed and edits `config/collection-sources.json`. An accepted correction widens an existing entry's sectors and geographies; narrowing operational scope stays a deliberate repository edit.

Accepted stories are picked up by the weekly collection for the issue date on the submission. A story accepted for a week that has already been collected is handed back with an explanation rather than waiting forever or altering a report already in review: reopen it, set a current issue date, and accept it again.

## When something needs attention

A failed synchronization writes the reason onto the submission. It shows as **Setup needs attention** in the review list and reopens the decision form, so the fix is to correct the details and accept again. Common reasons:

- *This publisher needs collection setup before accepting stories.* — accept the publisher first and wait for the hourly run.
- *Evidence link is outside its approved publisher.* — the story link's domain does not match the registry entry.
- *Story is outside the selected issue's reporting window.* — the publication date is older than that source's lookback.

Access errors against a source never change its editorial approval. Stories already reviewed keep their original dates.
