import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { z } from "zod";
import { acceptedPublisher, submissionSchema } from "../../review-worker/src/source-model";
import { collectSources, windowFor } from "../collection/collect";
import { candidateFileSchema, collectionRegistrySchema, manualLeadFileSchema, manualLeadSchema, runManifestSchema } from "../collection/types";
import { normalizeCandidate } from "../collection/normalize";
import { isDeepStrictEqual } from "node:util";
import rawRegistry from "../../config/collection-sources.json" with { type: "json" };
import publishers from "../../src/data/sources.json" with { type: "json" };

export async function reviewRequest(path: string, value?: unknown) {
  const base=process.env.REVIEW_API_URL;
  const key=process.env.REVIEW_SERVICE_KEY;
  const client=process.env.REVIEW_ACCESS_CLIENT_ID;
  const secret=process.env.REVIEW_ACCESS_CLIENT_SECRET;
  if (!base || new URL(base).protocol!=="https:" || !key || !client || !secret) throw new Error("Review service configuration is required.");
  const response=await fetch(`${base.replace(/\/$/,"")}/api/internal/sources/${path}`,{
    method:value===undefined?"GET":"POST",redirect:"error",signal:AbortSignal.timeout(60000),
    headers:{"content-type":"application/json","x-review-service-key":key,"CF-Access-Client-Id":client,"CF-Access-Client-Secret":secret},
    ...(value===undefined?{}:{body:JSON.stringify(value)})
  });
  if(!response.ok) throw new Error(`Source service ${path}: HTTP ${response.status}`);
  return response.json();
}
const acceptedSchema=z.array(z.object({id:z.uuid(),kind:z.enum(["source","story"]),status:z.enum(["accepted","applied"]),version:z.number().int().positive(),payload:submissionSchema,accepted:z.unknown(),sha:z.string().nullable()}));
const readJson=async(path:string)=>JSON.parse(await readFile(path,"utf8"));
const writeJson=async(path:string,value:unknown)=>writeFile(path,JSON.stringify(value,null,2)+"\n");
const sha=()=>execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim();

export async function prepareIssue(issueDate:string, destination:string) {
  z.iso.date().parse(issueDate);
  const [accepted,archive]=await Promise.all([reviewRequest("accepted"),reviewRequest("archive")]);
  const rows=acceptedSchema.parse(accepted);
  const saved=z.object({runs:z.array(z.object({candidates:candidateFileSchema,manifest:runManifestSchema})),checks:z.array(z.object({issue_date:z.string(),area:z.string(),outcome:z.string(),note:z.string(),checked_at:z.string()}))}).parse(archive);
  let local: z.infer<typeof manualLeadFileSchema>={schemaVersion:1,issueDate,leads:[]};
  try { local=manualLeadFileSchema.parse(await readJson(`src/data/research-runs/${issueDate}.manual.json`)); } catch(error) { if((error as NodeJS.ErrnoException).code!=="ENOENT") throw error; }
  if(local.issueDate!==issueDate) throw new Error("Local manual leads have the wrong issue date.");
  const registry=collectionRegistrySchema.parse(rawRegistry); const ids:Array<{id:string;version:number}>=[];
  for(const row of rows.filter(r=>r.kind==="story"&&r.payload.issueDate===issueDate)) {
    try {
      const lead=manualLeadSchema.parse(row.accepted);
      const source=registry.sources.find(s=>s.sourceId===lead.sourceId);
      const publisher=publishers.find(s=>s.id===lead.sourceId&&s.status==="approved");
      if(!source||!publisher) throw new Error("Publisher is not available in the approved registry yet.");
      const host=new URL(lead.url).hostname.replace(/^www\./,"");
      if(host!==publisher.domain&&!host.endsWith(`.${publisher.domain}`)) throw new Error("Evidence link is outside its approved publisher.");
      const candidate=normalizeCandidate(lead,{...source,allowedHosts:[...source.allowedHosts,publisher.domain]},new Date().toISOString(),{manual:true});
      const window=windowFor(issueDate,source.lookbackDays);
      if(candidate.publishedAt<window.start||candidate.publishedAt>=window.end) throw new Error("Story is outside the selected issue's reporting window.");
      if(!local.leads.some(l=>l.url===lead.url)) local.leads.push(lead);
      if(row.status==="accepted") ids.push({id:row.id,version:row.version});
    } catch(error) { if(row.status==="accepted") await reviewRequest("receipt",{id:row.id,version:row.version,error:error instanceof Error?error.message:"Story validation failed"}); }
  }
  // An accepted story whose week has already been collected would otherwise wait
  // forever. Hand it back to the reviewer instead of touching a report in review.
  for(const row of rows.filter(r=>r.kind==="story"&&r.status==="accepted"&&r.payload.issueDate&&r.payload.issueDate<issueDate)) {
    await reviewRequest("receipt",{id:row.id,version:row.version,error:`This story was accepted for the ${row.payload.issueDate} issue, which has already been collected. Set the issue date to ${issueDate} or later and accept it again.`});
  }
  manualLeadFileSchema.parse(local);
  await writeJson(`${destination}.manual.json`,local);
  await writeJson(`${destination}.archive.json`,{candidates:saved.runs.flatMap(r=>r.candidates.candidates),checks:saved.checks});
  await writeJson(`${destination}.receipts.json`,ids);
}
async function syncPublishers() {
  const rows=acceptedSchema.parse(await reviewRequest("accepted")).filter(r=>r.kind==="source"&&r.status==="accepted");
  const registry=structuredClone(rawRegistry); const sources=structuredClone(publishers);
  for(const row of rows) {
    try {
      const tier=z.object({tier:z.enum(["A","B","C"])}).parse(row.accepted).tier;
      // The reviewed snapshot, not mutable input from a branch, is the change authority.
      const approved=z.object({id:z.string(),name:z.string(),domain:z.string(),url:z.string(),tier:z.enum(["A","B","C"]),status:z.literal("approved"),regions:z.array(z.string()),sectors:z.array(z.enum(["dairy","meat","bovine-genetics"])),cadence:z.string(),notes:z.string(),allowedPaths:z.array(z.string()).optional()}).parse(row.accepted);
      const existing=sources.find(s=>s.id===approved.id);
      if(existing && isDeepStrictEqual(existing,approved) && registry.sources.some(s=>s.sourceId===approved.id)) { await reviewRequest("receipt",{id:row.id,version:row.version,sha:sha()}); continue; }
      if(!row.payload.sourceId && existing) throw new Error("Publisher ID already exists with different details.");
      if(row.payload.sourceId && (!existing || existing.domain!==approved.domain)) throw new Error("Publisher changed since review. Please submit a new correction.");
      if(!existing && sources.some(s=>s.domain===approved.domain)) throw new Error("Publisher domain is already registered.");
      const expected=acceptedPublisher(row.payload,tier);
      if(!isDeepStrictEqual(expected,approved)) throw new Error("Approved publisher snapshot no longer matches the registry.");
      if(existing) Object.assign(existing,approved); else sources.push(approved);
      const configs=registry.sources.filter(s=>s.sourceId===approved.id);
      // Widen an existing collection entry to the accepted scope; curated
      // operational scope is never narrowed by a review decision.
      if(configs.length) for(const config of configs) {
        config.sectors=[...new Set([...config.sectors,...approved.sectors])];
        config.geographies=[...new Set([...config.geographies,...approved.regions])];
      }
      else registry.sources.push({sourceId:approved.id,enabled:false,collectionRole:"manual",method:"manual",allowedHosts:[approved.domain],sectors:approved.sectors,geographies:approved.regions,lookbackDays:10,notes:"Accepted by a reviewer. Manual stories are available; enable automatic collection only after verifying a public feed."} as typeof registry.sources[number]);
    } catch(error) { await reviewRequest("receipt",{id:row.id,version:row.version,error:error instanceof Error?error.message:"Publisher synchronization failed"}); }
  }
  collectionRegistrySchema.parse(registry);
  if(JSON.stringify(sources)!==JSON.stringify(publishers)) await writeJson("src/data/sources.json",sources);
  if(JSON.stringify(registry)!==JSON.stringify(rawRegistry)) await writeJson("config/collection-sources.json",registry);
}
async function main() {
  const [mode,arg,path]=process.argv.slice(2);
  if(mode==="prepare") return prepareIssue(arg,path);
  if(mode==="publishers") return syncPublishers();
  if(mode==="receipt") { const ids=z.array(z.object({id:z.uuid(),version:z.number().int().positive()})).parse(await readJson(arg)); for(const receipt of ids) await reviewRequest("receipt",{...receipt,sha:sha()}); return; }
  if(mode==="daily") {
    const now=new Date(); const runDate=new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York"}).format(now);
    const tomorrow=new Date(`${runDate}T12:00:00Z`);tomorrow.setUTCDate(tomorrow.getUTCDate()+1);
    const result=await collectSources({issueDate:tomorrow.toISOString().slice(0,10)});
    await reviewRequest("archive",{runDate,candidates:result.candidateFile,manifest:result.manifest});
    if(result.manifest.status==="failed") throw new Error("All collection adapters failed; health details were saved.");
    console.log(`Saved ${result.manifest.candidateCount} discoveries for ${runDate}.`);return;
  }
  throw new Error("Use daily, publishers, prepare YYYY-MM-DD OUTPUT_PREFIX, or receipt FILE.");
}
if(process.argv[1] && resolve(process.argv[1])===resolve(new URL(import.meta.url).pathname)) main().catch(error=>{console.error(error instanceof Error?error.message:error);process.exitCode=1;});
