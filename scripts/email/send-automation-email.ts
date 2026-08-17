import nodemailer from "nodemailer";
import { getArgument, parseRecipients } from "./report";

const subject = getArgument("subject");
const text = getArgument("text");
const link = getArgument("link");
const recipients = parseRecipients(process.env.AUTOMATION_RECIPIENTS);
const username = process.env.GMAIL_USERNAME;
const password = process.env.GMAIL_APP_PASSWORD;

if (!subject || !text) throw new Error("Usage: --subject <text> --text <text> [--link <https-url>]");
if (!username || !password) throw new Error("GMAIL_USERNAME and GMAIL_APP_PASSWORD are required.");
if (recipients.length === 0) throw new Error("AUTOMATION_RECIPIENTS must contain at least one email address.");
if (link && new URL(link).protocol !== "https:") throw new Error("Notification links must use HTTPS.");

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: { user: username, pass: password }
});

const escapedText = text.replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;"
})[character] ?? character);
const escapedLink = link?.replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;"
})[character] ?? character);

await transporter.sendMail({
  from: `Proterra Intelligence <${username}>`,
  to: recipients,
  subject,
  text: `${text}${link ? `\n\n${link}` : ""}`,
  html: `<div style="font-family:Arial,sans-serif;line-height:1.55;color:#173f32"><p>${escapedText}</p>${escapedLink ? `<p><a href="${escapedLink}" style="display:inline-block;padding:11px 16px;background:#173f32;color:white;text-decoration:none;border-radius:6px">Open Proterra Intelligence</a></p>` : ""}</div>`
});

console.log(`Sent automation notification to ${recipients.length} recipient(s).`);
