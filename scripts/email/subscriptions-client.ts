import { z } from "zod";
import { getSiteUrl } from "./report";

export async function subscriptionApi(path: string, body?: unknown) {
  const origin = process.env.REVIEW_API_URL?.replace(/\/$/, "");
  const serviceKey = process.env.REVIEW_SERVICE_KEY;
  if (!origin || new URL(origin).protocol !== "https:" || !serviceKey) throw new Error("REVIEW_API_URL (HTTPS) and REVIEW_SERVICE_KEY are required.");
  const response = await fetch(`${origin}/api/internal/subscriptions/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "content-type": "application/json", "x-review-service-key": serviceKey,
      "CF-Access-Client-Id": process.env.REVIEW_ACCESS_CLIENT_ID ?? "",
      "CF-Access-Client-Secret": process.env.REVIEW_ACCESS_CLIENT_SECRET ?? ""
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "error", signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) throw new Error(`Subscription API ${path} failed (${response.status}).`);
  return response.json();
}

export const recipientSchema = z.object({ email: z.email(), unsubscribeUrl: z.url() });
export async function currentRecipients() {
  const result = z.object({ recipients: z.array(recipientSchema) }).parse(await subscriptionApi("recipients"));
  const origin = new URL(getSiteUrl()).origin;
  for (const recipient of result.recipients) {
    const link = new URL(recipient.unsubscribeUrl);
    if (link.origin !== origin || link.pathname !== "/subscriptions/unsubscribe") throw new Error("Invalid unsubscribe link in recipient snapshot.");
    // The source is private; mask it before any further workflow operation.
    if (process.env.GITHUB_ACTIONS === "true") {
      console.log(`::add-mask::${recipient.email}`);
      console.log(`::add-mask::${recipient.unsubscribeUrl}`);
    }
  }
  return result.recipients;
}
