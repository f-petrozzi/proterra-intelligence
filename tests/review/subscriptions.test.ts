import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Miniflare } from "miniflare";
import type { Env } from "../../review-worker/src/index";
import { claimMail, consumeRequest, importSubscribers, removeSubscriber, requestSubscription, subscriptionRecipients, subscriptionRoutes } from "../../review-worker/src/subscriptions";
import { loadDigest } from "../../scripts/email/digest";
import { renderDigest, getDigestSubject } from "../../scripts/email/render";

async function fixture(initialize = true) {
  const miniflare = new Miniflare({ workers: [{ config: {
    name: "subscriptions-test", type: "worker", compatibilityDate: "2026-08-17",
    manifest: { mainModule: "index.js", modulesRoot: process.cwd(), modules: {
      "index.js": { type: "esm", contents: "export default { fetch() { return new Response('ok') } }" }
    } }, env: { REVIEW_DB: { type: "d1", name: "subscriptions-test" } }
  } }] });
  const database = await miniflare.getD1Database("REVIEW_DB", "subscriptions-test");
  const sql = await readFile("review-worker/migrations/0004_subscriptions.sql", "utf8");
  for (const statement of sql.split(";").map(value => value.trim()).filter(Boolean)) await database.prepare(statement).run();
  const env = {
    REVIEW_DB: database, REVIEW_ORIGIN: "https://review.example.org", SITE_ORIGIN: "https://site.example.org",
    CSRF_SECRET: "c".repeat(64), REVIEW_SERVICE_KEY: "s".repeat(64)
  } as unknown as Env;
  if (initialize) await importSubscribers(env, ["legacy@example.org"]);
  return { miniflare, database, env };
}

async function requestToken(env: Env, email: string, kind: "invite" | "subscribe" | "unsubscribe") {
  await requestSubscription(env, email, kind);
  const message = await claimMail(env);
  assert.ok(message);
  assert.equal(message.email, email.toLowerCase().trim());
  return { token: new URL(message.url).searchParams.get("token")!, message };
}

test("legacy import is normalized, atomic, sends nothing, and cannot overwrite an initialized list", async context => {
  const { env, database, miniflare } = await fixture(false);
  context.after(() => miniflare.dispose());
  await assert.rejects(subscriptionRecipients(env), error => error instanceof Response && error.status === 503);
  assert.equal(await importSubscribers(env, [" A@example.org ", "a@example.org", "b@example.org"]), 2);
  assert.deepEqual((await subscriptionRecipients(env)).map(row => row.email), ["a@example.org", "b@example.org"]);
  assert.equal(await claimMail(env), null);
  await assert.rejects(importSubscribers(env, ["replacement@example.org"]), error => error instanceof Response && error.status === 409);
  assert.equal((await database.prepare("SELECT COUNT(*) AS n FROM subscribers").first<any>())!.n, 2);
  assert.equal((await database.prepare("SELECT COUNT(*) AS n FROM subscribers WHERE confirmed_at IS NOT NULL").first<any>())!.n, 0, "legacy import is not a new opt-in confirmation");
});

test("an invitation requires an explicit POST; accept activates once and consumes the token", async context => {
  const { env, miniflare } = await fixture();
  context.after(() => miniflare.dispose());
  const { token } = await requestToken(env, "friend@example.org", "invite");
  assert.equal((await subscriptionRecipients(env)).length, 1);
  const url = `${env.REVIEW_ORIGIN}/subscriptions/confirm?token=${token}`;
  const page = await subscriptionRoutes(new Request(url), env);
  assert.equal(page?.status, 200);
  assert.match(await page!.text(), /Accept and subscribe/);
  assert.equal((await subscriptionRecipients(env)).length, 1, "email link scanners cannot subscribe recipients");
  await assert.rejects(subscriptionRoutes(new Request(url, { method: "POST", headers: { origin: "https://evil.example.org", "content-type": "application/x-www-form-urlencoded" }, body: "action=accept" }), env), error => error instanceof Response && error.status === 403);
  const response = await subscriptionRoutes(new Request(url, { method: "POST", headers: { origin: env.REVIEW_ORIGIN, "content-type": "application/x-www-form-urlencoded" }, body: "action=accept" }), env);
  assert.equal(response?.status, 200);
  assert.equal((await subscriptionRecipients(env)).length, 2);
  assert.equal(await consumeRequest(env, token, "accept"), false);
});

test("decline suppresses invitations but permits a fresh self-subscription", async context => {
  const { env, miniflare } = await fixture();
  context.after(() => miniflare.dispose());
  const { token } = await requestToken(env, "friend@example.org", "invite");
  assert.equal(await consumeRequest(env, token, "decline"), true);
  assert.equal(await consumeRequest(env, token, "accept"), false);
  await requestSubscription(env, "friend@example.org", "invite");
  assert.equal(await claimMail(env), null);
  const next = await requestToken(env, "friend@example.org", "subscribe");
  assert.equal(await consumeRequest(env, next.token, "accept"), true);
  assert.equal((await subscriptionRecipients(env)).length, 2);
});

test("expired tokens cannot activate subscribers or be delivered", async context => {
  const { env, database, miniflare } = await fixture();
  context.after(() => miniflare.dispose());
  const { token } = await requestToken(env, "friend@example.org", "subscribe");
  await database.prepare("UPDATE subscription_requests SET expires_at = 0").run();
  assert.equal(await consumeRequest(env, token, "accept"), false);
  assert.equal(await claimMail(env), null);
  const mail = await database.prepare("SELECT token, status FROM subscription_mail").first<any>();
  assert.equal(mail.status, "cancelled");
  assert.equal(mail.token, null);
});

test("unsubscribe removes a recipient immediately, GET is harmless, and old links cannot affect a new subscription", async context => {
  const { env, miniflare } = await fixture();
  context.after(() => miniflare.dispose());
  const [recipient] = await subscriptionRecipients(env);
  const link = new URL(recipient.unsubscribeUrl);
  assert.equal((await subscriptionRoutes(new Request(link), env))?.status, 200);
  assert.equal((await subscriptionRecipients(env)).length, 1);
  const response = await subscriptionRoutes(new Request(link, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" }), env);
  assert.equal(response?.status, 200);
  assert.equal((await subscriptionRecipients(env)).length, 0);
  assert.equal(await removeSubscriber(env, link.searchParams.get("id")!, link.searchParams.get("token")!), false);
  const { token } = await requestToken(env, "legacy@example.org", "subscribe");
  assert.equal(await consumeRequest(env, token, "accept"), true);
  assert.equal(await removeSubscriber(env, link.searchParams.get("id")!, link.searchParams.get("token")!), false);
  assert.equal((await subscriptionRecipients(env)).length, 1);
});

test("unsubscribe-by-email requires its own confirmation and rejects the accept action", async context => {
  const { env, miniflare } = await fixture();
  context.after(() => miniflare.dispose());
  const { token } = await requestToken(env, "legacy@example.org", "unsubscribe");
  assert.equal(await consumeRequest(env, token, "accept"), false);
  assert.equal((await subscriptionRecipients(env)).length, 1);
  assert.equal(await consumeRequest(env, token, "unsubscribe"), true);
  assert.equal((await subscriptionRecipients(env)).length, 0);
});

test("mail leases prevent simultaneous delivery and acknowledgment erases the raw confirmation token", async context => {
  const { env, database, miniflare } = await fixture();
  context.after(() => miniflare.dispose());
  const { message } = await requestToken(env, "friend@example.org", "invite");
  assert.equal(await claimMail(env), null);
  const ack = async (lease: string) => subscriptionRoutes(new Request(`${env.REVIEW_ORIGIN}/api/internal/subscriptions/ack`, {
    method: "POST", headers: { "x-review-service-key": env.REVIEW_SERVICE_KEY }, body: JSON.stringify({ id: message.id, lease })
  }), env);
  assert.deepEqual(await (await ack(crypto.randomUUID()))!.json(), { acknowledged: false });
  assert.deepEqual(await (await ack(message.lease))!.json(), { acknowledged: true });
  assert.equal((await database.prepare("SELECT token FROM subscription_mail").first<any>())!.token, null);
});

test("recipient APIs and subscriber administration require authentication", async context => {
  const { env, miniflare } = await fixture();
  context.after(() => miniflare.dispose());
  for (const path of ["/subscribers", "/api/internal/subscriptions/recipients", "/api/internal/subscriptions/import", "/api/internal/subscriptions/claim"]) {
    await assert.rejects(subscriptionRoutes(new Request(`${env.REVIEW_ORIGIN}${path}`), env), error => error instanceof Response && error.status === 401);
  }
});

test("duplicate requests are limited, unknown unsubscribes do not create recipients, and malformed input is rejected", async context => {
  const { env, database, miniflare } = await fixture();
  context.after(() => miniflare.dispose());
  await Promise.all(Array.from({ length: 5 }, () => requestSubscription(env, "friend@example.org", "subscribe")));
  assert.equal((await database.prepare("SELECT COUNT(*) AS n FROM subscription_requests").first<any>())!.n, 1);
  await requestSubscription(env, "unknown@example.org", "unsubscribe");
  assert.equal((await database.prepare("SELECT COUNT(*) AS n FROM subscribers").first<any>())!.n, 2);
  await assert.rejects(requestSubscription(env, "bad\r\nBcc: bad@example.org", "invite"));
});

test("public request processing fails closed until bot protection is configured", async context => {
  const { env, miniflare } = await fixture();
  context.after(() => miniflare.dispose());
  const response = await subscriptionRoutes(new Request(`${env.REVIEW_ORIGIN}/subscriptions/request`, {
    method: "POST", headers: { origin: env.REVIEW_ORIGIN, "content-type": "application/x-www-form-urlencoded" }, body: "email=friend%40example.org&intent=invite"
  }), env);
  assert.equal(response?.status, 503);
  assert.equal(await claimMail(env), null);
});

test("catch-up renders three dated sections, all 18 articles, and recipient-specific unsubscribe links", async () => {
  const reports = loadDigest("2026-08-31,2026-09-07,2026-09-14", true);
  const link = "https://review.example.org/subscriptions/unsubscribe?id=test&token=private";
  const { html, text } = await renderDigest(reports, "https://proterra-intelligence.pages.dev", link);
  for (const date of ["August 24, 2026", "August 30, 2026", "August 31, 2026", "September 6, 2026", "September 7, 2026", "September 13, 2026"]) assert.ok(text.toLowerCase().includes(date.toLowerCase()));
  for (const report of reports) {
    assert.ok(html.includes(`/reports/${report.slug}/`));
    for (const item of report.items) assert.ok(text.toLowerCase().includes(item.headline.toLowerCase()));
  }
  assert.ok(text.includes(link));
  assert.match(getDigestSubject(reports), /Three-week catch-up/);
  assert.ok(Buffer.byteLength(html) < 95_000, "Keep the combined message below common email clipping thresholds");
  assert.throws(() => loadDigest("2026-09-14,2026-08-31,2026-09-07"), /chronological/);
  assert.throws(() => loadDigest("2026-08-31,2026-08-31,2026-09-14"), /distinct/);
  assert.throws(() => loadDigest("2026-08-31,2026-09-14"), /three/);
});

test("public requests verify the bot token hostname and action before queuing email", async context => {
  const { env, miniflare } = await fixture();
  context.after(() => miniflare.dispose());
  env.SUBSCRIPTIONS_TURNSTILE_SECRET = "test-secret";
  let verification = { success: true, hostname: "other.example.org", action: "subscription" };
  context.mock.method(globalThis, "fetch", async () => Response.json(verification));
  const submit = () => subscriptionRoutes(new Request(`${env.REVIEW_ORIGIN}/subscriptions/request`, {
    method: "POST", headers: { origin: env.REVIEW_ORIGIN, "content-type": "application/x-www-form-urlencoded", "cf-connecting-ip": "192.0.2.1" },
    body: "email=friend%40example.org&intent=invite&cf-turnstile-response=challenge"
  }), env);
  assert.equal((await submit())?.status, 400);
  assert.equal(await claimMail(env), null);
  verification = { success: true, hostname: "review.example.org", action: "wrong" };
  assert.equal((await submit())?.status, 400);
  assert.equal(await claimMail(env), null);
  verification = { success: true, hostname: "review.example.org", action: "subscription" };
  assert.equal((await submit())?.status, 200);
  assert.equal((await claimMail(env))?.email, "friend@example.org");
  assert.equal((await subscriptionRecipients(env)).length, 1);
});

test("concurrent acceptance and decline cannot both change consent", async context => {
  const { env, miniflare } = await fixture();
  context.after(() => miniflare.dispose());
  const { token } = await requestToken(env, "friend@example.org", "invite");
  const changed = await Promise.all([consumeRequest(env, token, "accept"), consumeRequest(env, token, "decline")]);
  assert.equal(changed.filter(Boolean).length, 1);
});
