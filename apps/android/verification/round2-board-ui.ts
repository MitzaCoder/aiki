/** Real native Board drag + accessible reorder + CAS draft/rotation. Scratch4790 only. */
import assert from "node:assert/strict";
import {connect} from "./wire.ts";
import {device,project,tap,find,tree,typeNode,capture} from "./native-ui.ts";
const out=process.env.HARNESS_ANDROID_DEVICE_CAPTURES;if(!out?.endsWith("/ROUND2/NATIVE"))throw Error("Use isolated captures");
const installed=await Bun.file("/tmp/harness-verification/scratch/android-screens/ROUND2/installed-post-review-candidate.json").json();
const client=await connect("http://127.0.0.1:4790");await client.request("hello",{protocolVersion:1});
const projectId="project-5981defd89";
const projects=(await client.request("projects.list",{})).projects;
assert(projects.some((p:any)=>p.id===projectId&&/^\/tmp\/harness-verification\/scratch\/android-verification-real-smoke-[^/]+\/project$/.test(p.path)));
const board=async()=>(await client.request("board.get",{projectId})).board;
const ids=(b:any)=>b.tasks.slice().sort((a:any,b:any)=>a.order-b.order).map((t:any)=>t.id);
const input=(t:any)=>({title:t.title,description:t.description,acceptance:t.acceptance,status:t.status,blockedBy:t.blockedBy,blockedReason:t.blockedReason,writeScopes:t.writeScopes});
async function until(accept:(b:any)=>boolean,label:string){for(let i=0;i<100;i++){const b=await board();if(accept(b))return b;await Bun.sleep(100);}throw Error("Actual Board did not settle: "+label);}
try {
 const before=await board(),original=before.tasks.find((t:any)=>t.id==="T2");assert.equal(original.title,"Review release checklist");assert.equal(before.tasks.find((t:any)=>t.id==="T3").status,"todo");
 await device("phone");await device("adb","shell","am","force-stop","io.github.mitzacoder.aiki");await device("launch");await project(/Android real checkout \(faux model\)/);
 await find(/^Message the coordinator…$/,false,20); // old committed proof prose can be above the latest viewport
 await tap(/^Open project panels$/);await tap(/^Board(?:,.*)?$/);
 await tap(/^Review · 1$/);await tap(/^Blocked · 1$/);
 let handles:ReturnType<typeof tree> extends Promise<infer T>?T:never=[];
 for(let i=0;i<8;i++) {
  handles=(await tree()).filter(n=>n.desc==="Hold to reorder T2"||n.desc==="Hold to reorder T3");
  if(handles.length===2&&handles.every(n=>n.bounds[1]!>450&&n.bounds[3]!<2300))break;
  await device("adb","shell","input","swipe","550","1600","550","1300","250");
 }
 const h2=handles.find(n=>n.desc==="Hold to reorder T2"),h3=handles.find(n=>n.desc==="Hold to reorder T3");assert(h2&&h3,"Both same-status native drag handles must be visible");
 const center=(n:typeof h2)=>[Math.round((n!.bounds[0]!+n!.bounds[2]!)/2),Math.round((n!.bounds[1]!+n!.bounds[3]!)/2)];
 const [x,y]=center(h3),[,targetY]=center(h2);
 await device("adb","shell","input","draganddrop",String(x),String(y),String(x),String(targetY),"1200");
 const dragged=await until(b=>ids(b).indexOf("T3")<ids(b).indexOf("T2"),"same-group drag persisted");
 for(const task of before.tasks){const after=dragged.tasks.find((t:any)=>t.id===task.id);assert.equal(after.revision,task.revision);assert.equal(after.status,task.status);assert.deepEqual(input(after),input(task));}
 assert.deepEqual(ids(dragged).filter((id:string)=>!["T2","T3"].includes(id)),ids(before).filter((id:string)=>!["T2","T3"].includes(id)));
 await capture("final-board-after-native-group-drag",false);
 await tap(/^Task T2 actions$/,"down");await tap(/^Move up$/);await until(b=>JSON.stringify(ids(b))===JSON.stringify(ids(before)),"accessible reorder restored original order");
 await tap(/^Task T2 actions$/,"down");await tap(/^Edit task$/);
 const field=(await tree()).find(n=>n.className.endsWith("EditText")&&n.text===original.title);assert(field,"Native task title input");
 const retained="R2 retained draft across conflict";await typeNode(field,retained,true);
 const external=await client.request("board.task.save",{projectId,taskId:original.id,expectedRevision:original.revision,task:{...input(original),title:"Remote title changed during draft"}});assert.notEqual(external.type,"error");
 await tap(/^Save$/,"down");await find(/^Task changed elsewhere\. Your draft is preserved\.$/,"down");
 await device("landscape");await find(new RegExp(`^${retained}$`),"up");await capture("final-board-cas-draft-landscape",false);
 await device("phone");await find(new RegExp(`^${retained}$`),"up");
 await find(/^Task changed elsewhere\. Your draft is preserved\.$/,"down");await capture("final-board-cas-conflict-after-rotation",false);
 await tap(new RegExp(`^Save mine against revision ${external.task.revision}$`),"down");
 const saved=await until(b=>b.tasks.some((t:any)=>t.id===original.id&&t.title===retained&&t.revision===external.task.revision+1),"explicit save mine against latest revision");
 const mine=saved.tasks.find((t:any)=>t.id===original.id);
 const restored=await client.request("board.task.save",{projectId,taskId:original.id,expectedRevision:mine.revision,task:input(original)});assert.notEqual(restored.type,"error");
 const proof={pass:true,installedSource:installed.source,installedApkSha256:installed.apkSha256,projectId,nativeDrag:{before:ids(before),after:ids(dragged),statusesAndRevisionsUnchanged:true},accessibleMoveUpRestoredOrder:true,cas:{initialRevision:original.revision,externalRevision:external.task.revision,savedMineRevision:mine.revision,draftRetainedAcrossRotation:true,explicitLatestRevisionSave:true,originalPresentationRestored:true},note:"External CAS competitor and final title restoration use actual scratch RPC; drag, fallback reorder, edit/save/conflict/Save mine are native UI."};
 await Bun.write(`${out}/final-board-drag-cas.json`,JSON.stringify(proof,null,2)+"\n");console.log(JSON.stringify(proof));
} finally {client.close();}
