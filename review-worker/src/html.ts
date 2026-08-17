export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;"
  })[character] ?? character);
}

export function reviewShell(input: {
  issueDate: string;
  previewUrl: string;
  previewSha: string;
  state: string;
  csrf: string;
  email: string;
}) {
  const values = Object.fromEntries(Object.entries(input).map(([key, value]) => [key, escapeHtml(value)])) as typeof input;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>Review ${values.issueDate} · Proterra Intelligence</title>
  <style>
    :root{font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#173f32;background:#eef3ef}*{box-sizing:border-box}
    body{margin:0}.shell{display:grid;grid-template-columns:minmax(0,1fr) 390px;height:100vh}.preview{border:0;width:100%;height:100%;background:white}
    aside{border-left:1px solid #ccd8d1;background:#fff;display:flex;flex-direction:column;min-height:0}.toolbar{padding:18px;border-bottom:1px solid #e1e8e3}
    h1{font-size:18px;margin:0 0 5px}.meta{font-size:12px;color:#60736a}.selection,.composer,.threads,.actions{padding:14px 18px}.selection{background:#f5f8f6;border-bottom:1px solid #e1e8e3}
    .selection strong,.selection span{display:block}.selection span{font-size:12px;margin-top:4px;color:#60736a;max-height:50px;overflow:auto}.composer{border-bottom:1px solid #e1e8e3}
    textarea{width:100%;min-height:90px;padding:10px;border:1px solid #aebdb5;border-radius:7px;resize:vertical;font:inherit}button{border:0;border-radius:7px;padding:10px 13px;font-weight:700;cursor:pointer}
    button.primary{background:#173f32;color:white}button.secondary{background:#e5eee9;color:#173f32}button:disabled{opacity:.45;cursor:not-allowed}.threads{overflow:auto;flex:1}
    .thread{border:1px solid #d8e2dc;border-radius:8px;padding:12px;margin-bottom:10px}.thread header{display:flex;justify-content:space-between;gap:8px;font-size:12px;color:#60736a}.thread p{font-size:14px;white-space:pre-wrap}.quote{border-left:3px solid #a9bcb1;padding-left:8px;color:#52665c}.orphan{background:#fff3cd;border:1px solid #e2b93b;border-radius:5px;padding:7px;color:#6d5400;font-size:12px}.status{font-weight:800;text-transform:uppercase;font-size:10px}.actions{display:flex;gap:8px;border-top:1px solid #e1e8e3}.actions button{flex:1}.error{color:#9e2b25;font-size:13px}.empty{color:#60736a;font-size:14px}
    @media(max-width:850px){.shell{grid-template-columns:1fr;grid-template-rows:55vh 45vh}aside{border-left:0;border-top:1px solid #ccd8d1}.toolbar{padding:10px 14px}.selection,.composer,.threads,.actions{padding:10px 14px}}
  </style>
</head>
<body>
<div class="shell">
  <iframe id="preview" class="preview" src="${values.previewUrl}" title="Draft report preview" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"></iframe>
  <aside>
    <div class="toolbar"><h1>Review ${values.issueDate}</h1><div class="meta">${values.email} · <span id="issue-state">${values.state}</span></div><div id="error" class="error" role="alert"></div></div>
    <div class="selection"><strong id="selection-label">Select content in the preview</strong><span id="selection-quote">Click a highlighted field, or select exact words first.</span></div>
    <div class="composer"><textarea id="comment-body" maxlength="4000" placeholder="Tell Codex exactly what should change" disabled></textarea><button id="add-comment" class="primary" disabled>Add comment</button></div>
    <div id="threads" class="threads" aria-live="polite"></div>
    <div class="actions"><button id="request-changes" class="secondary">Request changes</button><button id="approve" class="primary">Approve & publish</button></div>
  </aside>
</div>
<script>
const issueDate=${JSON.stringify(input.issueDate)}, previewOrigin=${JSON.stringify(new URL(input.previewUrl).origin)}, csrf=${JSON.stringify(input.csrf)}, expectedSha=${JSON.stringify(input.previewSha)};
let selected=null, model=null, anchorInventory=null;
const byId=(id)=>document.getElementById(id), error=(message)=>{byId('error').textContent=message||''};
async function api(path, options={}){const response=await fetch(path,{...options,headers:{'content-type':'application/json','x-review-csrf':csrf,...options.headers}});if(!response.ok)throw new Error(await response.text()||('Request failed: '+response.status));return response.status===204?null:response.json()}
function node(tag,text,className){const element=document.createElement(tag);if(text!==undefined)element.textContent=text;if(className)element.className=className;return element}
function render(){const root=byId('threads');root.replaceChildren();byId('issue-state').textContent=model.issue.state;const comments=model.comments||[];if(!comments.length)root.append(node('p','No comments yet.','empty'));
for(const comment of comments){const card=node('article',undefined,'thread'),header=node('header'),label=node('strong',comment.anchor_label),status=node('span',comment.status,'status');header.append(label,status);card.append(header);if(anchorInventory&&!anchorInventory.has(comment.anchor_key))card.append(node('p','This anchor no longer appears in the current preview. Reattach or resolve it before approval.','orphan'));if(comment.selected_text)card.append(node('p','“'+comment.selected_text+'”','quote'));card.append(node('p',comment.body));if(comment.agent_response)card.append(node('p','Codex: '+comment.agent_response,'quote'));if(comment.status==='open'){const edit=node('button','Edit','secondary');edit.onclick=()=>{const body=prompt('Edit this instruction before submission:',comment.body);if(body!==null&&body.trim()&&body.trim()!==comment.body)patchComment(comment.id,'edit',body.trim())};card.append(edit)}if(comment.status==='addressed'){const resolve=node('button','Resolve','secondary');resolve.onclick=()=>patchComment(comment.id,'resolve');card.append(resolve)}if(comment.status==='resolved'){const reopen=node('button','Reopen','secondary');reopen.onclick=()=>patchComment(comment.id,'reopen');card.append(reopen)}root.append(card)}
const blocking=comments.filter((comment)=>comment.status!=='resolved').length;byId('request-changes').disabled=!comments.some((comment)=>comment.status==='open');byId('approve').disabled=blocking>0||model.issue.preview_sha!==model.issue.draft_sha||model.issue.state!=='in-review'}
async function refresh(){model=await api('/api/review/issues/'+issueDate);render()}
async function patchComment(id,action,body){try{error('');await api('/api/review/comments/'+id,{method:'PATCH',body:JSON.stringify({action,...(body?{body}:{}),expectedSha:model.issue.draft_sha,expectedVersion:model.issue.version,idempotencyKey:crypto.randomUUID()})});await refresh()}catch(exception){error(exception.message)}}
window.addEventListener('message',(event)=>{if(event.origin!==previewOrigin)return;if(event.data?.type==='proterra-review-anchor-inventory'){anchorInventory=new Set(event.data.anchors||[]);if(model)render();return}if(event.data?.type!=='proterra-review-anchor')return;selected=event.data;byId('selection-label').textContent=selected.label;byId('selection-quote').textContent=selected.selectedText||selected.fieldPath;byId('comment-body').disabled=false;byId('add-comment').disabled=false});
byId('add-comment').onclick=async()=>{const body=byId('comment-body').value.trim();if(!selected||!body)return;try{error('');await api('/api/review/issues/'+issueDate+'/comments',{method:'POST',body:JSON.stringify({anchorKey:selected.anchorKey,storyReviewId:selected.storyReviewId,fieldPath:selected.fieldPath,anchorLabel:selected.label,selectedText:selected.selectedText||'',contextBefore:selected.contextBefore||'',contextAfter:selected.contextAfter||'',fieldValueHash:selected.fieldValueHash,body,expectedSha:model.issue.draft_sha,expectedVersion:model.issue.version,idempotencyKey:crypto.randomUUID()})});byId('comment-body').value='';await refresh()}catch(exception){error(exception.message)}};
byId('request-changes').onclick=async()=>{try{error('');await api('/api/review/issues/'+issueDate+'/request-changes',{method:'POST',body:JSON.stringify({expectedSha:model.issue.draft_sha,expectedVersion:model.issue.version,idempotencyKey:crypto.randomUUID()})});await refresh()}catch(exception){error(exception.message)}};
byId('approve').onclick=async()=>{if(!confirm('Publish this exact reviewed revision after validation?'))return;try{error('');await api('/api/review/issues/'+issueDate+'/approve',{method:'POST',body:JSON.stringify({expectedSha:model.issue.draft_sha,expectedVersion:model.issue.version,idempotencyKey:crypto.randomUUID()})});await refresh()}catch(exception){error(exception.message)}};
refresh().catch((exception)=>error(exception.message));
</script>
</body></html>`;
}
