import assert from "node:assert/strict";
import { chmod, copyFile, mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadScheduledEnvironment } from "../../scripts/review/scheduled-environment";
import { selectWeeklyPullRequest, scheduledIssueIsIdle } from "../../scripts/review/weekly-draft";

const pullRequest = { number: 1, headRefName: "research-2026-08-24", headRefOid: "a".repeat(40) };
const execute = promisify(execFile);

test("shared shell entry point skips a held lock and preserves failures after release", async () => {
  const directory = await mkdtemp(join(tmpdir(), "proterra-lock-test-"));
  let holder: ReturnType<typeof spawn> | undefined;
  try {
    await mkdir(join(directory, "scripts/review"), { recursive: true });
    await mkdir(join(directory, ".review"));
    await mkdir(join(directory, "bin"));
    const wrapper = join(directory, "scripts/review/run-weekly-draft.sh");
    await copyFile("scripts/review/run-weekly-draft.sh", wrapper);
    await writeFile(join(directory, "bin/node"), "#!/bin/bash\nexit 17\n", { mode: 0o700 });
    const environment = { ...process.env, PATH: `${directory}/bin:${process.env.PATH}` };
    holder = spawn("flock", ["--exclusive", join(directory, ".review/weekly-draft.lock"),
      "bash", "-c", "printf 'locked\\n'; read -r release"], { stdio: ["pipe", "pipe", "pipe"] });
    await once(holder.stdout!, "data");
    const skipped = await execute("bash", [wrapper, "--scheduled"], { env: environment });
    assert.match(skipped.stdout, /already running; skipped/);
    const closed = once(holder, "close");
    holder.stdin!.end("release\n");
    await closed;
    await assert.rejects(execute("bash", [wrapper, "--scheduled"], { env: environment }), (error: any) => {
      assert.equal(error.code, 17);
      assert.match(error.stdout, /finished \(exit 17\)/);
      return true;
    });
  } finally {
    holder?.stdin?.end("release\n");
    await rm(directory, { recursive: true, force: true });
  }
});

test("scheduled discovery idles on no queues and deduplicates overlapping labels", () => {
  assert.equal(selectWeeklyPullRequest([], true), undefined);
  assert.throws(() => selectWeeklyPullRequest([]), /exactly one/);
  assert.deepEqual(selectWeeklyPullRequest([pullRequest, pullRequest], true), pullRequest);
});

test("scheduled discovery refuses ambiguous or malformed queues", () => {
  assert.throws(() => selectWeeklyPullRequest([pullRequest, { ...pullRequest, number: 2 }], true), /chronologically/);
  assert.throws(() => selectWeeklyPullRequest([{ ...pullRequest, headRefName: "main" }], true), /valid research branch/);
  assert.throws(() => selectWeeklyPullRequest([{ ...pullRequest, headRefOid: "invalid" }], true), /valid research branch/);
});

test("scheduled polling skips review/publication but never hides failed or unknown states", () => {
  for (const state of ["in-review", "approved", "publishing", "published"]) {
    assert.equal(scheduledIssueIsIdle(state, true), true);
    assert.equal(scheduledIssueIsIdle(state, false), false);
  }
  for (const state of ["source-ready", "changes-requested", "failed", "unknown"]) {
    assert.equal(scheduledIssueIsIdle(state, true), false);
  }
});

test("scheduled secrets require a protected owned regular file and load only allowed keys as data", async () => {
  const directory = await mkdtemp(join(tmpdir(), "proterra-env-test-"));
  const path = join(directory, "review.env");
  const environment: NodeJS.ProcessEnv = { PROTERRA_REVIEW_ENV_FILE: path, PATH: "/original" };
  try {
    await writeFile(path, [
      "REVIEW_API_URL='https://review.example.com'", "REVIEW_ACCESS_CLIENT_ID='id'",
      "REVIEW_ACCESS_CLIENT_SECRET='$(this-is-not-executed)'", "REVIEW_SERVICE_KEY='key'",
      "PATH='/untrusted'"
    ].join("\n"), { mode: 0o600 });
    await loadScheduledEnvironment(environment);
    assert.equal(environment.REVIEW_API_URL, "https://review.example.com");
    assert.equal(environment.REVIEW_ACCESS_CLIENT_SECRET, "$(this-is-not-executed)");
    assert.equal(environment.PATH, "/original");
    await chmod(path, 0o644);
    await assert.rejects(loadScheduledEnvironment(environment), /mode 0600/);
    await chmod(path, 0o600);
    const link = join(directory, "link.env");
    await symlink(path, link);
    await assert.rejects(loadScheduledEnvironment({ PROTERRA_REVIEW_ENV_FILE: link }));
    await writeFile(path, "REVIEW_API_URL='https://review.example.com'\n");
    await assert.rejects(loadScheduledEnvironment(environment), /missing REVIEW_ACCESS_CLIENT_ID/);
    const notFile = join(directory, "directory.env");
    await mkdir(notFile, { mode: 0o600 });
    await assert.rejects(loadScheduledEnvironment({ PROTERRA_REVIEW_ENV_FILE: notFile }), /regular file/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
