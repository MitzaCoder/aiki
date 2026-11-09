/** Optional rendered literal CodeMode OUTPUT, no clipboard retry or new model input. */
import assert from "node:assert/strict";
import {device,project,tree,tapNode,capture} from "./native-ui.ts";
import {connect} from "./wire.ts";
const out=process.env.HARNESS_ANDROID_DEVICE_CAPTURES;if(!out?.endsWith("/ROUND2/NATIVE"))throw Error("Use isolated captures");
const target=await Bun.file("/tmp/harness-verification/scratch/android-screens/ROUND2/literal-real-project.json").json();assert.equal(target.origin,"http://127.0.0.1:4796");const installed=await Bun.file("/tmp/harness-verification/scratch/android-screens/ROUND2/installed-post-review-candidate.json").json();
const c=await connect(target.origin);await c.request("hello",{protocolVersion:1});try{
 const p=await c.request("conversation.page",{projectId:target.projectId,limit:500,order:"ascending"}),result=p.entries.flatMap((e:any)=>e.model??[]).findLast((m:any)=>m.role==="toolResult"&&m.toolName==="codemode");assert(result&&!result.isError&&result.details.calls.length===2);const expected=result.content.filter((p:any)=>p.type==="text").map((p:any)=>p.text).join("\n").replace(/^Script (?:completed|failed)\nWall time [\d.]+ seconds\nOutput:\n?/,"");assert(expected.includes("# Literal CodeMode output\n**not bold**"));
 await device("phone");await device("adb","shell","am","force-stop","com.mihaisaru.harness");await device("launch");await project(/Native copy proof \(faux\)/);
 const header=(await tree()).find(n=>n.text==="1 read · 1 bash");assert(header);await tapNode(header);
 let visible=false;for(let i=0;i<12;i++){const node=(await tree()).find(n=>n.text===expected);if(node&&node.bounds[1]!<1300){visible=true;break;}await device("adb","shell","input","swipe","550","1200","550","800","500");}assert(visible,"Actual output must remain one exact literal native text node, not Markdown headings/lists");await capture("final-codemode-literal-output-real",false);
 await Bun.write(`${out}/final-codemode-literal-output.json`,JSON.stringify({pass:true,source:installed.source,apkSha256:installed.apkSha256,projectId:target.projectId,actualTwoNestedCalls:true,expected,exactLiteralNativeTextVisible:true,clipboardScriptProbeStillSeparateAndInconclusive:true},null,2)+"\n");
}finally{c.close();}
