import * as React from "react";
import { render } from "react-email";
import { WeeklyBriefEmail } from "../../emails/WeeklyBriefEmail";
import type { Report } from "../../src/lib/content";
import { loadEditorialImages } from "./report";
import { CatchupEmail, readableDate } from "../../emails/CatchupEmail";

export function getEmailSubject(report: Report, test = false) {
  const headline = report.overview?.headline ?? `Weekly brief · ${report.publishedAt}`;
  return `${test ? "[TEST] " : ""}Proterra Intelligence: ${headline}`;
}

export async function renderWeeklyBrief(report: Report, siteUrl: string, unsubscribeUrl?: string) {
  const element = (
    <WeeklyBriefEmail report={report} siteUrl={siteUrl} images={loadEditorialImages()} unsubscribeUrl={unsubscribeUrl} />
  );
  const [html, text] = await Promise.all([
    render(element),
    render(element, { plainText: true })
  ]);
  return { html, text };
}

export function getDigestSubject(reports: Report[], test = false) {
  if (reports.length === 1) return getEmailSubject(reports[0], test);
  return `${test ? "[TEST] " : ""}Proterra Intelligence: Three-week catch-up · ${readableDate(reports[0].period.start)} – ${readableDate(reports.at(-1)!.period.end)}`;
}

export async function renderDigest(reports: Report[], siteUrl: string, unsubscribeUrl?: string) {
  if (reports.length === 1) return renderWeeklyBrief(reports[0], siteUrl, unsubscribeUrl);
  const element = <CatchupEmail reports={reports} siteUrl={siteUrl} unsubscribeUrl={unsubscribeUrl ?? `${siteUrl}/#digest-signup-title`} />;
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { html, text };
}
