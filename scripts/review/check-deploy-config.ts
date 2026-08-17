import { readFile } from "node:fs/promises";

const unresolved: string[] = [];

for (const path of ["review-worker/wrangler.jsonc", "public/_headers"]) {
  const contents = await readFile(path, "utf8");
  for (const match of contents.matchAll(/REPLACE_WITH_[A-Z0-9_]+/g)) {
    unresolved.push(`${path}: ${match[0]}`);
  }
}

if (unresolved.length) {
  throw new Error(`Deployment configuration still contains placeholders:\n${unresolved.join("\n")}`);
}

process.stdout.write("Review Worker and preview framing configuration contain no unresolved placeholders.\n");
