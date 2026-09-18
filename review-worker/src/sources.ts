import { z } from "zod";
import registry from "../../src/data/sources.json";
import collection from "../../config/collection-sources.json";
import { assertCsrf, assertService, authenticatedEmail, csrfToken } from "./auth";
import { escapeHtml as e } from "./html";
import { acceptedPublisher, acceptedStory, areas, dateSchema, decisionSchema, regions, submissionSchema, topics } from "./source-model";
import { coverageChecklist } from "../../scripts/collection/coverage";
import type { Candidate } from "../../scripts/collection/types";
import type { Env } from "./index";

type Row = { id: string; kind: string; payload: string; status: string; version: number; author: string; accepted_payload: string | null; review_note: string; reviewed_by: string | null; sync_error: string | null; applied_sha: string | null };
const json = (value: unknown) => Response.json(value, { headers: { "cache-control": "no-store" } });
const redirect = (path: string) => new Response(null, { status: 303, headers: { location: path } });
const nextIssue = () => { const date = new Date(); date.setUTCDate(date.getUTCDate() + ((8 - date.getUTCDay()) % 7 || 7)); return date.toISOString().slice(0, 10); };
const label = (value: string) => ({ "bovine-genetics": "Bovine genetics", dairy: "Dairy", meat: "Meat", pending: "Needs review", accepted: "Accepted · waiting for collection", applied: "Added", declined: "Declined" }[value] ?? value);
function page(env: Env, title: string, html: string, status = 200) {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(title)} · Proterra Intelligence</title><style>
  *{box-sizing:border-box}body{margin:0;background:#f7f5ef;color:#173f32;font:16px/1.6 system-ui,sans-serif}main{max-width:1080px;margin:auto;padding:24px}nav,.actions{display:flex;gap:16px;flex-wrap:wrap;align-items:center}nav{border-bottom:1px solid #cad7cc;padding-bottom:18px}a{color:#176748}h1,h2{line-height:1.2}h1{font:44px Georgia,serif}h2{font:27px Georgia,serif}article,section,fieldset{border:1px solid #cedbd2;background:white;padding:22px;border-radius:12px;margin:18px 0}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px}.grid article{margin:0}label{display:block;margin:14px 0}input:not([type=checkbox]),textarea,select{display:block;width:100%;font:inherit;border:1px solid #8fa69a;border-radius:6px;padding:10px;background:#fff}textarea{min-height:100px}input[type=checkbox]{margin-right:9px}button,.button{display:inline-block;background:#173f32;color:white;border:0;border-radius:6px;padding:10px 16px;font:inherit;cursor:pointer;text-decoration:none}.secondary{background:#e5eee7;color:#173f32}.muted,small{color:#51675b}.badge{display:inline-block;padding:2px 9px;border-radius:20px;background:#e5eee7;font-size:13px}.notice{padding:16px;background:#fff0c9;border-radius:8px}.error{color:#9d2920}table{width:100%;border-collapse:collapse}td,th{text-align:left;border-bottom:1px solid #dce3dd;padding:9px;vertical-align:top;overflow-wrap:anywhere}p,dd{overflow-wrap:anywhere}summary{cursor:pointer}fieldset label{display:inline-block;margin-right:18px}.history{white-space:pre-wrap}button:focus-visible,a:focus-visible{outline:3px solid #c69e35;outline-offset:3px}@media(max-width:600px){main{padding:16px}h1{font-size:34px}}
  </style></head><body><main><nav><strong>PROTERRA INTELLIGENCE</strong><a href="${e(env.SITE_ORIGIN)}">Weekly brief</a><a href="/sources">Sources</a><a href="/sources/new">Add source or story</a><a href="/sources/review">Review list</a><a href="/sources/coverage">Coverage</a></nav><h1>${e(title)}</h1>${html}</main></body></html>`, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'" } });
}
async function readBody(request: Request, jsonBody = false) {
  // Bound the stream before decoding; submitted links are never fetched here.
  const reader = request.body?.getReader(); let size = 0; let text = ""; const decoder = new TextDecoder();
  if (reader) { try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > (jsonBody ? 4_000_000 : 16000)) throw new Response("Request too large", { status: 413 }); text += decoder.decode(value, { stream: true }); } } finally { await reader.cancel(); } }
  text += decoder.decode();
  if (jsonBody) return JSON.parse(text);
  if (!request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded")) throw new Response("Expected a form", { status: 415 });
  return new URLSearchParams(text);
}
async function reviewer(env: Env, email: string) {
  return Boolean(await env.REVIEW_DB.prepare("SELECT email FROM review_users WHERE email = ? AND active = 1").bind(email).first());
}
function inputForm(data: Record<string, unknown>, token: string) {
  const value = (key: string) => e(String(data[key] ?? ""));
  const checks = (key: string, values: readonly string[]) => values.map(v => `<label><input type="checkbox" name="${key}" value="${e(v)}"${Array.isArray(data[key]) && data[key].includes(v) ? " checked" : ""}>${e(label(v))}</label>`).join("");
  return `<input type="hidden" name="csrf" value="${e(token)}"><input type="hidden" name="sourceId" value="${value("sourceId")}">
  <label>What are you adding?<select name="kind"><option value="story"${data.kind === "story" ? " selected" : ""}>An article, announcement, or social post</option><option value="source"${data.kind === "source" ? " selected" : ""}>A publisher or source</option></select></label>
  <label>Link<input type="url" name="url" required maxlength="2000" value="${value("url")}" placeholder="https://..."></label>
  <label>Publisher name or story headline<input name="name" required minlength="3" maxlength="200" value="${value("name")}"></label>
  <fieldset><legend>Where does it matter?</legend>${checks("regions", regions)}</fieldset><fieldset><legend>Topics</legend>${checks("sectors", topics)}</fieldset>
  <label>Why is it useful or trustworthy? <small>(optional when submitting a story)</small><textarea name="notes" maxlength="2000">${value("notes")}</textarea></label>
  <details${data.kind === "story" ? " open" : ""}><summary>Story details — can be completed during review</summary>
  <label>Weekly issue date<input type="date" name="issueDate" value="${value("issueDate")}"></label>
  <label>Publication date <small>(a date is enough; paste the publisher's full timestamp if you have it)</small><input name="publishedAt" value="${value("publishedAt")}" placeholder="2026-09-17"></label>
  <label>Factual summary from the publisher<textarea name="summary" maxlength="2000">${value("summary")}</textarea></label>
  <label>Supporting article link <small>(needed for a social post)</small><input type="url" name="evidenceUrl" value="${value("evidenceUrl")}"></label></details>`;
}
function parseForm(form: URLSearchParams) {
  const object: Record<string, unknown> = Object.fromEntries(form);
  object.regions = form.getAll("regions"); object.sectors = form.getAll("sectors");
  for (const key of ["sourceId", "issueDate", "publishedAt", "evidenceUrl"]) if (!object[key]) delete object[key];
  return submissionSchema.parse(object);
}
export async function submitSource(env: Env, email: string, data: unknown) {
  const payload = submissionSchema.parse(data);
  const duplicate = await env.REVIEW_DB.prepare("SELECT id FROM source_submissions WHERE kind = ? AND canonical_url = ? AND status IN ('pending','accepted')").bind(payload.kind, payload.url).first<{ id: string }>();
  if (duplicate) return duplicate.id;
  const id = crypto.randomUUID();
  try {
    await env.REVIEW_DB.batch([
      env.REVIEW_DB.prepare("INSERT INTO source_submissions(id,kind,canonical_url,author,payload) VALUES(?,?,?,?,?)").bind(id, payload.kind, payload.url, email, JSON.stringify(payload)),
      env.REVIEW_DB.prepare("INSERT INTO source_submission_events(id,submission_id,actor,action,payload) VALUES(?,?,?,'submitted',?)").bind(crypto.randomUUID(), id, email, JSON.stringify(payload))
    ]);
  } catch (error) {
    const concurrent = await env.REVIEW_DB.prepare("SELECT id FROM source_submissions WHERE kind = ? AND canonical_url = ? AND status IN ('pending','accepted')").bind(payload.kind, payload.url).first<{ id: string }>();
    if (concurrent) return concurrent.id;
    throw error;
  }
  return id;
}
export async function decideSource(env: Env, email: string, id: string, data: unknown, decision: unknown) {
  if (!await reviewer(env, email)) throw new Response("Reviewer access required", { status: 403 });
  const payload = submissionSchema.parse(data); const input = decisionSchema.parse(decision);
  const current = await env.REVIEW_DB.prepare("SELECT * FROM source_submissions WHERE id = ?").bind(id).first<Row>();
  if (!current || (current.status !== "pending" && !(current.status === "accepted" && current.sync_error)) || current.version !== input.version) throw new Response("This submission changed. Reload it before deciding.", { status: 409 });
  let accepted: unknown = null;
  if (input.action === "accept") accepted = payload.kind === "story" ? acceptedStory(payload) : acceptedPublisher(payload, input.tier);
  if (input.action === "decline" && !input.reason) throw new Error("Add a short reason for declining.");
  const status = input.action === "accept" ? "accepted" : input.action === "decline" ? "declined" : "pending";
  const eventId = crypto.randomUUID();
  // A fresh decision also clears the previous synchronisation failure.
  const batch = [
    env.REVIEW_DB.prepare(`INSERT INTO source_submission_events(id,submission_id,actor,action,payload)
      SELECT ?,id,?,?,? FROM source_submissions WHERE id=? AND version=? AND status=?`)
      .bind(eventId, email, input.action, JSON.stringify({ payload, decision: input }), id, input.version, current.status),
    env.REVIEW_DB.prepare(`UPDATE source_submissions SET kind=?,canonical_url=?,payload=?,status=?,version=version+1,accepted_payload=?,reviewed_by=?,review_note=?,sync_error=NULL,updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND version=? AND status=? AND EXISTS(SELECT 1 FROM source_submission_events WHERE id=?)`)
      .bind(payload.kind, payload.url, JSON.stringify(payload), status, accepted ? JSON.stringify(accepted) : null, email, input.reason, id, input.version, current.status, eventId)
  ];
  let results;
  try { results = await env.REVIEW_DB.batch(batch); }
  catch (cause) {
    if (!String(cause).includes("UNIQUE")) throw cause;
    throw new Response("Another open submission already uses that link. Decide that one first.", { status: 409 });
  }
  if (results[1].meta.changes !== 1) throw new Response("Submission changed; reload it.", { status: 409 });
}
async function internal(request: Request, env: Env, path: string[]) {
  assertService(request, env);
  if (request.method === "GET" && path[0] === "accepted") {
    const rows = await env.REVIEW_DB.prepare("SELECT * FROM source_submissions WHERE status IN ('accepted','applied') ORDER BY created_at,id").all<Row>();
    return json(rows.results.map(row => ({ id: row.id, kind: row.kind, status: row.status, version: row.version, payload: JSON.parse(row.payload), accepted: JSON.parse(row.accepted_payload!), sha: row.applied_sha })));
  }
  if (request.method === "POST" && path[0] === "receipt") {
    const input = z.object({ id: z.uuid(), version: z.number().int().positive(), sha: z.string().regex(/^[a-f0-9]{40}$/).optional(), error: z.string().max(1000).optional() }).parse(await readBody(request, true));
    if (!input.sha && !input.error) throw new Response("Receipt requires a commit or error", { status: 400 });
    await env.REVIEW_DB.prepare("UPDATE source_submissions SET status=CASE WHEN ? IS NOT NULL THEN 'applied' ELSE status END,applied_sha=COALESCE(?,applied_sha),sync_error=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND version=? AND status='accepted'").bind(input.sha ?? null, input.sha ?? null, input.error ?? null, input.id, input.version).run();
    return json({ ok: true });
  }
  if (request.method === "GET" && path[0] === "archive") {
    const rows = await env.REVIEW_DB.prepare("SELECT candidates,manifest FROM source_collection_runs ORDER BY run_date DESC LIMIT 21").all<{ candidates: string; manifest: string }>();
    const checks = await env.REVIEW_DB.prepare("SELECT * FROM source_coverage_checks ORDER BY checked_at DESC LIMIT 400").all();
    return json({ runs: rows.results.map(row => ({ candidates: JSON.parse(row.candidates), manifest: JSON.parse(row.manifest) })), checks: checks.results });
  }
  if (request.method === "POST" && path[0] === "archive") {
    const input = z.object({ runDate: dateSchema, candidates: z.object({ schemaVersion: z.literal(1), candidates: z.array(z.record(z.string(), z.unknown())).max(3000) }).passthrough(), manifest: z.object({ completedAt: z.iso.datetime(), adapters: z.array(z.record(z.string(), z.unknown())) }).passthrough() }).parse(await readBody(request, true));
    await env.REVIEW_DB.batch([
      // A later, thinner run of the same day records its health but must not erase discoveries.
      env.REVIEW_DB.prepare(`INSERT INTO source_collection_runs(run_date,candidates,manifest,completed_at) VALUES(?,?,?,?)
        ON CONFLICT(run_date) DO UPDATE SET
          candidates=CASE WHEN ? >= json_array_length(source_collection_runs.candidates,'$.candidates') THEN excluded.candidates ELSE source_collection_runs.candidates END,
          manifest=excluded.manifest,completed_at=excluded.completed_at`)
        .bind(input.runDate, JSON.stringify(input.candidates), JSON.stringify(input.manifest), input.manifest.completedAt, input.candidates.candidates.length),
      env.REVIEW_DB.prepare("DELETE FROM source_collection_runs WHERE run_date < date(?, '-60 days')").bind(input.runDate)
    ]);
    return json({ ok: true });
  }
  throw new Response("Not found", { status: 404 });
}
export async function sourceRoutes(request: Request, env: Env): Promise<Response | undefined> {
  const url = new URL(request.url); const path = url.pathname.split("/").filter(Boolean);
  if (path.slice(0,3).join("/") === "api/internal/sources") return internal(request, env, path.slice(3));
  if (path[0] !== "sources") return;
  const email = await authenticatedEmail(request, env); const canReview = await reviewer(env, email); const token = await csrfToken(email, env);
  let form: URLSearchParams | undefined;
  if (request.method === "POST") {
    form = await readBody(request) as URLSearchParams;
    const headers = new Headers(request.headers); headers.set("x-review-csrf", form.get("csrf") ?? "");
    await assertCsrf(new Request(request.url, { method: "POST", headers }), email, env);
  }
  if (path[1] === "new") {
    if (form) {
      try { return redirect(`/sources/submission/${await submitSource(env,email,parseForm(form))}`); }
      catch (error) { if (error instanceof Response) throw error; return page(env,"Check your submission",`<p class="notice">${e(error instanceof z.ZodError ? error.issues.map(i=>i.message).join(" · ") : error instanceof Error ? error.message : String(error))}</p><form method="post">${inputForm({ ...Object.fromEntries(form), regions: form.getAll("regions"), sectors: form.getAll("sectors") },token)}<button>Send for review</button></form>`,400); }
    }
    const source = registry.find(s=>s.id === url.searchParams.get("source"));
    const data = url.searchParams.get("kind") === "source"
      ? { ...source, kind:"source", sourceId:source?.id, regions:source?.regions ?? ["Puerto Rico"], sectors:source?.sectors ?? [] }
      : { kind:"story", issueDate:nextIssue(), regions:source?.regions ?? ["Puerto Rico"], sectors:source?.sectors ?? [] };
    return page(env,"Add source or story",`<p>Share a useful link. Either reviewer can complete the details and accept it. New publishers start with manual stories until automatic collection is verified.</p><form method="post">${inputForm(data,token)}<button>Send for review</button></form>`);
  }
  if (path[1] === "submission" && path[2]) {
    const id = z.uuid().parse(path[2]); const row = await env.REVIEW_DB.prepare("SELECT * FROM source_submissions WHERE id=?").bind(id).first<Row>();
    if (!row || (!canReview && row.author !== email)) throw new Response("Submission not found",{status:404});
    let error = "";
    if (form) { try { await decideSource(env,email,id,parseForm(form),Object.fromEntries(form)); return redirect(`/sources/submission/${id}`); } catch (cause) { if (cause instanceof Response) throw cause; error = cause instanceof z.ZodError ? cause.issues.map(i=>i.message).join(" · ") : cause instanceof Error ? cause.message : String(cause); } }
    const data = form ? {...Object.fromEntries(form),regions:form.getAll("regions"),sectors:form.getAll("sectors")} : JSON.parse(row.payload);
    const events = await env.REVIEW_DB.prepare("SELECT actor,action,created_at FROM source_submission_events WHERE submission_id=? ORDER BY created_at,id").bind(id).all<{actor:string;action:string;created_at:string}>();
    return page(env,"Review submission",`<p class="badge">${e(label(row.status))}</p>${error?`<p class="notice">${e(error)}</p>`:""}${row.sync_error?`<p class="notice">Setup needs attention: ${e(row.sync_error)}</p>`:""}${/^https:\/\//i.test(String(data.url)) ? `<p><a href="${e(String(data.url))}" target="_blank" rel="noreferrer">Open submitted link</a></p>` : ""}
    ${canReview && (row.status === "pending" || (row.status === "accepted" && row.sync_error)) ? `<form method="post">${inputForm(data,token)}<input type="hidden" name="version" value="${row.version}"><label>Publisher evidence level <small>(for sources)</small><select name="tier"><option value="B">Established industry publication</option><option value="A">Official agency or research institution</option><option value="C">Company or association — attribute its claims</option></select></label><label>Review note<textarea name="reason" maxlength="2000"></textarea></label><div class="actions"><button name="action" value="accept">Accept</button><button name="action" value="save" class="secondary">Save details</button><button name="action" value="decline" class="secondary">Decline</button></div></form>` : `<h2>${e(data.name)}</h2><p>${e(data.notes)}</p><p>${e(data.summary)}</p><p>${e(row.review_note)}</p><p>${row.status === "accepted" ? "Accepted. Automatic processing will add this to the registry or its selected weekly collection. Accepting a story does not publish it." : ""}</p>`}
    <details><summary>History</summary>${events.results.map(ev=>`<p>${e(ev.created_at)} · ${e(ev.action)} · ${e(ev.actor)}</p>`).join("")}</details>`);
  }
  if (path[1] === "review") {
    const rows = canReview ? await env.REVIEW_DB.prepare("SELECT * FROM source_submissions ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'accepted' THEN 1 ELSE 2 END,created_at DESC LIMIT 200").all<Row>() : await env.REVIEW_DB.prepare("SELECT * FROM source_submissions WHERE author=? ORDER BY created_at DESC LIMIT 200").bind(email).all<Row>();
    return page(env,canReview?"Review list":"Your submissions",`<p>Accept useful publishers and stories here. Publication of the weekly brief remains a separate decision.</p>${rows.results.length ? rows.results.map(row=>`<article><span class="badge">${e(label(row.status))}</span><h2><a href="/sources/submission/${row.id}">${e(JSON.parse(row.payload).name)}</a></h2><p>${row.kind === "source"?"Publisher":"Story"}${row.sync_error?" · Setup needs attention":""}</p></article>`).join("") : "<p>No submissions yet.</p>"}`);
  }
  if (path[1] === "coverage") {
    const issueDate = dateSchema.parse(url.searchParams.get("issue") || nextIssue());
    if (form) {
      if (!canReview) throw new Response("Reviewer access required",{status:403});
      const input=z.object({area:z.enum(areas),outcome:z.enum(["checked","unavailable"]),note:z.string().trim().min(10).max(2000)}).parse(Object.fromEntries(form));
      await env.REVIEW_DB.prepare("INSERT INTO source_coverage_checks(issue_date,area,outcome,note,reviewer) VALUES(?,?,?,?,?) ON CONFLICT(issue_date,area) DO UPDATE SET outcome=excluded.outcome,note=excluded.note,reviewer=excluded.reviewer,checked_at=CURRENT_TIMESTAMP").bind(issueDate,input.area,input.outcome,input.note,email).run();
      return redirect(`/sources/coverage?issue=${issueDate}`);
    }
    const checks=await env.REVIEW_DB.prepare("SELECT * FROM source_coverage_checks WHERE issue_date=?").bind(issueDate).all<{issue_date:string;area:string;outcome:string;note:string;checked_at:string}>();
    // Candidates already collected for this reporting week, so a check is a
    // judgement about what discovery found, not a blind question.
    const weekStart=new Date(`${issueDate}T00:00:00Z`); weekStart.setUTCDate(weekStart.getUTCDate()-7);
    const from=weekStart.toISOString().slice(0,10);
    const archived=await env.REVIEW_DB.prepare("SELECT candidates FROM source_collection_runs WHERE run_date <= ? AND run_date > date(?,'-21 days')").bind(issueDate,issueDate).all<{candidates:string}>();
    const weekly=new Map<string,Candidate>();
    for (const row of archived.results) for (const candidate of (JSON.parse(row.candidates).candidates ?? []) as Candidate[]) {
      const day=String(candidate.publishedAt).slice(0,10);
      if (day>=from && day<issueDate) weekly.set(candidate.candidateId,candidate);
    }
    const checklist=coverageChecklist(issueDate,[...weekly.values()],checks.results);
    const badge={checked:"Checked by a reviewer",unavailable:"Sources unavailable",["stories-found"]:"Candidates collected · no check recorded",["needs-check"]:"Needs a check"};
    return page(env,"Weekly coverage",`<form method="get"><label>Issue date<input type="date" name="issue" value="${issueDate}"></label><button>View week</button></form><p>Puerto Rico is checked separately from Latin America. A quiet week is fine: record <em>checked</em> even when there was nothing worth publishing. A check records what one of you looked at for the week of ${e(from)} to ${e(issueDate)}; it is not a claim of complete coverage.</p><div class="grid">${checklist.map(entry=>`<article><h2>${e(label(entry.area))}</h2><p class="badge">${e(badge[entry.status])}</p><p>${entry.newsCount} news candidate${entry.newsCount===1?"":"s"} collected for this week.</p><p>${e(entry.note || "Check relevant sources and add any useful stories.")}</p>${entry.checkedAt?`<small>Checked ${e(entry.checkedAt)}</small>`:""}${canReview?`<form method="post"><input type="hidden" name="csrf" value="${token}"><input type="hidden" name="area" value="${e(entry.area)}"><label>Result<select name="outcome"><option value="checked">Checked, including if there was no significant news</option><option value="unavailable">Could not check the sources</option></select></label><label>Sources checked and findings<textarea name="note" required minlength="10" maxlength="2000"></textarea></label><button>Save check</button></form>`:""}</article>`).join("")}</div>`);
  }
  const live = await env.REVIEW_DB.prepare("SELECT manifest FROM source_collection_runs ORDER BY completed_at DESC LIMIT 21").all<{manifest:string}>();
  const runs = live.results.map(row=>JSON.parse(row.manifest) as {completedAt:string;adapters:Array<{sourceId:string;status:string;error?:string;itemsAccepted:number}>});
  if (path[1]) {
    const source=registry.find(s=>s.id===path[1]); if(!source) throw new Response("Source not found",{status:404});
    const configs=collection.sources.filter(s=>s.sourceId===source.id);
    const history=runs.flatMap(run=>run.adapters.filter((a:{sourceId:string})=>configs.some(c=>("adapterId" in c?c.adapterId:c.sourceId)===a.sourceId)).map((a:{status:string;error?:string;itemsAccepted:number})=>({...a,date:run.completedAt})));
    const active=configs.some(c=>c.enabled && !["manual","disabled"].includes(c.method));
    const lastSuccess=history.find(h=>h.status==="success");
    return page(env,source.name,`<p class="badge">Editorial status: ${e(source.status)}</p><p>${e(source.notes)}</p><p>${e(source.regions.join(" · "))} · ${e(source.sectors.map(label).join(" · "))}</p><div class="actions"><a class="button" href="${e(source.url)}" target="_blank" rel="noreferrer">Visit source</a><a href="/sources/new?source=${source.id}">Submit a story</a><a href="/sources/new?kind=source&source=${source.id}">Suggest a change</a></div><section><h2>Collection</h2><p>${active?"Automatic collection is configured":"Manual stories — automatic collection is not configured"}</p><p>${lastSuccess?`Last successful automatic collection: ${e(lastSuccess.date)}.`:"No successful automatic collection has been recorded yet."}</p>${configs.map(c=>`<p>${e(c.notes)}</p>`).join("")}<p>Access errors do not change editorial approval. Existing reviewed stories remain available with their original dates.</p><h3>Recorded attempts</h3>${history.length?`<table><tr><th>Checked</th><th>Result</th><th>Stories found</th></tr>${history.map((h:{date:string;status:string;error?:string;itemsAccepted:number})=>`<tr><td>${e(h.date)}</td><td>${h.error?.includes("403")?"Automatic access denied (403)":e(h.error||h.status)}</td><td>${h.itemsAccepted}</td></tr>`).join("")}</table>`:"<p>The daily collector has not recorded an attempt for this source yet. Configuration notes may describe earlier access failures.</p>"}</section>`);
  }
  const query=(url.searchParams.get("q")||"").toLowerCase(); const region=url.searchParams.get("region")||"";
  const sources=registry.filter(s=>(!query||`${s.name} ${s.domain} ${s.notes}`.toLowerCase().includes(query))&&(!region||s.regions.includes(region)));
  return page(env,"Sources",`<p>Trusted publishers for dairy, meat, and bovine genetics. Puerto Rico has its own coverage check alongside the US, LATAM, and world news.</p><div class="actions"><a class="button" href="/sources/new">Add source or story</a><a href="/sources/review">Review submissions</a><a href="/sources/coverage">Check weekly coverage</a></div><form method="get"><label>Find a publisher<input type="search" name="q" value="${e(query)}"></label><label>Coverage<select name="region"><option value="">All regions</option>${regions.map(r=>`<option${region===r?" selected":""}>${e(r)}</option>`).join("")}</select></label><button>Filter</button></form><div class="grid">${sources.map(source=>{const configs=collection.sources.filter(c=>c.sourceId===source.id);const automatic=configs.some(c=>c.enabled&&!["manual","disabled"].includes(c.method));const failures=(runs[0]?.adapters ?? []).filter((a:{sourceId:string;status:string})=>a.status==="failed"&&configs.some(c=>("adapterId" in c?c.adapterId:c.sourceId)===a.sourceId));return `<article><span class="badge">${e(source.status)}</span><h2><a href="/sources/${source.id}">${e(source.name)}</a></h2><p>${e(source.regions.join(" · "))}</p><p>${automatic?failures.length?"Automatic collection needs attention":"Automatic collection configured":"Manual stories"}</p><a href="/sources/${source.id}">Review entry</a></article>`}).join("")}</div>${sources.length?"":"<p>No sources match.</p>"}<p class="muted">${runs[0]?`Last recorded collection: ${e(runs[0].completedAt)}.`:"The daily collector has not recorded a run yet."} Collection status can change; open a source for its history.</p>`);
}
