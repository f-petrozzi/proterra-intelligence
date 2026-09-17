import * as React from "react";
import { render } from "react-email";
import { WeeklyBriefEmail } from "../../emails/WeeklyBriefEmail";
import type { Report } from "../../src/lib/content";
import { loadEditorialImages } from "./report";
import { CatchupEmail, readableDate } from "../../emails/CatchupEmail";
import { SubscriptionEmail, type SubscriptionEmailProps } from "../../emails/SubscriptionEmail";

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
  const element = <CatchupEmail reports={reports} siteUrl={siteUrl} images={loadEditorialImages()} unsubscribeUrl={unsubscribeUrl ?? `${siteUrl}/subscriptions?intent=unsubscribe`} />;
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { html, text };
}

export type SubscriptionEmailInput = Omit<SubscriptionEmailProps, "siteUrl">;

export function getSubscriptionSubject({ kind, inviterName }: SubscriptionEmailInput) {
  if (kind === "unsubscribe") return "Unsubscribe from Proterra Intelligence";
  if (kind === "subscribe") return "Confirm your Proterra Intelligence subscription";
  return inviterName ? `${inviterName} invited you to Proterra Intelligence` : "You're invited to the Proterra Intelligence weekly digest";
}

export async function renderSubscriptionEmail(input: SubscriptionEmailInput, siteUrl: string) {
  const element = <SubscriptionEmail {...input} siteUrl={siteUrl} />;
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { html, text };
}
