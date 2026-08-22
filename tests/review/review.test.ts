import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { escapeHtml, reviewShell } from "../../review-worker/src/html";
import { reviewReportSchema } from "../../review-worker/src/report";
import { fallbackStoryReviewId, reviewAnchor } from "../../src/lib/review";
import { assertEditorialImageAssignments } from "../../src/lib/image-policy";
import { assertWeeklyDiff } from "../../scripts/review/assert-weekly-diff";
import {
  assertQueueMayDraft, buildDraftPrompt, chatGptOnlyEnvironment, matchesReconciliation,
  normalizeGeneratedReport, type DraftReceipt
} from "../../scripts/review/weekly-draft";
import { validateCollectionOutput } from "../../scripts/collection/validate-output";
import { createImageContext } from "../../scripts/review/prepare-image-context";

const shellReport = {
  slug: "2026-08-24", issueNumber: 3, title: "Weekly Brief", status: "draft",
  period: { start: "2026-08-17", end: "2026-08-23" }, publishedAt: "2026-08-24",
  scope: { basis: "public-sources-only", disclosure: "This test report contains only public source material for review." },
  executiveSummary: "A sufficiently detailed executive summary for the stable same-origin reviewer test fixture.",
  items: [{
    rank: 1, reviewId: "story-12345678", headline: "A sufficiently descriptive weekly test headline",
    imageId: "cattle-market", documentType: "report", sectors: ["meat"], regions: ["United States"],
    signal: "new", summary: "A sufficiently detailed summary used to exercise selectable report fields in the reviewer.",
    keyPoints: ["The first sufficiently detailed supporting point.", "The second sufficiently detailed supporting point."],
    whyItMatters: "This sufficiently detailed explanation describes why the development matters.",
    businessRelevance: "This sufficiently detailed explanation describes conditional business relevance.",
    watchNext: "Watch the next sufficiently detailed official release.", confidence: "high",
    citations: [{ sourceId: "usda-ams-livestock", title: "Readable official report landing page",
      url: "https://mymarketnews.ams.usda.gov/viewReport/2461",
      evidenceUrl: "https://mpr.datamart.ams.usda.gov/services/v1.1/reports/2461?q=report_date%3D08%2F14%2F2026",
      releaseId: "08/14/2026", publishedAt: "2026-08-14",
      sourceNote: "The dated release provides the values used by this test story." }]
  }]
} as any;

test("persistent review anchors do not depend on a citation URL after assignment", () => {
  const assigned = fallbackStoryReviewId("https://example.org/first-url");
  assert.match(assigned, /^story-[a-f0-9]{16}$/);
  assert.equal(reviewAnchor("2026-08-24", assigned, "summary"), `2026-08-24:${assigned}:summary`);
});

test("the Worker accepts the validated automated-draft contract", () => {
  const report = {
    ...shellReport,
    items: Array.from({ length: 5 }, (_, index) => ({
      ...shellReport.items[0], rank: index + 1, reviewId: `story-1234567${index}`,
      headline: `A sufficiently descriptive weekly test headline ${index + 1}`
    }))
  };
  assert.equal(reviewReportSchema.parse(report).slug, "2026-08-24");
});

test("generated reports receive deterministic issue metadata and harmless enum cleanup", () => {
  const normalized = normalizeGeneratedReport({
    slug: "wrong",
    issueNumber: 1,
    status: "approved",
    publishedAt: "2020-01-01",
    dashboard: { charts: [] },
    items: [{ documentType: "article" }, { documentType: "report" }]
  }, "2026-08-22", 3) as any;
  assert.equal(normalized.slug, "2026-08-22");
  assert.equal(normalized.issueNumber, 3);
  assert.equal(normalized.status, "draft");
  assert.equal(normalized.publishedAt, "2026-08-22");
  assert.equal("charts" in normalized.dashboard, false);
  assert.deepEqual(normalized.items.map((item: any) => item.documentType), ["news", "report"]);
});

test("image context grows the library before rotating and ranks current assets first", () => {
  const context = createImageContext([
    { id: "current", introducedForIssue: "2026-08-22" },
    { id: "unused" },
    { id: "recent" },
    { id: "older" }
  ], [
    { slug: "2026-08-17", items: [{ imageId: "recent" }] },
    { slug: "2026-08-10", items: [{ imageId: "older" }] }
  ], "2026-08-22", { schemaVersion: 1, growthTarget: 30, avoidPreviousIssues: 1 });
  assert.equal(context.phase, "grow");
  assert.equal(context.assetsNeededToRotate, 26);
  assert.deepEqual(context.assets.map((asset) => asset.id), ["current", "unused", "older", "recent"]);
  assert.deepEqual(context.assets.find((asset) => asset.id === "recent")?.usedInRecentIssues, ["2026-08-17"]);
});

test("weekly setup helper is shell-valid, discoverable, and non-mutating by default", async () => {
  execFileSync("bash", ["-n", "scripts/setup/weekly-automation.sh"]);
  const script = await readFile("scripts/setup/weekly-automation.sh", "utf8");
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  assert.equal(packageJson.scripts["weekly:setup"], "bash scripts/setup/weekly-automation.sh");
  assert.match(script, /The default command is read-only/);
  assert.match(script, /--init-env/);
  assert.match(script, /--online/);
  assert.match(script, /--verify/);
  assert.doesNotMatch(script, /gh (?:secret|variable).*\bset\b/);
  assert.doesNotMatch(script, /git (?:commit|push)\b/);
});

test("the stable review shell escapes database and identity values", () => {
  assert.equal(escapeHtml(`<script>alert("x")</script>`), "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
  const html = reviewShell({
    issueDate: "2026-08-24", previewSha: "a".repeat(40), state: `<img src=x onerror=alert(1)>`,
    csrf: "safe", email: "reviewer@example.org", report: shellReport, siteOrigin: "https://site.example.org"
  });
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<iframe/);
  assert.match(html, /View readable source/);
  assert.match(html, /Exact evidence · 08\/14\/2026/);
});

test("D1 schema includes immutable feedback snapshots, optimistic versions, and a durable outbox", async () => {
  const initial = await readFile("review-worker/migrations/0001_initial.sql", "utf8");
  const atomic = await readFile("review-worker/migrations/0002_atomic_outbox.sql", "utf8");
  const snapshots = await readFile("review-worker/migrations/0003_report_snapshots.sql", "utf8");
  assert.match(initial, /CREATE TABLE review_batch_items/);
  assert.match(initial, /field_value_hash TEXT NOT NULL/);
  assert.match(initial, /version INTEGER NOT NULL DEFAULT 1/);
  assert.match(atomic, /CREATE TABLE notification_outbox/);
  assert.match(atomic, /transition_key/);
  assert.match(atomic, /ALTER TABLE approvals ADD COLUMN transition_key/);
  assert.match(atomic, /ALTER TABLE review_comments ADD COLUMN transition_key/);
  assert.match(snapshots, /ADD COLUMN report_sha/);
  assert.match(snapshots, /ADD COLUMN report_json/);
});

test("weekly approval accepts only the three issue-specific files", () => {
  const allowed = [
    "A\tsrc/data/research-runs/2026-08-24.candidates.json",
    "A\tsrc/data/research-runs/2026-08-24.run.json",
    "A\tsrc/data/reports/2026-08-24.json"
  ].join("\n");
  assert.equal(assertWeeklyDiff("2026-08-24", allowed).length, 3);
  assert.throws(() => assertWeeklyDiff("2026-08-24", `${allowed}\nM\t.github/workflows/ci.yml`), /unsafe or incomplete/);
  assert.throws(() => assertWeeklyDiff("2026-08-24", allowed.replace("A\tsrc/data/reports", "D\tsrc/data/reports")), /Invalid entries/);
});

test("Codex execution strips every API-key override and matches a resumable receipt", () => {
  assert.deepEqual(chatGptOnlyEnvironment({ OPENAI_API_KEY: "one", CODEX_API_KEY: "two", SAFE: "yes" }), { SAFE: "yes" });
  const receipt: DraftReceipt = {
    schemaVersion: 1,
    issueDate: "2026-08-24",
    pullRequest: 42,
    branch: "research-2026-08-24",
    previousSha: "a".repeat(40),
    expectedVersion: 3,
    newSha: "b".repeat(40),
    idempotencyKey: "123e4567-e89b-42d3-a456-426614174000",
    responses: [],
    report: shellReport,
    summary: "Prepared draft",
    createdAt: "2026-08-24T12:00:00.000Z"
  };
  assert.equal(matchesReconciliation(receipt, {
    number: 42, headRefName: receipt.branch, headRefOid: receipt.newSha
  }, { issue: { draft_sha: receipt.previousSha, version: 3 } }), true);
  assert.equal(matchesReconciliation(receipt, {
    number: 42, headRefName: receipt.branch, headRefOid: "c".repeat(40)
  }, { issue: { draft_sha: receipt.previousSha, version: 3 } }), false);
});

test("review shell exposes comment editing and orphaned-anchor warnings", () => {
  const html = reviewShell({
    issueDate: "2026-08-24", previewSha: "a".repeat(40), state: "in-review", csrf: "safe",
    email: "reviewer@example.org", report: shellReport, siteOrigin: "https://site.example.org"
  });
  assert.match(html, /Edit this instruction before submission/);
  assert.match(html, /anchor no longer appears in the current report/);
  assert.match(html, /data-review-anchor/);
  assert.match(html, /selectField\(target\)/);
  assert.match(html, /idempotencyKey:crypto\.randomUUID\(\)/);
});

test("collection deletes stale issue artifacts before a rerun", async () => {
  const workflow = await readFile(".github/workflows/collect-weekly-sources.yml", "utf8");
  const removal = workflow.indexOf("Remove stale issue artifacts");
  const collection = workflow.indexOf("Collect source candidates");
  assert.ok(removal > 0 && collection > removal);
  assert.match(workflow, /rm -f .*\.candidates\.json.*\.run\.json/);
});

test("collection refreshes its branch and publishes a pre-Codex source audit", async () => {
  const workflow = await readFile(".github/workflows/collect-weekly-sources.yml", "utf8");
  assert.match(workflow, /git merge --no-edit origin\/main/);
  assert.match(workflow, /npm run research:audit/);
  assert.match(workflow, /source-audit\.md/);
  assert.match(workflow, /gh pr (create|edit).*--body-file/s);
  assert.equal(workflow.match(/steps\.audit\.outcome == 'failure'/g)?.length, 3);
});

test("runner retains its receipt until checked idempotent GitHub finalization succeeds", async () => {
  const runner = await readFile("scripts/review/weekly-draft.ts", "utf8");
  assert.match(runner, /await requireCommand\("gh", editArguments\)/);
  assert.match(runner, /proterra-draft-ready:\$\{sha\}/);
  const commentFinalization = runner.indexOf('const comments = await requireCommand("gh"');
  const labelFinalization = runner.indexOf('await requireCommand("gh", editArguments)');
  assert.ok(commentFinalization > 0 && labelFinalization > commentFinalization);
  const finalization = runner.indexOf("await markPullRequestReady(pullRequest, result.summary, newSha)");
  const receiptRemoval = runner.indexOf("await rm(receiptPath, { force: true })", finalization);
  assert.ok(finalization > 0 && receiptRemoval > finalization);
});

test("approval CI uses the guarded PR run and preserves a resumable prepared commit", async () => {
  const workflow = await readFile(".github/workflows/approve-weekly-brief.yml", "utf8");
  assert.doesNotMatch(workflow, /gh workflow run ci\.yml/);
  assert.match(workflow, /--event pull_request/);
  assert.match(workflow, /\/authorize-ci/);
  assert.match(workflow, /approval_commit_sha/);
  assert.match(workflow, /status:\"running\",approvalCommitSha/);
  assert.match(workflow, /Approval workflow paused and can be safely retried/);
});

test("known coverage gaps stop before Codex unless an editorial lead explicitly overrides", async () => {
  const manifest = {
    schemaVersion: 1 as const,
    issueDate: "2026-08-24",
    startedAt: "2026-08-24T12:00:00.000Z",
    completedAt: "2026-08-24T12:01:00.000Z",
    status: "success" as const,
    candidateCount: 5,
    candidatesBeforeDeduplication: 5,
    newsCandidateCount: 5,
    datasetCandidateCount: 0,
    clusterCount: 5,
    adapters: [],
    manualSources: [],
    editorialReadiness: "coverage-gap" as const,
    newsReadiness: "ready" as const,
    coverageGaps: ["No relevant bovine-genetics candidate was collected."],
    coverage: { sectors: {}, geographies: {}, languages: {} },
    warnings: []
  };
  assert.throws(() => assertQueueMayDraft(manifest, "source-ready", false), /Codex was not started/);
  assert.doesNotThrow(() => assertQueueMayDraft(manifest, "source-ready", true));
  assert.doesNotThrow(() => assertQueueMayDraft(manifest, "changes-requested", false));

  // The news-led minimum is not waivable by the coverage override.
  const newsShort = { ...manifest, newsReadiness: "insufficient-news" as const, newsCandidateCount: 3 };
  assert.throws(() => assertQueueMayDraft(newsShort, "source-ready", true), /news-led minimum/);
  assert.throws(() => assertQueueMayDraft(newsShort, "changes-requested", false), /news-led minimum/);

  const normalPrompt = buildDraftPrompt(manifest.issueDate, manifest, false);
  const overridePrompt = buildDraftPrompt(manifest.issueDate, manifest, true);
  assert.match(normalPrompt, /EDITORIAL_OVERRIDE \{"approved":false,"scope":"none"/);
  assert.match(overridePrompt, /EDITORIAL_OVERRIDE \{"approved":true,"scope":"manifest-readiness-only"/);
  assert.match(overridePrompt, /No relevant bovine-genetics candidate was collected/);
  assert.match(overridePrompt, /Do not return coverage-gap solely because the manifest is not editorially ready/);
  assert.match(overridePrompt, /does not authorize filler, invented evidence, unsupported claims/);
  assert.match(overridePrompt, /\.review\/evidence\.json as the complete, deterministically extracted evidence universe/);
  assert.match(overridePrompt, /Do not browse, search the web, use curl/);
  assert.match(overridePrompt, /relatedUrls show grouped coverage, not necessarily independent corroboration/);
  assert.match(overridePrompt, /only independentPublisherCount counts separate publisher groups/);
  assert.match(overridePrompt, /Do not run npm, tests, validation, Git commands/);
  const policy = await readFile("automation/source-review-prompt.md", "utf8");
  assert.match(policy, /scope: "manifest-readiness-only"/);
  assert.match(policy, /does not authorize filler, invented evidence, unsupported claims/);

  const runner = await readFile("scripts/review/weekly-draft.ts", "utf8");
  const guard = runner.indexOf("assertQueueMayDraft(manifest");
  const prompt = runner.indexOf("buildDraftPrompt(issueDate, manifest, editorialOverrideApproved)");
  const codex = runner.indexOf('await run("codex"', prompt);
  assert.ok(guard > 0 && prompt > guard && codex > prompt);
  assert.match(runner, /sandbox_workspace_write\.network_access=false/);
  assert.match(runner, /tools\.web_search=false/);
  assert.match(runner, /model_reasoning_effort=medium/);
  const savedDraft = runner.indexOf("Saved the generated draft locally before validation");
  const validation = runner.indexOf('await run("npm", ["run", "verify"]');
  assert.ok(savedDraft > codex && validation > savedDraft);
  assert.match(runner, /Reused the saved Codex draft for this exact source SHA and feedback revision/);
});

test("collector failure invalidates the previous GitHub and D1 source-ready queue", async () => {
  const workflow = await readFile(".github/workflows/collect-weekly-sources.yml", "utf8");
  const worker = await readFile("review-worker/src/index.ts", "utf8");
  assert.match(workflow, /collection-failed" \|\| api_status/);
  assert.match(workflow, /--remove-label source-review-ready/);
  assert.match(workflow, /always\(\) && \(steps\.manifest\.outputs\.status == 'failed'.*steps\.collector\.outcome == 'failure'.*steps\.manifest\.outcome == 'failure'.*steps\.audit\.outcome == 'failure'\)/);
  assert.match(worker, /state = 'failed'.*version = version \+ 1/s);
  assert.match(worker, /transition_key LIKE 'collection-failed:%'/);
});

test("malformed collection output triggers every failure cleanup path", async () => {
  assert.throws(
    () => validateCollectionOutput("{ malformed", "{}", "2026-08-24"),
    /Candidate artifact is not valid JSON/
  );
  const workflow = await readFile(".github/workflows/collect-weekly-sources.yml", "utf8");
  assert.match(workflow, /scripts\/collection\/validate-output\.ts/);
  assert.equal(workflow.match(/steps\.manifest\.outcome == 'failure'/g)?.length, 3);
  assert.equal(workflow.match(/steps\.collector\.outcome == 'failure'/g)?.length, 3);
});

test("automated reports use unique, headline-specific editorial images", async () => {
  const registry = JSON.parse(await readFile("src/data/editorial-images.json", "utf8")) as Array<{
    id: string;
    subjects: string[];
  }>;
  assert.ok(registry.length >= 10);
  assert.equal(new Set(registry.map((image) => image.id)).size, registry.length);
  assert.ok(registry.every((image) => image.subjects.length >= 2));
  assert.ok(registry.some((image) => image.id === "milk-powder" && image.subjects.includes("nonfat dry milk")));
  assert.ok(registry.some((image) => image.id === "beef-retail" && image.subjects.includes("beef promotion")));
  assert.ok(registry.some((image) => image.id === "beef-processing" && image.subjects.includes("boxed beef")));

  const policy = await readFile("automation/weekly-report-prompt.md", "utf8");
  assert.match(policy, /src\/data\/editorial-images\.json/);
  assert.match(policy, /one unique editorial `imageId` per story/);

  const policyImages = new Map([
    ["milk-powder", { subjects: ["nonfat dry milk", "milk powder"] }],
    ["butter-output", { subjects: ["butter", "butter prices"] }]
  ]);
  assert.doesNotThrow(() => assertEditorialImageAssignments([
    { rank: 1, headline: "Nonfat dry milk leads the week", imageId: "milk-powder" }
  ], policyImages, "test-report"));
  assert.doesNotThrow(() => assertEditorialImageAssignments([
    { rank: 1, headline: "Temporary allowance for beef import shipments", imageId: "cattle-loading" }
  ], new Map([["cattle-loading", { subjects: ["cattle imports"] }]]), "test-report"));
  assert.throws(() => assertEditorialImageAssignments([
    { rank: 1, headline: "Nonfat dry milk leads the week", imageId: "butter-output" }
  ], policyImages, "test-report"), /does not match a declared subject/);
  assert.throws(() => assertEditorialImageAssignments([
    { rank: 1, headline: "Nonfat dry milk leads the week", imageId: "milk-powder" },
    { rank: 2, headline: "Milk powder exports rise", imageId: "milk-powder" }
  ], policyImages, "test-report"), /different editorial image/);
});
