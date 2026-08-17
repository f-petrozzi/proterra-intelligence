import { access, chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { z } from "zod";
import { runManifestSchema, type RunManifest } from "../collection/types";

const issuePattern = /^research-(\d{4}-\d{2}-\d{2})$/;
const shaPattern = /^[a-f0-9]{40}$/;
const resultSchema = z.object({
  status: z.enum(["draft-ready", "coverage-gap"]),
  summary: z.string().min(1).max(4000),
  commentResponses: z.array(z.object({ commentId: z.uuid(), response: z.string().min(1).max(2000) }))
});
const receiptSchema = z.object({
  schemaVersion: z.literal(1),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  pullRequest: z.number().int().positive(),
  branch: z.string().regex(/^research-\d{4}-\d{2}-\d{2}$/),
  previousSha: z.string().regex(/^[a-f0-9]{40}$/),
  expectedVersion: z.number().int().positive(),
  newSha: z.string().regex(/^[a-f0-9]{40}$/),
  idempotencyKey: z.uuid(),
  responses: resultSchema.shape.commentResponses,
  summary: z.string().min(1).max(4000),
  createdAt: z.iso.datetime()
});
export type DraftReceipt = z.infer<typeof receiptSchema>;

type CommandResult = { stdout: string; stderr: string; code: number };

export function chatGptOnlyEnvironment(source: NodeJS.ProcessEnv = process.env) {
  const environment = { ...source };
  delete environment.OPENAI_API_KEY;
  delete environment.CODEX_API_KEY;
  return environment;
}

export function matchesReconciliation(receipt: DraftReceipt, pullRequest: any, context: any) {
  return receipt.pullRequest === pullRequest.number
    && receipt.branch === pullRequest.headRefName
    && receipt.newSha === pullRequest.headRefOid
    && receipt.previousSha === context.issue.draft_sha
    && receipt.expectedVersion === context.issue.version;
}

export function assertQueueMayDraft(manifest: RunManifest, issueState: string, allowCoverageGap: boolean) {
  if (manifest.status === "failed") {
    throw new Error("The collection manifest is failed; repair and rerun source collection before drafting.");
  }
  if (issueState === "source-ready" && manifest.editorialReadiness === "coverage-gap" && !allowCoverageGap) {
    throw new Error(
      `The source queue has known coverage gaps, so Codex was not started: ${manifest.coverageGaps.join(" ")} `
      + "Add a defensible manual lead and rerun collection, or have the editorial lead deliberately run "
      + "npm run weekly:draft -- --allow-coverage-gap."
    );
  }
}

export function buildDraftPrompt(issueDate: string, manifest: RunManifest, editorialOverrideApproved: boolean) {
  const override = editorialOverrideApproved
    ? {
        approved: true,
        scope: "manifest-readiness-only",
        acceptedCoverageGaps: manifest.coverageGaps
      }
    : { approved: false, scope: "none", acceptedCoverageGaps: [] };
  return [
    `Prepare the Proterra Intelligence weekly draft for ${issueDate}.`,
    "Follow automation/source-review-prompt.md.",
    `EDITORIAL_OVERRIDE ${JSON.stringify(override)}`,
    editorialOverrideApproved
      ? "The editorial lead accepts only the listed manifest coverage gaps. Do not return coverage-gap solely because the manifest is not editorially ready or because of those accepted gaps. This does not authorize filler, invented evidence, unsupported claims, weakened source verification, or a schema-invalid report. Return coverage-gap if the available credible evidence still cannot support a valid report."
      : "No editorial override is approved; apply every normal readiness and coverage rule.",
    `Read candidates locally from src/data/research-runs/${issueDate}.candidates.json and submitted feedback only from .review/feedback.json.`,
    `Edit only src/data/reports/${issueDate}.json. Do not commit or push.`
  ].join("\n");
}

export function run(command: string, args: string[], options: { cwd?: string; inherit?: boolean; env?: NodeJS.ProcessEnv } = {}) {
  return new Promise<CommandResult>((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: options.inherit ? "inherit" : ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => resolveRun({ stdout, stderr, code: code ?? 1 }));
  });
}

async function requireCommand(command: string, args: string[], expected?: RegExp, options: { cwd?: string } = {}) {
  let result: CommandResult;
  try {
    result = await run(command, args, options);
  } catch (error) {
    throw new Error(`${command} is required but could not be started: ${error instanceof Error ? error.message : error}`);
  }
  if (result.code !== 0 || (expected && !expected.test(`${result.stdout}\n${result.stderr}`))) {
    throw new Error(`${command} ${args.join(" ")} failed its preflight check.\n${result.stderr || result.stdout}`.trim());
  }
  return result;
}

async function verifyChatGptAuthentication() {
  const environment = chatGptOnlyEnvironment();
  const status = await run("codex", ["login", "status"], { env: environment });
  if (status.code !== 0 || !/Logged in using ChatGPT/i.test(`${status.stdout}\n${status.stderr}`)) {
    throw new Error(`codex login status must report ChatGPT authentication.\n${status.stderr || status.stdout}`.trim());
  }
  if (/API key/i.test(`${status.stdout}\n${status.stderr}`)) {
    throw new Error("Codex must use locally stored ChatGPT authentication, not API-key authentication.");
  }
  const authFile = resolve(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "auth.json");
  try {
    const metadata = await stat(authFile);
    if ((metadata.mode & 0o077) !== 0) {
      await chmod(authFile, 0o600);
      process.stdout.write(`Restricted ${authFile} to user-only permissions.\n`);
    }
  } catch {
    // Some platforms keep credentials in an OS credential store instead of auth.json.
  }
}

async function reviewRequest(path: string, init?: RequestInit) {
  const base = process.env.REVIEW_API_URL?.replace(/\/$/, "");
  const clientId = process.env.REVIEW_ACCESS_CLIENT_ID;
  const clientSecret = process.env.REVIEW_ACCESS_CLIENT_SECRET;
  const serviceKey = process.env.REVIEW_SERVICE_KEY;
  if (!base || !clientId || !clientSecret || !serviceKey) {
    throw new Error("REVIEW_API_URL, REVIEW_ACCESS_CLIENT_ID, REVIEW_ACCESS_CLIENT_SECRET, and REVIEW_SERVICE_KEY are required.");
  }
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "CF-Access-Client-Id": clientId,
      "CF-Access-Client-Secret": clientSecret,
      "X-Review-Service-Key": serviceKey,
      ...init?.headers
    }
  });
  if (!response.ok) throw new Error(`Review service ${path} failed (${response.status}): ${await response.text()}`);
  return response.json() as Promise<any>;
}

async function actionablePullRequest() {
  const labels = ["source-review-ready", "changes-requested"];
  const found = new Map<number, any>();
  for (const label of labels) {
    const result = await requireCommand("gh", ["pr", "list", "--state", "open", "--label", label, "--json", "number,headRefName,headRefOid,url,labels"]);
    for (const pullRequest of JSON.parse(result.stdout) as any[]) found.set(pullRequest.number, pullRequest);
  }
  if (found.size !== 1) throw new Error(`Expected exactly one actionable weekly pull request; found ${found.size}.`);
  const pullRequest = [...found.values()][0];
  if (!issuePattern.test(pullRequest.headRefName) || !shaPattern.test(pullRequest.headRefOid)) {
    throw new Error("The actionable pull request does not use a valid research branch or head SHA.");
  }
  return pullRequest;
}

async function apiAgentResult(issueDate: string, payload: unknown) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await reviewRequest(`/api/internal/issues/${issueDate}/agent-result`, { method: "POST", body: JSON.stringify(payload) });
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 1000));
    }
  }
  throw lastError;
}

async function loadReceipt(path: string) {
  try {
    return receiptSchema.parse(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error(`Invalid reconciliation receipt at ${path}: ${error instanceof Error ? error.message : error}`);
  }
}

async function markPullRequestReady(pullRequest: any, summary: string, sha: string, reconciled = false) {
  const labels = await requireCommand("gh", ["pr", "view", String(pullRequest.number), "--json", "labels", "--jq", ".labels[].name"]);
  const currentLabels = new Set(labels.stdout.split("\n").map((label) => label.trim()).filter(Boolean));
  const editArguments = ["pr", "edit", String(pullRequest.number), "--add-label", "brief-review-ready"];
  for (const label of ["source-review-ready", "changes-requested"]) {
    if (currentLabels.has(label)) editArguments.push("--remove-label", label);
  }
  const marker = `<!-- proterra-draft-ready:${sha} -->`;
  const comments = await requireCommand("gh", ["pr", "view", String(pullRequest.number), "--json", "comments", "--jq", ".comments[].body"]);
  if (!comments.stdout.includes(marker)) {
    await requireCommand("gh", ["pr", "comment", String(pullRequest.number), "--body",
      `${marker}\n${summary}\n\nValidated draft: \`${sha}\`. ${reconciled ? "Recovered the pending review-state handoff. " : ""}Waiting for the exact Cloudflare preview deployment before reviewers are notified.`]);
  }
  await requireCommand("gh", editArguments);
}

async function main() {
  const arguments_ = process.argv.slice(2);
  const unknownArguments = arguments_.filter((argument) => argument !== "--allow-coverage-gap");
  if (unknownArguments.length > 0) throw new Error(`Unknown weekly:draft option: ${unknownArguments.join(", ")}`);
  const allowCoverageGap = arguments_.includes("--allow-coverage-gap");
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 24 || (major === 24 && minor < 19)) throw new Error(`Node 24.19 or newer is required; found ${process.version}.`);
  await requireCommand("git", ["--version"]);
  await requireCommand("git", ["config", "user.name"], /\S/);
  await requireCommand("git", ["config", "user.email"], /\S/);
  await requireCommand("gh", ["auth", "status"]);
  await verifyChatGptAuthentication();

  const dirty = await run("git", ["status", "--porcelain"]);
  if (dirty.stdout.trim()) process.stdout.write("Warning: the primary checkout has unrelated changes; the isolated worktree will not modify them.\n");

  const pullRequest = await actionablePullRequest();
  const match = issuePattern.exec(pullRequest.headRefName)!;
  const issueDate = match[1];
  const receiptDirectory = resolve(".review", "receipts");
  const receiptPath = resolve(receiptDirectory, `${issueDate}.json`);
  const context = await reviewRequest(`/api/internal/issues/${issueDate}/agent-context`);
  const pendingReceipt = await loadReceipt(receiptPath);
  if (context.issue.branch !== pullRequest.headRefName || context.issue.draft_sha !== pullRequest.headRefOid) {
    if (!pendingReceipt || !matchesReconciliation(pendingReceipt, pullRequest, context)) {
      throw new Error("GitHub and the review service disagree about the actionable draft SHA, and no matching reconciliation receipt exists.");
    }
    await apiAgentResult(issueDate, {
      previousSha: pendingReceipt.previousSha,
      expectedVersion: pendingReceipt.expectedVersion,
      newSha: pendingReceipt.newSha,
      idempotencyKey: pendingReceipt.idempotencyKey,
      responses: pendingReceipt.responses
    });
    await markPullRequestReady(pullRequest, pendingReceipt.summary, pendingReceipt.newSha, true);
    await rm(receiptPath, { force: true });
    process.stdout.write(`Reconciled pushed draft ${pendingReceipt.newSha} with the review service. No Codex run was needed.\n`);
    return;
  }
  if (pendingReceipt && pendingReceipt.newSha === pullRequest.headRefOid) {
    await markPullRequestReady(pullRequest, pendingReceipt.summary, pendingReceipt.newSha, true);
    await rm(receiptPath, { force: true });
    process.stdout.write(`Reconciled GitHub labels and draft-ready comment for ${pendingReceipt.newSha}. No Codex run was needed.\n`);
    return;
  }

  const tempRoot = await mkdtemp(join(tmpdir(), `proterra-intelligence-${issueDate}-`));
  const worktree = join(tempRoot, "worktree");
  let worktreeAdded = false;
  try {
    await requireCommand("git", ["fetch", "origin", pullRequest.headRefName]);
    const add = await run("git", ["worktree", "add", "--detach", worktree, `origin/${pullRequest.headRefName}`], { inherit: true });
    if (add.code !== 0) throw new Error("Unable to create the isolated research worktree.");
    worktreeAdded = true;

    const candidatesPath = resolve(worktree, "src", "data", "research-runs", `${issueDate}.candidates.json`);
    const manifestPath = resolve(worktree, "src", "data", "research-runs", `${issueDate}.run.json`);
    await Promise.all([access(candidatesPath), access(manifestPath)]);
    const manifest = runManifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")));
    if (manifest.issueDate !== issueDate) throw new Error("The collection manifest does not match the actionable issue date.");
    if (!["source-ready", "changes-requested"].includes(String(context.issue.state))) {
      throw new Error(`The review issue is not actionable from state ${context.issue.state}.`);
    }
    assertQueueMayDraft(manifest, String(context.issue.state), allowCoverageGap);
    const editorialOverrideApproved = manifest.editorialReadiness === "coverage-gap"
      && (allowCoverageGap || context.issue.state === "changes-requested");
    if (manifest.editorialReadiness === "coverage-gap" && allowCoverageGap) {
      process.stdout.write("Editorial lead override accepted for the documented coverage gaps.\n");
    }
    const checkedOutSha = (await requireCommand("git", ["rev-parse", "HEAD"], undefined, { cwd: worktree })).stdout.trim();
    if (checkedOutSha !== pullRequest.headRefOid) throw new Error("The research branch changed while the runner was starting; rerun against the latest revision.");
    const reviewDirectory = resolve(worktree, ".review");
    await mkdir(reviewDirectory, { recursive: true });
    await writeFile(resolve(reviewDirectory, "feedback.json"), `${JSON.stringify({
      issueDate, sourceSha: context.issue.draft_sha, version: context.issue.version,
      batches: context.batches, batchItems: context.batchItems
    }, null, 2)}\n`, { mode: 0o600 });

    const install = await run("npm", ["ci"], { cwd: worktree, inherit: true });
    if (install.code !== 0) throw new Error("npm ci failed in the isolated worktree.");

    const prompt = buildDraftPrompt(issueDate, manifest, editorialOverrideApproved);
    const codex = await run("codex", [
      "exec", "--sandbox", "workspace-write", "--output-schema", "automation/codex-result.schema.json",
      "--output-last-message", ".review/codex-result.json", prompt
    ], { cwd: worktree, inherit: true, env: chatGptOnlyEnvironment() });
    if (codex.code !== 0) throw new Error("Codex did not complete successfully. The research branch was not changed.");

    const result = resultSchema.parse(JSON.parse(await readFile(resolve(reviewDirectory, "codex-result.json"), "utf8")));
    if (result.status === "coverage-gap") throw new Error(`Codex reported insufficient coverage: ${result.summary}`);
    const expectedComments = new Set((context.batchItems as any[]).map((item) => item.comment_id));
    const returnedComments = new Set(result.commentResponses.map((item) => item.commentId));
    if (expectedComments.size !== returnedComments.size || [...expectedComments].some((id) => !returnedComments.has(id))) {
      throw new Error("Codex did not return a disposition for every immutable feedback item.");
    }

    const reportPath = `src/data/reports/${issueDate}.json`;
    const changed = await requireCommand("git", ["status", "--porcelain", "--untracked-files=all"], undefined, { cwd: worktree });
    const changedPaths = changed.stdout.split("\n").filter(Boolean).map((line) => line.slice(3));
    if (changedPaths.length !== 1 || changedPaths[0] !== reportPath) {
      throw new Error(`Codex changed unexpected paths: ${changedPaths.join(", ") || "none"}.`);
    }
    const verify = await run("npm", ["run", "verify"], { cwd: worktree, inherit: true });
    if (verify.code !== 0) throw new Error("Draft validation failed; nothing was pushed.");

    await requireCommand("git", ["add", reportPath], undefined, { cwd: worktree });
    const commit = await run("git", ["commit", "-m", `content: prepare weekly brief ${issueDate}`], { cwd: worktree, inherit: true });
    if (commit.code !== 0) throw new Error("Unable to commit the validated draft.");
    const newSha = (await requireCommand("git", ["rev-parse", "HEAD"], undefined, { cwd: worktree })).stdout.trim();
    const receipt: DraftReceipt = {
      schemaVersion: 1,
      issueDate,
      pullRequest: pullRequest.number,
      branch: pullRequest.headRefName,
      previousSha: context.issue.draft_sha,
      expectedVersion: context.issue.version,
      newSha,
      idempotencyKey: crypto.randomUUID(),
      responses: result.commentResponses,
      summary: result.summary,
      createdAt: new Date().toISOString()
    };
    await mkdir(receiptDirectory, { recursive: true });
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
    const push = await run("git", ["push", "origin", `HEAD:refs/heads/${pullRequest.headRefName}`], { cwd: worktree, inherit: true });
    if (push.code !== 0) {
      await rm(receiptPath, { force: true });
      throw new Error("Push failed; the remote branch and review state were not changed.");
    }

    try {
      await apiAgentResult(issueDate, {
        previousSha: receipt.previousSha,
        expectedVersion: receipt.expectedVersion,
        newSha: receipt.newSha,
        idempotencyKey: receipt.idempotencyKey,
        responses: receipt.responses
      });
    } catch (error) {
      throw new Error(`Draft ${newSha} was pushed, but review-state reporting failed. Rerun npm run weekly:draft to reconcile from ${receiptPath}. ${error instanceof Error ? error.message : error}`);
    }
    await markPullRequestReady(pullRequest, result.summary, newSha);
    await rm(receiptPath, { force: true });
    process.stdout.write(`Draft ${issueDate} pushed successfully. Reviewers will be emailed after Cloudflare deploys ${newSha}.\n`);
  } finally {
    if (worktreeAdded) await run("git", ["worktree", "remove", "--force", worktree]);
    await rm(tempRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
