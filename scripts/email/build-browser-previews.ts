import { writeFileSync } from "node:fs";
import { loadDigest } from "./digest";
import { getSiteUrl } from "./report";
import { renderDigest, renderSubscriptionEmail } from "./render";

// Build-only artifacts: approved content, generic links, no addresses or bearer tokens.
const siteUrl = getSiteUrl();
for (const [filename, selection] of [
  ["digest-preview.html", "2026-08-31,2026-09-07,2026-09-14"],
  ["weekly-digest-preview.html", undefined]
] as const) {
  const { html } = await renderDigest(loadDigest(selection, true), siteUrl);
  writeFileSync(`public/${filename}`, html);
}
for (const kind of ["subscribe", "invite", "unsubscribe"] as const) {
  const { html } = await renderSubscriptionEmail({ kind, url: `${siteUrl}/subscriptions`, expiresAt: "2026-10-17T12:00:00.000Z" }, siteUrl);
  writeFileSync(`public/${kind}-preview.html`, html);
}
console.log("Built generic digest and subscription email previews.");
