import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getArgument, getSiteUrl, hasFlag, loadReport } from "./report";
import { getEmailSubject, renderWeeklyBrief } from "./render";

const report = loadReport(getArgument("report"));
const siteUrl = getSiteUrl();
const { html, text } = await renderWeeklyBrief(report, siteUrl);

if (!hasFlag("check")) {
  const outputDirectory = resolve("email-preview");
  mkdirSync(outputDirectory, { recursive: true });
  writeFileSync(resolve(outputDirectory, `${report.slug}.html`), html);
  writeFileSync(resolve(outputDirectory, `${report.slug}.txt`), text);
  console.log(`Email preview written to email-preview/${report.slug}.html`);
}

console.log(`Validated issue ${report.slug}: ${getEmailSubject(report)}`);
