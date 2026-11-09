/** Populate ONLY the real launcher's scratch UI project through actual checkout APIs.
 * Board/schedules use WebSocket handlers. Memory has no write RPC; use the real MemoryStore
 * service (same write API as coordinator tools), observed by the running server's file watcher. */
import {connect} from "./wire.ts";
import {MemoryStore} from "../../../packages/server/src/memory.ts";
const scratch = "/tmp/harness-verification/scratch/android-verification-real";
const result = await Bun.file("/tmp/harness-verification/scratch/android-screens/real-ui-result.json").json();
if(result.path !== `${scratch}/ui-project`) throw new Error("Refusing non-verification project");
const client = await connect("http://127.0.0.1:4790");
await client.request("hello",{protocolVersion:1});
const req = async(type:string, fields:Record<string,unknown>) => {
    const r = await client.request(type,fields); if(r.type === "error") throw new Error(JSON.stringify(r.error)); return r;
};
const projectId = result.projectId;
await req("projects.configure",{projectId, name:"Native UI · real checkout",checkIns:{enabled:false,intervalMinutes:10}});
let board = (await req("board.get",{projectId})).board;
for(const [title,description,status] of [
    ["Verify native conversation flow","UI-created scratch project. Faux response committed by the real checkout server.","done"],
    ["Review tablet board layout","Check narrow cards, accessible controls and unsaved draft recreation.","in_progress"],
    ["Record verification boundaries","Thread/media screens use only the explicitly labeled contract fixture.","todo"],
]) if(!board.tasks.some((t:any)=>t.title === title)) await req("board.task.save",{projectId,task:{title,description,acceptance:"Evidence retained under android-screens",status,blockedBy:[],blockedReason:null,writeScopes:["apps/android"]}});
const schedules=(await req("schedules.list",{projectId})).schedules;
if(!schedules.some((s:any)=>s.title === "Scratch review (disabled)")) await req("schedules.save",{projectId,schedule:{title:"Scratch review (disabled)",brief:"Review synthetic verification evidence; never run automatically.",spec:{kind:"daily",time:"09:00"},model:{provider:"faux",modelId:"faux-1"},thinkingLevel:null,isolation:"shared",onReport:"record",enabled:false,kind:"worker"}});
const memory = new MemoryStore({dataDir:`${scratch}/data`});
try { await memory.write({target:{scope:"project",projectId},fileId:"native-verification",title:"Native verification boundaries",summary:"Scratch-only Android checks",tags:["android","verification"],create:true,heading:"Safety",text:"Only loopback scratch backends are used. The real checkout handles persistence and streaming with a faux model. Contract fixture threads and artifacts are not production semantics."}); }
finally { await memory.close(); }
await Bun.sleep(1000);
console.log(JSON.stringify({projectId, tasks:(await req("board.get",{projectId})).board.tasks.length, schedules:(await req("schedules.list",{projectId})).schedules.length,memory:(await req("memory.list",{scope:"project",projectId})).files?.length}));
client.close();
