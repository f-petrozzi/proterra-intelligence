import nodemailer from "nodemailer";
import {
  getArgument,
  getSiteUrl,
  parseRecipients
} from "./report";
import { getDigestSubject, renderDigest } from "./render";
import { digestId, loadDigest } from "./digest";
import { currentRecipients } from "./subscriptions-client";

const mode = getArgument("mode");
if (mode !== "test" && mode !== "send") {
  throw new Error("--mode must be test or send.");
}

const production = mode === "send";
const reports = loadDigest(getArgument("report"), production);
const reportSelection = reports.map(report => report.slug).join(",");
const confirmation = getArgument("confirm");
if (production && confirmation !== reportSelection) {
  throw new Error(`Production send requires --confirm ${reportSelection}.`);
}

const username = process.env.GMAIL_USERNAME?.trim();
const appPassword = process.env.GMAIL_APP_PASSWORD?.replace(/\s/g, "");
if (!username || !appPassword) {
  throw new Error("GMAIL_USERNAME and GMAIL_APP_PASSWORD are required.");
}

const recipients = production
  ? await currentRecipients()
  : parseRecipients(process.env.EMAIL_TEST_RECIPIENT || username).map(email => ({ email, unsubscribeUrl: undefined }));
if (recipients.length === 0) {
  throw new Error(production ? "There are no active subscribers." : "EMAIL_TEST_RECIPIENT is empty.");
}

const transport = nodemailer.createTransport({
  service: "gmail",
  auth: { user: username, pass: appPassword }
});

await transport.verify();
let sent = 0;
for (const recipient of recipients) {
  try {
    const { html, text } = await renderDigest(reports, getSiteUrl(), recipient.unsubscribeUrl);
    // Re-read immediately before delivery; never fall back to a stale GitHub snapshot.
    if (production && !(await currentRecipients()).some(current => current.email === recipient.email && current.unsubscribeUrl === recipient.unsubscribeUrl)) continue;
    const result = await transport.sendMail({
      from: `"Proterra Intelligence" <${username}>`, to: recipient.email, replyTo: username,
      subject: getDigestSubject(reports, !production), html, text,
      headers: {
        "X-Proterra-Issue": reportSelection,
        ...(recipient.unsubscribeUrl ? { "List-Unsubscribe": `<${recipient.unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } : {})
      }
    });
    if (result.rejected.length || !result.accepted.length) throw new Error("Recipient not accepted");
    sent++;
  } catch {
    throw new Error(`Digest delivery stopped after ${sent} successful message(s). Inspect the sender's Sent folder before retrying to avoid duplicates.`);
  }
}
console.log(`${production ? "Production" : "Test"} digest ${digestId(reports)} sent to ${sent} recipient(s).`);
