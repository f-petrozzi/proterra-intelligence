import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getArgument, getSiteUrl, hasFlag } from "./report";
import { getDigestSubject, renderDigest } from "./render";
import { digestId, loadDigest } from "./digest";

const reports = loadDigest(getArgument("report"));
const siteUrl = getSiteUrl();
const { html, text } = await renderDigest(reports, siteUrl);
const id = digestId(reports);

if (!hasFlag("check")) {
  const outputDirectory = resolve("email-preview");
  mkdirSync(outputDirectory, { recursive: true });
  writeFileSync(resolve(outputDirectory, `${id}.html`), html);
  writeFileSync(resolve(outputDirectory, `${id}.txt`), text);
  console.log(`Email preview written to email-preview/${id}.html`);
}

console.log(`Validated digest ${id}: ${getDigestSubject(reports)}`);
