# Proterra Intelligence Weekly Editorial Automation

Status: implemented; external service setup and a full rehearsal remain  
Last updated: 2026-08-17

## Decision

Use a deterministic GitHub Actions collector, a manually launched homelab Codex pass, a stable main-only Cloudflare Review Worker, and human approval of an exact deployed revision.

```text
GitHub schedule / manual dispatch
              |
              v
Deterministic candidate branch + PR ----> source-ready email
              |
              v
Operator runs: npm run weekly:draft
              |
              v
Isolated worktree + locally authenticated Codex
              |
              v
Validated draft branch
              |
              v
Cloudflare Pages preview (unprivileged selection bridge)
              |
              v
Stable Review Worker deployed from main only
              |
              +----> D1 comments, immutable batches, approvals, audit
              +----> GitHub notification/approval workflow dispatch
              |
              v
Exact-SHA validation and merge
              |
              v
Cloudflare production deployment ----> publication email
```

The Astro branch preview never receives the D1 binding, GitHub workflow token, Gmail password, or approval capability. Reviewers type comments and approve in the stable Worker shell. Preview code only sends semantic field selections to that shell with `postMessage`.

## Collection contract

- `config/collection-sources.json` classifies sources as `evidence`, `discovery`, `manual`, or `disabled`, separately from editorial source approval.
- Collection supports RSS/Atom, configured JSON and CSV APIs, and explicitly scoped HTML listing pages.
- Only configured HTTPS hosts may be fetched. Redirects, response sizes, timeouts, rates, and source failures are bounded.
- Every enabled adapter has a minimum listing-item health threshold, so selector or feed drift fails visibly instead of producing a silently empty successful run.
- Canonical URLs lose fragments and tracking parameters. Exact URLs and conservatively identical titles are deduplicated and sorted stably.
- Source-provided summaries remain labeled untrusted text. Article bodies and generated summaries are never stored.
- Every run writes a date-keyed candidate file and manifest with provenance, adapter failures, manual gaps, and sector/geography coverage.
- A queue is editorially ready only with at least five relevant candidates, coverage in dairy, meat, and bovine genetics, and at least one development outside the United States. Missing Latin America or Puerto Rico coverage remains a visible warning.
- Recurring USDA report adapters fetch a bounded moving index but emit a release-specific API URL, exact report-date identifier, and stable report landing page for every candidate.
- Before a rerun, the workflow deletes that issue date's candidate and manifest artifacts so a failed collector cannot reuse stale files from the research branch.
- LinkedIn remains manual/public-index discovery only and is never scraped.
- A collector failure, missing artifact, malformed JSON, or schema-invalid artifact opens or updates a GitHub issue, sends a failure email, removes `source-review-ready` from any existing issue PR, and atomically moves an existing D1 `source-ready` issue to `failed`. A repaired rerun may restore only a failure marked as a collection failure. A partial run produces a visibly warned queue.

The schedule is present but gated by repository variable `WEEKLY_COLLECTION_ENABLED=true`. Keep it disabled until the manual-dispatch rehearsal succeeds.

## Homelab runner

`npm run weekly:draft` performs the only model-driven step:

1. Warn about unrelated changes in the primary checkout without blocking.
2. Find exactly one open weekly PR labeled `source-review-ready` or `changes-requested`.
3. Fetch that research branch and create a temporary detached worktree.
4. Read candidate and manifest files locally from the branch. If the initial queue is `coverage-gap`, stop before dependency installation or Codex execution. The editorial lead may deliberately accept the documented gaps with `npm run weekly:draft -- --allow-coverage-gap`; later `changes-requested` revisions reuse that decision without requiring another override. The generated Codex prompt carries a structured `manifest-readiness-only` authorization containing the accepted gaps. It never waives source verification, evidence quality, schema validity, or the prohibitions against filler and invented claims.
5. Download only submitted immutable feedback batches from the stable Review Worker.
6. Run `codex login status` and require the output to identify ChatGPT authentication rather than API-key authentication.
7. Remove both `OPENAI_API_KEY` and `CODEX_API_KEY` from the Codex subprocess environment and launch `codex exec` with `workspace-write`, the repository policy, and a JSON output schema.
8. Allow only the issue report JSON to change, run `npm run verify`, commit, and push.
9. Write a user-only reconciliation receipt, push, then report the new SHA and a response for every feedback item to the Review Worker. Keep the receipt until checked, idempotent GitHub finalization also succeeds. Create or confirm the exact-SHA marker comment before switching labels, so a partial failure remains discoverable through the old actionable label. If either handoff fails after the push, the next invocation resumes without rerunning Codex.
10. Remove the temporary worktree. The primary checkout is never edited.

Codex reuses the operator’s locally stored ChatGPT authentication. The credential remains on the trusted homelab account, is never copied into the repository, container, GitHub Actions, D1, or Cloudflare, and is protected with user-only filesystem permissions. On platforms that use `~/.codex/auth.json`, the runner restricts it to mode `0600`; OS credential-store installations remain supported.

No OpenAI API key is used. Nothing listens for inbound homelab traffic.

## Review model

The stable Worker owns `REVIEW_DB`, `GITHUB_WORKFLOW_TOKEN`, `CSRF_SECRET`, and `REVIEW_SERVICE_KEY`. It is deployed only by `.github/workflows/deploy-review-worker.yml` from `main`.

D1 stores:

- reviewer roles;
- issue branch, PR, state, exact draft/preview SHA, numeric optimistic version, and Cloudflare deployment metadata;
- mutable thread status;
- immutable review batches and `review_batch_items` snapshots;
- exact-SHA approvals;
- append-only audit and idempotency events;
- a durable notification outbox with leased, scheduled retries.

Each batch item preserves the comment ID, persistent story review ID, semantic path, selected quote, surrounding context, instruction, source SHA, and full-field SHA-256 hash.

New stories receive `reviewId: story-<candidate-id-prefix>`. The value remains unchanged when citations or URLs are corrected. Existing approved reports need no migration. Draft validation requires unique persistent review IDs.

Review state transitions use the issue version and draft SHA in conditional updates. A zero-row update returns `409 Conflict`. Approval is available only when the displayed deployment SHA equals the draft SHA and every thread is resolved.
Approval and comment writes recheck the same in-review state, version, draft SHA, and preview SHA inside their D1 transactions. Approval additionally includes an atomic `NOT EXISTS` unresolved-comment guard, so a late or reopened comment and approval cannot both succeed. Comment PATCH requests are idempotent.

## Deployment and publication

- GitHub Actions sends all email through the existing Gmail SMTP code. Cloudflare never receives the Gmail app password or connects to Gmail.
- Source-ready and collection-failed email originates in the collection workflow.
- The Review Worker dispatches `notify-review.yml` for change-request, preview-ready, and published messages.
- `record-preview-deployment.yml` polls the Cloudflare Pages deployments API for the exact research commit and records deployment ID, immutable URL, branch alias, commit SHA, and completion time before email is sent.
- `approve-weekly-brief.yml` retrieves the immutable approval, rechecks PR/repository/base/head, changes only the report status, verifies, and commits with the ephemeral `GITHUB_TOKEN`. GitHub intentionally places the resulting PR validation in `action_required`; the stable Worker uses its Actions-write-only token to authorize only the run whose PR number, workflow path, and head SHA match the guarded approval. The workflow waits for that PR-associated required check, records the prepared commit for safe retries, and merges with the expected head SHA.
- `record-production-deployment.yml` polls for the exact merge commit before marking the issue published and emailing reviewers.

Permission split:

- Worker fine-grained GitHub token: Actions write only, used for workflow dispatch and authorization of an exact, validated `action_required` PR run. It cannot write repository contents or merge.
- Approval workflow `GITHUB_TOKEN`: contents write, pull requests write, and Actions write.
- Cloudflare API token: Pages deployment read for polling; Worker/D1 deployment permissions only in the protected deployment environment.
- Review API service token and service key: homelab runner and selected GitHub workflows only.

Repository rules must permit the GitHub Actions workflow identity to merge after required checks. If repository rules require a formal GitHub approving review, the D1 approval does not satisfy it; either remove that requirement for the automation branch pattern or add an explicitly authorized GitHub-review step. The workflow never uses an administrative bypass.

## Acceptance and rollback

Before enabling the schedule, rehearse:

1. Manual collection creates one queue/PR and emails the operator.
2. `npm run weekly:draft` creates a valid draft without touching the primary checkout.
3. Cloudflare’s exact preview deployment is recorded before reviewers are emailed.
4. Both reviewers can create comments; Request changes creates one immutable batch.
5. The next runner pass responds to every batch item and preserves story review IDs.
6. Reviewers resolve addressed threads; either publisher can approve.
7. A stale SHA, stale issue version, unresolved thread, failed CI run, or unauthorized identity blocks publication.
8. The exact approved commit merges and the production deployment is confirmed before publication email.

Rollback is additive: disable the collection schedule and Worker deployment, keep D1 and candidate files as audit history, and use `automation/weekly-report-prompt.md` plus the existing local report-approval command manually. Weekly email delivery remains a separate explicit action.

## Primary references

- [Codex authentication](https://learn.chatgpt.com/docs/auth)
- [Cloudflare Pages bindings](https://developers.cloudflare.com/pages/functions/bindings/)
- [Cloudflare Access service tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/)
- [Cloudflare Pages deployments API](https://developers.cloudflare.com/api/resources/pages/subresources/projects/subresources/deployments/methods/list/)
- [GitHub workflow dispatch API](https://docs.github.com/en/rest/actions/workflows)
- [GitHub pull-request merge API](https://docs.github.com/en/rest/pulls/pulls)
