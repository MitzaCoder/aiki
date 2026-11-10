/** Native composers initiate additional actual-tool visual states; RPCs below only read/assert. */
import assert from "node:assert/strict";
import {device,project,find,type,tap} from "./native-ui.ts";
import {connect} from "./wire.ts";
import {contentText} from "./real-scenarios.ts";
const installed=await Bun.file("/tmp/harness-verification/scratch/android-screens/ROUND2/installed-post-review-candidate.json").json();
const target=await Bun.file("/tmp/harness-verification/scratch/android-screens/ROUND2/visual-real-project.json").json();
if(target.origin!=="http://127.0.0.1:4795"||!/^\/tmp\/harness-verification\/scratch\/android-verification-real-smoke-[^/]+\/project$/.test(target.path))throw Error("Refusing non-visual scratch project");
const client=await connect(target.origin);await client.request("hello",{protocolVersion:1});
const req=(type:string,fields:Record<string,unknown>={})=>client.request(type,{projectId:target.projectId,...fields});
async function until(read:()=>Promise<any>,accept:(v:any)=>boolean,label:string){for(let i=0;i<300;i++){const v=await read();if(accept(v))return v;await Bun.sleep(100);}throw Error("Actual state did not settle: "+label);}
async function send(text:string){await find(/^Message the coordinator…$/);await type(/^Message the coordinator…$/,text,false,true);await tap(/^Send$/);await until(()=>req("conversation.page",{limit:500,order:"ascending"}),r=>r.entries.some((e:any)=>(e.model??[]).some((m:any)=>m.role==="user"&&contentText(m.content)===text)),text);await until(()=>req("threads.list"),r=>r.threads.some((t:any)=>t.main&&t.status!=="running"),"main settled "+text);}
try {
 const initial=await req("threads.list");assert.equal(initial.threads.filter((t:any)=>!t.main).length,0,"Refusing to repeat fresh-state visual setup");
 await device("phone");await device("adb","reverse","tcp:4795","tcp:4795");await device("adb","shell","am","force-stop","io.github.mitzacoder.aiki");await device("launch");await project(/Native visual states \(faux\)/);
 for(const input of ["R2 visual states","R2 visual coding","R2 visual artifacts"])await send(input);
 process.env.ANDROID_NATIVE_UI_ORIGIN=target.origin;await import("./round2-seed-real-ui.ts");
 for(const input of ["R2 visual thinking","R2 visual coding"])await send(input);
 const threads=await until(()=>req("threads.list"),r=>r.threads.some((t:any)=>t.openQuestions===1)&&r.threads.some((t:any)=>!t.main&&t.status==="running"&&t.runningWorkers===1),"actual Waiting + Working and worker facts");
 const board=(await req("board.get")).board;assert.equal(board.questions.filter((q:any)=>q.status==="open").length,1);assert.equal(board.questions[0].taskId,"T1");
 const artifacts=(await req("artifacts.list")).artifacts;assert.equal(artifacts.length,4);
 const page=await req("conversation.page",{limit:500,order:"ascending"});const json=JSON.stringify(page);assert(json.includes('"type":"thinking"')&&json.includes("native-proof.ts")&&json.includes("sed -n"));
 await find(/Changed one scratch file and verified its contents/);
 const result={pass:true,source:installed.source,apkSha256:installed.apkSha256,scope:"Native composer initiation; actual imported server/tool execution, deterministic faux model",appearanceSeed:"Separate actual Board/Schedules RPCs + MemoryStore; not substituted for native tool execution",...target,inputs:["R2 visual states","R2 visual coding","R2 visual artifacts","R2 visual thinking","R2 visual coding"],threads:threads.threads.map((t:any)=>({id:t.id,title:t.title,status:t.status,openQuestions:t.openQuestions,runningWorkers:t.runningWorkers,ownedTasks:t.ownedTasks})),questions:board.questions,artifacts:artifacts.map((a:any)=>({id:a.id,kind:a.kind,name:a.name,threadId:a.threadId})),longModelName:(await client.request("models.list",{})).models.find((m:any)=>m.provider==="faux")?.name};
 await Bun.write("/tmp/harness-verification/scratch/android-screens/ROUND2/native-visual-tools.json",JSON.stringify(result,null,2)+"\n");console.log(JSON.stringify(result));
}finally{client.close();}
