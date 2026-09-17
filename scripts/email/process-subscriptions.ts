import { spawnSync } from "node:child_process";
import nodemailer from "nodemailer";
import { z } from "zod";
import { getArgument, parseRecipients } from "./report";
import { currentRecipients, subscriptionApi } from "./subscriptions-client";

const mode = getArgument("mode");
if (!["import", "sync", "process"].includes(mode ?? "")) throw new Error("--mode must be import, sync, or process.");

if (mode === "import") {
  const emails = parseRecipients(process.env.EMAIL_RECIPIENTS);
  if (!emails.length) throw new Error("Refusing to initialize an empty legacy list.");
  await subscriptionApi("import", { emails });
  console.log(`Imported ${emails.length} legacy recipient(s). No email was sent. Review the private /subscribers page before sending a digest.`);
} else {
  // This workflow has one concurrency group; import and sync cannot overwrite each other.
  if (!process.env.RECIPIENT_SYNC_TOKEN || !process.env.GITHUB_REPOSITORY) throw new Error("RECIPIENT_SYNC_TOKEN and GITHUB_REPOSITORY are required.");
  const recipients = await currentRecipients();
  const sync = spawnSync("gh", ["secret", "set", "EMAIL_RECIPIENTS", "--repo", process.env.GITHUB_REPOSITORY], {
    input: recipients.map(recipient => recipient.email).join(","), encoding: "utf8",
    env: { ...process.env, GH_TOKEN: process.env.RECIPIENT_SYNC_TOKEN }, stdio: ["pipe", "pipe", "pipe"]
  });
  if (sync.status !== 0) throw new Error("Recipient secret synchronization failed. Check the token's repository Secrets write permission.");
  console.log(`Synchronized ${recipients.length} active recipient(s) to GitHub.`);

  if (mode === "process") {
    const username = process.env.GMAIL_USERNAME?.trim();
    const pass = process.env.GMAIL_APP_PASSWORD?.replace(/\s/g, "");
    if (!username || !pass) throw new Error("Gmail credentials are required.");
    const transport = nodemailer.createTransport({ service: "gmail", auth: { user: username, pass }, connectionTimeout: 30_000, socketTimeout: 60_000 });
    await transport.verify();
    let count = 0;
    for (; count < 25; count++) {
      const { message } = z.object({ message: z.object({ id: z.uuid(), lease: z.uuid(), email: z.email(), kind: z.enum(["invite", "subscribe", "unsubscribe"]), url: z.url() }).nullable() }).parse(await subscriptionApi("claim", {}));
      if (!message) break;
      const link = new URL(message.url);
      if (link.origin !== new URL(process.env.REVIEW_API_URL!).origin || link.pathname !== "/subscriptions/confirm") throw new Error("Unexpected subscription confirmation URL.");
      if (process.env.GITHUB_ACTIONS === "true") {
        console.log(`::add-mask::${message.email}`);
        console.log(`::add-mask::${message.url}`);
      }
      const subject = message.kind === "invite" ? "You're invited to the Proterra Intelligence weekly digest" : message.kind === "unsubscribe" ? "Confirm your Proterra Intelligence unsubscribe request" : "Confirm your Proterra Intelligence subscription";
      const introduction = message.kind === "invite" ? "Someone invited you to receive the Proterra Intelligence weekly digest covering dairy, meat, and bovine genetics. You have not been subscribed. Open the link to accept or decline." : message.kind === "unsubscribe" ? "Open the link to confirm that you want to stop receiving the weekly digest." : "Confirm that you want to receive the Proterra Intelligence weekly digest covering dairy, meat, and bovine genetics.";
      try {
        const result = await transport.sendMail({
          from: `"Proterra Intelligence" <${username}>`, to: message.email, replyTo: username,
          messageId: `<subscription-${message.id}@${username.split("@")[1]}>`, subject,
          text: `${introduction}\n\n${message.url}\n\nThis link expires in 7 days. If you did not expect this email, you can ignore it. No subscription changes occur unless you confirm.`
        });
        if (result.rejected.length || !result.accepted.length) throw new Error("Recipient not accepted");
      } catch {
        throw new Error("Subscription email delivery failed. The leased message will be retried; inspect the sender's Sent folder before manual retries.");
      }
      const ack = z.object({ acknowledged: z.boolean() }).parse(await subscriptionApi("ack", { id: message.id, lease: message.lease }));
      if (!ack.acknowledged) throw new Error("Delivery acknowledgment failed; inspect the sent message before retrying.");
    }
    console.log(`Delivered ${count} subscription message(s).`);
  }
}
