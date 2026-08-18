import type { ReviewItem, ReviewReport } from "./report";

export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;"
  })[character] ?? character);
}

function safeJson(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function field(issueDate: string, reviewId: string, fieldPath: string, label: string) {
  return `data-review-anchor="${escapeHtml(`${issueDate}:${reviewId}:${fieldPath}`)}" data-story-review-id="${escapeHtml(reviewId)}" data-review-field-path="${escapeHtml(fieldPath)}" data-review-label="${escapeHtml(label)}"`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${value}T00:00:00Z`));
}

function renderCitation(issueDate: string, item: ReviewItem, index: number) {
  const citation = item.citations[index];
  const exact = citation.evidenceUrl && citation.evidenceUrl !== citation.url
    ? `<a class="source-link secondary" href="${escapeHtml(citation.evidenceUrl)}" target="_blank" rel="noreferrer">Exact evidence${citation.releaseId ? ` · ${escapeHtml(citation.releaseId)}` : ""}</a>`
    : "";
  return `<div class="citation" ${field(issueDate, item.reviewId, `citations.${index}`, `Story ${item.rank} source ${index + 1}`)}>
    <div><strong>${escapeHtml(citation.title)}</strong><span>${escapeHtml(formatDate(citation.publishedAt))}</span></div>
    <p>${escapeHtml(citation.sourceNote)}</p>
    <div class="source-actions"><a class="source-link" href="${escapeHtml(citation.url)}" target="_blank" rel="noreferrer">View readable source</a>${exact}</div>
  </div>`;
}

function renderStory(issueDate: string, item: ReviewItem, siteOrigin: string) {
  const imageUrl = new URL(`/images/editorial/${item.imageId}.webp`, siteOrigin).toString();
  const metadata = [...item.sectors, ...item.regions, item.signal, `${item.confidence} confidence`];
  return `<article class="story" id="story-${item.rank}">
    <div class="story-image" ${field(issueDate, item.reviewId, "imageId", `Story ${item.rank} image`)}>
      <img src="${escapeHtml(imageUrl)}" alt="Editorial image for ${escapeHtml(item.headline)}" loading="lazy">
      <span>Image: ${escapeHtml(item.imageId)}</span>
    </div>
    <div class="story-body">
      <div class="story-meta">${metadata.map((value) => `<span>${escapeHtml(value)}</span>`).join("")}</div>
      <h2 ${field(issueDate, item.reviewId, "headline", `Story ${item.rank} headline`)}>${escapeHtml(item.headline)}</h2>
      <p class="summary" ${field(issueDate, item.reviewId, "summary", `Story ${item.rank} summary`)}>${escapeHtml(item.summary)}</p>
      <ul class="key-points">${item.keyPoints.map((point, index) => `<li ${field(issueDate, item.reviewId, `keyPoints.${index}`, `Story ${item.rank} key point ${index + 1}`)}>${escapeHtml(point)}</li>`).join("")}</ul>
      <div class="analysis-grid">
        <section ${field(issueDate, item.reviewId, "whyItMatters", `Story ${item.rank} why it matters`)}><h3>Why it matters</h3><p>${escapeHtml(item.whyItMatters)}</p></section>
        <section ${field(issueDate, item.reviewId, "businessRelevance", `Story ${item.rank} business relevance`)}><h3>Proterra relevance</h3><p>${escapeHtml(item.businessRelevance)}</p></section>
        ${item.uncertainty ? `<section ${field(issueDate, item.reviewId, "uncertainty", `Story ${item.rank} uncertainty`)}><h3>Uncertainty</h3><p>${escapeHtml(item.uncertainty)}</p></section>` : ""}
        <section ${field(issueDate, item.reviewId, "watchNext", `Story ${item.rank} what to watch`)}><h3>Watch next</h3><p>${escapeHtml(item.watchNext)}</p></section>
      </div>
      <div class="citations">${item.citations.map((_, index) => renderCitation(issueDate, item, index)).join("")}</div>
    </div>
  </article>`;
}

function renderReport(report: ReviewReport, siteOrigin: string) {
  const general = field(report.slug, "story-report-general", "report.general", "General issue feedback");
  return `<main class="preview" id="report-preview">
    <header class="report-header" ${general}>
      <span>Weekly Brief · Issue ${String(report.issueNumber).padStart(2, "0")}</span>
      <h1>${escapeHtml(report.title)}</h1>
      <p>${escapeHtml(formatDate(report.period.start))} – ${escapeHtml(formatDate(report.period.end))}</p>
    </header>
    <section class="executive" ${field(report.slug, "story-report-general", "executiveSummary", "Executive summary")}>
      <span>Executive summary</span><p>${escapeHtml(report.executiveSummary)}</p>
    </section>
    ${report.editorNote ? `<aside class="editor-note" ${field(report.slug, "story-report-general", "editorNote", "Editor note")}><strong>Editor note</strong><p>${escapeHtml(report.editorNote)}</p></aside>` : ""}
    ${report.overview ? `<section class="overview" ${field(report.slug, "story-report-general", "overview", "Issue overview")}><h2>${escapeHtml(report.overview.headline)}</h2><ul>${report.overview.points.map((point) => `<li><strong>${escapeHtml(point.label)}</strong>${escapeHtml(point.text)}</li>`).join("")}</ul></section>` : ""}
    <div class="stories">${report.items.map((item) => renderStory(report.slug, item, siteOrigin)).join("")}</div>
  </main>`;
}

export function reviewShell(input: {
  issueDate: string;
  previewSha: string;
  state: string;
  csrf: string;
  email: string;
  report: ReviewReport;
  siteOrigin: string;
}) {
  const state = escapeHtml(input.state);
  const email = escapeHtml(input.email);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>Review ${escapeHtml(input.issueDate)} · Proterra Intelligence</title>
  <style>
    :root{font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#173f32;background:#eef3ef;line-height:1.5}*{box-sizing:border-box}body{margin:0}.shell{display:grid;grid-template-columns:minmax(0,1fr) 390px;height:100vh}.preview{overflow:auto;padding:32px clamp(20px,4vw,64px);background:#f7f5ef}.report-header{padding:28px;border-radius:18px;background:#173f32;color:#fff}.report-header span,.executive>span{font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}.report-header h1{margin:7px 0 4px;font-family:Georgia,serif;font-size:clamp(34px,5vw,64px);line-height:1}.report-header p{margin:0;color:#cbdad2}.executive,.editor-note,.overview{margin:18px 0;padding:22px;border:1px solid #cfdbd4;border-radius:14px;background:#fff}.executive p,.editor-note p{margin:8px 0 0;font-size:17px}.editor-note{background:#fff9e9;border-color:#dfc878}.overview h2{margin:0;font-family:Georgia,serif}.overview ul{display:grid;gap:8px;padding:0;list-style:none}.overview li{display:grid;grid-template-columns:120px 1fr;gap:12px}.stories{display:grid;gap:22px}.story{display:grid;grid-template-columns:minmax(180px,28%) 1fr;overflow:hidden;border:1px solid #cfdbd4;border-radius:16px;background:#fff;box-shadow:0 8px 24px #173f3210}.story-image{position:relative;min-height:260px;background:#dfe9e3}.story-image img{width:100%;height:100%;object-fit:cover}.story-image>span{position:absolute;right:8px;bottom:8px;padding:4px 7px;border-radius:5px;background:#fffffff0;font-size:11px}.story-body{padding:24px}.story-meta{display:flex;flex-wrap:wrap;gap:6px}.story-meta span{padding:3px 7px;border-radius:20px;background:#e8f0eb;font-size:11px;font-weight:700}.story h2{margin:13px 0 8px;font-family:Georgia,serif;font-size:30px;line-height:1.12}.summary{font-size:17px}.key-points{padding-left:22px}.key-points li{margin:8px 0}.analysis-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.analysis-grid section{padding:14px;border-radius:9px;background:#f3f6f4}.analysis-grid h3{margin:0 0 5px;font-size:12px;text-transform:uppercase}.analysis-grid p{margin:0;font-size:14px}.citations{display:grid;gap:8px;margin-top:14px}.citation{padding:13px;border:1px solid #d8e2dc;border-radius:9px}.citation>div:first-child{display:flex;justify-content:space-between;gap:12px}.citation span,.citation p{font-size:12px;color:#60736a}.citation p{margin:5px 0}.source-actions{display:flex;flex-wrap:wrap;gap:8px}.source-link{padding:6px 9px;border-radius:6px;background:#173f32;color:#fff;font-size:12px;font-weight:750;text-decoration:none}.source-link.secondary{background:#e5eee9;color:#173f32}.review-selectable{outline:2px solid transparent;outline-offset:3px;cursor:pointer;transition:background .15s,outline-color .15s}.review-selectable:hover,.review-selectable:focus{outline-color:#48a777;background-color:#ecf7f0}.review-selectable.selected{outline-color:#d28c18;background:#fff5d9}aside.sidebar{border-left:1px solid #ccd8d1;background:#fff;display:flex;flex-direction:column;min-height:0}.toolbar{padding:18px;border-bottom:1px solid #e1e8e3}.toolbar h1{font-size:18px;margin:0 0 5px}.meta{font-size:12px;color:#60736a}.selection,.composer,.threads,.actions{padding:14px 18px}.selection{background:#f5f8f6;border-bottom:1px solid #e1e8e3}.selection strong,.selection span{display:block}.selection span{font-size:12px;margin-top:4px;color:#60736a;max-height:60px;overflow:auto}.composer{border-bottom:1px solid #e1e8e3}textarea{width:100%;min-height:90px;padding:10px;border:1px solid #aebdb5;border-radius:7px;resize:vertical;font:inherit}button{border:0;border-radius:7px;padding:10px 13px;font-weight:700;cursor:pointer}button.primary{background:#173f32;color:white}button.secondary{background:#e5eee9;color:#173f32}button:disabled{opacity:.45;cursor:not-allowed}.threads{overflow:auto;flex:1}.thread{border:1px solid #d8e2dc;border-radius:8px;padding:12px;margin-bottom:10px}.thread header{display:flex;justify-content:space-between;gap:8px;font-size:12px;color:#60736a}.thread p{font-size:14px;white-space:pre-wrap}.quote{border-left:3px solid #a9bcb1;padding-left:8px;color:#52665c}.orphan{background:#fff3cd;border:1px solid #e2b93b;border-radius:5px;padding:7px;color:#6d5400;font-size:12px}.status{font-weight:800;text-transform:uppercase;font-size:10px}.actions{display:flex;gap:8px;border-top:1px solid #e1e8e3}.actions button{flex:1}.error{color:#9e2b25;font-size:13px}.empty{color:#60736a;font-size:14px}
    @media(max-width:1050px){.shell{grid-template-columns:minmax(0,1fr) 340px}.story{grid-template-columns:1fr}.story-image{max-height:320px}.analysis-grid{grid-template-columns:1fr}}
    @media(max-width:760px){.shell{grid-template-columns:1fr;grid-template-rows:58vh 42vh}.preview{padding:16px}.story h2{font-size:25px}aside.sidebar{border-left:0;border-top:1px solid #ccd8d1}.toolbar{padding:10px 14px}.selection,.composer,.threads,.actions{padding:10px 14px}}
  </style>
</head>
<body>
<div class="shell">
  ${renderReport(input.report, input.siteOrigin)}
  <aside class="sidebar">
    <div class="toolbar"><h1>Review ${escapeHtml(input.issueDate)}</h1><div class="meta">${email} · <span id="issue-state">${state}</span> · ${escapeHtml(input.previewSha.slice(0, 7))}</div><div id="error" class="error" role="alert"></div></div>
    <div class="selection"><strong id="selection-label">Select content in the report</strong><span id="selection-quote">Click a highlighted field, or select exact words first.</span></div>
    <div class="composer"><textarea id="comment-body" maxlength="4000" placeholder="Tell Codex exactly what should change" disabled></textarea><button id="add-comment" class="primary" disabled>Add comment</button></div>
    <div id="threads" class="threads" aria-live="polite"></div>
    <div class="actions"><button id="request-changes" class="secondary">Request changes</button><button id="approve" class="primary">Approve &amp; publish</button></div>
  </aside>
</div>
<script>
const issueDate=${safeJson(input.issueDate)}, csrf=${safeJson(input.csrf)}, expectedSha=${safeJson(input.previewSha)};
let selected=null,model=null;const byId=(id)=>document.getElementById(id),error=(message)=>{byId('error').textContent=message||''};
const selectable='[data-review-anchor]',normalize=(value)=>value.replace(/\s+/g,' ').trim();
async function hash(value){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return [...new Uint8Array(bytes)].map((byte)=>byte.toString(16).padStart(2,'0')).join('')}
async function selectField(target){document.querySelectorAll(selectable).forEach((element)=>element.classList.remove('selected'));target.classList.add('selected');const fieldValue=normalize(target.textContent||'');const selection=window.getSelection();let selectedText='';if(selection&&selection.rangeCount>0&&target.contains(selection.anchorNode)&&target.contains(selection.focusNode))selectedText=normalize(selection.toString()).slice(0,1000);const offset=selectedText?fieldValue.indexOf(selectedText):-1;selected={anchorKey:target.dataset.reviewAnchor,storyReviewId:target.dataset.storyReviewId,fieldPath:target.dataset.reviewFieldPath,label:target.dataset.reviewLabel,selectedText,contextBefore:offset>=0?fieldValue.slice(Math.max(0,offset-120),offset):'',contextAfter:offset>=0?fieldValue.slice(offset+selectedText.length,offset+selectedText.length+120):'',fieldValueHash:await hash(fieldValue)};byId('selection-label').textContent=selected.label;byId('selection-quote').textContent=selected.selectedText||selected.fieldPath;byId('comment-body').disabled=false;byId('add-comment').disabled=false;byId('comment-body').focus()}
document.querySelectorAll(selectable).forEach((element)=>{element.classList.add('review-selectable');element.tabIndex=0;element.title='Click to comment on this field'});
document.addEventListener('pointerup',(event)=>{if(event.target instanceof Element&&event.target.closest('a,button,textarea'))return;const target=event.target instanceof Element?event.target.closest(selectable):null;if(target)selectField(target)});
document.addEventListener('keydown',(event)=>{if(!['Enter',' '].includes(event.key)||!(event.target instanceof Element)||!event.target.matches(selectable))return;event.preventDefault();selectField(event.target)});
const anchorInventory=new Set([...document.querySelectorAll(selectable)].map((element)=>element.dataset.reviewAnchor).filter(Boolean));
async function api(path,options={}){const response=await fetch(path,{...options,headers:{'content-type':'application/json','x-review-csrf':csrf,...options.headers}});if(!response.ok)throw new Error(await response.text()||('Request failed: '+response.status));return response.status===204?null:response.json()}
function node(tag,text,className){const element=document.createElement(tag);if(text!==undefined)element.textContent=text;if(className)element.className=className;return element}
function render(){const root=byId('threads');root.replaceChildren();byId('issue-state').textContent=model.issue.state;const comments=model.comments||[];if(!comments.length)root.append(node('p','No comments yet.','empty'));for(const comment of comments){const card=node('article',undefined,'thread'),header=node('header'),label=node('strong',comment.anchor_label),status=node('span',comment.status,'status');header.append(label,status);card.append(header);if(!anchorInventory.has(comment.anchor_key))card.append(node('p','This anchor no longer appears in the current report. Reattach or resolve it before approval.','orphan'));if(comment.selected_text)card.append(node('p','“'+comment.selected_text+'”','quote'));card.append(node('p',comment.body));if(comment.agent_response)card.append(node('p','Codex: '+comment.agent_response,'quote'));if(comment.status==='open'){const edit=node('button','Edit','secondary');edit.onclick=()=>{const body=prompt('Edit this instruction before submission:',comment.body);if(body!==null&&body.trim()&&body.trim()!==comment.body)patchComment(comment.id,'edit',body.trim())};card.append(edit)}if(comment.status==='addressed'){const resolve=node('button','Resolve','secondary');resolve.onclick=()=>patchComment(comment.id,'resolve');card.append(resolve)}if(comment.status==='resolved'){const reopen=node('button','Reopen','secondary');reopen.onclick=()=>patchComment(comment.id,'reopen');card.append(reopen)}root.append(card)}const blocking=comments.filter((comment)=>comment.status!=='resolved').length;byId('request-changes').disabled=!comments.some((comment)=>comment.status==='open');byId('approve').disabled=blocking>0||model.issue.preview_sha!==model.issue.draft_sha||model.issue.report_sha!==model.issue.draft_sha||model.issue.state!=='in-review'}
async function refresh(){model=await api('/api/review/issues/'+issueDate);render()}
async function patchComment(id,action,body){try{error('');await api('/api/review/comments/'+id,{method:'PATCH',body:JSON.stringify({action,...(body?{body}:{}),expectedSha:model.issue.draft_sha,expectedVersion:model.issue.version,idempotencyKey:crypto.randomUUID()})});await refresh()}catch(exception){error(exception.message)}}
byId('add-comment').onclick=async()=>{const body=byId('comment-body').value.trim();if(!selected||!body)return;try{error('');await api('/api/review/issues/'+issueDate+'/comments',{method:'POST',body:JSON.stringify({...selected,body,expectedSha:model.issue.draft_sha,expectedVersion:model.issue.version,idempotencyKey:crypto.randomUUID()})});byId('comment-body').value='';await refresh()}catch(exception){error(exception.message)}};
byId('request-changes').onclick=async()=>{try{error('');await api('/api/review/issues/'+issueDate+'/request-changes',{method:'POST',body:JSON.stringify({expectedSha:model.issue.draft_sha,expectedVersion:model.issue.version,idempotencyKey:crypto.randomUUID()})});await refresh()}catch(exception){error(exception.message)}};
byId('approve').onclick=async()=>{if(!confirm('Publish this exact reviewed revision after validation?'))return;try{error('');await api('/api/review/issues/'+issueDate+'/approve',{method:'POST',body:JSON.stringify({expectedSha:model.issue.draft_sha,expectedVersion:model.issue.version,idempotencyKey:crypto.randomUUID()})});await refresh()}catch(exception){error(exception.message)}};
refresh().catch((exception)=>error(exception.message));
</script>
</body></html>`;
}
