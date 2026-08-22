import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

type ImageRecord = { id: string; introducedForIssue?: string };
type ReportRecord = { slug?: string; items?: Array<{ imageId?: string }> };
type ImagePolicy = { schemaVersion: 1; growthTarget: number; avoidPreviousIssues: number };

export function createImageContext(
  images: ImageRecord[],
  reports: ReportRecord[],
  issueDate: string,
  policy: ImagePolicy
) {
  const previousReports = reports
    .filter((report) => typeof report.slug === "string" && report.slug < issueDate)
    .sort((left, right) => String(right.slug).localeCompare(String(left.slug)));
  const recentIssues = [...new Set(previousReports.map((report) => String(report.slug)))]
    .slice(0, policy.avoidPreviousIssues);

  const usage = new Map<string, string[]>();
  for (const report of previousReports) {
    for (const item of report.items ?? []) {
      if (!item.imageId) continue;
      const issues = usage.get(item.imageId) ?? [];
      issues.push(String(report.slug));
      usage.set(item.imageId, issues);
    }
  }

  const phase = images.length < policy.growthTarget ? "grow" : "rotate";
  const assets = images.map((image) => {
    const usedInIssues = usage.get(image.id) ?? [];
    const usedInRecentIssues = recentIssues.filter((date) => usedInIssues.includes(date));
    const introducedForCurrentIssue = image.introducedForIssue === issueDate;
    const assignmentPriority = introducedForCurrentIssue && phase === "grow"
      ? 0
      : usedInIssues.length === 0
        ? 1
        : usedInRecentIssues.length === 0
          ? 2
          : 3;
    return {
      id: image.id,
      introducedForIssue: image.introducedForIssue ?? null,
      introducedForCurrentIssue,
      usageCount: usedInIssues.length,
      lastUsedIssue: usedInIssues[0] ?? null,
      usedInRecentIssues,
      assignmentPriority
    };
  }).sort((left, right) => left.assignmentPriority - right.assignmentPriority
    || left.usageCount - right.usageCount
    || left.id.localeCompare(right.id));

  return {
    schemaVersion: 1,
    issueDate,
    phase,
    librarySize: images.length,
    growthTarget: policy.growthTarget,
    assetsNeededToRotate: Math.max(0, policy.growthTarget - images.length),
    avoidPreviousIssues: policy.avoidPreviousIssues,
    recentIssues,
    guidance: phase === "grow"
      ? "Match the headline subject first, then prefer a compatible asset introduced for this issue. Do not force an irrelevant new image."
      : "Match the headline subject first, then prefer the lowest-priority and least-used compatible asset.",
    assets
  };
}

export async function prepareImageContext(projectRoot: string, issueDate: string, outputPath: string) {
  const imagePath = resolve(projectRoot, "src/data/editorial-images.json");
  const reportsPath = resolve(projectRoot, "src/data/reports");
  const policyPath = resolve(projectRoot, "config/editorial-image-policy.json");
  const [images, policy, reportFiles] = await Promise.all([
    readFile(imagePath, "utf8").then((value) => JSON.parse(value) as ImageRecord[]),
    readFile(policyPath, "utf8").then((value) => JSON.parse(value) as ImagePolicy),
    readdir(reportsPath)
  ]);
  const reports = await Promise.all(reportFiles
    .filter((file) => /^\d{4}-\d{2}-\d{2}\.json$/.test(file))
    .map((file) => readFile(resolve(reportsPath, file), "utf8").then((value) => JSON.parse(value) as ReportRecord)));
  const context = createImageContext(images, reports, issueDate, policy);
  await writeFile(outputPath, `${JSON.stringify(context, null, 2)}\n`, { mode: 0o600 });
  return context;
}
