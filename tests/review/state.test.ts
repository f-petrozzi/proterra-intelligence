import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Miniflare } from "miniflare";
import reviewWorker, {
  approveIssue, approvePullRequestWorkflowRun, createComment, drainOutbox, invalidateSourceQueue, mutateComment, recordAgentResult,
  recordPresentationResult, recordProductionFailure, requestChanges, type CommentInput, type Env
} from "../../review-worker/src/index";
import { assertCsrf, assertService, csrfToken, type AuthEnv } from "../../review-worker/src/auth";

const issueDate = "2026-08-24";
const oldSha = "a".repeat(40);
const newSha = "b".repeat(40);
const reviewer = "reviewer@example.org";
const okFetch = (async () => new Response(null, { status: 204 })) as typeof fetch;
const failedFetch = (async () => new Response("unavailable", { status: 503 })) as typeof fetch;
const reportSnapshot = {
  slug: issueDate,
  status: "draft",
  issueNumber: 3,
  title: "Weekly Brief",
  period: { start: "2026-08-17", end: "2026-08-23" },
  publishedAt: issueDate,
  scope: { basis: "public-sources-only", disclosure: "This fixture contains only public source material for review." },
  executiveSummary: "This fixture supplies a sufficiently detailed executive summary for snapshot persistence testing.",
  items: []
} as any;

async function fixture(state: "source-ready" | "in-review" = "in-review") {
  const miniflare = new Miniflare({
    workers: [{
      config: {
        name: "review-test-worker",
        type: "worker",
        compatibilityDate: "2026-08-17",
        manifest: {
          mainModule: "index.js",
          modulesRoot: process.cwd(),
          modules: {
            "index.js": {
              type: "esm",
              contents: "export default { fetch() { return new Response('ok') } }"
            }
          }
        },
        env: { REVIEW_DB: { type: "d1", name: "review-test" } }
      }
    }]
  });
  const database = await miniflare.getD1Database("REVIEW_DB", "review-test-worker");
  for (const migration of ["0001_initial.sql", "0002_atomic_outbox.sql", "0003_report_snapshots.sql"]) {
    const sql = await readFile(`review-worker/migrations/${migration}`, "utf8");
    for (const statement of sql.split(";").map((value) => value.trim()).filter(Boolean)) {
      await database.prepare(statement).run();
    }
  }
  await database.prepare("INSERT INTO review_users (email, role) VALUES (?, 'publisher')").bind(reviewer).run();
  await database.prepare(`INSERT INTO review_issues
    (issue_date, pull_request, branch, state, version, draft_sha, preview_sha, report_sha, report_json)
    VALUES (?, 42, ?, ?, 1, ?, ?, ?, ?)`)
    .bind(issueDate, `research-${issueDate}`, state, oldSha, state === "in-review" ? oldSha : null,
      state === "in-review" ? oldSha : null, state === "in-review" ? JSON.stringify(reportSnapshot) : null).run();
  const env = {
    REVIEW_DB: database,
    GITHUB_OWNER: "owner",
    GITHUB_REPO: "repo",
    GITHUB_WORKFLOW_TOKEN: "github-token",
    ACCESS_TEAM_DOMAIN: "https://team.cloudflareaccess.com",
    ACCESS_AUD: "audience",
    CSRF_SECRET: "c".repeat(64),
    REVIEW_ORIGIN: "https://review.example.org",
    SITE_ORIGIN: "https://site.example.org",
    REVIEW_SERVICE_KEY: "s".repeat(64)
  } as unknown as Env;
  return { miniflare, database, env };
}

async function addOpenComment(database: Env["REVIEW_DB"]) {
  const id = crypto.randomUUID();
  await database.prepare(`INSERT INTO review_comments
    (id, issue_date, anchor_key, story_review_id, field_path, anchor_label, field_value_hash,
     body, author_email, status, source_sha)
    VALUES (?, ?, ?, ?, 'summary', 'Summary', ?, 'Make this clearer', ?, 'open', ?)`)
    .bind(id, issueDate, `${issueDate}:story-12345678:summary`, "story-12345678", "f".repeat(64), reviewer, oldSha).run();
  return id;
}

function newCommentInput(): CommentInput {
  return {
    anchorKey: `${issueDate}:story-12345678:summary`, storyReviewId: "story-12345678",
    fieldPath: "summary", anchorLabel: "Summary", selectedText: "", contextBefore: "", contextAfter: "",
    fieldValueHash: "f".repeat(64), body: "Clarify this claim", expectedSha: oldSha,
    expectedVersion: 1, idempotencyKey: crypto.randomUUID()
  };
}

test("request changes commits state, snapshots, event, and outbox atomically when delivery fails", async (context) => {
  const { miniflare, database, env } = await fixture();
  context.after(() => miniflare.dispose());
  await addOpenComment(database);
  const idempotencyKey = crypto.randomUUID();
  await requestChanges(env, reviewer, issueDate, {
    expectedSha: oldSha, expectedVersion: 1, idempotencyKey
  }, failedFetch);

  const issue = await database.prepare("SELECT state, version FROM review_issues WHERE issue_date = ?").bind(issueDate).first<any>();
  const batch = await database.prepare("SELECT id, status FROM review_batches WHERE issue_date = ?").bind(issueDate).first<any>();
  const item = await database.prepare("SELECT instruction_body, source_sha FROM review_batch_items WHERE batch_id = ?").bind(idempotencyKey).first<any>();
  const event = await database.prepare("SELECT event_type FROM review_events WHERE idempotency_key = ?").bind(idempotencyKey).first<any>();
  const outbox = await database.prepare("SELECT status, attempts, last_error FROM notification_outbox WHERE dedupe_key = ?")
    .bind(`changes-requested:${idempotencyKey}`).first<any>();
  assert.deepEqual(issue, { state: "changes-requested", version: 2 });
  assert.deepEqual(batch, { id: idempotencyKey, status: "submitted" });
  assert.deepEqual(item, { instruction_body: "Make this clearer", source_sha: oldSha });
  assert.equal(event.event_type, "changes-requested");
  assert.equal(outbox.status, "pending");
  assert.equal(outbox.attempts, 1);
  assert.match(outbox.last_error, /503/);

  const duplicate = await requestChanges(env, reviewer, issueDate, {
    expectedSha: oldSha, expectedVersion: 1, idempotencyKey
  }, okFetch);
  assert.equal(duplicate.duplicate, true);
  const count = await database.prepare("SELECT COUNT(*) AS count FROM review_batches").first<{ count: number }>();
  assert.equal(count?.count, 1);
});

test("optimistic locking allows only one concurrent state transition", async (context) => {
  const { miniflare, database, env } = await fixture();
  context.after(() => miniflare.dispose());
  await addOpenComment(database);
  const attempts = await Promise.allSettled([
    requestChanges(env, reviewer, issueDate, { expectedSha: oldSha, expectedVersion: 1, idempotencyKey: crypto.randomUUID() }, okFetch),
    requestChanges(env, reviewer, issueDate, { expectedSha: oldSha, expectedVersion: 1, idempotencyKey: crypto.randomUUID() }, okFetch)
  ]);
  assert.equal(attempts.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(attempts.filter((result) => result.status === "rejected").length, 1);
  const batches = await database.prepare("SELECT COUNT(*) AS count FROM review_batches").first<{ count: number }>();
  assert.equal(batches?.count, 1);
});

test("approval locks the exact SHA and queues a retryable workflow dispatch", async (context) => {
  const { miniflare, database, env } = await fixture();
  context.after(() => miniflare.dispose());
  const idempotencyKey = crypto.randomUUID();
  const approved = await approveIssue(env, reviewer, issueDate, { expectedSha: oldSha, expectedVersion: 1, idempotencyKey }, failedFetch);
  assert.equal(approved.approvalId, idempotencyKey);
  const issue = await database.prepare("SELECT state, version FROM review_issues WHERE issue_date = ?").bind(issueDate).first<any>();
  const approval = await database.prepare("SELECT status, approved_sha FROM approvals WHERE id = ?").bind(idempotencyKey).first<any>();
  assert.deepEqual(issue, { state: "publishing", version: 2 });
  assert.deepEqual(approval, { status: "pending", approved_sha: oldSha });
  await assert.rejects(
    approveIssue(env, reviewer, issueDate, { expectedSha: oldSha, expectedVersion: 1, idempotencyKey: crypto.randomUUID() }, okFetch),
    (error) => error instanceof Response && error.status === 409
  );

  await database.prepare("UPDATE notification_outbox SET available_at = datetime('now', '-1 minute')").run();
  assert.deepEqual(await drainOutbox(env, undefined, okFetch), { selected: 1, delivered: 1 });
  const outbox = await database.prepare("SELECT status, attempts FROM notification_outbox").first<any>();
  assert.deepEqual(outbox, { status: "delivered", attempts: 2 });
});

test("the stable Worker authorizes only the exact action-required PR validation", async (context) => {
  const { miniflare, database, env } = await fixture();
  context.after(() => miniflare.dispose());
  const approvalId = crypto.randomUUID();
  await approveIssue(env, reviewer, issueDate, {
    expectedSha: oldSha, expectedVersion: 1, idempotencyKey: approvalId
  }, failedFetch);
  await database.prepare("UPDATE approvals SET status = 'running' WHERE id = ?").bind(approvalId).run();
  const prepared = await reviewWorker.fetch(new Request(`https://review.example.org/api/internal/approvals/${approvalId}/result`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-review-service-key": "s".repeat(64) },
    body: JSON.stringify({ status: "running", approvalCommitSha: newSha })
  }), env);
  assert.equal(prepared.status, 200);
  const storedApproval = await database.prepare("SELECT status, approval_commit_sha FROM approvals WHERE id = ?")
    .bind(approvalId).first<any>();
  assert.deepEqual(storedApproval, { status: "running", approval_commit_sha: newSha });
  const calls: Array<{ url: string; method: string }> = [];
  const githubFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method });
    if (url.endsWith("/approve")) return new Response(null, { status: 201 });
    return Response.json({
      event: "pull_request", status: "completed", conclusion: "action_required", head_sha: newSha,
      path: ".github/workflows/ci.yml", pull_requests: [{ number: 42 }]
    });
  }) as typeof fetch;

  assert.deepEqual(await approvePullRequestWorkflowRun(env, approvalId, {
    runId: 12345, approvalCommitSha: newSha
  }, githubFetch), { ok: true, runId: 12345 });
  assert.deepEqual(calls.map(({ method }) => method), ["GET", "POST"]);
  assert.match(calls[1].url, /actions\/runs\/12345\/approve$/);
  const event = await database.prepare("SELECT event_type, idempotency_key FROM review_events WHERE idempotency_key = ?")
    .bind("approval-ci:12345").first<any>();
  assert.deepEqual(event, { event_type: "approval-ci-authorized", idempotency_key: "approval-ci:12345" });

  await assert.rejects(
    approvePullRequestWorkflowRun(env, approvalId, { runId: 12346, approvalCommitSha: oldSha }, githubFetch),
    (error) => error instanceof Response && error.status === 409
  );
});

test("approval and a late comment are serialized so exactly one can win", async (context) => {
  const { miniflare, database, env } = await fixture();
  context.after(() => miniflare.dispose());
  const attempts = await Promise.allSettled([
    approveIssue(env, reviewer, issueDate, {
      expectedSha: oldSha, expectedVersion: 1, idempotencyKey: crypto.randomUUID()
    }, okFetch),
    createComment(env, reviewer, issueDate, newCommentInput())
  ]);
  assert.equal(attempts.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(attempts.filter((result) => result.status === "rejected").length, 1);
  const issue = await database.prepare("SELECT state FROM review_issues WHERE issue_date = ?").bind(issueDate).first<any>();
  const comments = await database.prepare("SELECT COUNT(*) AS count FROM review_comments").first<{ count: number }>();
  const approvals = await database.prepare("SELECT COUNT(*) AS count FROM approvals").first<{ count: number }>();
  assert.ok(
    (issue?.state === "publishing" && comments?.count === 0 && approvals?.count === 1)
      || (issue?.state === "in-review" && comments?.count === 1 && approvals?.count === 0)
  );
});

test("approval and reopening a resolved comment are serialized so exactly one can win", async (context) => {
  const { miniflare, database, env } = await fixture();
  context.after(() => miniflare.dispose());
  const commentId = await addOpenComment(database);
  await database.prepare("UPDATE review_comments SET status = 'resolved' WHERE id = ?").bind(commentId).run();
  const attempts = await Promise.allSettled([
    approveIssue(env, reviewer, issueDate, {
      expectedSha: oldSha, expectedVersion: 1, idempotencyKey: crypto.randomUUID()
    }, okFetch),
    mutateComment(env, reviewer, commentId, {
      action: "reopen", expectedSha: oldSha, expectedVersion: 1, idempotencyKey: crypto.randomUUID()
    })
  ]);
  assert.equal(attempts.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(attempts.filter((result) => result.status === "rejected").length, 1);
  const issue = await database.prepare("SELECT state FROM review_issues WHERE issue_date = ?").bind(issueDate).first<any>();
  const comment = await database.prepare("SELECT status FROM review_comments WHERE id = ?").bind(commentId).first<any>();
  assert.ok((issue?.state === "publishing" && comment?.status === "resolved")
    || (issue?.state === "in-review" && comment?.status === "open"));
});

test("comment PATCH is idempotent and conditionally locked to the review revision", async (context) => {
  const { miniflare, database, env } = await fixture();
  context.after(() => miniflare.dispose());
  const commentId = await addOpenComment(database);
  const edit = {
    action: "edit" as const, body: "Use the exact reported value", expectedSha: oldSha,
    expectedVersion: 1, idempotencyKey: crypto.randomUUID()
  };
  assert.equal((await mutateComment(env, reviewer, commentId, edit)).duplicate, false);
  assert.equal((await mutateComment(env, reviewer, commentId, edit)).duplicate, true);
  await database.prepare("UPDATE review_issues SET state = 'publishing', version = 2 WHERE issue_date = ?").bind(issueDate).run();
  await assert.rejects(
    mutateComment(env, reviewer, commentId, { ...edit, body: "Late edit", idempotencyKey: crypto.randomUUID() }),
    (error) => error instanceof Response && error.status === 409
  );
  const stored = await database.prepare("SELECT body FROM review_comments WHERE id = ?").bind(commentId).first<any>();
  assert.equal(stored.body, "Use the exact reported value");
});

test("agent result is idempotent and rejects a stale source SHA", async (context) => {
  const { miniflare, env } = await fixture("source-ready");
  context.after(() => miniflare.dispose());
  const input = {
    previousSha: oldSha,
    expectedVersion: 1,
    newSha,
    idempotencyKey: crypto.randomUUID(),
    responses: [],
    report: reportSnapshot
  };
  assert.equal((await recordAgentResult(env, issueDate, input)).duplicate, false);
  assert.equal((await recordAgentResult(env, issueDate, input)).duplicate, true);
  const stored = await env.REVIEW_DB.prepare("SELECT report_sha, report_json FROM review_issues WHERE issue_date = ?")
    .bind(issueDate).first<any>();
  assert.equal(stored.report_sha, newSha);
  assert.equal(JSON.parse(stored.report_json).slug, issueDate);
  await assert.rejects(
    recordAgentResult(env, issueDate, { ...input, idempotencyKey: crypto.randomUUID(), previousSha: "c".repeat(40) }),
    (error) => error instanceof Response && error.status === 409
  );
});

test("presentation refresh changes only image IDs and invalidates the exact preview", async (context) => {
  const { miniflare, database, env } = await fixture();
  context.after(() => miniflare.dispose());
  const storedReport = { ...reportSnapshot, items: [{ imageId: "old-image" }] };
  await database.prepare("UPDATE review_issues SET report_json = ? WHERE issue_date = ?")
    .bind(JSON.stringify(storedReport), issueDate).run();
  const input = {
    previousSha: oldSha,
    expectedVersion: 1,
    newSha,
    idempotencyKey: crypto.randomUUID(),
    report: { ...storedReport, items: [{ imageId: "new-image" }] }
  } as any;
  assert.equal((await recordPresentationResult(env, issueDate, input)).duplicate, false);
  assert.equal((await recordPresentationResult(env, issueDate, input)).duplicate, true);
  const stored = await database.prepare(`SELECT state, version, draft_sha, preview_sha, report_sha, report_json
    FROM review_issues WHERE issue_date = ?`).bind(issueDate).first<any>();
  assert.equal(stored.state, "in-review");
  assert.equal(stored.version, 2);
  assert.equal(stored.draft_sha, newSha);
  assert.equal(stored.preview_sha, null);
  assert.equal(stored.report_sha, newSha);
  assert.equal(JSON.parse(stored.report_json).items[0].imageId, "new-image");
});

test("presentation refresh rejects editorial text changes", async (context) => {
  const { miniflare, env } = await fixture();
  context.after(() => miniflare.dispose());
  await assert.rejects(recordPresentationResult(env, issueDate, {
    previousSha: oldSha,
    expectedVersion: 1,
    newSha,
    idempotencyKey: crypto.randomUUID(),
    report: { ...reportSnapshot, title: "Changed weekly brief title" }
  } as any), (error) => error instanceof Response && error.status === 409);
});

test("collection failure idempotently invalidates only a source-ready queue", async (context) => {
  const { miniflare, database, env } = await fixture("source-ready");
  context.after(() => miniflare.dispose());
  const input = {
    branch: `research-${issueDate}`,
    reason: "Collector did not produce a trustworthy queue",
    runUrl: "https://github.com/example/repo/actions/runs/123",
    idempotencyKey: "collection-failed:123:456:1"
  };
  assert.deepEqual(await invalidateSourceQueue(env, issueDate, input), { duplicate: false, invalidated: true });
  assert.deepEqual(await invalidateSourceQueue(env, issueDate, input), { duplicate: true, invalidated: true });
  const issue = await database.prepare("SELECT state, version, transition_key FROM review_issues WHERE issue_date = ?")
    .bind(issueDate).first<any>();
  assert.deepEqual(issue, { state: "failed", version: 2, transition_key: input.idempotencyKey });
  const event = await database.prepare("SELECT event_type, payload FROM review_events WHERE idempotency_key = ?")
    .bind(input.idempotencyKey).first<any>();
  assert.equal(event.event_type, "collection-failed");
  assert.equal(JSON.parse(event.payload).runUrl, input.runUrl);
});

test("production timeout records a retryable publishing state and failure notification", async (context) => {
  const { miniflare, database, env } = await fixture();
  context.after(() => miniflare.dispose());
  const approvalId = crypto.randomUUID();
  await database.prepare("UPDATE review_issues SET state = 'publishing' WHERE issue_date = ?").bind(issueDate).run();
  await database.prepare(`INSERT INTO approvals
    (id, issue_date, reviewer_email, approved_sha, status, merge_commit_sha)
    VALUES (?, ?, ?, ?, 'merged', ?)`).bind(approvalId, issueDate, reviewer, oldSha, newSha).run();
  const input = { mergeSha: newSha, error: "Cloudflare timed out", runUrl: "https://github.example/actions/1" };
  assert.equal((await recordProductionFailure(env, input, failedFetch)).duplicate, false);
  assert.equal((await recordProductionFailure(env, input, okFetch)).duplicate, true);
  const issue = await database.prepare("SELECT state, version FROM review_issues WHERE issue_date = ?").bind(issueDate).first<any>();
  const approval = await database.prepare("SELECT status, error FROM approvals WHERE id = ?").bind(approvalId).first<any>();
  const outbox = await database.prepare("SELECT status, attempts FROM notification_outbox").first<any>();
  assert.deepEqual(issue, { state: "publishing", version: 2 });
  assert.deepEqual(approval, { status: "merged", error: "Cloudflare timed out" });
  assert.deepEqual(outbox, { status: "pending", attempts: 1 });
});

test("service authentication and CSRF enforce exact secrets and origin", async () => {
  const env: AuthEnv = {
    ACCESS_TEAM_DOMAIN: "https://team.cloudflareaccess.com",
    ACCESS_AUD: "audience",
    CSRF_SECRET: "csrf-secret",
    REVIEW_ORIGIN: "https://review.example.org",
    REVIEW_SERVICE_KEY: "service-secret"
  };
  assert.doesNotThrow(() => assertService(new Request("https://review.example.org", {
    headers: { "x-review-service-key": "service-secret" }
  }), env));
  assert.throws(() => assertService(new Request("https://review.example.org", {
    headers: { "x-review-service-key": "wrong" }
  }), env), (error) => error instanceof Response && error.status === 401);

  const token = await csrfToken(reviewer, env);
  await assert.doesNotReject(assertCsrf(new Request("https://review.example.org", {
    method: "POST", headers: { origin: "https://review.example.org", "x-review-csrf": token }
  }), reviewer, env));
  await assert.rejects(assertCsrf(new Request("https://review.example.org", {
    method: "POST", headers: { origin: "https://evil.example", "x-review-csrf": token }
  }), reviewer, env), (error) => error instanceof Response && error.status === 403);
});
