# Weekly automation operations

## One-time setup

### Homelab

1. Install Node 24.19, GitHub CLI, and Codex CLI.
2. Run `gh auth login` with access to the private repository.
3. Configure `git config user.name` and `git config user.email` for the operator account; the isolated worktree uses this identity for draft commits.
4. Follow [Codex authentication](https://learn.chatgpt.com/docs/auth), run `codex login`, choose ChatGPT authentication, and verify:

   ```sh
   codex login status
   ```

   The result must say `Logged in using ChatGPT`. If `~/.codex/auth.json` exists, confirm it is owned by the homelab user and mode `0600`.
   The runner removes both `OPENAI_API_KEY` and `CODEX_API_KEY` from the Codex subprocess environment so an unrelated shell setting cannot consume API credits.
5. Add the review service values to an untracked `.env` or the homelab account’s secret manager:

   ```text
   REVIEW_API_URL=https://review.example.com
   REVIEW_ACCESS_CLIENT_ID=
   REVIEW_ACCESS_CLIENT_SECRET=
   REVIEW_SERVICE_KEY=
   ```

### Cloudflare

1. Create D1 database `proterra-intelligence-review` and replace `REPLACE_WITH_D1_DATABASE_ID` in `review-worker/wrangler.jsonc`.
2. Set the Access team domain, application AUD, stable review origin, and public site origin in the same config.
3. Create Access policies for the two reviewer emails plus a Service Auth policy on the stable Review Worker. Pages preview access may remain enabled because Pages is only a deployment-success gate; it is never embedded by the reviewer.
5. Create one Access service token for the homelab/GitHub automation path.
6. Set Worker secrets with `wrangler secret put`: `CSRF_SECRET`, `REVIEW_SERVICE_KEY`, and `GITHUB_WORKFLOW_TOKEN`.
7. Apply every migration, including `0002_atomic_outbox.sql` and `0003_report_snapshots.sql`, and deploy only from `main` using the protected `review-production` GitHub environment. The Worker cron retries notification outbox rows every five minutes.
8. Insert both reviewer emails as publishers:

   ```sql
   INSERT INTO review_users (email, role) VALUES ('first@example.com', 'publisher');
   INSERT INTO review_users (email, role) VALUES ('second@example.com', 'publisher');
   ```

The Worker’s fine-grained GitHub token must be limited to this repository with Actions: write. It does not need contents or pull-request permission.

### GitHub

Set repository variables:

- `WEEKLY_REVIEWER`
- `WEEKLY_COLLECTION_ENABLED=false` until rehearsal succeeds
- `REVIEW_API_URL`
- `CLOUDFLARE_PAGES_PROJECT`

Set repository or protected-environment secrets:

- `GMAIL_USERNAME`, `GMAIL_APP_PASSWORD`
- `AUTOMATION_OPERATOR_EMAIL`, `AUTOMATION_REVIEWER_EMAILS`
- `REVIEW_ACCESS_CLIENT_ID`, `REVIEW_ACCESS_CLIENT_SECRET`, `REVIEW_SERVICE_KEY`
- `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`

Protect `main` with the Verify check. Permit the approval workflow identity to merge only after checks. Do not require a separate formal GitHub approval unless that requirement is intentionally integrated into this workflow.

For the homelab portion of setup, `npm run weekly:setup` performs the safe read-only prerequisite, authentication, placeholder, ignore, and protected-secret-file checks. Add `-- --init-env` to create a blank mode-`0600` secret template, `-- --online` for read-only GitHub/Review API checks, and `-- --verify` for `npm ci` plus the complete project validation. It never creates remote resources or prints secret values.

## Normal week

1. Wait for “Proterra Intelligence sources are ready.”
2. Open the linked draft pull request and inspect **Deterministic source audit**. It lists every configured adapter, health and rejection counts, every accepted candidate, and the exact additive reason for its score. Confirm that the leading developments and collapsed related links look sensible before spending Codex usage.
3. From the repository root on the homelab, load the review secrets and run:

   ```sh
   npm run weekly:draft
   ```

   If the source email says `coverage-gap`, do not run Codex merely to rediscover that result. Add a defensible manual lead and rerun collection. Only when the editorial lead deliberately accepts the documented gaps, run the command below. This waives only the manifest-readiness gate; it never permits filler, invented evidence, weakened verification, or an invalid report.

   ```sh
   npm run weekly:draft -- --allow-coverage-gap
   ```

4. Wait for “draft ready,” then use the stable review link in the email.
5. Click or select report content to attach comments. Source buttons open separately and do not change the active comment anchor.
6. Add all instructions, then select **Request changes** once.
7. When the change-request email arrives, run the same command again.
8. Confirm each addressed thread against the refreshed exact-SHA report snapshot and resolve it.
9. Either publisher selects **Approve & publish**. No GitHub action or merge is needed from the reviewer.

## Recovery

- Collection or artifact-validation failure—including malformed JSON—removes `source-review-ready` from the existing PR and marks a matching D1 source queue `failed`, so the older queue cannot be drafted. Inspect the `collection-failed` issue and rerun after repairing the adapter or output; a successful rerun restores the queue.
- Runner failure before push: correct the reported preflight, coverage, or validation problem and rerun; the remote branch is unchanged.
- Runner push succeeds but review-state reporting or final GitHub label/comment updates fail: leave `.review/receipts/YYYY-MM-DD.json` in place, restore connectivity, and run `npm run weekly:draft` again. The marker comment is finalized before labels change, leaving the PR discoverable on a partial failure; the runner reconciles the exact pushed SHA and idempotent PR finalization from the receipt without invoking Codex a second time.
- Preview timeout: inspect Cloudflare Pages for the exact commit SHA; do not substitute CI success for deployment success.
- Approval failure: inspect the GitHub run and D1 approval record, then rerun the same approval workflow with its original approval ID. The prepared approval commit and publishing state are retained so validation and merge resume without a second site approval. Never bypass branch protection with `--admin`.
- Production deployment failure or timeout: D1 records the error, leaves the exact merged approval in its retryable `publishing`/`merged` state, and queues a failure email. Repair the deployment problem, then rerun `record-production-deployment.yml` with the same merge SHA; do not silently treat CI success as deployment success.
- Stale snapshot or version conflict: reload the stable review workspace and repeat the intended action against the current revision.
