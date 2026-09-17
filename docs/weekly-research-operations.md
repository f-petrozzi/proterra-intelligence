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
2. Open the linked draft pull request and inspect **Source review**. Read **Review first** as the suggested 8–10-item starting set, not a verdict. Check its plain-language reasons, sector/geography coverage, and publisher mix before spending Codex usage. **Also worth reviewing**, supporting data, source health, grouped coverage, and exact score math remain available in collapsed sections.
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
7. The review service stores the immutable feedback batch, mirrors `changes-requested` on the pull request, and emails the operator. When the email arrives, run the same command again. D1 remains authoritative: the runner also discovers `brief-review-ready` as a safe fallback if GitHub label synchronization is delayed.
8. Confirm each addressed thread against the refreshed exact-SHA report snapshot and resolve it.
9. Either publisher selects **Approve & publish**. No GitHub action or merge is needed from the reviewer.

## Unattended drafting on the homelab

The checked-in `automation/systemd/proterra-weekly-draft.{service,timer}` units are templates only; adding them does not install or enable scheduling. GitHub still collects the weekly sources, and the homelab polls every six hours for a ready source queue or submitted revision. It does not approve or publish reports. Draft completion continues through the existing preview/review workflow, including its configured notifications.

`npm run weekly:scheduled` loads only the four review credentials from `~/.config/proterra-intelligence/review.env` (or `PROTERRA_REVIEW_ENV_FILE`). The file must be owned by the operator, mode `0600`, and not a symlink. Values use dotenv syntax and are parsed as data; shell commands and variable interpolation are not evaluated. Missing credentials fail the run without printing their contents. GitHub and Codex still use the operator's existing CLI authentication.

Both `weekly:draft` and `weekly:scheduled` acquire `.review/weekly-draft.lock` with `flock`; an overlapping invocation exits successfully without doing work. Always use these entry points from this checkout: direct TypeScript execution or another checkout bypasses this shared lock. No open labeled PR is a successful scheduled skip. A single PR already in review or publication is also a successful skip, after pending receipts have been reconciled. Multiple discovered PRs fail safely so catch-up issues must be processed chronologically. Failed or unknown review states remain errors. Scheduling never supplies a coverage override.

Before activation, finish the catch-up queue and rehearse `npm run weekly:scheduled` against one approved-for-drafting source queue. This command is live: it may draft, push a validated report, and trigger the normal review handoff. Review the service's checkout location and pinned Node/CLI `PATH` for this account. After the rehearsal succeeds, install the templates:

```sh
install -d -m 700 ~/.config/systemd/user
install -m 644 automation/systemd/proterra-weekly-draft.service automation/systemd/proterra-weekly-draft.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now proterra-weekly-draft.timer
systemctl --user list-timers proterra-weekly-draft.timer
```

Also enable GitHub's `WEEKLY_COLLECTION_ENABLED` only after rehearsal. The timer uses the host's timezone, polls at 00:15, 06:15, 12:15, and 18:15 with up to five minutes of jitter, and catches a missed activation when the user manager resumes. For execution while logged out, confirm `loginctl show-user "$USER" -p Linger`; enabling linger is a separate host administration step. The service does not update the checkout or install dependencies: deploy reviewed code and dependencies before enabling it.

Inspect runs with `journalctl --user -u proterra-weekly-draft.service --since '2 days ago'` and `systemctl --user status proterra-weekly-draft.service`. Each invocation records start/end and exit status. Logs can contain source material and CLI diagnostics; use the operator's restricted journal access. Failed runs retry on the next six-hour tick, without immediate restart loops. A run is stopped after three hours. Persistent failures (coverage, validation, credentials) require operator repair; this timer does not add email alerts. Stop polling with `systemctl --user disable --now proterra-weekly-draft.timer`; stop an active draft separately with `systemctl --user stop proterra-weekly-draft.service`.

Keep `.review/cache` and `.review/receipts` when recovering: retries reuse an exact-source/feedback draft and reconcile a pushed SHA through the existing idempotent handoff. After repairing a failure, `systemctl --user start proterra-weekly-draft.service` retries immediately. A failed drafting pass that produced no valid cached draft may consume another Codex pass on the next tick.

## Recovery

- Collection or artifact-validation failure—including malformed JSON—removes `source-review-ready` from the existing PR and marks a matching D1 source queue `failed`, so the older queue cannot be drafted. Inspect the `collection-failed` issue and rerun after repairing the adapter or output; a successful rerun restores the queue.
- Runner failure before push: correct the reported preflight, coverage, or validation problem and rerun; the remote branch is unchanged.
- Runner push succeeds but review-state reporting or final GitHub label/comment updates fail: leave `.review/receipts/YYYY-MM-DD.json` in place, restore connectivity, and run `npm run weekly:draft` again. The marker comment is finalized before labels change, leaving the PR discoverable on a partial failure; the runner reconciles the exact pushed SHA and idempotent PR finalization from the receipt without invoking Codex a second time.
- Preview timeout: inspect Cloudflare Pages for the exact commit SHA; do not substitute CI success for deployment success.
- Approval failure: inspect the GitHub run and D1 approval record, then rerun the same approval workflow with its original approval ID. The prepared approval commit and publishing state are retained so validation and merge resume without a second site approval. Never bypass branch protection with `--admin`.
- Production deployment failure or timeout: D1 records the error, leaves the exact merged approval in its retryable `publishing`/`merged` state, and queues a failure email. Repair the deployment problem, then rerun `record-production-deployment.yml` with the same merge SHA; do not silently treat CI success as deployment success.
- Stale snapshot or version conflict: reload the stable review workspace and repeat the intended action against the current revision.
