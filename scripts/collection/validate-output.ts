import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { candidateFileSchema, runManifestSchema } from "./types";

function parseJson(label: string, text: string) {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error instanceof Error ? error.message : error}`);
  }
}

export function validateCollectionOutput(candidateText: string, manifestText: string, expectedIssueDate: string) {
  const candidates = candidateFileSchema.parse(parseJson("Candidate artifact", candidateText));
  const manifest = runManifestSchema.parse(parseJson("Run manifest", manifestText));
  if (candidates.issueDate !== expectedIssueDate || manifest.issueDate !== expectedIssueDate) {
    throw new Error("Generated artifacts do not match the requested issue date.");
  }
  return { status: manifest.status, readiness: manifest.editorialReadiness };
}

async function main() {
  const [issueDate, candidatesPath, manifestPath] = process.argv.slice(2);
  if (!issueDate || !candidatesPath || !manifestPath) {
    throw new Error("Usage: validate-output.ts ISSUE_DATE CANDIDATES_PATH MANIFEST_PATH");
  }
  const [candidateText, manifestText] = await Promise.all([
    readFile(candidatesPath, "utf8"),
    readFile(manifestPath, "utf8")
  ]);
  const result = validateCollectionOutput(candidateText, manifestText, issueDate);
  process.stdout.write(`status=${result.status}\nreadiness=${result.readiness}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
