import { loadReport } from "./report";

export function loadDigest(argument?: string, requireApproved = false) {
  if (!argument) return [loadReport(undefined, requireApproved)];
  const slugs = argument.split(",").map(slug => slug.trim());
  if ((slugs.length !== 1 && slugs.length !== 3) || new Set(slugs).size !== slugs.length) throw new Error("Choose one issue or three distinct issues separated by commas.");
  if (slugs.join(",") !== [...slugs].sort().join(",")) throw new Error("Catch-up issues must be in chronological order.");
  return slugs.map(slug => loadReport(slug, requireApproved));
}

export function digestId(reports: { slug: string }[]) {
  return reports.length === 1 ? reports[0].slug : `catchup-${reports[0].slug}-${reports.at(-1)!.slug}`;
}
