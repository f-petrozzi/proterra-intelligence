import nodemailer from "nodemailer";
import {
  getArgument,
  getSiteUrl,
  loadReport,
  parseRecipients
} from "./report";
import { getEmailSubject, renderWeeklyBrief } from "./render";

const mode = getArgument("mode");
if (mode !== "test" && mode !== "send") {
  throw new Error("--mode must be test or send.");
}

const production = mode === "send";
const report = loadReport(getArgument("report"), production);
const confirmation = getArgument("confirm");
if (production && confirmation !== report.slug) {
  throw new Error(`Production send requires --confirm ${report.slug}.`);
}

const username = process.env.GMAIL_USERNAME?.trim();
const appPassword = process.env.GMAIL_APP_PASSWORD?.replace(/\s/g, "");
if (!username || !appPassword) {
  throw new Error("GMAIL_USERNAME and GMAIL_APP_PASSWORD are required.");
}

const recipients = production
  ? parseRecipients(process.env.EMAIL_RECIPIENTS)
  : parseRecipients(process.env.EMAIL_TEST_RECIPIENT || username);
if (recipients.length === 0) {
  throw new Error(production ? "EMAIL_RECIPIENTS is empty." : "EMAIL_TEST_RECIPIENT is empty.");
}

const { html, text } = await renderWeeklyBrief(report, getSiteUrl());
const transport = nodemailer.createTransport({
  service: "gmail",
  auth: { user: username, pass: appPassword }
});

await transport.verify();
const result = await transport.sendMail({
  from: `"Proterra Intelligence" <${username}>`,
  to: production ? username : recipients,
  bcc: production ? recipients : undefined,
  replyTo: username,
  subject: getEmailSubject(report, !production),
  html,
  text,
  headers: { "X-Proterra-Issue": report.slug }
});

console.log(`${production ? "Production" : "Test"} email sent for issue ${report.slug} to ${recipients.length} recipient(s).`);
console.log(`Message ID: ${result.messageId}`);
