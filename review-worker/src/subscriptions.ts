import { z } from "zod";
import { assertService, authenticatedEmail } from "./auth";
import { escapeHtml as e } from "./html";
import type { Env } from "./index";

type Kind = "invite" | "subscribe" | "unsubscribe";
type Subscriber = { id: string; email: string; status: string; version: number };
const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());
const kindSchema = z.enum(["invite", "subscribe", "unsubscribe"]);
// Shown to a third party in an invitation: plain name characters only, so it cannot carry links or header breaks.
export const inviterNameSchema = z.string().trim().max(60).regex(/^[\p{L}\p{M}\p{N} .,'’()&-]*$/u).transform(value => value.replace(/\s+/g, " ") || undefined);
// Invitations wait on someone who did not ask for them; self-subscriptions are confirmed right away.
export const requestLifetimeDays = { invite: 30, subscribe: 7 } as const;
const redirectSeconds = 5;
const seconds = () => Math.floor(Date.now() / 1000);
const genericMessage = "If this address can receive the digest, an email with the next step is on its way. It can take a minute or two, so check your spam folder if it doesn't arrive. Nothing changes until the recipient confirms.";

const pageStyles = `
:root{--ink:#17201c;--muted:#5e6963;--paper:#f4f3ed;--paper-deep:#e9e9e1;--surface:#fafaf6;--forest:#173f32;--forest-deep:#0c2c22;--mint:#b7d7c1;--line:rgba(23,32,28,.14);--line-strong:rgba(23,32,28,.28);--focus:0 0 0 3px rgba(23,63,50,.22)}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;color:var(--ink);background:radial-gradient(circle at 86% 5%,rgba(183,215,193,.17),transparent 26rem),var(--paper);font:16px/1.55 "Aptos","Segoe UI","Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased}
.shell{width:min(calc(100% - 2rem),78rem);margin:0 auto;display:flex;align-items:center;min-height:5.25rem;border-bottom:1px solid var(--line-strong)}
.brand{display:inline-flex;align-items:center;gap:.8rem;color:var(--ink);font-size:.94rem;font-weight:650;letter-spacing:-.015em;text-decoration:none}
.mark{display:grid;place-items:center;width:2.4rem;height:2.4rem;border-radius:50%;color:var(--surface);background:var(--forest);font-size:.67rem;font-weight:750;letter-spacing:.08em}
main{width:min(calc(100% - 2rem),33rem);margin:clamp(2rem,9vh,5rem) auto 4rem;padding:clamp(1.5rem,5vw,2.5rem);border:1px solid var(--line);border-radius:1.25rem;background:var(--surface);box-shadow:0 20px 55px rgba(18,43,34,.08)}
main.wide{width:min(calc(100% - 2rem),60rem)}
h1{margin:0;font-size:clamp(1.8rem,5vw,2.35rem);font-weight:540;letter-spacing:-.04em;line-height:1.08}
p{margin:.85rem 0 0;color:var(--muted)}
strong{color:var(--ink);font-weight:650}
a{color:var(--forest);text-underline-offset:.16em}
.done{display:grid;place-items:center;width:2.75rem;height:2.75rem;margin-bottom:1.25rem;border-radius:50%;background:var(--mint)}
.done svg{width:1.3rem;height:1.3rem;fill:none;stroke:var(--forest-deep);stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
form{margin-top:1.6rem}
form>label:first-of-type,form>.actions:first-child{margin-top:0}
label{display:block;margin-top:1.15rem;font-size:.86rem;font-weight:650}
label small{margin-left:.35rem;color:var(--muted);font-size:.8rem;font-weight:400}
input:not([type=hidden]){display:block;width:100%;margin-top:.45rem;padding:.78rem .95rem;border:1px solid var(--line-strong);border-radius:.65rem;color:var(--ink);background:#fff;font:inherit;font-size:1rem}
input:focus{outline:0;border-color:var(--forest);box-shadow:var(--focus)}
.hint{margin-top:.4rem;font-size:.8rem}
.cf-turnstile{min-height:65px;margin-top:1.3rem}
.actions{display:flex;flex-wrap:wrap;gap:.6rem;margin-top:1.4rem}
button,.button{display:inline-flex;align-items:center;justify-content:center;min-height:2.9rem;padding:.7rem 1.35rem;border:1px solid var(--forest);border-radius:999px;color:var(--surface);background:var(--forest);font:inherit;font-size:.93rem;font-weight:650;text-decoration:none;cursor:pointer;transition:background-color 160ms ease,border-color 160ms ease}
button:hover,.button:hover{background:var(--forest-deep)}
button.quiet,.button.quiet{color:var(--ink);background:transparent;border-color:var(--line-strong)}
button.quiet:hover,.button.quiet:hover{border-color:var(--forest);background:var(--paper)}
:focus-visible{outline:0;box-shadow:var(--focus)}
.trap{position:absolute;left:-10000px}
.return{margin-top:1.75rem}
.return p{margin:0;font-size:.85rem}
.bar{height:3px;margin-bottom:.8rem;border-radius:3px;background:var(--paper-deep);overflow:hidden}
.bar span{display:block;height:100%;background:var(--forest);transform-origin:left;animation:fill ${redirectSeconds}s linear forwards}
@keyframes fill{from{transform:scaleX(0)}to{transform:scaleX(1)}}
.table{margin-top:1.5rem;overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:.9rem}
th,td{padding:.7rem .6rem;border-bottom:1px solid var(--line);text-align:left;overflow-wrap:anywhere}
th{color:var(--muted);font-size:.78rem;font-weight:650}
@media (max-width:30rem){.actions>*{flex:1 1 100%}}
@media (prefers-reduced-motion:reduce){.bar{display:none}button,.button{transition:none}}
`;
const doneIcon = `<div class="done" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>`;

type PageOptions = { status?: number; done?: boolean; wide?: boolean };

// done: a finished step. It shows a check mark and returns the visitor to the publication after a short pause.
function page(env: Env, title: string, content: string, { status = 200, done = false, wide = false }: PageOptions = {}) {
  const home = `${env.SITE_ORIGIN.replace(/\/$/, "")}/`;
  const refresh = done ? `<meta http-equiv="refresh" content="${redirectSeconds};url=${e(home)}">` : "";
  const returning = done ? `<div class="return"><div class="bar"><span></span></div><p>Taking you back to Proterra Intelligence. <a href="${e(home)}">Go now</a></p></div>` : "";
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="theme-color" content="#173f32">${refresh}<title>${e(title)} | Proterra Intelligence</title><style>${pageStyles}</style></head><body><header class="shell"><a class="brand" href="${e(home)}"><span class="mark" aria-hidden="true">PI</span>Proterra Intelligence</a></header><main${wide ? ' class="wide"' : ""}>${done ? doneIcon : ""}<h1>${e(title)}</h1>${content}${returning}</main></body></html>`, {
    status, headers: {
      "content-type": "text/html; charset=utf-8", "cache-control": "no-store",
      // same-origin, not no-referrer: under no-referrer browsers send `Origin: null` on these forms, which sameOrigin() rejects.
      "referrer-policy": "same-origin", "x-content-type-options": "nosniff",
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

export async function requestSubscription(env: Env, email: string, kind: "invite" | "subscribe", inviterName?: string) {
  await initialized(env);
  email = emailSchema.parse(email);
  inviterName = kind === "invite" ? inviterNameSchema.parse(inviterName ?? "") : undefined;
  if (!await limit(env, `address:${kind}:${email}`, 1, 86400)) return;
  const existing = await env.REVIEW_DB.prepare("SELECT * FROM subscribers WHERE email = ?").bind(email).first<Subscriber>();
  if (existing?.status === "active") return;
  // A declined invitation or unsubscribe suppresses future third-party invitations.
  // The address owner can still explicitly request a new subscription.
  if (kind === "invite" && ["declined", "unsubscribed"].includes(existing?.status ?? "")) return;
  const id = crypto.randomUUID();
  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");
  const subscriberId = existing?.id ?? crypto.randomUUID();
  await env.REVIEW_DB.batch([
    env.REVIEW_DB.prepare("INSERT OR IGNORE INTO subscribers (id, email, status, source) VALUES (?, ?, 'pending', ?)").bind(subscriberId, email, kind),
    env.REVIEW_DB.prepare(`INSERT INTO subscription_requests (id, subscriber_id, kind, token_hash, subscriber_version, expires_at, inviter_name)
      SELECT ?, id, ?, ?, version, ?, ? FROM subscribers WHERE email = ?`)
      .bind(id, kind, await hash(token), seconds() + requestLifetimeDays[kind] * 86400, inviterName ?? null, email),
    env.REVIEW_DB.prepare("INSERT INTO subscription_mail (id, token) VALUES (?, ?)").bind(id, token)
  ]);
}

// Unsubscribing by address takes effect immediately; there is no confirmation email.
// Callers show the same response whether or not the address was subscribed.
export async function unsubscribeAddress(env: Env, email: string) {
  await initialized(env);
  const subscriber = await env.REVIEW_DB.prepare("SELECT * FROM subscribers WHERE email = ? AND status = 'active'").bind(emailSchema.parse(email)).first<Subscriber>();
  return subscriber ? unsubscribe(env, subscriber) : false;
}

// Start the delivery workflow now instead of waiting for the schedule. The schedule still retries anything this misses.
async function triggerDelivery(env: Env) {
  if (!env.GITHUB_WORKFLOW_TOKEN) return;
  try {
    const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_REPO)}/actions/workflows/subscriptions.yml/dispatches`, {
      method: "POST",
      headers: {
        accept: "application/vnd.github+json", authorization: `Bearer ${env.GITHUB_WORKFLOW_TOKEN}`,
        "content-type": "application/json", "user-agent": "Proterra-Intelligence-Review-Worker",
        "x-github-api-version": "2022-11-28"
      },
      body: JSON.stringify({ ref: "main", inputs: { mode: "process" } }),
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) console.error(`Subscription delivery dispatch failed (${response.status})`);
  } catch (error) {
    console.error("Subscription delivery dispatch failed", error);
  }
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
  return subscriber ? unsubscribe(env, subscriber) : false;
}

async function unsubscribe(env: Env, subscriber: Subscriber) {
  const results = await env.REVIEW_DB.batch([
    env.REVIEW_DB.prepare("UPDATE subscribers SET status = 'unsubscribed', version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND version = ? AND status = 'active'").bind(subscriber.id, subscriber.version),
    env.REVIEW_DB.prepare("UPDATE subscription_requests SET consumed_at = CURRENT_TIMESTAMP WHERE subscriber_id = ? AND consumed_at IS NULL").bind(subscriber.id),
    env.REVIEW_DB.prepare("UPDATE subscription_mail SET status = 'cancelled', token = NULL WHERE id IN (SELECT id FROM subscription_requests WHERE subscriber_id = ?) AND status != 'sent'").bind(subscriber.id)
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
  const row = await env.REVIEW_DB.prepare(`SELECT m.id, m.token, r.kind, r.expires_at, r.inviter_name, s.email FROM subscription_mail m
    JOIN subscription_requests r ON r.id = m.id JOIN subscribers s ON s.id = r.subscriber_id
    WHERE m.lease_id = ? AND m.status = 'sending'`).bind(lease).first<{ id: string; token: string; kind: Kind; expires_at: number; inviter_name: string | null; email: string }>();
  return row ? {
    id: row.id, lease, email: row.email, kind: row.kind, url: `${env.REVIEW_ORIGIN}/subscriptions/confirm?token=${row.token}`,
    expiresAt: new Date(row.expires_at * 1000).toISOString(), ...(row.inviter_name ? { inviterName: row.inviter_name } : {})
  } : null;
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
    return page(env, "Digest subscribers", `<p>${count} active ${count === 1 ? "recipient" : "recipients"}. Only active subscribers receive the digest.</p><div class="table"><table><thead><tr><th>Email</th><th>Status</th><th>Source</th><th>Updated (UTC)</th></tr></thead><tbody>${rows.results.map(row => `<tr><td>${e(row.email)}</td><td>${e(row.status)}</td><td>${e(row.source)}</td><td>${e(row.updated_at)}</td></tr>`).join("")}</tbody></table></div>`, { wide: true });
  }
  if (!url.pathname.startsWith("/subscriptions")) return null;
  const homeLink = `<p><a href="${e(env.SITE_ORIGIN.replace(/\/$/, ""))}/">Go to Proterra Intelligence</a></p>`;
  const expired = () => page(env, "This link has expired", `<p>Confirmation links work once. Invitations expire after ${requestLifetimeDays.invite} days and subscription links after ${requestLifetimeDays.subscribe}. You can request a new one from Proterra Intelligence.</p>${homeLink}`, { status: 410 });
  if (url.pathname === "/subscriptions/unsubscribe") {
    const id = url.searchParams.get("id") ?? "";
    const token = url.searchParams.get("token") ?? "";
    if (request.method === "POST") {
      const data = await form(request);
      // RFC 8058 mailbox requests carry the unguessable per-subscriber capability.
      if (data.get("List-Unsubscribe") !== "One-Click") sameOrigin(request, env);
      // Mail clients retry one-click requests that fail, so an already-used link still answers 200.
      return await removeSubscriber(env, id, token)
        ? page(env, "You're unsubscribed", "<p>You won't receive the weekly digest at this address anymore. You can subscribe again from Proterra Intelligence at any time.</p>", { done: true })
        : page(env, "This link is no longer active", `<p>You may already be unsubscribed.</p>${homeLink}`);
    }
    if (request.method === "GET") {
      if (!await tokenSubscriber(env, id, token)) return page(env, "This link is no longer active", `<p>You may already be unsubscribed.</p>${homeLink}`, { status: 410 });
      return page(env, "Unsubscribe from the weekly digest", `<p>You'll stop receiving the digest at this address.</p><form method="post"><div class="actions"><button type="submit">Unsubscribe</button></div></form>`);
    }
  }
  if (url.pathname === "/subscriptions/confirm") {
    const token = url.searchParams.get("token") ?? "";
    if (request.method === "POST") {
      sameOrigin(request, env);
      const data = await form(request);
      const action = data.get("action") ?? "";
      if (!await consumeRequest(env, token, action)) return expired();
      if (action === "accept") return page(env, "You're subscribed", "<p>The next weekly digest will arrive in this inbox. Every issue has an unsubscribe link at the bottom.</p>", { done: true });
      if (action === "decline") return page(env, "Invitation declined", "<p>You haven't been added to the digest, and you won't receive more invitations to it.</p>", { done: true });
      return page(env, "You're unsubscribed", "<p>You won't receive the weekly digest at this address anymore.</p>", { done: true });
    }
    if (request.method === "GET") {
      const row = /^[a-f0-9]{64}$/.test(token) ? await env.REVIEW_DB.prepare(`SELECT r.kind, r.inviter_name FROM subscription_requests r JOIN subscribers s ON s.id = r.subscriber_id
        WHERE r.token_hash = ? AND r.consumed_at IS NULL AND r.expires_at > ? AND r.subscriber_version = s.version`).bind(await hash(token), seconds()).first<{ kind: Kind; inviter_name: string | null }>() : null;
      if (!row) return expired();
      if (row.kind === "unsubscribe") return page(env, "Confirm unsubscribe", `<p>You'll stop receiving the weekly digest at this address.</p><form method="post"><div class="actions"><button name="action" value="unsubscribe">Unsubscribe</button></div></form>`);
      const about = "<p>Weekly coverage of dairy, meat, and bovine genetics, reviewed from direct sources. Every issue has an unsubscribe link.</p>";
      if (row.kind === "invite") {
        return page(env, row.inviter_name ? `${row.inviter_name} invited you to the weekly digest` : "You're invited to the weekly digest", `${about}<form method="post"><div class="actions"><button name="action" value="accept">Accept invitation</button><button class="quiet" name="action" value="decline">Decline</button></div></form>`);
      }
      return page(env, "Confirm your subscription", `${about}<form method="post"><div class="actions"><button name="action" value="accept">Confirm subscription</button></div></form><p class="hint">Didn't ask for this? Close this page and nothing changes.</p>`);
    }
  }
  if (url.pathname === "/subscriptions/request" && request.method === "POST") {
    sameOrigin(request, env);
    await initialized(env);
    if (!env.SUBSCRIPTIONS_TURNSTILE_SECRET) return page(env, "Subscriptions are unavailable", `<p>The subscription form isn't available right now. Try again later.</p>${homeLink}`, { status: 503 });
    const data = await form(request);
    const kind = kindSchema.catch("subscribe").parse(data.get("intent"));
    const finished = () => kind === "unsubscribe"
      ? page(env, "You're unsubscribed", "<p>If this address was subscribed, it won't receive the weekly digest anymore.</p>", { done: true })
      : page(env, kind === "invite" ? "Thanks for sharing" : "Check your inbox", `<p>${genericMessage}</p>`, { done: true });
    const retry = (title: string, message: string, status = 400) => page(env, title, `<p>${message}</p><div class="actions"><a class="button" href="/subscriptions?intent=${kind}">Back to the form</a></div>`, { status });
    if (data.get("website")) return finished();
    const email = emailSchema.safeParse(data.get("email"));
    if (!email.success) return retry("Check the email address", "Enter a full email address, like name@company.com.");
    const inviterName = inviterNameSchema.safeParse(data.get("name") ?? "");
    if (kind === "invite" && !inviterName.success) return retry("Check your name", "Use letters, spaces, and simple punctuation, up to 60 characters.");
    const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
    if (!await limit(env, `ip:${ip}`, 5, 3600)) return retry("Too many attempts", "Wait an hour, then try again.", 429);
    const verification = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST", body: new URLSearchParams({ secret: env.SUBSCRIPTIONS_TURNSTILE_SECRET, response: data.get("cf-turnstile-response") ?? "", remoteip: ip }), signal: AbortSignal.timeout(10000)
    });
    const result = await verification.json() as { success: boolean; hostname?: string; action?: string };
    if (!result.success || result.hostname !== new URL(env.REVIEW_ORIGIN).hostname || result.action !== "subscription") return retry("Verification didn't finish", "Complete the check on the form, then send it again.");
    if (!await limit(env, "global", 100, 86400)) return page(env, "Too many requests today", `<p>The form has reached its daily limit. Try again tomorrow.</p>${homeLink}`, { status: 429 });
    if (kind === "unsubscribe") {
      await unsubscribeAddress(env, email.data);
      return finished();
    }
    await requestSubscription(env, email.data, kind, inviterName.success ? inviterName.data : undefined);
    await triggerDelivery(env);
    return finished();
  }
  if ((url.pathname === "/subscriptions" && request.method === "GET") || (url.pathname === "/subscriptions/start" && request.method === "POST")) {
    await initialized(env);
    let email = "";
    let kind: Kind = kindSchema.catch("subscribe").parse(url.searchParams.get("intent"));
    if (request.method === "POST") {
      sameOrigin(request, env, true);
      const data = await form(request);
      email = emailSchema.catch("").parse(data.get("email"));
      kind = kindSchema.catch("subscribe").parse(data.get("intent"));
    }
    if (!env.SUBSCRIPTIONS_TURNSTILE_SITE_KEY || !env.SUBSCRIPTIONS_TURNSTILE_SECRET) return page(env, "Subscriptions are unavailable", `<p>The subscription form isn't available right now. Try again later.</p>${homeLink}`, { status: 503 });
    const copy = {
      subscribe: { title: "Subscribe to the weekly digest", lead: "We'll email you a link to confirm. You're added once you click it.", label: "Your email address", button: "Send confirmation link" },
      invite: { title: "Invite someone to the digest", lead: "We'll email them an invitation. They're added only if they accept.", label: "Their email address", button: "Send invitation" },
      unsubscribe: { title: "Unsubscribe from the weekly digest", lead: "Enter the address that receives the digest. It stops right away.", label: "Your email address", button: "Unsubscribe" }
    }[kind];
    const nameField = kind === "invite" ? `<label for="name">Your name <small>Optional</small></label><input id="name" name="name" autocomplete="name" maxlength="60"><p class="hint">Shown in the invitation so they know who it's from.</p>` : "";
    return page(env, copy.title, `<p>${copy.lead}</p><form method="post" action="/subscriptions/request"><input type="hidden" name="intent" value="${kind}"><label for="email">${copy.label}</label><input id="email" type="email" name="email" value="${e(email)}" autocomplete="${kind === "invite" ? "off" : "email"}" maxlength="254" required>${nameField}<label class="trap" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"></label><div class="cf-turnstile" data-sitekey="${e(env.SUBSCRIPTIONS_TURNSTILE_SITE_KEY)}" data-action="subscription"></div><div class="actions"><button type="submit">${copy.button}</button></div></form><script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>`);
  }
  return new Response("Not found", { status: 404 });
}
