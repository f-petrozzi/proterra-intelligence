import { z } from "zod";
import { assertCsrf, assertService, authenticatedEmail, csrfToken, type AuthEnv } from "./auth";
import { reviewShell } from "./html";
import { reviewReportSchema, type ReviewReport } from "./report";

export interface Env extends AuthEnv {
  REVIEW_DB: D1Database;
  GITHUB_OWNER: string;
  GITHUB_REPO: string;
  GITHUB_WORKFLOW_TOKEN: string;
  SITE_ORIGIN: string;
}

const issueDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const shaSchema = z.string().regex(/^[a-f0-9]{40}$/);
const commentInputSchema = z.object({
  anchorKey: z.string().min(3).max(300),
  storyReviewId: z.string().regex(/^story-[a-z0-9-]{8,80}$/),
  fieldPath: z.string().min(1).max(300),
  anchorLabel: z.string().min(1).max(200),
  selectedText: z.string().max(1000).default(""),
  contextBefore: z.string().max(240).default(""),
  contextAfter: z.string().max(240).default(""),
  fieldValueHash: z.string().regex(/^[a-f0-9]{64}$/),
  body: z.string().trim().min(1).max(4000),
  expectedSha: shaSchema,
  expectedVersion: z.number().int().positive(),
  idempotencyKey: z.uuid()
});
const commentMutationSchema = z.object({
  action: z.enum(["resolve", "reopen", "edit"]),
  body: z.string().trim().min(1).max(4000).optional(),
  expectedSha: shaSchema,
  expectedVersion: z.number().int().positive(),
  idempotencyKey: z.uuid()
}).superRefine((value, context) => {
  if (value.action === "edit" && !value.body) context.addIssue({ code: "custom", message: "Edited comments require a body" });
  if (value.action !== "edit" && value.body) context.addIssue({ code: "custom", message: "Only edit accepts a body" });
});
export type CommentInput = z.infer<typeof commentInputSchema>;
export type CommentMutationInput = z.infer<typeof commentMutationSchema>;
const stateInputSchema = z.object({ expectedSha: shaSchema, expectedVersion: z.number().int().positive(), idempotencyKey: z.uuid() });
export type StateInput = z.infer<typeof stateInputSchema>;

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}

async function body(request: Request, maximumBytes = 20_000) {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > maximumBytes) throw new Response("Request is too large", { status: 413 });
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maximumBytes) throw new Response("Request is too large", { status: 413 });
  try { return JSON.parse(text) as unknown; } catch { throw new Response("Invalid JSON", { status: 400 }); }
}

async function user(env: Env, email: string) {
  const record = await env.REVIEW_DB.prepare("SELECT email, role FROM review_users WHERE email = ? AND active = 1").bind(email).first<{ email: string; role: string }>();
  if (!record) throw new Response("Reviewer access required", { status: 403 });
  return record;
}

async function issue(env: Env, issueDate: string) {
  const record = await env.REVIEW_DB.prepare("SELECT * FROM review_issues WHERE issue_date = ?").bind(issueDate).first<Record<string, unknown>>();
  if (!record) throw new Response("Review issue not found", { status: 404 });
  return record;
}

async function issuePayload(env: Env, issueDate: string) {
  const current = await issue(env, issueDate);
  const comments = await env.REVIEW_DB.prepare("SELECT * FROM review_comments WHERE issue_date = ? ORDER BY created_at, id").bind(issueDate).all();
  const { report_json: _reportJson, ...publicIssue } = current;
  return { issue: publicIssue, comments: comments.results };
}

type OutboxRecord = {
  id: string;
  workflow: string;
  inputs: string;
};

function eventStatement(env: Env, input: {
  id: string;
  issueDate: string;
  type: string;
  actor: string;
  idempotencyKey?: string;
  payload?: unknown;
  transitionKey: string;
}) {
  return env.REVIEW_DB.prepare(`INSERT INTO review_events (id, issue_date, event_type, actor, idempotency_key, payload)
    SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (
      SELECT 1 FROM review_issues WHERE issue_date = ? AND transition_key = ?
    )`).bind(input.id, input.issueDate, input.type, input.actor, input.idempotencyKey ?? null,
      JSON.stringify(input.payload ?? {}), input.issueDate, input.transitionKey);
}

function outboxStatement(env: Env, input: {
  id: string;
  issueDate: string;
  dedupeKey: string;
  workflow: string;
  inputs: Record<string, string>;
  transitionKey: string;
}) {
  return env.REVIEW_DB.prepare(`INSERT INTO notification_outbox (id, issue_date, dedupe_key, workflow, inputs)
    SELECT ?, ?, ?, ?, ? WHERE EXISTS (
      SELECT 1 FROM review_issues WHERE issue_date = ? AND transition_key = ?
    )`).bind(input.id, input.issueDate, input.dedupeKey, input.workflow, JSON.stringify(input.inputs),
      input.issueDate, input.transitionKey);
}

async function existingOperation(env: Env, idempotencyKey: string, expectedType: string) {
  const existing = await env.REVIEW_DB.prepare("SELECT event_type, payload FROM review_events WHERE idempotency_key = ?")
    .bind(idempotencyKey).first<{ event_type: string; payload: string }>();
  if (!existing) return undefined;
  if (existing.event_type !== expectedType) throw new Response("Idempotency key was already used for another operation", { status: 409 });
  return JSON.parse(existing.payload) as Record<string, unknown>;
}

export async function drainOutbox(env: Env, requestedId?: string, fetcher: typeof fetch = fetch) {
  const selection = requestedId
    ? env.REVIEW_DB.prepare(`SELECT id, workflow, inputs FROM notification_outbox WHERE id = ?
        AND (status = 'pending' AND available_at <= CURRENT_TIMESTAMP
          OR status = 'processing' AND lease_expires_at <= CURRENT_TIMESTAMP) LIMIT 1`).bind(requestedId)
    : env.REVIEW_DB.prepare(`SELECT id, workflow, inputs FROM notification_outbox
        WHERE (status = 'pending' AND available_at <= CURRENT_TIMESTAMP)
          OR (status = 'processing' AND lease_expires_at <= CURRENT_TIMESTAMP)
        ORDER BY created_at LIMIT 10`);
  const pending = await selection.all<OutboxRecord>();
  let delivered = 0;
  for (const record of pending.results) {
    const claim = await env.REVIEW_DB.prepare(`UPDATE notification_outbox SET status = 'processing',
      lease_expires_at = datetime('now', '+5 minutes'), updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND (status = 'pending' AND available_at <= CURRENT_TIMESTAMP
        OR status = 'processing' AND lease_expires_at <= CURRENT_TIMESTAMP)`).bind(record.id).run();
    if (claim.meta.changes !== 1) continue;
    try {
      const inputs = JSON.parse(record.inputs) as Record<string, string>;
      const response = await fetcher(`https://api.github.com/repos/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_REPO)}/actions/workflows/${encodeURIComponent(record.workflow)}/dispatches`, {
        method: "POST",
        headers: {
          accept: "application/vnd.github+json", authorization: `Bearer ${env.GITHUB_WORKFLOW_TOKEN}`,
          "content-type": "application/json", "user-agent": "Proterra-Intelligence-Review-Worker",
          "x-github-api-version": "2022-11-28"
        },
        body: JSON.stringify({ ref: "main", inputs })
      });
      if (!response.ok) throw new Error(`GitHub workflow dispatch failed (${response.status})`);
      await env.REVIEW_DB.prepare(`UPDATE notification_outbox SET status = 'delivered', attempts = attempts + 1,
        delivered_at = CURRENT_TIMESTAMP, lease_expires_at = NULL, last_error = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'processing'`).bind(record.id).run();
      delivered += 1;
    } catch (error) {
      await env.REVIEW_DB.prepare(`UPDATE notification_outbox SET status = 'pending', attempts = attempts + 1,
        available_at = datetime('now', '+' || min(60, max(1, attempts + 1) * 5) || ' minutes'),
        lease_expires_at = NULL, last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'processing'`)
        .bind(error instanceof Error ? error.message.slice(0, 1000) : "unknown dispatch error", record.id).run();
    }
  }
  return { selected: pending.results.length, delivered };
}

async function recordEvent(env: Env, input: { issueDate: string; type: string; actor: string; idempotencyKey?: string; payload?: unknown }) {
  const id = crypto.randomUUID();
  try {
    await env.REVIEW_DB.prepare("INSERT INTO review_events (id, issue_date, event_type, actor, idempotency_key, payload) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(id, input.issueDate, input.type, input.actor, input.idempotencyKey ?? null, JSON.stringify(input.payload ?? {})).run();
    return { id, duplicate: false };
  } catch (error) {
    if (input.idempotencyKey && String(error).includes("UNIQUE")) return { id, duplicate: true };
    throw error;
  }
}

export async function createComment(env: Env, email: string, issueDate: string, input: CommentInput) {
  const duplicate = await existingOperation(env, input.idempotencyKey, "comment-created");
  if (duplicate) return { duplicate: true, commentId: String(duplicate.commentId) };
  await issue(env, issueDate);
  const commentId = crypto.randomUUID();
  try {
    const results = await env.REVIEW_DB.batch([
      env.REVIEW_DB.prepare(`INSERT INTO review_comments
        (id, issue_date, anchor_key, story_review_id, field_path, anchor_label, selected_text, context_before, context_after,
         field_value_hash, body, author_email, status, source_sha, transition_key)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ? WHERE EXISTS (
          SELECT 1 FROM review_issues WHERE issue_date = ? AND state = 'in-review' AND version = ?
          AND draft_sha = ? AND preview_sha = ? AND report_sha = ?
        )`).bind(commentId, issueDate, input.anchorKey, input.storyReviewId, input.fieldPath, input.anchorLabel,
          input.selectedText || null, input.contextBefore || null, input.contextAfter || null, input.fieldValueHash,
          input.body, email, input.expectedSha, input.idempotencyKey, issueDate, input.expectedVersion,
          input.expectedSha, input.expectedSha, input.expectedSha),
      env.REVIEW_DB.prepare(`INSERT INTO review_events
        (id, issue_date, event_type, actor, idempotency_key, payload)
        SELECT ?, ?, 'comment-created', ?, ?, ? WHERE EXISTS (
          SELECT 1 FROM review_comments WHERE id = ? AND transition_key = ?
        )`).bind(crypto.randomUUID(), issueDate, email, input.idempotencyKey, JSON.stringify({ commentId }),
          commentId, input.idempotencyKey)
    ]);
    if (results[0].meta.changes !== 1 || results[1].meta.changes !== 1) {
      throw new Response("The issue changed or is locked; reload before commenting", { status: 409 });
    }
  } catch (error) {
    const raced = await existingOperation(env, input.idempotencyKey, "comment-created");
    if (raced) return { duplicate: true, commentId: String(raced.commentId) };
    throw error;
  }
  return { duplicate: false, commentId };
}

export async function mutateComment(env: Env, email: string, commentId: string, input: CommentMutationInput) {
  const eventType = `comment-${input.action}`;
  const duplicate = await existingOperation(env, input.idempotencyKey, eventType);
  if (duplicate) return { duplicate: true, issueDate: String(duplicate.issueDate) };
  const comment = await env.REVIEW_DB.prepare("SELECT * FROM review_comments WHERE id = ?")
    .bind(commentId).first<Record<string, unknown>>();
  if (!comment) throw new Response("Comment not found", { status: 404 });
  const issueDate = String(comment.issue_date);
  await issue(env, issueDate);
  if (input.action === "resolve" && comment.status !== "addressed") throw new Response("Only addressed comments can be resolved", { status: 409 });
  if (input.action === "reopen" && comment.status !== "resolved") throw new Response("Only resolved comments can be reopened", { status: 409 });
  if (input.action === "edit" && (comment.status !== "open" || comment.author_email !== email)) {
    throw new Response("Only the author can edit an unsubmitted comment", { status: 409 });
  }

  const requiredStatus = input.action === "resolve" ? "addressed" : input.action === "reopen" ? "resolved" : "open";
  const nextStatus = input.action === "resolve" ? "resolved" : input.action === "reopen" ? "open" : "open";
  const statements = [
    input.action === "edit"
      ? env.REVIEW_DB.prepare(`UPDATE review_comments SET body = ?, transition_key = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND status = ? AND author_email = ? AND EXISTS (
            SELECT 1 FROM review_issues WHERE issue_date = ? AND state = 'in-review' AND version = ?
            AND draft_sha = ? AND preview_sha = ? AND report_sha = ?
          )`).bind(input.body, input.idempotencyKey, commentId, requiredStatus, email, issueDate,
            input.expectedVersion, input.expectedSha, input.expectedSha, input.expectedSha)
      : env.REVIEW_DB.prepare(`UPDATE review_comments SET status = ?, transition_key = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND status = ? AND EXISTS (
            SELECT 1 FROM review_issues WHERE issue_date = ? AND state = 'in-review' AND version = ?
            AND draft_sha = ? AND preview_sha = ? AND report_sha = ?
          )`).bind(nextStatus, input.idempotencyKey, commentId, requiredStatus, issueDate,
            input.expectedVersion, input.expectedSha, input.expectedSha, input.expectedSha)
  ];
  if (comment.batch_id && input.action !== "edit") {
    statements.push(input.action === "resolve"
      ? env.REVIEW_DB.prepare(`UPDATE review_batches SET status = 'resolved', updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND EXISTS (SELECT 1 FROM review_comments WHERE id = ? AND transition_key = ?)
          AND NOT EXISTS (SELECT 1 FROM review_comments WHERE batch_id = ? AND status != 'resolved')`)
        .bind(comment.batch_id, commentId, input.idempotencyKey, comment.batch_id)
      : env.REVIEW_DB.prepare(`UPDATE review_batches SET status = 'addressed', updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND EXISTS (SELECT 1 FROM review_comments WHERE id = ? AND transition_key = ?)`)
        .bind(comment.batch_id, commentId, input.idempotencyKey));
  }
  statements.push(env.REVIEW_DB.prepare(`INSERT INTO review_events
    (id, issue_date, event_type, actor, idempotency_key, payload)
    SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (
      SELECT 1 FROM review_comments WHERE id = ? AND transition_key = ?
    )`).bind(crypto.randomUUID(), issueDate, eventType, email, input.idempotencyKey,
      JSON.stringify({ commentId, issueDate, action: input.action }), commentId, input.idempotencyKey));
  try {
    const results = await env.REVIEW_DB.batch(statements);
    if (results[0].meta.changes !== 1 || results.at(-1)?.meta.changes !== 1) {
      throw new Response("The issue or comment changed; reload and try again", { status: 409 });
    }
  } catch (error) {
    const raced = await existingOperation(env, input.idempotencyKey, eventType);
    if (raced) return { duplicate: true, issueDate: String(raced.issueDate) };
    throw error;
  }
  return { duplicate: false, issueDate };
}

export async function requestChanges(env: Env, email: string, issueDate: string, input: StateInput, fetcher: typeof fetch = fetch) {
  const duplicate = await existingOperation(env, input.idempotencyKey, "changes-requested");
  if (duplicate) return { duplicate: true, batchId: String(duplicate.batchId) };
  const current = await issue(env, issueDate);
  if (current.state !== "in-review" || current.draft_sha !== input.expectedSha || current.preview_sha !== input.expectedSha
    || current.report_sha !== input.expectedSha || current.version !== input.expectedVersion) {
    throw new Response("The reviewed snapshot changed; reload", { status: 409 });
  }
  const open = await env.REVIEW_DB.prepare("SELECT COUNT(*) AS count FROM review_comments WHERE issue_date = ? AND status = 'open'")
    .bind(issueDate).first<{ count: number }>();
  if (!open?.count) throw new Response("Add at least one new comment", { status: 409 });

  const batchId = input.idempotencyKey;
  const outboxId = crypto.randomUUID();
  const payload = { batchId, sourceSha: input.expectedSha };
  try {
    const results = await env.REVIEW_DB.batch([
      env.REVIEW_DB.prepare(`UPDATE review_issues SET state = 'changes-requested', version = version + 1,
        transition_key = ?, updated_at = CURRENT_TIMESTAMP WHERE issue_date = ? AND state = 'in-review'
        AND version = ? AND draft_sha = ? AND preview_sha = ? AND report_sha = ?`)
        .bind(input.idempotencyKey, issueDate, input.expectedVersion, input.expectedSha, input.expectedSha, input.expectedSha),
      env.REVIEW_DB.prepare(`INSERT INTO review_batches (id, issue_date, submitted_by, source_sha, status)
        SELECT ?, ?, ?, ?, 'submitted' WHERE EXISTS (
          SELECT 1 FROM review_issues WHERE issue_date = ? AND transition_key = ?
        )`).bind(batchId, issueDate, email, input.expectedSha, issueDate, input.idempotencyKey),
      env.REVIEW_DB.prepare(`INSERT INTO review_batch_items
        (id, batch_id, comment_id, story_review_id, anchor_key, field_path, anchor_label, selected_text, context_before,
         context_after, instruction_body, source_sha, field_value_hash)
        SELECT lower(hex(randomblob(16))), ?, id, story_review_id, anchor_key, field_path, anchor_label, selected_text,
         context_before, context_after, body, source_sha, field_value_hash
        FROM review_comments WHERE issue_date = ? AND status = 'open' AND EXISTS (
          SELECT 1 FROM review_issues WHERE issue_date = ? AND transition_key = ?
        )`).bind(batchId, issueDate, issueDate, input.idempotencyKey),
      env.REVIEW_DB.prepare(`UPDATE review_comments SET status = 'submitted', batch_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE issue_date = ? AND status = 'open' AND EXISTS (
          SELECT 1 FROM review_issues WHERE issue_date = ? AND transition_key = ?
        )`).bind(batchId, issueDate, issueDate, input.idempotencyKey),
      eventStatement(env, {
        id: crypto.randomUUID(), issueDate, type: "changes-requested", actor: email,
        idempotencyKey: input.idempotencyKey, payload, transitionKey: input.idempotencyKey
      }),
      outboxStatement(env, {
        id: outboxId, issueDate, dedupeKey: `changes-requested:${input.idempotencyKey}`,
        workflow: "notify-review.yml",
        inputs: { kind: "changes-requested", issue_date: issueDate, link: env.REVIEW_ORIGIN + `/review/${issueDate}` },
        transitionKey: input.idempotencyKey
      })
    ]);
    if (results[0].meta.changes !== 1) throw new Response("The review state changed; reload and try again", { status: 409 });
  } catch (error) {
    const raced = await existingOperation(env, input.idempotencyKey, "changes-requested");
    if (raced) return { duplicate: true, batchId: String(raced.batchId) };
    throw error;
  }
  await drainOutbox(env, outboxId, fetcher);
  return { duplicate: false, batchId };
}

export async function approveIssue(env: Env, email: string, issueDate: string, input: StateInput, fetcher: typeof fetch = fetch) {
  const duplicate = await existingOperation(env, input.idempotencyKey, "approval-requested");
  if (duplicate) return { duplicate: true, approvalId: String(duplicate.approvalId) };
  const current = await issue(env, issueDate);
  if (current.state !== "in-review" || current.draft_sha !== input.expectedSha || current.preview_sha !== input.expectedSha
    || current.report_sha !== input.expectedSha || current.version !== input.expectedVersion) {
    throw new Response("Only the current deployed snapshot can be approved", { status: 409 });
  }
  const blocking = await env.REVIEW_DB.prepare("SELECT COUNT(*) AS count FROM review_comments WHERE issue_date = ? AND status != 'resolved'")
    .bind(issueDate).first<{ count: number }>();
  if (blocking?.count) throw new Response("Resolve every comment before approval", { status: 409 });

  const approvalId = input.idempotencyKey;
  const outboxId = crypto.randomUUID();
  const payload = { approvalId, approvedSha: input.expectedSha };
  try {
    const results = await env.REVIEW_DB.batch([
      env.REVIEW_DB.prepare(`UPDATE review_issues SET state = 'publishing', version = version + 1,
        transition_key = ?, updated_at = CURRENT_TIMESTAMP WHERE issue_date = ? AND state = 'in-review'
        AND version = ? AND draft_sha = ? AND preview_sha = ? AND report_sha = ? AND NOT EXISTS (
          SELECT 1 FROM review_comments WHERE issue_date = ? AND status != 'resolved'
        )`)
        .bind(input.idempotencyKey, issueDate, input.expectedVersion, input.expectedSha, input.expectedSha,
          input.expectedSha, issueDate),
      env.REVIEW_DB.prepare(`INSERT INTO approvals (id, issue_date, reviewer_email, approved_sha, status)
        SELECT ?, ?, ?, ?, 'pending' WHERE EXISTS (
          SELECT 1 FROM review_issues WHERE issue_date = ? AND transition_key = ?
        )`).bind(approvalId, issueDate, email, input.expectedSha, issueDate, input.idempotencyKey),
      eventStatement(env, {
        id: crypto.randomUUID(), issueDate, type: "approval-requested", actor: email,
        idempotencyKey: input.idempotencyKey, payload, transitionKey: input.idempotencyKey
      }),
      outboxStatement(env, {
        id: outboxId, issueDate, dedupeKey: `approval-requested:${input.idempotencyKey}`,
        workflow: "approve-weekly-brief.yml", inputs: { approval_id: approvalId }, transitionKey: input.idempotencyKey
      })
    ]);
    if (results[0].meta.changes !== 1) throw new Response("Only the current deployed revision can be approved", { status: 409 });
  } catch (error) {
    const raced = await existingOperation(env, input.idempotencyKey, "approval-requested");
    if (raced) return { duplicate: true, approvalId: String(raced.approvalId) };
    throw error;
  }
  await drainOutbox(env, outboxId, fetcher);
  return { duplicate: false, approvalId };
}

type ApprovalWorkflowRunInput = {
  runId: number;
  approvalCommitSha: string;
};

type GitHubWorkflowRun = {
  event: string;
  status: string;
  conclusion: string | null;
  head_sha: string;
  path: string;
  pull_requests: Array<{ number: number }>;
};

export async function approvePullRequestWorkflowRun(
  env: Env,
  approvalId: string,
  input: ApprovalWorkflowRunInput,
  fetcher: typeof fetch = fetch
) {
  const approval = await env.REVIEW_DB.prepare(`SELECT approvals.status, approvals.approval_commit_sha, approvals.issue_date,
    review_issues.state AS issue_state, review_issues.pull_request
    FROM approvals JOIN review_issues USING(issue_date) WHERE approvals.id = ?`).bind(approvalId).first<{
      status: string;
      approval_commit_sha: string | null;
      issue_date: string;
      issue_state: string;
      pull_request: number;
    }>();
  if (!approval || approval.status !== "running" || approval.issue_state !== "publishing"
    || approval.approval_commit_sha !== input.approvalCommitSha) {
    throw new Response("Approval workflow state conflict", { status: 409 });
  }

  const headers = {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${env.GITHUB_WORKFLOW_TOKEN}`,
    "user-agent": "Proterra-Intelligence-Review-Worker",
    "x-github-api-version": "2022-11-28"
  };
  const runUrl = `https://api.github.com/repos/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_REPO)}/actions/runs/${input.runId}`;
  const runResponse = await fetcher(runUrl, { headers });
  if (!runResponse.ok) throw new Response(`Could not inspect approval CI (${runResponse.status})`, { status: 502 });
  const run = await runResponse.json() as GitHubWorkflowRun;
  const expectedWorkflow = ".github/workflows/ci.yml";
  if (run.event !== "pull_request" || run.head_sha !== input.approvalCommitSha
    || !(run.path === expectedWorkflow || run.path.startsWith(`${expectedWorkflow}@`))
    || !run.pull_requests.some((pullRequest) => pullRequest.number === approval.pull_request)) {
    throw new Response("Workflow run does not match the guarded approval commit", { status: 409 });
  }

  if (run.status === "completed" && run.conclusion === "action_required") {
    const approved = await fetcher(`${runUrl}/approve`, { method: "POST", headers });
    if (!approved.ok) throw new Response(`Could not authorize approval CI (${approved.status})`, { status: 502 });
  } else if (!(run.status !== "completed" || run.conclusion === "success")) {
    throw new Response(`Approval CI cannot be authorized from ${run.status}/${run.conclusion ?? "none"}`, { status: 409 });
  }

  await recordEvent(env, {
    issueDate: approval.issue_date,
    type: "approval-ci-authorized",
    actor: "publisher",
    idempotencyKey: `approval-ci:${input.runId}`,
    payload: input
  });
  return { ok: true, runId: input.runId };
}

const agentResultSchema = z.object({
  previousSha: shaSchema,
  expectedVersion: z.number().int().positive(),
  newSha: shaSchema,
  idempotencyKey: z.uuid(),
  responses: z.array(z.object({ commentId: z.uuid(), response: z.string().min(1).max(2000) })).default([]),
  report: reviewReportSchema
});
export type AgentResultInput = z.infer<typeof agentResultSchema>;
const presentationResultSchema = z.object({
  previousSha: shaSchema,
  expectedVersion: z.number().int().positive(),
  newSha: shaSchema,
  idempotencyKey: z.uuid(),
  report: reviewReportSchema
});
export type PresentationResultInput = z.infer<typeof presentationResultSchema>;

const collectionFailureSchema = z.object({
  branch: z.string().regex(/^research-\d{4}-\d{2}-\d{2}$/),
  reason: z.string().min(1).max(2000),
  runUrl: z.url(),
  idempotencyKey: z.string().min(8).max(200)
});
export type CollectionFailureInput = z.infer<typeof collectionFailureSchema>;

export async function recordAgentResult(env: Env, issueDate: string, input: AgentResultInput) {
  const duplicate = await existingOperation(env, input.idempotencyKey, "agent-completed");
  if (duplicate) return { duplicate: true, newSha: String(duplicate.newSha) };
  const current = await issue(env, issueDate);
  if (current.draft_sha !== input.previousSha || current.version !== input.expectedVersion
    || !["source-ready", "changes-requested"].includes(String(current.state))) {
    throw new Response("Draft state conflict", { status: 409 });
  }
  if (input.report.slug !== issueDate || input.report.status !== "draft") {
    throw new Response("Draft snapshot does not match the review issue", { status: 409 });
  }
  const payload = { previousSha: input.previousSha, newSha: input.newSha };
  try {
    const statements = [
      env.REVIEW_DB.prepare(`UPDATE review_issues SET state = 'in-review', version = version + 1, draft_sha = ?,
        preview_sha = NULL, preview_url = NULL, preview_deployment_id = NULL, preview_alias_url = NULL,
        preview_completed_at = NULL, report_sha = ?, report_json = ?, transition_key = ?, updated_at = CURRENT_TIMESTAMP
        WHERE issue_date = ? AND version = ? AND draft_sha = ? AND state IN ('source-ready', 'changes-requested')`)
        .bind(input.newSha, input.newSha, JSON.stringify(input.report), input.idempotencyKey,
          issueDate, input.expectedVersion, input.previousSha),
      ...input.responses.map((response) => env.REVIEW_DB.prepare(
        `UPDATE review_comments SET status = 'addressed', addressed_sha = ?, agent_response = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND issue_date = ? AND status = 'submitted' AND EXISTS (
           SELECT 1 FROM review_issues WHERE issue_date = ? AND transition_key = ?
         )`
      ).bind(input.newSha, response.response, response.commentId, issueDate, issueDate, input.idempotencyKey)),
      env.REVIEW_DB.prepare(`UPDATE review_batches SET status = 'addressed', updated_at = CURRENT_TIMESTAMP
        WHERE issue_date = ? AND status = 'submitted' AND EXISTS (
          SELECT 1 FROM review_issues WHERE issue_date = ? AND transition_key = ?
        )`).bind(issueDate, issueDate, input.idempotencyKey),
      eventStatement(env, {
        id: crypto.randomUUID(), issueDate, type: "agent-completed", actor: "homelab",
        idempotencyKey: input.idempotencyKey, payload, transitionKey: input.idempotencyKey
      })
    ];
    const results = await env.REVIEW_DB.batch(statements);
    if (results[0].meta.changes !== 1) throw new Response("Draft state conflict", { status: 409 });
  } catch (error) {
    const raced = await existingOperation(env, input.idempotencyKey, "agent-completed");
    if (raced) return { duplicate: true, newSha: String(raced.newSha) };
    throw error;
  }
  return { duplicate: false, newSha: input.newSha };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function withoutEditorialImages(report: unknown) {
  const normalized = structuredClone(report) as { items?: Array<Record<string, unknown>> };
  for (const item of normalized.items ?? []) delete item.imageId;
  return canonicalJson(normalized);
}

export async function recordPresentationResult(env: Env, issueDate: string, input: PresentationResultInput) {
  const duplicate = await existingOperation(env, input.idempotencyKey, "presentation-refreshed");
  if (duplicate) return { duplicate: true, newSha: String(duplicate.newSha) };
  const current = await issue(env, issueDate);
  if (current.state !== "in-review" || current.draft_sha !== input.previousSha
    || current.report_sha !== input.previousSha || current.version !== input.expectedVersion) {
    throw new Response("Presentation refresh state conflict", { status: 409 });
  }
  if (!current.report_json || withoutEditorialImages(JSON.parse(String(current.report_json))) !== withoutEditorialImages(input.report)) {
    throw new Response("Presentation refresh may change only editorial image IDs", { status: 409 });
  }
  const payload = { previousSha: input.previousSha, newSha: input.newSha };
  try {
    const results = await env.REVIEW_DB.batch([
      env.REVIEW_DB.prepare(`UPDATE review_issues SET version = version + 1, draft_sha = ?,
        preview_sha = NULL, preview_url = NULL, preview_deployment_id = NULL, preview_alias_url = NULL,
        preview_completed_at = NULL, report_sha = ?, report_json = ?, transition_key = ?, updated_at = CURRENT_TIMESTAMP
        WHERE issue_date = ? AND state = 'in-review' AND version = ? AND draft_sha = ? AND report_sha = ?`)
        .bind(input.newSha, input.newSha, JSON.stringify(input.report), input.idempotencyKey,
          issueDate, input.expectedVersion, input.previousSha, input.previousSha),
      eventStatement(env, {
        id: crypto.randomUUID(), issueDate, type: "presentation-refreshed", actor: "operator",
        idempotencyKey: input.idempotencyKey, payload, transitionKey: input.idempotencyKey
      })
    ]);
    if (results[0].meta.changes !== 1 || results[1].meta.changes !== 1) {
      throw new Response("Presentation refresh state conflict", { status: 409 });
    }
  } catch (error) {
    const raced = await existingOperation(env, input.idempotencyKey, "presentation-refreshed");
    if (raced) return { duplicate: true, newSha: String(raced.newSha) };
    throw error;
  }
  return { duplicate: false, newSha: input.newSha };
}

export async function backfillReportSnapshot(env: Env, issueDate: string, sha: string, report: ReviewReport) {
  if (report.slug !== issueDate || report.status !== "draft") {
    throw new Response("Draft snapshot does not match the review issue", { status: 409 });
  }
  const result = await env.REVIEW_DB.prepare(`UPDATE review_issues SET report_sha = ?, report_json = ?,
    updated_at = CURRENT_TIMESTAMP WHERE issue_date = ? AND draft_sha = ? AND state IN ('in-review', 'changes-requested')`)
    .bind(sha, JSON.stringify(report), issueDate, sha).run();
  if (result.meta.changes !== 1) throw new Response("Snapshot state conflict", { status: 409 });
  await recordEvent(env, { issueDate, type: "report-snapshot-backfilled", actor: "operator", payload: { sha } });
  return { ok: true, issueDate, sha };
}

export async function invalidateSourceQueue(env: Env, issueDate: string, input: CollectionFailureInput) {
  const duplicate = await existingOperation(env, input.idempotencyKey, "collection-failed");
  if (duplicate) return { duplicate: true, invalidated: true };
  const current = await env.REVIEW_DB.prepare("SELECT branch, state, transition_key FROM review_issues WHERE issue_date = ?")
    .bind(issueDate).first<{ branch: string; state: string; transition_key: string | null }>();
  if (!current) return { duplicate: false, invalidated: false };
  if (current.branch !== input.branch) throw new Response("Collection branch does not match the review issue", { status: 409 });
  if (current.state === "failed" && current.transition_key?.startsWith("collection-failed:")) {
    return { duplicate: false, invalidated: false };
  }
  if (current.state !== "source-ready") return { duplicate: false, invalidated: false };

  const transitionKey = input.idempotencyKey;
  const payload = { issueDate, branch: input.branch, reason: input.reason, runUrl: input.runUrl };
  const results = await env.REVIEW_DB.batch([
    env.REVIEW_DB.prepare(`UPDATE review_issues SET state = 'failed', version = version + 1,
      transition_key = ?, updated_at = CURRENT_TIMESTAMP
      WHERE issue_date = ? AND branch = ? AND state = 'source-ready'`)
      .bind(transitionKey, issueDate, input.branch),
    eventStatement(env, {
      id: crypto.randomUUID(), issueDate, type: "collection-failed", actor: "collector",
      idempotencyKey: input.idempotencyKey, payload, transitionKey
    })
  ]);
  if (results[0].meta.changes !== 1 || results[1].meta.changes !== 1) {
    const raced = await existingOperation(env, input.idempotencyKey, "collection-failed");
    if (raced) return { duplicate: true, invalidated: true };
    throw new Response("Collection failure state conflict", { status: 409 });
  }
  return { duplicate: false, invalidated: true };
}

export type ProductionFailureInput = {
  mergeSha: string;
  error: string;
  runUrl: string;
};

export async function recordProductionFailure(
  env: Env,
  input: ProductionFailureInput,
  fetcher: typeof fetch = fetch
) {
  const idempotencyKey = `production-failed:${input.mergeSha}`;
  const duplicate = await existingOperation(env, idempotencyKey, "production-failed");
  if (duplicate) return { ok: true, issueDate: String(duplicate.issueDate), duplicate: true };
  const approval = await env.REVIEW_DB.prepare("SELECT id, issue_date, status FROM approvals WHERE merge_commit_sha = ?")
    .bind(input.mergeSha).first<{ id: string; issue_date: string; status: string }>();
  if (!approval) throw new Response("Publishing approval not found for deployment SHA", { status: 404 });
  if (approval.status !== "merged") throw new Response("Publishing approval is not awaiting deployment", { status: 409 });
  const transitionKey = idempotencyKey;
  const outboxId = crypto.randomUUID();
  const results = await env.REVIEW_DB.batch([
    env.REVIEW_DB.prepare(`UPDATE review_issues SET state = 'publishing', version = version + 1,
      transition_key = ?, updated_at = CURRENT_TIMESTAMP WHERE issue_date = ? AND state = 'publishing'`)
      .bind(transitionKey, approval.issue_date),
    env.REVIEW_DB.prepare(`UPDATE approvals SET error = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'merged' AND EXISTS (
        SELECT 1 FROM review_issues WHERE issue_date = ? AND transition_key = ?
      )`).bind(input.error, approval.id, approval.issue_date, transitionKey),
    eventStatement(env, {
      id: crypto.randomUUID(), issueDate: approval.issue_date, type: "production-failed",
      actor: "deployment", idempotencyKey, payload: { ...input, issueDate: approval.issue_date }, transitionKey
    }),
    outboxStatement(env, {
      id: outboxId, issueDate: approval.issue_date, dedupeKey: transitionKey, workflow: "notify-review.yml",
      inputs: { kind: "failed", issue_date: approval.issue_date, link: input.runUrl }, transitionKey
    })
  ]);
  if (results[0].meta.changes !== 1 || results[1].meta.changes !== 1) {
    throw new Response("Production failure state conflict", { status: 409 });
  }
  await drainOutbox(env, outboxId, fetcher);
  return { ok: true, issueDate: approval.issue_date, duplicate: false };
}

async function handleUserApi(request: Request, env: Env, path: string[]) {
  const email = await authenticatedEmail(request, env);
  const reviewer = await user(env, email);
  if (request.method !== "GET") await assertCsrf(request, email, env);

  if (request.method === "GET" && path[0] === "issues" && path.length === 2) {
    return json(await issuePayload(env, issueDateSchema.parse(path[1])));
  }
  if (request.method === "POST" && path[0] === "issues" && path[2] === "comments") {
    const issueDate = issueDateSchema.parse(path[1]);
    const input = commentInputSchema.parse(await body(request));
    const result = await createComment(env, email, issueDate, input);
    return json(await issuePayload(env, issueDate), result.duplicate ? 200 : 201);
  }
  if (request.method === "PATCH" && path[0] === "comments" && path.length === 2) {
    const input = commentMutationSchema.parse(await body(request));
    const result = await mutateComment(env, email, path[1], input);
    return json(await issuePayload(env, result.issueDate));
  }
  if (request.method === "POST" && path[0] === "issues" && path[2] === "request-changes") {
    const issueDate = issueDateSchema.parse(path[1]);
    const input = stateInputSchema.parse(await body(request));
    await requestChanges(env, email, issueDate, input);
    return json(await issuePayload(env, issueDate));
  }
  if (request.method === "POST" && path[0] === "issues" && path[2] === "approve") {
    const issueDate = issueDateSchema.parse(path[1]);
    const input = stateInputSchema.parse(await body(request));
    if (reviewer.role !== "publisher") throw new Response("Publisher access required", { status: 403 });
    await approveIssue(env, email, issueDate, input);
    return json(await issuePayload(env, issueDate), 202);
  }
  throw new Response("Not found", { status: 404 });
}

async function handleInternalApi(request: Request, env: Env, path: string[]) {
  assertService(request, env);
  if (request.method === "POST" && path[0] === "outbox" && path[1] === "drain") {
    return json(await drainOutbox(env));
  }
  if (request.method === "POST" && path[0] === "issues" && path[1] === "upsert") {
    const input = z.object({ issueDate: issueDateSchema, pullRequest: z.number().int().positive(), branch: z.string().regex(/^research-\d{4}-\d{2}-\d{2}$/), draftSha: shaSchema }).parse(await body(request));
    const result = await env.REVIEW_DB.prepare(`INSERT INTO review_issues (issue_date, pull_request, branch, state, draft_sha)
      VALUES (?, ?, ?, 'source-ready', ?)
      ON CONFLICT(issue_date) DO UPDATE SET pull_request = excluded.pull_request, branch = excluded.branch,
      state = 'source-ready', draft_sha = excluded.draft_sha, version = review_issues.version + 1,
      preview_sha = NULL, preview_url = NULL, preview_deployment_id = NULL, preview_alias_url = NULL,
      preview_completed_at = NULL, report_sha = NULL, report_json = NULL,
      transition_key = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE review_issues.state = 'source-ready'
        OR (review_issues.state = 'failed' AND review_issues.transition_key LIKE 'collection-failed:%')`)
      .bind(input.issueDate, input.pullRequest, input.branch, input.draftSha).run();
    if (result.meta.changes !== 1) throw new Response("The issue has moved beyond source review; collection cannot replace its revision", { status: 409 });
    await recordEvent(env, { issueDate: input.issueDate, type: "source-ready", actor: "collector", payload: input });
    return json(await issuePayload(env, input.issueDate));
  }
  if (request.method === "POST" && path[0] === "issues" && path[2] === "collection-failed") {
    const issueDate = issueDateSchema.parse(path[1]);
    const input = collectionFailureSchema.parse(await body(request));
    return json(await invalidateSourceQueue(env, issueDate, input));
  }
  if (request.method === "GET" && path[0] === "issues" && path[2] === "agent-context") {
    const issueDate = issueDateSchema.parse(path[1]);
    const current = await issue(env, issueDate);
    const batches = await env.REVIEW_DB.prepare("SELECT * FROM review_batches WHERE issue_date = ? AND status = 'submitted' ORDER BY created_at").bind(issueDate).all();
    const batchItems = await env.REVIEW_DB.prepare(`SELECT review_batch_items.* FROM review_batch_items
      JOIN review_batches ON review_batches.id = review_batch_items.batch_id
      WHERE review_batches.issue_date = ? AND review_batches.status = 'submitted' ORDER BY review_batch_items.created_at, review_batch_items.id`).bind(issueDate).all();
    return json({ issue: current, batches: batches.results, batchItems: batchItems.results });
  }
  if (request.method === "POST" && path[0] === "issues" && path[2] === "agent-result") {
    const issueDate = issueDateSchema.parse(path[1]);
    const input = agentResultSchema.parse(await body(request, 100_000));
    await recordAgentResult(env, issueDate, input);
    return json(await issuePayload(env, issueDate));
  }
  if (request.method === "POST" && path[0] === "issues" && path[2] === "presentation-result") {
    const issueDate = issueDateSchema.parse(path[1]);
    const input = presentationResultSchema.parse(await body(request, 100_000));
    await recordPresentationResult(env, issueDate, input);
    return json(await issuePayload(env, issueDate));
  }
  if (request.method === "POST" && path[0] === "issues" && path[2] === "snapshot") {
    const issueDate = issueDateSchema.parse(path[1]);
    const input = z.object({ sha: shaSchema, report: reviewReportSchema }).parse(await body(request, 100_000));
    return json(await backfillReportSnapshot(env, issueDate, input.sha, input.report));
  }
  if (request.method === "POST" && path[0] === "issues" && path[2] === "deployment") {
    const issueDate = issueDateSchema.parse(path[1]);
    const input = z.object({
      sha: shaSchema, expectedVersion: z.number().int().positive(), deploymentId: z.string().min(1).max(200),
      immutableUrl: z.url(), aliasUrl: z.url(), completedAt: z.iso.datetime()
    }).parse(await body(request));
    const current = await issue(env, issueDate);
    if (current.draft_sha !== input.sha || current.report_sha !== input.sha || current.version !== input.expectedVersion) {
      throw new Response("Deployment state conflict", { status: 409 });
    }
    const transitionKey = `preview:${input.deploymentId}`;
    const outboxId = crypto.randomUUID();
    const results = await env.REVIEW_DB.batch([
      env.REVIEW_DB.prepare(`UPDATE review_issues SET state = 'in-review', version = version + 1,
        preview_sha = ?, preview_url = ?, preview_deployment_id = ?, preview_alias_url = ?, preview_completed_at = ?,
        transition_key = ?, updated_at = CURRENT_TIMESTAMP WHERE issue_date = ? AND version = ? AND draft_sha = ?
        AND report_sha = ?`)
        .bind(input.sha, input.immutableUrl, input.deploymentId, input.aliasUrl, input.completedAt,
          transitionKey, issueDate, input.expectedVersion, input.sha, input.sha),
      eventStatement(env, {
        id: crypto.randomUUID(), issueDate, type: "preview-ready", actor: "deployment", payload: input, transitionKey
      }),
      outboxStatement(env, {
        id: outboxId, issueDate, dedupeKey: transitionKey, workflow: "notify-review.yml",
        inputs: { kind: "preview-ready", issue_date: issueDate, link: env.REVIEW_ORIGIN + `/review/${issueDate}` }, transitionKey
      })
    ]);
    if (results[0].meta.changes !== 1) throw new Response("Deployment state conflict", { status: 409 });
    await drainOutbox(env, outboxId);
    return json(await issuePayload(env, issueDate));
  }
  if (request.method === "GET" && path[0] === "approvals" && path.length === 2) {
    const approval = await env.REVIEW_DB.prepare(`SELECT approvals.*, review_issues.pull_request, review_issues.branch, review_issues.state AS issue_state,
      review_issues.draft_sha, review_issues.preview_sha FROM approvals JOIN review_issues USING(issue_date) WHERE approvals.id = ?`).bind(path[1]).first();
    if (!approval) throw new Response("Approval not found", { status: 404 });
    return json(approval);
  }
  if (request.method === "POST" && path[0] === "approvals" && path[2] === "authorize-ci") {
    const approvalId = path[1];
    const input = z.object({
      runId: z.number().int().positive(), approvalCommitSha: shaSchema
    }).parse(await body(request));
    return json(await approvePullRequestWorkflowRun(env, approvalId, input));
  }
  if (request.method === "POST" && path[0] === "approvals" && path[2] === "result") {
    const approvalId = path[1];
    const input = z.object({
      status: z.enum(["running", "merged", "published", "failed", "invalidated"]),
      error: z.string().max(2000).optional(), approvalCommitSha: shaSchema.optional(), mergeCommitSha: shaSchema.optional()
    }).parse(await body(request));
    const approval = await env.REVIEW_DB.prepare("SELECT issue_date, status, approval_commit_sha FROM approvals WHERE id = ?")
      .bind(approvalId).first<{ issue_date: string; status: string; approval_commit_sha: string | null }>();
    if (!approval) throw new Response("Approval not found", { status: 404 });
    if (approval.status === input.status) {
      if (input.status === "running") {
        if (approval.approval_commit_sha && input.approvalCommitSha
          && approval.approval_commit_sha !== input.approvalCommitSha) {
          throw new Response("Prepared approval commit changed", { status: 409 });
        }
        const result = await env.REVIEW_DB.prepare(`UPDATE approvals SET error = ?,
          approval_commit_sha = COALESCE(approval_commit_sha, ?), updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND status = 'running' AND EXISTS (
            SELECT 1 FROM review_issues WHERE issue_date = approvals.issue_date AND state = 'publishing'
          )`).bind(input.error ?? null, input.approvalCommitSha ?? null, approvalId).run();
        if (result.meta.changes !== 1) throw new Response("Approval is not retryable", { status: 409 });
      }
      return json({ ok: true, duplicate: true });
    }
    const allowed: Record<string, string[]> = {
      pending: ["running", "failed", "invalidated"],
      running: ["merged", "failed", "invalidated"]
    };
    if (!allowed[approval.status]?.includes(input.status)) throw new Response("Invalid approval status transition", { status: 409 });
    const transitionKey = crypto.randomUUID();
    const results = await env.REVIEW_DB.batch([
      env.REVIEW_DB.prepare(`UPDATE approvals SET status = ?, error = ?,
        approval_commit_sha = COALESCE(?, approval_commit_sha), merge_commit_sha = COALESCE(?, merge_commit_sha),
        transition_key = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = ?`)
        .bind(input.status, input.error ?? null, input.approvalCommitSha ?? null, input.mergeCommitSha ?? null,
          transitionKey, approvalId, approval.status),
      env.REVIEW_DB.prepare(`UPDATE review_issues SET state = ?, updated_at = CURRENT_TIMESTAMP
        WHERE issue_date = ? AND EXISTS (SELECT 1 FROM approvals WHERE id = ? AND transition_key = ?)`)
        .bind(input.status === "published" ? "published" : ["running", "merged"].includes(input.status) ? "publishing" : "failed",
          approval.issue_date, approvalId, transitionKey),
      env.REVIEW_DB.prepare(`INSERT INTO review_events (id, issue_date, event_type, actor, payload)
        SELECT ?, ?, ?, 'publisher', ? WHERE EXISTS (
          SELECT 1 FROM approvals WHERE id = ? AND transition_key = ?
        )`).bind(crypto.randomUUID(), approval.issue_date, `approval-${input.status}`, JSON.stringify(input), approvalId, transitionKey)
    ]);
    if (results[0].meta.changes !== 1 || results[1].meta.changes !== 1 || results[2].meta.changes !== 1) {
      throw new Response("Approval status changed concurrently", { status: 409 });
    }
    return json({ ok: true });
  }
  if (request.method === "POST" && path[0] === "deployments" && path[1] === "production") {
    const input = z.object({
      mergeSha: shaSchema, deploymentId: z.string().min(1).max(200),
      immutableUrl: z.url(), completedAt: z.iso.datetime()
    }).parse(await body(request));
    const approval = await env.REVIEW_DB.prepare("SELECT id, issue_date, status, production_deployment_id FROM approvals WHERE merge_commit_sha = ?")
      .bind(input.mergeSha).first<{ id: string; issue_date: string; status: string; production_deployment_id: string | null }>();
    if (!approval) throw new Response("Publishing approval not found for deployment SHA", { status: 404 });
    if (approval.status === "published" && approval.production_deployment_id === input.deploymentId) {
      return json({ ok: true, issueDate: approval.issue_date, duplicate: true });
    }
    if (approval.status !== "merged") throw new Response("Publishing approval is not awaiting deployment", { status: 409 });
    const transitionKey = `production:${input.deploymentId}`;
    const outboxId = crypto.randomUUID();
    const results = await env.REVIEW_DB.batch([
      env.REVIEW_DB.prepare(`UPDATE review_issues SET state = 'published', version = version + 1,
        transition_key = ?, updated_at = CURRENT_TIMESTAMP WHERE issue_date = ? AND state = 'publishing'`)
        .bind(transitionKey, approval.issue_date),
      env.REVIEW_DB.prepare(`UPDATE approvals SET status = 'published', production_deployment_id = ?, production_url = ?,
        error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'merged' AND EXISTS (
          SELECT 1 FROM review_issues WHERE issue_date = ? AND transition_key = ?
        )`).bind(input.deploymentId, input.immutableUrl, approval.id, approval.issue_date, transitionKey),
      eventStatement(env, {
        id: crypto.randomUUID(), issueDate: approval.issue_date, type: "production-deployed",
        actor: "deployment", payload: input, transitionKey
      }),
      outboxStatement(env, {
        id: outboxId, issueDate: approval.issue_date, dedupeKey: transitionKey, workflow: "notify-review.yml",
        inputs: { kind: "published", issue_date: approval.issue_date, link: input.immutableUrl }, transitionKey
      })
    ]);
    if (results[0].meta.changes !== 1 || results[1].meta.changes !== 1) throw new Response("Production deployment state conflict", { status: 409 });
    await drainOutbox(env, outboxId);
    return json({ ok: true, issueDate: approval.issue_date });
  }
  if (request.method === "POST" && path[0] === "deployments" && path[1] === "production-failure") {
    const input = z.object({
      mergeSha: shaSchema,
      error: z.string().trim().min(1).max(2000),
      runUrl: z.url()
    }).parse(await body(request));
    return json(await recordProductionFailure(env, input));
  }
  throw new Response("Not found", { status: 404 });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);
      const path = url.pathname.split("/").filter(Boolean);
      if (path[0] === "api" && path[1] === "internal") return await handleInternalApi(request, env, path.slice(2));
      if (path[0] === "api" && path[1] === "review") return await handleUserApi(request, env, path.slice(2));
      if (request.method === "GET" && path[0] === "review" && path.length === 2) {
        const issueDate = issueDateSchema.parse(path[1]);
        const email = await authenticatedEmail(request, env);
        await user(env, email);
        const current = await issue(env, issueDate);
        if (!current.preview_sha || current.preview_sha !== current.draft_sha
          || !current.report_json || current.report_sha !== current.draft_sha) {
          throw new Response("The reviewed report snapshot is not ready yet", { status: 409 });
        }
        const report = reviewReportSchema.parse(JSON.parse(String(current.report_json)));
        if (report.slug !== issueDate) throw new Response("The reviewed report snapshot does not match this issue", { status: 409 });
        const configuredSite = new URL(env.SITE_ORIGIN);
        if (configuredSite.protocol !== "https:") throw new Response("The configured site origin must use HTTPS", { status: 500 });
        const siteOrigin = configuredSite.origin;
        return new Response(reviewShell({
          issueDate, previewSha: String(current.preview_sha), state: String(current.state),
          csrf: await csrfToken(email, env), email, report, siteOrigin
        }), {
          headers: {
            "content-type": "text/html; charset=utf-8", "cache-control": "no-store",
            "content-security-policy": `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src ${siteOrigin}; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
            "referrer-policy": "no-referrer", "x-content-type-options": "nosniff"
          }
        });
      }
      if (request.method === "GET" && url.pathname === "/health") return json({ ok: true });
      return new Response("Not found", { status: 404 });
    } catch (error) {
      if (error instanceof Response) return error;
      if (error instanceof z.ZodError) return json({ error: "Invalid request", details: error.issues }, 400);
      console.error(error);
      return new Response("Internal error", { status: 500 });
    }
  },
  async scheduled(_controller: ScheduledController, env: Env, context: ExecutionContext) {
    context.waitUntil(drainOutbox(env));
  }
} satisfies ExportedHandler<Env>;
