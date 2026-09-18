import { writeFileSync } from "node:fs";
import { loadDigest } from "./digest";
import { getSiteUrl } from "./report";
import { renderDigest } from "./render";

// Public preview: approved report content only, never subscriber data or personal links.
const reports = loadDigest("2026-08-31,2026-09-07,2026-09-14", true);
const { html } = await renderDigest(reports, getSiteUrl());
writeFileSync("public/digest-preview.html", html);
console.log("Built the three-week digest browser preview.");
