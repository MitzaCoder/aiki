/** Explicit native Copy -> empty UNSENT composer -> exact actual API bytes (including final LF).
 * Never inject clipboard bytes; controls initiate actual tools on owned4796, not a fixture. */
import assert from "node:assert/strict";
import {device,project,find,tap,tapNode,tree,capture,type,backends} from "./native-ui.ts";
import {connect} from "./wire.ts";
import {contentText} from "./real-scenarios.ts";
const out=process.env.HARNESS_ANDROID_DEVICE_CAPTURES;if(!out?.endsWith("/ROUND2/NATIVE"))throw Error("Use isolated captures");
const target=await Bun.file("/tmp/harness-verification/scratch/android-screens/ROUND2/literal-real-project.json").json();assert.equal(target.origin,"http://127.0.0.1:4796");assert(/^\/tmp\/harness-verification\/scratch\/android-verification-real-smoke-[^/]+\/project$/.test(target.path));
const installed=await Bun.file("/tmp/harness-verification/scratch/android-screens/ROUND2/installed-post-review-candidate.json").json();assert.equal(installed.source,"64152b6");
const c=await connect(target.origin);await c.request("hello",{protocolVersion:1});const projectId=target.projectId;
const page=()=>c.request("conversation.page",{projectId,limit:500,order:"ascending"});
const models=(p:any)=>p.entries.flatMap((e:any)=>e.model??[]);
async function fresh(){await device("adb","shell","am","force-stop","io.github.mitzacoder.aiki");await device("launch");await project(/Native copy proof \(faux\)/);await find(/^Message the coordinator…$/);}
async function locate(label:RegExp,direction:"up"|"down"="down"){
 for(let i=0;i<24;i++){const n=(await tree()).find(n=>n.enabled&&(label.test(n.text)||label.test(n.desc)));if(n)return n;await device("adb","shell","input","swipe","550",direction==="up"?"700":"1200","550",direction==="up"?"1200":"700","500");}throw Error(`Missing actual copy control ${label}`);
}
async function send(input:string){await fresh();await type(/^Message the coordinator…$/,input,false);await tap(/^Send$/);for(let i=0;i<120;i++){const p=await page(),m=models(p),last=m.at(-1);if(m.some((x:any)=>x.role==="user"&&contentText(x.content)===input)&&last?.role==="assistant"&&(await c.request("threads.list",{projectId})).threads.find((t:any)=>t.main)?.status!=="running")return m.slice(m.findLastIndex((x:any)=>x.role==="user"&&contentText(x.content)===input)+1);await Bun.sleep(100);}throw Error(`Actual tools did not settle: ${input}`);}
const calls=(m:any[])=>m.flatMap(x=>Array.isArray(x.content)?x.content:[]).filter(x=>x.type==="toolCall");
const result=(m:any[],call:any)=>m.find(x=>x.role==="toolResult"&&x.toolCallId===call.id);
// Existing native transcript projection separates distinct tool text parts with LF.
const toolText=(message:any):string=>message.content.filter((p:any)=>p.type==="text").map((p:any)=>p.text).join("\n");
const resume=process.argv.includes("--resume-codemode"),proofs:any[]=[];
if(resume){const prior=await Bun.file(`${out}/final-literal-copy-progress.json`).json();assert.equal(prior.source,installed.source);assert.equal(prior.apkSha256,installed.apkSha256);assert.equal(prior.proofs.length,7);proofs.push(...prior.proofs);const inputs=models(await page()).filter((m:any)=>m.role==="user").map((m:any)=>contentText(m.content));assert.deepEqual(inputs,["R2 literal copy","R2 literal error","R2 literal diff","R2 literal codemode"],"Resume only the same fresh four-input run");}
async function copy(label:string,expected:string,tag:string){
 assert(expected.length>0);await locate(new RegExp(`^${label}$`));const before=await page();await tap(new RegExp(`^${label}$`));await capture(`final-${tag}-copy-pressed`,false);
 await tap(/^Message the coordinator…$/);await device("adb","shell","input","keyevent","KEYCODE_PASTE");const field=(await tree()).find(n=>n.className.endsWith("EditText")&&n.text!=="Message the coordinator…");assert(field,"Native paste must populate empty composer");assert.equal(field.text,expected,`${label}: full actual bytes, NO trimming`);
 await device("adb","shell","input","keyevent","KEYCODE_BACK");await capture(`final-${tag}-pasted-unsent`,false);await tapNode(field);await device("adb","shell","input","keycombination","KEYCODE_CTRL_LEFT","KEYCODE_A");await device("adb","shell","input","keyevent","KEYCODE_DEL");await device("adb","shell","input","keyevent","KEYCODE_BACK");await find(/^Message the coordinator…$/);assert.deepEqual((await page()).entries,before.entries,"Copy/paste must not send or mutate main");
 proofs.push({label,tag,expected,copied:field.text,bytes:new TextEncoder().encode(expected).length,finalNewlinePreserved:expected.endsWith("\n"),mainEntriesUnchanged:true,unsentDraftCleared:true});await Bun.write(`${out}/final-literal-copy-progress.json`,JSON.stringify({source:installed.source,apkSha256:installed.apkSha256,complete:false,proofs},null,2)+"\n");
}
async function coding(which:"write"|"read"|"bash") {await fresh();await locate(/^Wrote 1 file · Read 1 file · Ran 1 command$/,"up");await tap(/^Wrote 1 file · Read 1 file · Ran 1 command$/);await locate(/^literal-copy-proof\.md$/);const ns=(await tree()).filter(n=>n.text==="literal-copy-proof.md");if(which!=="bash"){assert(ns[which==="write"?0:1]);await tapNode(ns[which==="write"?0:1]!);}else{await locate(/^printf /);await tap(/^printf /);}}
try {
 await device("phone");await device("adb","reverse","tcp:4796","tcp:4796");await device("adb","shell","am","force-stop","io.github.mitzacoder.aiki");await device("launch");await backends();
 let registered=false;for(let i=0;i<12;i++){const nodes=await tree();if(nodes.some(n=>n.text==="Literal checkout - faux")){registered=true;break;}if(nodes.some(n=>n.text==="Add backend"))break;await device("adb","shell","input","swipe","550","1400","550","900","500");}
 if(!registered){await type(/^Name \(optional; filled from address\)$/,"Literal checkout - faux");await type(/^URL, host, or published name$/,target.origin);await tap(/^Add backend$/,"down");}
 if(!resume){assert(!models(await page()).some((m:any)=>m.role==="user"),"Use a fresh owned4796 project for every full clipboard run; never select among old repeated proof cards");
 const m=await send("R2 literal copy"),cc=calls(m),write=cc.find(x=>x.name==="write"),read=cc.find(x=>x.name==="read"),bash=cc.find(x=>x.name==="bash");assert(write&&read&&bash);const assistant=m.filter((x:any)=>x.role==="assistant").map((x:any)=>contentText(x.content)).join("\n"),code=/```text\n([\s\S]*?)```/.exec(assistant)?.[1];assert(code);
 await coding("write");await copy("Copy file contents",write.arguments.content,"write-file");
 await coding("read");await copy("Copy file contents",toolText(result(m,read)),"read-file");
 await coding("bash");await copy("Copy command",bash.arguments.command,"bash-command");
 await coding("bash");await copy("Copy output",toolText(result(m,bash)),"bash-output");
 await fresh();await copy("Copy code",code,"assistant-code");
 const errorMessages=await send("R2 literal error"),error=calls(errorMessages).find(x=>x.name==="bash");assert(result(errorMessages,error).isError);await fresh();await locate(/^Run command$/);await tap(/^Run command$/);await copy("Copy error output",toolText(result(errorMessages,error)),"error-output");
 const diffMessages=await send("R2 literal diff"),edit=calls(diffMessages).find(x=>x.name==="edit"),diff=result(diffMessages,edit).details?.diff;assert.equal(typeof diff,"string");await fresh();await locate(/^Edit file$/);await tap(/^Edit file$/);await copy("Copy diff",diff,"edit-diff");
 }
 const required={pass:true,requiredComplete:true,source:installed.source,apkSha256:installed.apkSha256,projectId,proofs:proofs.slice(0,7)};assert.equal(required.proofs.length,7);await Bun.write(`${out}/final-literal-required-copy.json`,JSON.stringify(required,null,2)+"\n");
 if(process.argv.includes("--optional-codemode")||resume){
 const existing=models(await page()),cm=resume?existing.slice(existing.findLastIndex((m:any)=>m.role==="user"&&contentText(m.content)==="R2 literal codemode")+1):await send("R2 literal codemode"),script=calls(cm).find(x=>x.name==="codemode");assert(script);const output=toolText(result(cm,script)).replace(/^Script (?:completed|failed)\nWall time [\d.]+ seconds\nOutput:\n?/,"");
 for(const kind of ["script","output"]){await fresh();await locate(/^1 read · 1 bash$/);await tap(/^1 read · 1 bash$/);if(kind==="script"){await locate(/^Script$/);await tap(/^Script$/);}await copy(kind==="script"?"Copy script":"Copy output",kind==="script"?script.arguments.code:output,`codemode-${kind}`);}
 }
 const proof={pass:true,requiredComplete:true,optionalAttempted:process.argv.includes("--optional-codemode")||resume,source:installed.source,apkSha256:installed.apkSha256,projectId,server:"actual imported checkout; deterministic faux; NO fixture clipboard injection",initiation:"native composers",method:"Tap explicit Copy; KEYCODE_PASTE into empty UNSENT composer; exact equality to actual committed arguments/results; clear draft; main API unchanged",proofs};await Bun.write(`${out}/final-literal-copy.json`,JSON.stringify(proof,null,2)+"\n");console.log(JSON.stringify(proof));
}finally{c.close();}
