import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Report } from "../../src/lib/content";

export type EditorialImage = {
  id: string;
  src: string;
  alt: string;
  creator: string;
  provider: string;
  license: string;
  sourceUrl: string;
};

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const reportDirectory = resolve(projectRoot, "src/data/reports");
const imagesFile = resolve(projectRoot, "src/data/editorial-images.json");
const issuePattern = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireText(record: Record<string, unknown>, field: string, context: string) {
  if (typeof record[field] !== "string" || record[field].length === 0) {
    throw new Error(`${context}: "${field}" must be a non-empty string.`);
  }
}

function assertReport(value: unknown, filename: string): asserts value is Report {
  if (!isRecord(value)) throw new Error(`${filename}: report must be an object.`);

  requireText(value, "slug", filename);
  requireText(value, "publishedAt", filename);
  requireText(value, "executiveSummary", filename);

  if (!issuePattern.test(value.slug as string)) {
    throw new Error(`${filename}: slug must use YYYY-MM-DD.`);
  }
  if (value.status !== "draft" && value.status !== "approved") {
    throw new Error(`${filename}: status must be draft or approved.`);
  }
  if (!Array.isArray(value.items) || value.items.length < 8 || value.items.length > 10) {
    throw new Error(`${filename}: report must contain 8 to 10 items.`);
  }

  value.items.forEach((candidate, index) => {
    const context = `${filename}: item ${index + 1}`;
    if (!isRecord(candidate)) throw new Error(`${context} must be an object.`);
    requireText(candidate, "headline", context);
    requireText(candidate, "summary", context);
    requireText(candidate, "whyItMatters", context);
    requireText(candidate, "imageId", context);
    if (candidate.rank !== index + 1) {
      throw new Error(`${context}: ranks must be consecutive and start at 1.`);
    }
    if (!Array.isArray(candidate.keyPoints) || candidate.keyPoints.length < 2) {
      throw new Error(`${context}: at least two key points are required.`);
    }
    if (!Array.isArray(candidate.citations) || candidate.citations.length === 0) {
      throw new Error(`${context}: at least one citation is required.`);
    }
    const primary = candidate.citations[0];
    if (!isRecord(primary)) throw new Error(`${context}: primary citation is invalid.`);
    requireText(primary, "title", context);
    requireText(primary, "url", context);
    const citationUrl = new URL(primary.url as string);
    if (citationUrl.protocol !== "https:") {
      throw new Error(`${context}: primary citation must use HTTPS.`);
    }
  });
}

function parseReport(filename: string) {
  const path = resolve(reportDirectory, filename);
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  assertReport(value, filename);
  if (`${value.slug}.json` !== filename) {
    throw new Error(`${filename}: filename must match report slug.`);
  }
  return value;
}

export function loadReport(requestedSlug?: string, requireApproved = false) {
  let report: Report | undefined;

  if (requestedSlug) {
    if (!issuePattern.test(requestedSlug)) {
      throw new Error("--report must use YYYY-MM-DD.");
    }
    report = parseReport(`${requestedSlug}.json`);
  } else {
    const filenames = readdirSync(reportDirectory)
      .filter((filename) => issuePattern.test(filename.replace(/\.json$/, "")) && filename.endsWith(".json"))
      .sort((a, b) => b.localeCompare(a));
    report = filenames.map(parseReport).find((candidate) => candidate.status === "approved");
  }

  if (!report) throw new Error("No approved weekly report was found.");
  if (requireApproved && report.status !== "approved") {
    throw new Error(`Issue ${report.slug} is a draft. Approve it before a production send.`);
  }
  return report;
}

export function loadEditorialImages() {
  const value: unknown = JSON.parse(readFileSync(imagesFile, "utf8"));
  if (!Array.isArray(value)) throw new Error("Editorial image registry must be an array.");

  return new Map(
    value.map((candidate, index) => {
      if (!isRecord(candidate)) throw new Error(`Editorial image ${index + 1} is invalid.`);
      for (const field of ["id", "src", "alt", "creator", "provider", "license", "sourceUrl"]) {
        requireText(candidate, field, `Editorial image ${index + 1}`);
      }
      return [(candidate as EditorialImage).id, candidate as EditorialImage] as const;
    })
  );
}

export function getArgument(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`--${name} requires a value.`);
  return value;
}

export function hasFlag(name: string) {
  return process.argv.includes(`--${name}`);
}

export function getSiteUrl() {
  const value = process.env.SITE_URL?.trim() || "https://proterra-signal.pages.dev";
  const url = new URL(value);
  if (url.protocol !== "https:" && url.hostname !== "localhost") {
    throw new Error("SITE_URL must use HTTPS unless it points to localhost.");
  }
  return value.replace(/\/$/, "");
}

export function formatIssueDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  }).format(new Date(`${value}T00:00:00Z`));
}

export function parseRecipients(value: string | undefined) {
  if (!value) return [];
  const recipients = value
    .split(/[;,\n]/)
    .map((recipient) => recipient.trim())
    .filter(Boolean);
  for (const recipient of recipients) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
      throw new Error(`Invalid recipient address: ${recipient}`);
    }
  }
  return [...new Set(recipients)];
}
