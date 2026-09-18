import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Miniflare } from "miniflare";
import { submitSource, decideSource, sourceRoutes } from "../../review-worker/src/sources";
import type { Env } from "../../review-worker/src/index";
import { coverageChecklist } from "../../scripts/collection/coverage";
import { acceptedStory, publisherFor } from "../../review-worker/src/source-model";
import { parseHtmlList } from "../../scripts/collection/adapters/html-list";
import { collectionRegistrySchema } from "../../scripts/collection/types";
import collection from "../../config/collection-sources.json" with { type: "json" };

test("two-person source review persists decisions, rejects stale approval, and protects service routes", async context=>{
 const mf=new Miniflare({workers:[{config:{name:"source-test",type:"worker",compatibilityDate:"2026-08-17",manifest:{mainModule:"index.js",modulesRoot:process.cwd(),modules:{"index.js":{type:"esm",contents:"export default {fetch(){return new Response('ok')}}"}}},env:{REVIEW_DB:{type:"d1",name:"sources"}}}}]});
 context.after(()=>mf.dispose());const db=await mf.getD1Database("REVIEW_DB","source-test");
 for(const file of ["0001_initial.sql","0005_sources.sql"]) for(const sql of (await readFile(`review-worker/migrations/${file}`,"utf8")).split(";").map(s=>s.trim()).filter(Boolean)) await db.prepare(sql).run();
 await db.prepare("INSERT INTO review_users(email,role) VALUES('coo@example.org','reviewer')").run();
 const env={REVIEW_DB:db,REVIEW_SERVICE_KEY:"secret",REVIEW_ORIGIN:"https://review.example.org"} as unknown as Env;
 const payload={kind:"source",url:"https://example.org/news?utm_source=test",name:"Example livestock institute",notes:"Official dated cattle research publications.",regions:["Puerto Rico"],sectors:["dairy"]};
 const id=await submitSource(env,"owner@example.org",payload);
 assert.equal(await submitSource(env,"owner@example.org",{...payload,url:"https://example.org/news"}),id);
 await assert.rejects(decideSource(env,"outsider@example.org",id,payload,{version:1,action:"accept",tier:"A"}),e=>e instanceof Response&&e.status===403);
 await decideSource(env,"coo@example.org",id,payload,{version:1,action:"accept",tier:"A"});
 const row=await db.prepare("SELECT status,accepted_payload,version FROM source_submissions WHERE id=?").bind(id).first<{status:string;accepted_payload:string;version:number}>();
 assert.equal(row?.status,"accepted");assert.equal(JSON.parse(row!.accepted_payload).status,"approved");
 await assert.rejects(decideSource(env,"coo@example.org",id,payload,{version:1,action:"decline",reason:"duplicate"}),e=>e instanceof Response&&e.status===409);
 await assert.rejects(sourceRoutes(new Request('https://review.example.org/api/internal/sources/accepted'),env),e=>e instanceof Response&&e.status===401);
 // An old receipt must never mark a newer review revision as applied.
 await sourceRoutes(new Request('https://review.example.org/api/internal/sources/receipt',{method:'POST',headers:{'x-review-service-key':'secret'},body:JSON.stringify({id,version:1,sha:'a'.repeat(40)})}),env);
 assert.equal((await db.prepare("SELECT status FROM source_submissions WHERE id=?").bind(id).first<{status:string}>())?.status,'accepted');
 await sourceRoutes(new Request('https://review.example.org/api/internal/sources/receipt',{method:'POST',headers:{'x-review-service-key':'secret'},body:JSON.stringify({id,version:2,sha:'a'.repeat(40)})}),env);
 assert.equal((await db.prepare("SELECT status FROM source_submissions WHERE id=?").bind(id).first<{status:string}>())?.status,'applied');
 // A second, thinner collection on the same day records its health without losing the day's discoveries.
 const archive=(candidates:unknown[],completedAt:string)=>sourceRoutes(new Request('https://review.example.org/api/internal/sources/archive',{method:'POST',headers:{'x-review-service-key':'secret'},body:JSON.stringify({runDate:'2026-09-16',candidates:{schemaVersion:1,candidates},manifest:{completedAt,adapters:[]}})}),env);
 await archive([{candidateId:'a'},{candidateId:'b'}],'2026-09-16T10:00:00.000Z');
 await archive([],'2026-09-16T22:00:00.000Z');
 const saved=await db.prepare("SELECT candidates,completed_at FROM source_collection_runs WHERE run_date='2026-09-16'").first<{candidates:string;completed_at:string}>();
 assert.equal(JSON.parse(saved!.candidates).candidates.length,2);
 assert.equal(saved!.completed_at,'2026-09-16T22:00:00.000Z');
});
test("Puerto Rico is independent of LATAM; a recorded quiet-week check resolves the missing check",()=>{
 const candidates=[{contentClass:"news",sectors:["dairy"],geographies:["Latin America & Caribbean"]}] as Parameters<typeof coverageChecklist>[1];
 const checklist=coverageChecklist("2026-09-21",candidates);
 assert.equal(checklist.find(c=>c.area==="Puerto Rico")?.status,"needs-check");
 assert.equal(checklist.find(c=>c.area==="Latin America & Caribbean")?.status,"stories-found");
 assert.equal(coverageChecklist("2026-09-21",[],[{issue_date:"2026-09-21",area:"Puerto Rico",outcome:"checked",note:"Checked agriculture and university sources; no new dairy stories."}]).find(c=>c.area==="Puerto Rico")?.status,"checked");
 assert.throws(()=>acceptedStory({kind:"story",url:"https://unapproved.example/news",name:"Dairy research",regions:["Puerto Rico"],sectors:["dairy"],notes:"",summary:"A detailed factual summary that is long enough for review."}),/publisher first/);
 // Several registry entries share fao.org; the most specific allowed path identifies the publisher.
 assert.equal(publisherFor("https://www.fao.org/newsroom/detail/dairy-outlook")?.id,"fao-newsroom");
 assert.equal(publisherFor("https://www.fao.org/faostat/en/#data")?.id,"fao-faostat");
 assert.equal(publisherFor("https://www.linkedin.com/posts/example")?.id,undefined);
});
test("Brazilian publication dates use day-first formatting",()=>{
 const source=collectionRegistrySchema.parse(collection).sources.find(s=>s.sourceId==="embrapa-dairy")!;
 const rows=parseHtmlList('<table><tbody class="table-data"><tr><td><div class="titulo"><a href="/web/gado-de-leite/news">Genética do leite</a></div><span class="situacao">15/09/26</span><div class="detalhes"><p>Research announcement</p></div></td></tr></tbody></table>',source);
 assert.equal(rows[0].publishedAt,"2026-09-15");
});
