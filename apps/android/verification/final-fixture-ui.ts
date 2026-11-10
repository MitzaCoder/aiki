/** Native threads/media/SAF smoke against ONLY the labeled in-memory fixture, never production semantics. */
import {connect} from "./wire.ts";
import {createHash} from "node:crypto";
import {device,find,tap,tapNode,type,typeNode,capture,tree,swipe,project} from "./native-ui.ts";
const client = await connect("http://127.0.0.1:4791");
const hello = await client.request("hello",{protocolVersion:1});
if(hello.server.name !== "ANDROID CONTRACT FIXTURE") throw new Error("Not the labeled fixture");
const projectId = "android-fixture";
const before = await client.request("conversation.page",{projectId,threadId:"main"});
await device("phone");
await device("adb","shell","am","force-stop","io.github.mitzacoder.aiki"); await device("launch");
await project(/^ANDROID CONTRACT FIXTURE$/);
await tap(/^Panels$/);
await find(/^Background contract fixture$/,"down");
await find(/^Stop thread$/,"down");
const open=(await tree()).filter(n=>n.text === "Open conversation" && n.bounds[2]!>n.bounds[0]!).at(-1);
if(!open) throw new Error("Background open button absent");
await capture("fixture-threads-phone");
await tapNode(open);
await find(/Contract QA · background · Ready/);
await type(/^Message the coordinator…$/, "Background scope native QA", false);
await tap(/^Send$/);
await find(/^Background scope native QA$/);
const after = await client.request("conversation.page",{projectId,threadId:"main"});
const background = await client.request("conversation.page",{projectId,threadId:"background"});
if(after.entries.length !== before.entries.length || !JSON.stringify(background.entries).includes("Background scope native QA")) throw new Error("Thread submit scope was not preserved");
await capture("fixture-background-thread-sent");
await tap(/^Panels$/); await tap(/^Artifacts$/);
await type(/^Thread ID \(main or background\)$/, "",false,true);
await capture("fixture-artifacts-list");
async function artifact(id:string) {
    const label=new RegExp(`^Fixture ${id}$`);
    let title=await find(label,"down");
    let button=(await tree()).find(n=>n.text === "Open artifact" && n.bounds[1]!>title.bounds[3]! && n.bounds[2]!>n.bounds[0]!);
    if(!button) { await swipe("down"); title=await find(label); button=(await tree()).find(n=>n.text === "Open artifact" && n.bounds[1]!>title.bounds[3]! && n.bounds[2]!>n.bounds[0]!); }
    if(!button) throw new Error(`No open action below ${id}`);
    await tapNode(button);
    if(id !== "video") await find(label);
}
await artifact("file");
await tap(/^Save a copy…$/);
await find(/^(SAVE|Save)$/);
const outputName = `harness-fixture-${Date.now()}.bin`;
const filename=(await tree()).find(n=>n.resource === "android:id/title" && n.className === "android.widget.EditText");
if(!filename) throw new Error("Document filename field missing");
await typeNode(filename,outputName,true);
await capture("fixture-save-document-picker");
await tap(/^(SAVE|Save)$/);
await find(/^Saved 256 bytes\.$/);
await capture("fixture-file-saved");
const expected=createHash("sha256").update(Uint8Array.from({length:256},(_,i)=>i)).digest("hex");
const saved=await device("adb","shell","sha256sum",`/sdcard/Download/${outputName}`);
if(!saved.startsWith(expected)) throw new Error("SAF document differs from fixture bytes");
await tap(/^Back$/);
await type(/^Thread ID \(main or background\)$/, "", "up", true);
await artifact("video");
// Media3 updates can prevent the CLI's 1000 ms idle window. Use bounded sanitized
// player callbacks rather than silently reusing a previous window's XML.
const pid=(await device("adb","shell","pidof","io.github.mitzacoder.aiki")).trim();
async function mediaLog() { return device("adb","logcat","-d",`--pid=${pid}`,"-s","HarnessMedia:V","*:S"); }
const frames=(log:string)=>[...log.matchAll(/frame source=(\d+) durationMs=(\d+) positionMs=(\d+)/g)].map(m=>({source:Number(m[1]),duration:Number(m[2]),position:Number(m[3])}));
async function waitMedia(predicate:(log:string)=>boolean) {
    for(let i=0;i<20;i++) { const log=await mediaLog(); if(predicate(log)) return log; await Bun.sleep(1000); }
    throw new Error("No ready decoded frame within bounded media wait");
}
const firstLog=await waitMedia(log=>frames(log).some(f=>f.duration===2000));
const sourceBefore=frames(firstLog).at(-1)!.source;
// Fixed native seekbar geometry, ONLY for the known 1080x2400 / 420-dpi phone fixture.
await device("adb","shell","input","tap","650","1238");
const seekLog=await waitMedia(log=>[...log.matchAll(/position source=\d+ positionMs=(\d+)/g)].some(m=>Number(m[1])>800 && Number(m[1])<1800));
const position=Number([...seekLog.matchAll(/position source=\d+ positionMs=(\d+)/g)].at(-1)![1]);
await capture("fixture-video-seeked",false);
await Bun.sleep(31_000); // includes proactive URL renewal before its 30 s expiry
const renewedLog=await waitMedia(log=>frames(log).some(f=>f.source>sourceBefore && f.duration===2000 && Math.abs(f.position-position)<100));
const renewedFrame=frames(renewedLog).at(-1)!;
const sourceAfter=renewedFrame.source, renewed=renewedFrame.position;
await Bun.write(`${process.env.HOME}/scratch/android-cache/final-media-player.log`,renewedLog);
await capture("fixture-video-after-expiry-renewal",false);
await device("adb","shell","input","keyevent","KEYCODE_BACK"); await type(/^Thread ID \(main or background\)$/, "", "up", true);
await artifact("image"); await find(/^image.png$/); await capture("fixture-image-preview");
await tap(/^Back$/); await type(/^Thread ID \(main or background\)$/, "", "up", true);
await artifact("text"); await find(/Android artifact contract fixture/); await capture("fixture-text-preview");
console.log(JSON.stringify({pass:true,scope:"LABELED CONTRACT FIXTURE ONLY",backgroundSubmit:true,safSha256:expected,videoPosition:position,renewedPosition:renewed,readyDurationSeconds:2,decodedFrame:true,sourceBefore,sourceAfter,outputName,previews:["file","video","image","text"]}));
client.close();
