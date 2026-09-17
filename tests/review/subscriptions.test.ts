import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Miniflare } from "miniflare";
import type { Env } from "../../review-worker/src/index";
import { claimMail, consumeRequest, importSubscribers, inviterNameSchema, removeSubscriber, requestSubscription, subscriptionRecipients, subscriptionRoutes, unsubscribeAddress } from "../../review-worker/src/subscriptions";
import { onRequest as subscriptionsRoute } from "../../functions/subscriptions/[[path]]";
import { loadDigest } from "../../scripts/email/digest";
import { escapeHtml } from "../../review-worker/src/html";
import { renderDigest, getDigestSubject, getSubscriptionSubject, renderSubscriptionEmail } from "../../scripts/email/render";

async function fixture(initialize = true) {
  const miniflare = new Miniflare({ workers: [{ config: {
    name: "subscriptions-test", type: "worker", compatibilityDate: "2026-08-17",
    manifest: { mainModule: "index.js", modulesRoot: process.cwd(), modules: {
      "index.js": { type: "esm", contents: "export default { fetch() { return new Response('ok') } }" }
    } }, env: { REVIEW_DB: { type: "d1", name: "subscriptions-test" } }
  } }] });
  const database = await miniflare.getD1Database("REVIEW_DB", "subscriptions-test");
  for (const migration of ["0004_subscriptions.sql", "0005_subscription_inviter.sql"]) {
    const sql = (await readFile(`review-worker/migrations/${migration}`, "utf8")).replace(/^--.*$/gm, "");
    for (const statement of sql.split(";").map(value => value.trim()).filter(Boolean)) await database.prepare(statement).run();
  }
  const env = {
    REVIEW_DB: database, REVIEW_ORIGIN: "https://review.example.org", SITE_ORIGIN: "https://site.example.org",
    CSRF_SECRET: "c".repeat(64), REVIEW_SERVICE_KEY: "s".repeat(64)
  } as unknown as Env;
  if (initialize) await importSubscribers(env, ["legacy@example.org"]);
  return { miniflare, database, env };
}

async function requestToken(env: Env, email: string, kind: "invite" | "subscribe", inviterName?: string) {
  await requestSubscription(env, email, kind, inviterName);
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
  const url = `${env.SITE_ORIGIN}/subscriptions/confirm?token=${token}`;
  const page = await subscriptionRoutes(new Request(url), env);
  assert.equal(page?.status, 200);
  assert.equal(page!.headers.get("referrer-policy"), "strict-origin", "no-referrer makes browsers post Origin: null; same-origin would leak the token to other site pages");
  assert.match(await page!.text(), /Accept invitation/);
  assert.equal((await subscriptionRecipients(env)).length, 1, "email link scanners cannot subscribe recipients");
  await assert.rejects(subscriptionRoutes(new Request(url, { method: "POST", headers: { origin: "https://evil.example.org", "content-type": "application/x-www-form-urlencoded" }, body: "action=accept" }), env), error => error instanceof Response && error.status === 403);
  const response = await subscriptionRoutes(new Request(url, { method: "POST", headers: { origin: env.REVIEW_ORIGIN, "content-type": "application/x-www-form-urlencoded" }, body: "action=accept" }), env);
  assert.equal(response?.status, 200);
  assert.match(await response!.text(), new RegExp(`http-equiv="refresh" content="5;url=${env.SITE_ORIGIN}/"`), "a finished step returns to the publication");
  assert.equal((await subscriptionRecipients(env)).length, 2);
  assert.equal(await consumeRequest(env, token, "accept"), false);
});

test("a self-subscription link completes in one click, while an invitation still asks", async context => {
  const { env, miniflare } = await fixture();
  context.after(() => miniflare.dispose());
  const own = await requestToken(env, "self@example.org", "subscribe");
  const confirming = await subscriptionRoutes(new Request(`${env.SITE_ORIGIN}/subscriptions/confirm?token=${own.token}`), env);
  const confirmingHtml = await confirming!.text();
  const nonce = confirmingHtml.match(/<script nonce="([a-f0-9]{32})">document\.forms\[0\]\.submit\(\)<\/script>/);
  assert.ok(nonce, "the page submits its own form");
  assert.ok(confirming!.headers.get("content-security-policy")!.includes(`script-src 'nonce-${nonce![1]}'`), "only that script may run");
  assert.match(confirmingHtml, /<input type="hidden" name="action" value="accept">/, "form.submit() carries no button, so the action is a field");
  assert.equal((await subscriptionRecipients(env)).length, 1, "rendering the page does not subscribe anyone");

  const invited = await requestToken(env, "friend@example.org", "invite");
  const invitation = await subscriptionRoutes(new Request(`${env.SITE_ORIGIN}/subscriptions/confirm?token=${invited.token}`), env);
  const invitationHtml = await invitation!.text();
  assert.ok(!invitationHtml.includes("<script"), "an invitation is a choice between accept and decline, so it waits");
  assert.match(invitationHtml, /Accept invitation/);
  assert.match(invitationHtml, /Decline/);
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
  const page = await subscriptionRoutes(new Request(link), env);
  assert.equal(page?.status, 200);
  assert.match(await page!.text(), /<script nonce="[a-f0-9]{32}">/, "an unsubscribe link from a digest takes one click");
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

test("unsubscribe-by-email takes effect immediately and is a no-op for unknown or repeated addresses", async context => {
  const { env, database, miniflare } = await fixture();
  context.after(() => miniflare.dispose());
  assert.equal(await unsubscribeAddress(env, " Legacy@Example.org "), true);
  assert.equal((await subscriptionRecipients(env)).length, 0);
  assert.equal(await unsubscribeAddress(env, "legacy@example.org"), false, "a repeat is a harmless no-op");
  assert.equal(await unsubscribeAddress(env, "unknown@example.org"), false);
  assert.equal((await database.prepare("SELECT COUNT(*) AS n FROM subscribers WHERE email = 'unknown@example.org'").first<any>())!.n, 0);
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
  assert.equal(await unsubscribeAddress(env, "unknown@example.org"), false);
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
  // The catch-up uses the weekly brief's presentation: per-week metrics, a lead story with image,
  // key points and why-it-matters, and every story linked to the source it was reported in.
  for (const report of reports) {
    const top = report.items[0];
    assert.ok(html.includes(escapeHtml(top.whyItMatters)), `why it matters for ${report.slug}`);
    for (const point of top.keyPoints.slice(0, 3)) assert.ok(html.includes(escapeHtml(point)), `key point for ${report.slug}`);
    for (const pulse of report.dashboard?.sectorPulses ?? []) assert.ok(html.includes(escapeHtml(pulse.value)), `pulse for ${report.slug}`);
    assert.ok(html.includes(`/images/editorial/`), "lead stories keep their editorial image");
    assert.match(html, new RegExp(`Open issue (<!-- -->)?${report.issueNumber}`), `issue button for ${report.slug}`);
    assert.ok(html.includes(`/reports/${report.slug}/`), `issue link for ${report.slug}`);
    for (const item of report.items) assert.ok(html.includes(`href="${item.citations[0].url}"`), `source link for ${item.headline}`);
  }
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
  verification = { success: true, hostname: "site.example.org", action: "subscription" };
  assert.equal((await submit())?.status, 200, "the widget is solved on the site, which hosts the pages");
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

test("invitations carry an optional plain inviter name and expire after 30 days; self-subscriptions after 7", async context => {
  const { env, miniflare } = await fixture();
  context.after(() => miniflare.dispose());
  const now = Date.now();
  const { message: invite, token } = await requestToken(env, "friend@example.org", "invite", "  Fabrizio   Petrozzi ");
  assert.equal(invite.inviterName, "Fabrizio Petrozzi");
  assert.ok(Math.abs(Date.parse(invite.expiresAt) - now - 30 * 86_400_000) < 60_000);
  const page = await subscriptionRoutes(new Request(`${env.SITE_ORIGIN}/subscriptions/confirm?token=${token}`), env);
  assert.match(await page!.text(), /Fabrizio Petrozzi invited you to the weekly digest/);
  const { message: own } = await requestToken(env, "self@example.org", "subscribe", "Ignored for self-subscriptions");
  assert.equal(own.inviterName, undefined);
  assert.ok(Math.abs(Date.parse(own.expiresAt) - now - 7 * 86_400_000) < 60_000);
  for (const name of ["Visit https://example.org", "Name\r\nBcc: bad@example.org", "a".repeat(61), "<b>Name</b>"]) {
    assert.equal(inviterNameSchema.safeParse(name).success, false, name);
  }
  await assert.rejects(requestSubscription(env, "other@example.org", "invite", "https://example.org"));
});

test("the public form unsubscribes immediately without email, answers the same for unknown addresses, and dispatches delivery for requests", async context => {
  const { env, miniflare } = await fixture();
  context.after(() => miniflare.dispose());
  env.SUBSCRIPTIONS_TURNSTILE_SECRET = "test-secret";
  env.GITHUB_WORKFLOW_TOKEN = "workflow-token";
  env.GITHUB_OWNER = "owner";
  env.GITHUB_REPO = "repo";
  const dispatches: string[] = [];
  context.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
    const target = String(input);
    if (target.startsWith("https://api.github.com/")) {
      dispatches.push(target);
      return new Response(null, { status: 204 });
    }
    return Response.json({ success: true, hostname: "review.example.org", action: "subscription" });
  });
  const submit = (body: string, ip: string) => subscriptionRoutes(new Request(`${env.REVIEW_ORIGIN}/subscriptions/request`, {
    method: "POST", headers: { origin: env.REVIEW_ORIGIN, "content-type": "application/x-www-form-urlencoded", "cf-connecting-ip": ip },
    body: `${body}&cf-turnstile-response=challenge`
  }), env);
  const known = await submit("email=legacy%40example.org&intent=unsubscribe", "192.0.2.10");
  const unknown = await submit("email=nobody%40example.org&intent=unsubscribe", "192.0.2.11");
  assert.equal(known?.status, 200);
  assert.equal((await subscriptionRecipients(env)).length, 0);
  assert.equal(await claimMail(env), null, "no confirmation email is queued");
  assert.equal(await known!.text(), await unknown!.text(), "the response does not reveal whether an address was subscribed");
  assert.deepEqual(dispatches, []);
  const invited = await submit("email=friend%40example.org&intent=invite&name=Fabrizio", "192.0.2.12");
  assert.equal(invited?.status, 200);
  assert.deepEqual(dispatches, ["https://api.github.com/repos/owner/repo/actions/workflows/subscriptions.yml/dispatches"]);
  assert.equal((await claimMail(env))?.inviterName, "Fabrizio");
  const badName = await submit("email=other%40example.org&intent=invite&name=https%3A%2F%2Fexample.org", "192.0.2.13");
  assert.equal(badName?.status, 400);
  assert.match(await badName!.text(), /Check your name/);
});

test("subscription emails are branded, hide the token behind a button, and name the inviter", async () => {
  const url = `https://review.example.org/subscriptions/confirm?token=${"a".repeat(64)}`;
  const invite = { kind: "invite" as const, url, inviterName: "Fabrizio <Petrozzi>", expiresAt: "2026-10-17T12:00:00.000Z" };
  const { html, text } = await renderSubscriptionEmail(invite, "https://proterra-intelligence.pages.dev");
  assert.match(getSubscriptionSubject(invite), /^Fabrizio <Petrozzi> invited you to Proterra Intelligence$/);
  assert.ok(html.includes(`href="${url}"`));
  assert.ok(html.includes("Fabrizio &lt;Petrozzi&gt;"));
  assert.ok(!html.replace(/href="[^"]*"/g, "").includes("a".repeat(64)), "the raw token appears only inside link targets");
  assert.ok(text.includes(url));
  assert.match(text, /October 17, 2026/);
  const self = await renderSubscriptionEmail({ kind: "subscribe", url, expiresAt: "2026-09-24T12:00:00.000Z" }, "https://proterra-intelligence.pages.dev");
  assert.match(self.text, /Confirm subscription/i);
  assert.match(getSubscriptionSubject({ kind: "invite", url, expiresAt: invite.expiresAt }), /invited to/);
});

test("the site hosts the pages: links point at it, the Worker host redirects, and only subscription paths are forwarded", async context => {
  const { env, miniflare } = await fixture();
  context.after(() => miniflare.dispose());
  const [recipient] = await subscriptionRecipients(env);
  assert.ok(recipient.unsubscribeUrl.startsWith(`${env.SITE_ORIGIN}/subscriptions/unsubscribe?`), recipient.unsubscribeUrl);
  const { message } = await requestToken(env, "friend@example.org", "invite");
  assert.ok(message.url.startsWith(`${env.SITE_ORIGIN}/subscriptions/confirm?`), message.url);

  const moved = await subscriptionRoutes(new Request(`${env.REVIEW_ORIGIN}/subscriptions?intent=invite`), env);
  assert.equal(moved?.status, 302);
  assert.equal(moved?.headers.get("location"), `${env.SITE_ORIGIN}/subscriptions?intent=invite`);
  env.SUBSCRIPTIONS_TURNSTILE_SITE_KEY = "test-site-key";
  env.SUBSCRIPTIONS_TURNSTILE_SECRET = "test-secret";
  const page = await subscriptionRoutes(new Request(`${env.SITE_ORIGIN}/subscriptions?intent=invite`), env);
  assert.equal(page?.status, 200);
  assert.match(await page!.text(), /Primary navigation/, "the site header stays available on subscription pages");

  const forwarded: string[] = [];
  const binding = { fetch: async (request: Request) => { forwarded.push(new URL(request.url).pathname); return new Response("ok"); } };
  for (const path of ["/subscriptions", "/subscriptions/confirm", "/subscriptions/unsubscribe"]) {
    assert.equal((await subscriptionsRoute({ request: new Request(`${env.SITE_ORIGIN}${path}`), env: { SUBSCRIPTIONS: binding } })).status, 200);
  }
  assert.deepEqual(forwarded, ["/subscriptions", "/subscriptions/confirm", "/subscriptions/unsubscribe"]);
  for (const path of ["/subscribers", "/api/internal/subscriptions/claim", "/review/2026-09-14", "/subscriptionsX"]) {
    assert.equal((await subscriptionsRoute({ request: new Request(`${env.SITE_ORIGIN}${path}`), env: { SUBSCRIPTIONS: binding } })).status, 404, path);
  }
  assert.deepEqual(forwarded.length, 3, "review and admin routes are never forwarded from the site");
  assert.equal((await subscriptionsRoute({ request: new Request(`${env.SITE_ORIGIN}/subscriptions`), env: {} })).status, 503);
});
