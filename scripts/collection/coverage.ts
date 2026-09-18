import { areas } from "../../review-worker/src/source-model";
import type { Candidate } from "./types";
export type CoverageCheck = { issue_date: string; area: string; outcome: string; note: string; checked_at?: string };
const latin = /latin america|caribbean|mexico|central america|dominican|brazil|argentina|chile|colombia|uruguay|paraguay|peru|ecuador|bolivia|venezuela|costa rica|el salvador|guatemala|honduras|nicaragua|panama|belize/i;
export function matchesArea(candidate: Pick<Candidate,"sectors"|"geographies">, area: string) {
  if (["dairy","meat","bovine-genetics"].includes(area)) return candidate.sectors.some(s=>s===area);
  if (area === "International") return candidate.geographies.some(g=>g!=="United States" && g!=="Puerto Rico");
  if (area === "Latin America & Caribbean") return candidate.geographies.some(g=>g!=="Puerto Rico" && latin.test(g));
  return candidate.geographies.includes(area);
}
export type CoverageStatus = "checked" | "stories-found" | "unavailable" | "needs-check";
export function coverageChecklist(issueDate: string, candidates: Candidate[], checks: CoverageCheck[] = []):
  Array<{ area: string; newsCount: number; status: CoverageStatus; note: string; checkedAt?: string }> {
  return areas.map(area=>{
    const count=candidates.filter(c=>c.contentClass === "news" && matchesArea(c,area)).length;
    const check=checks.find(c=>c.issue_date===issueDate && c.area===area);
    return { area, newsCount:count, status:check?.outcome === "checked" ? "checked" : count ? "stories-found" : check?.outcome === "unavailable" ? "unavailable" : "needs-check", note:check?.note ?? "", checkedAt:check?.checked_at };
  });
}
