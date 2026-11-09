/** Add presentation data only to the native run's actual, isolated server. Tools proof is never replaced. */
import {connect} from "./wire.ts";
import {MemoryStore} from "../../../packages/server/src/memory.ts";
import {realpath} from "node:fs/promises";
const origin=process.env.ANDROID_NATIVE_UI_ORIGIN??"http://127.0.0.1:4790";
if(!/^http:\/\/127\.0\.0\.1:(4790|4795)$/.test(origin))throw Error("Use an owned native scratch backend");
const log=await Bun.file(origin.endsWith(":4795")?"/tmp/harness-verification/scratch/android-cache/r2-visual-real-server.log":"/tmp/harness-verification/scratch/android-cache/r2-native-real-server.log").text();
const root=/root (\/tmp\/harness-verification\/scratch\/android-verification-real-smoke-[^;\s]+)/.exec(log)?.[1];
const projectId=/; project (project-[^;]+);/.exec(log)?.[1];
if(!root || !projectId || !(await realpath(root)).startsWith("/tmp/harness-verification/scratch/android-verification-real-smoke-")) throw Error("Missing guarded native scratch root");
const client=await connect(origin);
await client.request("hello",{protocolVersion:1});
const req=async(type:string,fields:Record<string,unknown>={})=>{
 const r=await client.request(type,{projectId,...fields});if(r.type==="error")throw Error(JSON.stringify(r.error));return r;
};
try {
 const projects=(await client.request("projects.list",{})).projects;
 if(!projects.some((p:any)=>p.id===projectId && p.path===root+"/project"))throw Error("Native run project identity changed");
 let board=(await req("board.get")).board;
 for(const [title,status,description] of [
 ["Review release checklist","todo","Keep status groups legible at phone and tablet widths."],
 ["Record delivery evidence","todo","Preserve the exact APK hash and native evidence."],
 ["Resolve dependency handoff","blocked","Wait for the current task owner before continuing."],
 ["Review source and visuals","review","Independent final approval is still required."],
 ["Capture original baseline","done","Retained original delivery while the new candidate is verified."]
 ]) if(!board.tasks.some((t:any)=>t.title===title)) await req("board.task.save",{task:{title,description,acceptance:"Evidence retained under ROUND2.",status,blockedBy:status==="blocked"?["T1"]:[],blockedReason:status==="blocked"?"Waiting for T1 evidence":null,writeScopes:["apps/android"]}});
 const schedules=(await req("schedules.list")).schedules;
 for(const kind of ["worker","thread"]) {
  const title=kind==="worker"?"Review native evidence (disabled)":"Prepare release notes (disabled)";
  if(!schedules.some((s:any)=>s.title===title))await req("schedules.save",{schedule:{title,brief:"Scratch-only disabled schedule for native layout verification. Never runs automatically.",spec:{kind:"daily",time:"09:00"},model:{provider:"faux",modelId:"faux-1"},thinkingLevel:null,isolation:"shared",onReport:"record",enabled:false,kind}});
 }
 const memory=new MemoryStore({dataDir:root+"/data"});
 try {const existing=await req("memory.list",{scope:"project"});
 if(!existing.files.some((f:any)=>f.fileId==="native-verification"||f.id==="native-verification"))await memory.write({target:{scope:"project",projectId},fileId:"native-verification",title:"Native verification boundaries",summary:"Real checkout, deterministic model, no external provider",tags:["android","verification"],create:true,heading:"Evidence",text:"Native composers initiated actual thread, worker and artifact tools. Persistence, sockets, saved bytes and signing are real. The model is faux; no provider account, camera, or physical decoder is verified."});}
 finally {await memory.close();}
 await Bun.sleep(500);
 console.log(JSON.stringify({projectId,boardTasks:(await req("board.get")).board.tasks.length,schedules:(await req("schedules.list")).schedules.length,memory:(await req("memory.list",{scope:"project"})).files.length}));
} finally {client.close();}
