import { z } from "zod";
import { assertService, authenticatedEmail } from "./auth";
import { escapeHtml as e } from "./html";
import type { Env } from "./index";

type Kind = "invite" | "subscribe" | "unsubscribe";
type Subscriber = { id: string; email: string; status: string; version: number };
const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());
const kindSchema = z.enum(["invite", "subscribe", "unsubscribe"]);
const seconds = () => Math.floor(Date.now() / 1000);
const genericMessage = "If this address is eligible, an email will arrive with the next step. Please check your inbox and spam folder. Nothing changes until the recipient confirms.";

function page(title: string, content: string, status = 200) {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${e(title)} · Proterra Intelligence</title><style>body{font:16px/1.6 system-ui,sans-serif;color:#173f32;background:#f3f6f4;margin:0;padding:32px 16px}main{max-width:760px;margin:auto;background:white;padding:32px;border-radius:12px}h1{line-height:1.2}label{display:block;margin:16px 0}input{font:inherit;box-sizing:border-box;padding:10px;width:100%;max-width:440px}button{font:inherit;background:#145f4a;color:white;border:0;border-radius:5px;padding:12px 18px;margin:12px 8px 0 0;cursor:pointer}a{color:#145f4a}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:10px;border-bottom:1px solid #dce4e0;overflow-wrap:anywhere}.trap{position:absolute;left:-10000px}small{color:#62706b}</style></head><body><main><p>PROTERRA INTELLIGENCE</p><h1>${e(title)}</h1>${content}</main></body></html>`, {
    status, headers: {
      "content-type": "text/html; charset=utf-8", "cache-control": "no-store",
      "referrer-policy": "no-referrer", "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src https://challenges.cloudflare.com; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
    }
  });
}

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}

async function form(request: Request) {
  const text = await request.text();
  if (new TextEncoder().encode(text).length > 8192) throw new Response("Request too large", { status: 413 });
  if (!request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded")) throw new Response("Expected form data", { status: 415 });
  return new URLSearchParams(text);
}

function sameOrigin(request: Request, env: Env, allowSite = false) {
  const allowed = [env.REVIEW_ORIGIN.replace(/\/$/, "")];
  if (allowSite) allowed.push(env.SITE_ORIGIN.replace(/\/$/, ""));
  if (!allowed.includes(request.headers.get("origin") ?? "")) throw new Response("Invalid origin", { status: 403 });
}

async function hash(value: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), b => b.toString(16).padStart(2, "0")).join("");
}

async function signature(env: Env, value: string) {
  if (!env.CSRF_SECRET) throw new Response("Subscription signing is unavailable", { status: 503 });
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.CSRF_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`subscription:${value}`))), b => b.toString(16).padStart(2, "0")).join("");
}

export async function unsubscribeUrl(env: Env, subscriber: Subscriber) {
  const token = await signature(env, `${subscriber.id}:${subscriber.version}`);
  return `${env.REVIEW_ORIGIN}/subscriptions/unsubscribe?id=${encodeURIComponent(subscriber.id)}&token=${token}`;
}

async function initialized(env: Env) {
  if (!await env.REVIEW_DB.prepare("SELECT id FROM subscription_meta WHERE id = 1").first()) {
    throw new Response("Subscriptions are not yet available. Please try again later.", { status: 503 });
  }
}

async function limit(env: Env, key: string, maximum: number, duration: number) {
  const window = Math.floor(seconds() / duration);
  const result = await env.REVIEW_DB.prepare(`INSERT INTO subscription_limits (key, count, expires_at) VALUES (?, 1, ?)
    ON CONFLICT(key) DO UPDATE SET count = count + 1 WHERE count < ? RETURNING count`)
    .bind(await signature(env, `limit:${key}:${window}`), (window + 1) * duration, maximum).first();
  return Boolean(result);
}

export async function requestSubscription(env: Env, email: string, kind: Kind) {
  await initialized(env);
  email = emailSchema.parse(email);
  if (!await limit(env, `address:${kind}:${email}`, 1, 86400)) return;
  const existing = await env.REVIEW_DB.prepare("SELECT * FROM subscribers WHERE email = ?").bind(email).first<Subscriber>();
  if (kind === "unsubscribe" && existing?.status !== "active") return;
  if (kind !== "unsubscribe" && existing?.status === "active") return;
  // A declined invitation or unsubscribe suppresses future third-party invitations.
  // The address owner can still explicitly request a new subscription.
  if (kind === "invite" && ["declined", "unsubscribed"].includes(existing?.status ?? "")) return;
  const id = crypto.randomUUID();
  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");
  const subscriberId = existing?.id ?? crypto.randomUUID();
  await env.REVIEW_DB.batch([
    env.REVIEW_DB.prepare("INSERT OR IGNORE INTO subscribers (id, email, status, source) VALUES (?, ?, 'pending', ?)").bind(subscriberId, email, kind === "unsubscribe" ? "subscribe" : kind),
    env.REVIEW_DB.prepare(`INSERT INTO subscription_requests (id, subscriber_id, kind, token_hash, subscriber_version, expires_at)
      SELECT ?, id, ?, ?, version, ? FROM subscribers WHERE email = ?`)
      .bind(id, kind, await hash(token), seconds() + 7 * 86400, email),
    env.REVIEW_DB.prepare("INSERT INTO subscription_mail (id, token) VALUES (?, ?)").bind(id, token)
  ]);
}

export async function consumeRequest(env: Env, token: string, action: string) {
  if (!/^[a-f0-9]{64}$/.test(token) || !["accept", "decline", "unsubscribe"].includes(action)) return false;
  const request = await env.REVIEW_DB.prepare(`SELECT r.*, s.version, s.status FROM subscription_requests r
    JOIN subscribers s ON s.id = r.subscriber_id WHERE token_hash = ?`).bind(await hash(token))
    .first<{ id: string; subscriber_id: string; kind: Kind; subscriber_version: number; version: number; expires_at: number; consumed_at: string | null }>();
  if (!request || request.consumed_at || request.expires_at <= seconds() || request.subscriber_version !== request.version) return false;
  if ((request.kind === "unsubscribe") !== (action === "unsubscribe")) return false;
  const status = action === "accept" ? "active" : action === "decline" ? "declined" : "unsubscribed";
  const results = await env.REVIEW_DB.batch([
    env.REVIEW_DB.prepare(`UPDATE subscribers SET status = ?, source = CASE WHEN ? = 'active' THEN ? ELSE source END,
      version = version + 1, confirmed_at = CASE WHEN ? = 'active' THEN CURRENT_TIMESTAMP ELSE confirmed_at END,
      updated_at = CURRENT_TIMESTAMP WHERE id = ? AND version = ?
      AND EXISTS (SELECT 1 FROM subscription_requests WHERE id = ? AND consumed_at IS NULL AND expires_at > ?)`)
      .bind(status, status, request.kind, status, request.subscriber_id, request.version, request.id, seconds()),
    env.REVIEW_DB.prepare("UPDATE subscription_requests SET consumed_at = CURRENT_TIMESTAMP WHERE subscriber_id = ? AND consumed_at IS NULL").bind(request.subscriber_id),
    env.REVIEW_DB.prepare("UPDATE subscription_mail SET status = 'cancelled', token = NULL WHERE id IN (SELECT id FROM subscription_requests WHERE subscriber_id = ?) AND status != 'sent'").bind(request.subscriber_id)
  ]);
  return results[0].meta.changes === 1;
}

async function tokenSubscriber(env: Env, id: string, token: string) {
  if (!/^[a-f0-9-]{36}$/.test(id) || !/^[a-f0-9]{64}$/.test(token)) return null;
  const subscriber = await env.REVIEW_DB.prepare("SELECT * FROM subscribers WHERE id = ? AND status = 'active'").bind(id).first<Subscriber>();
  if (!subscriber) return null;
  const expected = await signature(env, `${subscriber.id}:${subscriber.version}`);
  let difference = 0;
  for (let index = 0; index < expected.length; index++) difference |= expected.charCodeAt(index) ^ token.charCodeAt(index);
  return difference === 0 ? subscriber : null;
}

export async function removeSubscriber(env: Env, id: string, token: string) {
  const subscriber = await tokenSubscriber(env, id, token);
  if (!subscriber) return false;
  const results = await env.REVIEW_DB.batch([
    env.REVIEW_DB.prepare("UPDATE subscribers SET status = 'unsubscribed', version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND version = ? AND status = 'active'").bind(id, subscriber.version),
    env.REVIEW_DB.prepare("UPDATE subscription_requests SET consumed_at = CURRENT_TIMESTAMP WHERE subscriber_id = ? AND consumed_at IS NULL").bind(id),
    env.REVIEW_DB.prepare("UPDATE subscription_mail SET status = 'cancelled', token = NULL WHERE id IN (SELECT id FROM subscription_requests WHERE subscriber_id = ?) AND status != 'sent'").bind(id)
  ]);
  return results[0].meta.changes === 1;
}

export async function subscriptionRecipients(env: Env): Promise<{ email: string; unsubscribeUrl: string }[]> {
  await initialized(env);
  const rows = await env.REVIEW_DB.prepare("SELECT id, email, status, version FROM subscribers WHERE status = 'active' ORDER BY email").all<Subscriber>();
  return Promise.all(rows.results.map(async row => ({ email: row.email, unsubscribeUrl: await unsubscribeUrl(env, row) })));
}

export async function importSubscribers(env: Env, emails: string[]) {
  if (await env.REVIEW_DB.prepare("SELECT id FROM subscription_meta WHERE id = 1").first()) throw new Response("Recipients already imported", { status: 409 });
  const normalized = [...new Set(z.array(emailSchema).min(1).max(500).parse(emails))];
  // D1 batches are transactional: initialization cannot become visible before the import.
  await env.REVIEW_DB.batch([
    env.REVIEW_DB.prepare("INSERT INTO subscription_meta (id) VALUES (1)"),
    ...normalized.map(email => env.REVIEW_DB.prepare("INSERT INTO subscribers (id, email, status, source) VALUES (?, ?, 'active', 'legacy')").bind(crypto.randomUUID(), email))
  ]);
  return normalized.length;
}

export async function claimMail(env: Env) {
  await initialized(env);
  await env.REVIEW_DB.batch([
    env.REVIEW_DB.prepare("DELETE FROM subscription_limits WHERE expires_at < ?").bind(seconds()),
    env.REVIEW_DB.prepare(`UPDATE subscription_mail SET status = 'cancelled', token = NULL WHERE status != 'sent'
      AND id IN (SELECT r.id FROM subscription_requests r JOIN subscribers s ON s.id = r.subscriber_id
        WHERE r.consumed_at IS NOT NULL OR r.expires_at <= ? OR r.subscriber_version != s.version)`).bind(seconds())
  ]);
  const lease = crypto.randomUUID();
  // One durable lease at a time; expired leases are retried with the same Message-ID.
  await env.REVIEW_DB.prepare(`UPDATE subscription_mail SET status = 'sending', lease_id = ?, lease_until = ?, attempts = attempts + 1
    WHERE id = (SELECT id FROM subscription_mail WHERE status = 'pending' OR (status = 'sending' AND lease_until < ?)
      ORDER BY created_at LIMIT 1)`).bind(lease, seconds() + 900, seconds()).run();
  const row = await env.REVIEW_DB.prepare(`SELECT m.id, m.token, r.kind, s.email FROM subscription_mail m
    JOIN subscription_requests r ON r.id = m.id JOIN subscribers s ON s.id = r.subscriber_id
    WHERE m.lease_id = ? AND m.status = 'sending'`).bind(lease).first<{ id: string; token: string; kind: Kind; email: string }>();
  return row ? { id: row.id, lease, email: row.email, kind: row.kind, url: `${env.REVIEW_ORIGIN}/subscriptions/confirm?token=${row.token}` } : null;
}

export async function subscriptionRoutes(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/internal/subscriptions/")) {
    assertService(request, env);
    const action = url.pathname.slice("/api/internal/subscriptions/".length);
    if (action === "recipients" && request.method === "GET") return json({ recipients: await subscriptionRecipients(env) });
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > 150_000) return new Response("Request too large", { status: 413 });
    let input: unknown;
    try { input = JSON.parse(raw || "{}"); } catch { return new Response("Invalid JSON", { status: 400 }); }
    if (action === "import") return json({ count: await importSubscribers(env, z.object({ emails: z.array(z.string()) }).parse(input).emails) });
    if (action === "claim") return json({ message: await claimMail(env) });
    if (action === "ack") {
      const { id, lease } = z.object({ id: z.uuid(), lease: z.uuid() }).parse(input);
      const result = await env.REVIEW_DB.prepare("UPDATE subscription_mail SET status = 'sent', token = NULL WHERE id = ? AND lease_id = ? AND status = 'sending'").bind(id, lease).run();
      return json({ acknowledged: result.meta.changes === 1 });
    }
    return new Response("Not found", { status: 404 });
  }
  if (url.pathname === "/subscribers" && request.method === "GET") {
    const email = await authenticatedEmail(request, env);
    const allowed = await env.REVIEW_DB.prepare("SELECT email FROM review_users WHERE email = ? AND active = 1 AND role = 'publisher'").bind(email).first();
    if (!allowed) return new Response("Publisher access required", { status: 403 });
    await initialized(env);
    const rows = await env.REVIEW_DB.prepare("SELECT email, status, source, updated_at FROM subscribers ORDER BY status, email").all<{ email: string; status: string; source: string; updated_at: string }>();
    const count = rows.results.filter(row => row.status === "active").length;
    return page("Digest subscribers", `<p>${count} active recipient(s). Only active subscribers receive the digest.</p><table><thead><tr><th>Email</th><th>Status</th><th>Source</th><th>Updated (UTC)</th></tr></thead><tbody>${rows.results.map(row => `<tr><td>${e(row.email)}</td><td>${e(row.status)}</td><td>${e(row.source)}</td><td>${e(row.updated_at)}</td></tr>`).join("")}</tbody></table>`);
  }
  if (!url.pathname.startsWith("/subscriptions")) return null;
  if (url.pathname === "/subscriptions/unsubscribe") {
    const id = url.searchParams.get("id") ?? "";
    const token = url.searchParams.get("token") ?? "";
    if (request.method === "POST") {
      const data = await form(request);
      // RFC 8058 mailbox requests carry the unguessable per-subscriber capability.
      if (data.get("List-Unsubscribe") !== "One-Click") sameOrigin(request, env);
      const changed = await removeSubscriber(env, id, token);
      return page("Unsubscribe", changed ? "<p>You have been unsubscribed from the weekly digest.</p>" : "<p>This link is no longer active. You may already be unsubscribed.</p>");
    }
    if (request.method === "GET") {
      if (!await tokenSubscriber(env, id, token)) return page("Unsubscribe", "<p>This link is no longer active. You may already be unsubscribed.</p>", 410);
      return page("Unsubscribe", `<p>Stop receiving the Proterra Intelligence weekly digest?</p><form method="post"><button type="submit">Unsubscribe</button></form>`);
    }
  }
  if (url.pathname === "/subscriptions/confirm") {
    const token = url.searchParams.get("token") ?? "";
    if (request.method === "POST") {
      sameOrigin(request, env);
      const data = await form(request);
      const action = data.get("action") ?? "";
      const changed = await consumeRequest(env, token, action);
      return page(changed ? "Preference saved" : "Link no longer active", changed
        ? `<p>${action === "accept" ? "You are subscribed to the weekly digest." : action === "decline" ? "Invitation declined. You have not been added to the digest." : "You have been unsubscribed from the weekly digest."}</p>`
        : "<p>This link has expired or was already used. Request a new link if you still want to change your preference.</p>", changed ? 200 : 410);
    }
    if (request.method === "GET") {
      const row = /^[a-f0-9]{64}$/.test(token) ? await env.REVIEW_DB.prepare(`SELECT r.kind FROM subscription_requests r JOIN subscribers s ON s.id = r.subscriber_id
        WHERE r.token_hash = ? AND r.consumed_at IS NULL AND r.expires_at > ? AND r.subscriber_version = s.version`).bind(await hash(token), seconds()).first<{ kind: Kind }>() : null;
      if (!row) return page("Link no longer active", "<p>This link has expired or was already used.</p>", 410);
      return page(row.kind === "unsubscribe" ? "Confirm unsubscribe" : "Join the weekly digest", `<p>${row.kind === "unsubscribe" ? "Stop receiving the weekly digest?" : "Receive weekly coverage of dairy, meat, and bovine genetics. You can unsubscribe at any time."}</p><form method="post">${row.kind === "unsubscribe" ? '<button name="action" value="unsubscribe">Unsubscribe</button>' : '<button name="action" value="accept">Accept and subscribe</button><button name="action" value="decline">Decline</button>'}</form>`);
    }
  }
  if (url.pathname === "/subscriptions/request" && request.method === "POST") {
    sameOrigin(request, env);
    await initialized(env);
    if (!env.SUBSCRIPTIONS_TURNSTILE_SECRET) return page("Temporarily unavailable", "<p>Please try again later.</p>", 503);
    const data = await form(request);
    if (data.get("website")) return page("Check your inbox", `<p>${genericMessage}</p>`);
    const email = emailSchema.parse(data.get("email"));
    const kind = kindSchema.parse(data.get("intent"));
    const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
    if (!await limit(env, `ip:${ip}`, 5, 3600)) return page("Please try later", "<p>Too many requests. Please try again later.</p>", 429);
    const verification = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST", body: new URLSearchParams({ secret: env.SUBSCRIPTIONS_TURNSTILE_SECRET, response: data.get("cf-turnstile-response") ?? "", remoteip: ip }), signal: AbortSignal.timeout(10000)
    });
    const result = await verification.json() as { success: boolean; hostname?: string; action?: string };
    if (!result.success || result.hostname !== new URL(env.REVIEW_ORIGIN).hostname || result.action !== "subscription") return page("Verification needed", "<p>Please return to the form and complete verification.</p>", 400);
    if (!await limit(env, "global", 100, 86400)) return page("Please try later", "<p>Please try again tomorrow.</p>", 429);
    await requestSubscription(env, email, kind);
    return page("Check your inbox", `<p>${genericMessage}</p>`);
  }
  if ((url.pathname === "/subscriptions" && request.method === "GET") || (url.pathname === "/subscriptions/start" && request.method === "POST")) {
    await initialized(env);
    let email = "";
    let kind: Kind = kindSchema.catch("subscribe").parse(url.searchParams.get("intent"));
    if (request.method === "POST") {
      sameOrigin(request, env, true);
      const data = await form(request);
      email = emailSchema.parse(data.get("email"));
      kind = kindSchema.parse(data.get("intent"));
    }
    if (!env.SUBSCRIPTIONS_TURNSTILE_SITE_KEY || !env.SUBSCRIPTIONS_TURNSTILE_SECRET) return page("Temporarily unavailable", "<p>Subscription forms are being set up. Please try again later.</p>", 503);
    const title = kind === "invite" ? "Share with others" : kind === "unsubscribe" ? "Unsubscribe" : "Subscribe to the weekly digest";
    return page(title, `<p>${kind === "invite" ? "They will receive an invitation and can accept or decline." : kind === "unsubscribe" ? "We will email you a link to confirm your request." : "We will email you a confirmation link before adding you."}</p><form method="post" action="/subscriptions/request"><input type="hidden" name="intent" value="${kind}"><label>Email address<input type="email" name="email" value="${e(email)}" autocomplete="email" maxlength="254" required></label><label class="trap" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"></label><div class="cf-turnstile" data-sitekey="${e(env.SUBSCRIPTIONS_TURNSTILE_SITE_KEY)}" data-action="subscription"></div><button type="submit">${kind === "invite" ? "Send invitation" : "Send confirmation link"}</button></form><script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>`);
  }
  return new Response("Not found", { status: 404 });
}
