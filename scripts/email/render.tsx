import * as React from "react";
import { render } from "react-email";
import { WeeklyBriefEmail } from "../../emails/WeeklyBriefEmail";
import type { Report } from "../../src/lib/content";
import { loadEditorialImages } from "./report";

export function getEmailSubject(report: Report, test = false) {
  const headline = report.overview?.headline ?? `Weekly brief · ${report.publishedAt}`;
  return `${test ? "[TEST] " : ""}Proterra Intelligence: ${headline}`;
}

export async function renderWeeklyBrief(report: Report, siteUrl: string) {
  const element = (
    <WeeklyBriefEmail report={report} siteUrl={siteUrl} images={loadEditorialImages()} />
  );
  const [html, text] = await Promise.all([
    render(element),
    render(element, { plainText: true })
  ]);
  return { html, text };
}
