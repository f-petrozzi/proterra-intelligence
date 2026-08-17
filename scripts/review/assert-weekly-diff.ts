import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const issueDatePattern = /^\d{4}-\d{2}-\d{2}$/;

export function expectedWeeklyPaths(issueDate: string) {
  if (!issueDatePattern.test(issueDate)) throw new Error("Issue date must use YYYY-MM-DD.");
  return [
    `src/data/research-runs/${issueDate}.candidates.json`,
    `src/data/research-runs/${issueDate}.run.json`,
    `src/data/reports/${issueDate}.json`
  ];
}

export function assertWeeklyDiff(issueDate: string, nameStatus: string) {
  const expected = expectedWeeklyPaths(issueDate);
  const entries = nameStatus.split("\n").filter(Boolean).map((line) => line.split("\t"));
  const invalid = entries.filter(([status, path, renamedPath]) =>
    !["A", "M"].includes(status) || Boolean(renamedPath) || !expected.includes(path)
  );
  const actual = entries.map(([, path]) => path).sort();
  const missing = expected.filter((path) => !actual.includes(path));
  const duplicate = actual.filter((path, index) => actual.indexOf(path) !== index);
  if (invalid.length || missing.length || duplicate.length || actual.length !== expected.length) {
    throw new Error([
      "Weekly pull request contains an unsafe or incomplete file set.",
      invalid.length ? `Invalid entries: ${invalid.map((entry) => entry.join(" -> ")).join(", ")}` : "",
      missing.length ? `Missing entries: ${missing.join(", ")}` : "",
      duplicate.length ? `Duplicate entries: ${duplicate.join(", ")}` : "",
      `Allowed entries: ${expected.join(", ")}`
    ].filter(Boolean).join("\n"));
  }
  return actual;
}

function git(args: string[]) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn("git", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr || `git exited ${code}`)));
  });
}

async function main() {
  const [issueDate, base = "origin/main", head = "HEAD"] = process.argv.slice(2);
  if (!issueDate) throw new Error("Usage: assert-weekly-diff.ts YYYY-MM-DD [base] [head]");
  const output = await git(["diff", "--name-status", "--find-renames", `${base}...${head}`]);
  const paths = assertWeeklyDiff(issueDate, output);
  process.stdout.write(`Weekly PR allowlist passed for ${paths.join(", ")}.\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
