/** Native text wrap/copy/paste + confirmed deletion, on a newly tool-created disposable artifact.
 * No synthetic artifact metadata or RPC mutation substitutes for native controls. */
import assert from "node:assert/strict";
import {connect} from "./wire.ts";
import {device,project,find,tap,tapNode,tree,type,capture} from "./native-ui.ts";
import {contentText} from "./real-scenarios.ts";
const out=process.env.HARNESS_ANDROID_DEVICE_CAPTURES;if(!out?.endsWith("/ROUND2/NATIVE"))throw Error("Use isolated captures");
const installed=await Bun.file("/tmp/harness-verification/scratch/android-screens/ROUND2/installed-post-review-candidate.json").json();
const targetProject=await Bun.file("/tmp/harness-verification/scratch/android-screens/ROUND2/visual-real-project.json").json();assert.equal(targetProject.origin,"http://127.0.0.1:4795");assert(/^\/tmp\/harness-verification\/scratch\/android-verification-real-smoke-[^/]+\/project$/.test(targetProject.path));
const c=await connect(targetProject.origin);await c.request("hello",{protocolVersion:1});const projectId=targetProject.projectId;
const list=async()=>(await c.request("artifacts.list",{projectId})).artifacts;
const page=()=>c.request("conversation.page",{projectId,limit:500,order:"ascending"});
async function until(read:()=>Promise<any>,accept:(r:any)=>boolean,label:string){for(let i=0;i<100;i++){const r=await read();if(accept(r))return r;await Bun.sleep(100);}throw Error("Actual state not settled: "+label);}
async function viewer(){await project(/Native visual states \(faux\)/);await find(/^Message the coordinator…$/);await tap(/^Open project panels$/);await tap(/^Artifacts(?:,.*)?$/);await tap(/^Native implementation proof$/);await find(/^Copy text$/);}
const codeNode=async()=>(await tree()).find(n=>n.text.startsWith("export function verificationScope"));
try {
 await device("phone");await device("adb","shell","am","force-stop","io.github.mitzacoder.aiki");await device("launch");const before=await list();await project(/Native visual states \(faux\)/);
 await type(/^Message the coordinator…$/,"R2 visual artifacts",false,true);await tap(/^Send$/);
 const after=await until(list,a=>a.length===before.length+4,"four fresh actual saves");const fresh=after.filter((a:any)=>!before.some((b:any)=>b.id===a.id));const target=fresh.find((a:any)=>a.kind==="text");assert(target);
 await until(()=>c.request("threads.list",{projectId}),r=>r.threads.some((t:any)=>t.main&&t.status!=="running"),"main completed native saves");
 const source=await c.request("artifacts.url",{projectId,artifactId:target.id,intent:"inline"});const expected=await(await fetch(source.url)).text();assert(expected.startsWith("export function verificationScope"));
 await viewer();await find(/^Wrap: on$/,"down");const wrapped=await codeNode();assert(wrapped);
 await tap(/^Wrap: on$/);await find(/^Wrap: off$/);const unwrapped=await codeNode();assert(unwrapped);assert(unwrapped.bounds[3]!-unwrapped.bounds[1]!<wrapped.bounds[3]!-wrapped.bounds[1]!,"Wrap toggle must change actual rendered line height");
 await capture("final-artifact-text-wrap-off",false);await tap(/^Wrap: off$/);await find(/^Wrap: on$/);await tap(/^Copy text$/);
 const mainBefore=await page();await tap(/^Back$/);await find(/^Message the coordinator…$/);await tap(/^Message the coordinator…$/);await device("adb","shell","input","keyevent","KEYCODE_PASTE");
 const pasted=(await tree()).find(n=>n.className.endsWith("EditText")&&n.text.startsWith("export function verificationScope"));assert(pasted);assert.equal(pasted.text,expected,"Native Copy text must paste byte-identical text into unsent composer");
 await device("adb","shell","input","keyevent","KEYCODE_BACK");await capture("final-artifact-copied-text-unsent-composer",false);await tapNode(pasted);await device("adb","shell","input","keycombination","KEYCODE_CTRL_LEFT","KEYCODE_A");await device("adb","shell","input","keyevent","KEYCODE_DEL");await device("adb","shell","input","keyevent","KEYCODE_BACK");await find(/^Message the coordinator…$/);assert.deepEqual((await page()).entries,mainBefore.entries,"Copy/paste draft must never submit");
 await viewer();
 await tap(/^Delete artifact$/);await find(/^Delete artifact\?$/);assert((await list()).some((a:any)=>a.id===target.id));await capture("final-artifact-delete-confirm",false);await tap(/^Keep it$/);assert((await list()).some((a:any)=>a.id===target.id),"Cancel must retain actual artifact");
 const active=await c.request("artifacts.url",{projectId,artifactId:target.id,intent:"inline"});assert.equal((await fetch(active.url)).status,200,"Old URL is genuinely live immediately before deletion");
 await tap(/^Delete artifact$/);await tap(/^Delete$/);await find(/^Artifact unavailable$/);
 await until(list,a=>!a.some((x:any)=>x.id===target.id),"native confirmation deletes actual artifact");const status=(await fetch(active.url)).status;assert.equal(status,404);
 await device("landscape");await find(/^Artifact unavailable$/);await device("phone");await Bun.sleep(31_000);await find(/^Artifact unavailable$/);await capture("final-artifact-deleted-after-rotation-and-renewal-window",false);
 const retained=await list();assert(before.every((a:any)=>retained.some((b:any)=>a.id===b.id)),"Original matrix artifacts remain after disposable proof");
 const proof={pass:true,source:installed.source,apkSha256:installed.apkSha256,projectId,artifactId:target.id,artifactCreation:"native composer -> actual artifact_save",wrap:{wrappedHeight:wrapped.bounds[3]!-wrapped.bounds[1]!,unwrappedHeight:unwrapped.bounds[3]!-unwrapped.bounds[1]!,restoredOn:true},copy:{nativeCopyThenPaste:true,characters:expected.length,exactText:true,composerUnsentAndCleared:true,mainEntriesUnchanged:true},deletion:{cancelRetained:true,explicitNativeConfirmation:true,absentFromActualList:true,oldSignedHttpStatus:status,unavailableAcrossRotationAndNextRenewalWindow:true},retainedOriginalMatrixArtifacts:true};
 await Bun.write(`${out}/final-artifact-actions.json`,JSON.stringify(proof,null,2)+"\n");console.log(JSON.stringify(proof));
}finally{c.close();}
