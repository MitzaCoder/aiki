/** End an owned visual run natively: confirmed Stop cancels coordinator AND worker,
 * then answer the real background-owned Board question through native controls. */
import assert from "node:assert/strict";
import {device,project,tap,find,capture} from "./native-ui.ts";
import {connect} from "./wire.ts";
import {contentText} from "./real-scenarios.ts";
const target=await Bun.file("/tmp/harness-verification/scratch/android-screens/ROUND2/visual-real-project.json").json();assert.equal(target.origin,"http://127.0.0.1:4795");assert(/^\/tmp\/harness-verification\/scratch\/android-verification-real-smoke-[^/]+\/project$/.test(target.path));
const installed=await Bun.file("/tmp/harness-verification/scratch/android-screens/ROUND2/installed-post-review-candidate.json").json();
const out=process.env.HARNESS_ANDROID_DEVICE_CAPTURES;if(!out?.endsWith("/ROUND2/NATIVE"))throw Error("Use isolated captures");
const c=await connect(target.origin);await c.request("hello",{protocolVersion:1});const projectId=target.projectId;
async function until(read:()=>Promise<any>,accept:(r:any)=>boolean,label:string){for(let i=0;i<100;i++){const r=await read();if(accept(r))return r;await Bun.sleep(100);}throw Error(label);}
try {
 const before=(await c.request("threads.list",{projectId})).threads;assert(before.some((t:any)=>t.id==="native-readiness-validation"&&t.status==="running"&&t.runningWorkers===1));
 await device("phone");await device("adb","shell","am","force-stop","com.mihaisaru.harness");await device("launch");await project(/Native visual states \(faux\)/);await find(/^Message the coordinator…$/);
 await tap(/^Open project panels$/);await tap(/^Background(?:,.*)?$/);await tap(/^Stop Native readiness validation$/);await find(/^Stop Native readiness validation\?$/);await tap(/^Stop thread$/);
 const stopped=await until(()=>c.request("threads.list",{projectId}),r=>r.threads.some((t:any)=>t.id==="native-readiness-validation"&&t.status!=="running"&&t.runningWorkers===0),"Native Stop did not cancel actual coordinator+worker");
 await capture(`functional-visual-${projectId}-confirmed-stop`,false); // keep prior run's completed proof image untouched
 await tap(/^Board(?:,.*)?$/);await find(/^Which release channel should native delivery target\?$/);await tap(/^Internal QA$/);await tap(/^Answer$/);
 const board=await until(()=>c.request("board.get",{projectId}),r=>r.board.questions.some((q:any)=>q.id==="Q1"&&q.status==="answered"&&q.answer==="Internal QA"),"Native Board answer was not committed");
 const recipient=await until(()=>c.request("conversation.page",{projectId,threadId:"release-channel-review",limit:500,order:"ascending"}),r=>r.entries.some((e:any)=>(e.model??[]).some((m:any)=>m.role==="user"&&contentText(m.content).includes("Internal QA"))),"Actual question answer not delivered to its owning background");
 const answerInputs=recipient.entries.flatMap((e:any)=>(e.model??[]).filter((m:any)=>m.role==="user"&&contentText(m.content).includes("Internal QA")).map((m:any)=>contentText(m.content)));
 const proof={pass:true,images:[`functional-visual-${projectId}-confirmed-stop.png`],source:installed.source,apkSha256:installed.apkSha256,projectId,nativeConfirmedStop:true,coordinatorAndWorkerNoLongerRunning:true,stopped:stopped.threads.find((t:any)=>t.id==="native-readiness-validation"),question:board.board.questions.find((q:any)=>q.id==="Q1"),answerDeliveredToThread:"release-channel-review",answerInputs};
 await Bun.write(`${out}/visual-${projectId}-native-stop-and-answer.json`,JSON.stringify(proof,null,2)+"\n");console.log(JSON.stringify(proof));
}finally{c.close();}
