import type * as React from "react";
import type { EditorialImage } from "../scripts/email/report";

// The weekly brief's visual system. The catch-up digest renders the same components, so both emails
// read as one publication; change a value here and every subscription email follows.
export const colors = {
  ink: "#15231f",
  muted: "#62706b",
  line: "#dce4e0",
  paper: "#ffffff",
  canvas: "#f3f6f4",
  green: "#145f4a",
  greenSoft: "#e8f1ed",
  warm: "#f6f1e8"
};

export const sectorNames: Record<string, string> = {
  dairy: "Dairy",
  meat: "Meat",
  "bovine-genetics": "Bovine genetics"
};

export function absoluteUrl(siteUrl: string, path: string) {
  return path.startsWith("http") ? path : `${siteUrl}${path}`;
}

export function issueUrl(siteUrl: string, slug: string) {
  return `${siteUrl}/reports/${slug}/`;
}

export function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  }).format(new Date(`${value}T00:00:00Z`));
}

export const body: React.CSSProperties = { margin: 0, backgroundColor: colors.canvas, color: colors.ink, fontFamily: "Arial, Helvetica, sans-serif" };
export const container: React.CSSProperties = { width: "100%", maxWidth: "600px", margin: "0 auto", backgroundColor: colors.paper };
export const masthead: React.CSSProperties = { padding: "24px", borderBottom: `1px solid ${colors.line}` };
export const eyebrow: React.CSSProperties = { margin: "0 0 4px", color: colors.green, fontSize: "12px", fontWeight: 700, letterSpacing: "1.4px" };
export const dateLine: React.CSSProperties = { margin: 0, color: colors.muted, fontSize: "12px", lineHeight: "18px" };
export const viewColumn: React.CSSProperties = { width: "105px" };
export const utilityLink: React.CSSProperties = { color: colors.green, fontSize: "12px", textDecoration: "underline" };
export const intro: React.CSSProperties = { padding: "34px 24px 26px" };
export const h1: React.CSSProperties = { margin: "0 0 14px", color: colors.ink, fontSize: "32px", lineHeight: "38px", letterSpacing: "-0.6px" };
export const lead: React.CSSProperties = { margin: 0, color: "#43514c", fontSize: "16px", lineHeight: "25px" };
export const pulseWrapper: React.CSSProperties = { padding: "0 24px 32px" };
export const pulseSection: React.CSSProperties = { width: "100%", backgroundColor: colors.greenSoft, borderRadius: "8px" };
export const pulseColumn: React.CSSProperties = { width: "33.333%", padding: "16px 10px", textAlign: "center", verticalAlign: "top" };
export const pulseLabel: React.CSSProperties = { margin: "0 0 6px", color: colors.muted, fontSize: "10px", fontWeight: 700, letterSpacing: "0.5px", textTransform: "uppercase" };
export const pulseValue: React.CSSProperties = { margin: "0 0 3px", color: colors.ink, fontSize: "22px", fontWeight: 700, lineHeight: "26px" };
export const pulseBasis: React.CSSProperties = { margin: 0, color: colors.muted, fontSize: "10px", lineHeight: "14px" };
export const topStorySection: React.CSSProperties = { padding: "0 24px 36px" };
export const sectionLabel: React.CSSProperties = { margin: "0 0 14px", color: colors.green, fontSize: "11px", fontWeight: 700, letterSpacing: "1.2px" };
export const heroImage: React.CSSProperties = { display: "block", margin: "0 auto", maxWidth: "100%", height: "auto", borderRadius: "8px" };

// Editorial photos range from 16:9 to tall portrait. Email clients cannot crop, so each one also ships
// as a banner of a single shape, built by scripts/images/build-banners.ts.
export const bannerWidth = 1104;
export const bannerHeight = 460;
export function bannerPath(id: string) {
  return `/images/editorial/banners/${id}.webp`;
}
export const bannerImage: React.CSSProperties = { display: "block", width: "100%", height: "auto", borderRadius: "8px" };

// Email clients cannot crop, so a portrait photo at full column width would fill the screen.
// Size every hero to about the same height instead, never wider than the column.
export function heroSize(image: EditorialImage, maxWidth = 552, maxHeight = 330) {
  if (!image.width || !image.height) return { width: maxWidth, height: undefined };
  const width = Math.min(maxWidth, Math.round((maxHeight * image.width) / image.height));
  return { width, height: Math.round((width * image.height) / image.width) };
}
export const credit: React.CSSProperties = { margin: "6px 0 18px", color: "#78847f", fontSize: "10px", lineHeight: "14px" };
export const storyMeta: React.CSSProperties = { margin: "0 0 7px", color: colors.green, fontSize: "11px", fontWeight: 700, lineHeight: "16px", textTransform: "uppercase" };
export const h2: React.CSSProperties = { margin: "0 0 12px", fontSize: "25px", lineHeight: "31px", letterSpacing: "-0.35px" };
export const h3: React.CSSProperties = { margin: "0 0 8px", fontSize: "20px", lineHeight: "26px", letterSpacing: "-0.2px" };
export const headlineLink: React.CSSProperties = { color: colors.ink, textDecoration: "none" };
export const storySummary: React.CSSProperties = { margin: "0 0 18px", color: "#43514c", fontSize: "15px", lineHeight: "24px" };
export const keyPointBox: React.CSSProperties = { margin: "0 0 18px", padding: "16px 18px", backgroundColor: colors.warm, borderRadius: "8px" };
export const boxTitle: React.CSSProperties = { margin: "0 0 9px", color: colors.ink, fontSize: "12px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.6px" };
export const keyPoint: React.CSSProperties = { margin: "6px 0", color: "#43514c", fontSize: "14px", lineHeight: "21px" };
export const whyLabel: React.CSSProperties = { margin: "0 0 5px", color: colors.muted, fontSize: "10px", fontWeight: 700, letterSpacing: "0.8px" };
export const whyText: React.CSSProperties = { margin: "0 0 18px", color: "#43514c", fontSize: "14px", lineHeight: "22px" };
export const primaryButton: React.CSSProperties = { backgroundColor: colors.green, borderRadius: "6px", color: "#ffffff", display: "inline-block", fontSize: "13px", fontWeight: 700, padding: "12px 18px", textDecoration: "none" };
export const latestSection: React.CSSProperties = { padding: "30px 24px 36px", borderTop: `1px solid ${colors.line}` };
export const storyDivider: React.CSSProperties = { margin: "24px 0", borderColor: colors.line, borderWidth: "1px 0 0" };
export const compactSummary: React.CSSProperties = { margin: "0 0 8px", color: "#53605c", fontSize: "14px", lineHeight: "22px" };
export const sourceLine: React.CSSProperties = { margin: 0, fontSize: "12px", lineHeight: "18px" };
export const sourceLink: React.CSSProperties = { color: colors.green, fontWeight: 700, textDecoration: "none" };
export const closing: React.CSSProperties = { padding: "28px 24px 34px", borderTop: `1px solid ${colors.line}`, textAlign: "center" };
export const footer: React.CSSProperties = { padding: "22px 24px 28px", backgroundColor: "#edf1ef", borderTop: `1px solid ${colors.line}` };
export const footerBrand: React.CSSProperties = { margin: "0 0 3px", color: colors.ink, fontSize: "12px", fontWeight: 700, lineHeight: "18px" };
export const footerText: React.CSSProperties = { margin: 0, color: colors.muted, fontSize: "11px", lineHeight: "17px" };
export const footerLinks: React.CSSProperties = { margin: "14px 0 0", fontSize: "11px", lineHeight: "18px" };
export const footerLink: React.CSSProperties = { color: colors.green, fontWeight: 700, textDecoration: "none" };
export const footerQuiet: React.CSSProperties = { margin: "7px 0 0", fontSize: "11px", lineHeight: "18px" };
export const footerQuietLink: React.CSSProperties = { color: colors.muted, textDecoration: "underline" };
// Email clients drop margins between inline links; spaces keep the row readable without separators.
export const linkGap = "\u00a0\u00a0\u00a0";

// Some source titles run to a full sentence; keep the line under the story it belongs to.
export function sourceLabel(title: string, maximum = 72) {
  return title.length <= maximum ? title : `${title.slice(0, maximum - 1).trimEnd()}…`;
}

