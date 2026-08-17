import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const issueDate = process.argv[2];

if (!issueDate || !/^\d{4}-\d{2}-\d{2}$/.test(issueDate)) {
  throw new Error("Usage: npm run report:approve -- YYYY-MM-DD");
}

const reportPath = resolve("src", "data", "reports", `${issueDate}.json`);
const report = JSON.parse(await readFile(reportPath, "utf8")) as {
  slug?: string;
  publishedAt?: string;
  issueNumber?: number;
  status?: string;
  items?: Array<{ rank?: number; reviewStatus?: string }>;
};

if (report.slug !== issueDate || report.publishedAt !== issueDate) {
  throw new Error(`${reportPath}: slug and publishedAt must match ${issueDate}.`);
}

if (report.status !== "draft") {
  throw new Error(`${reportPath}: expected a draft report, found "${report.status ?? "missing"}".`);
}

if (!Array.isArray(report.items) || report.items.length === 0) {
  throw new Error(`${reportPath}: report has no reviewable items.`);
}

const dismissedRanks = report.items
  .filter((item) => item.reviewStatus === "dismissed")
  .map((item) => item.rank)
  .join(", ");

if (dismissedRanks) {
  throw new Error(`${reportPath}: dismissed items cannot be approved (ranks ${dismissedRanks}).`);
}

const unknownStatuses = report.items
  .filter((item) => !["new", "shortlisted", "reviewed"].includes(item.reviewStatus ?? ""))
  .map((item) => `${item.rank ?? "?"}:${item.reviewStatus ?? "missing"}`)
  .join(", ");

if (unknownStatuses) {
  throw new Error(`${reportPath}: unsupported review statuses (${unknownStatuses}).`);
}

report.status = "approved";
report.items = report.items.map((item) => ({ ...item, reviewStatus: "reviewed" }));

await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(`Approved Issue ${String(report.issueNumber ?? "").padStart(2, "0")} (${issueDate}).`);
