/** Fresh final-source actual video. No stale hierarchy once Media3 mounts; use callbacks + fresh PNG. */
import assert from "node:assert/strict";
import {device,project,tap,find,capture} from "./native-ui.ts";
import {connect} from "./wire.ts";
const out=process.env.HARNESS_ANDROID_DEVICE_CAPTURES;if(!out?.endsWith("/ROUND2/NATIVE"))throw Error("Use isolated captures");
const installed=await Bun.file("/tmp/harness-verification/scratch/android-screens/ROUND2/installed-post-review-candidate.json").json();
const c=await connect("http://127.0.0.1:4790");await c.request("hello",{protocolVersion:1});const projectId="project-5981defd89";
assert((await c.request("projects.list",{})).projects.some((p:any)=>p.id===projectId&&/^\/tmp\/harness-verification\/scratch\/android-verification-real-smoke-[^/]+\/project$/.test(p.path)));
const artifact=(await c.request("artifacts.list",{projectId})).artifacts.find((a:any)=>a.kind==="video");assert(artifact);
const logs=()=>device("adb","logcat","-d","-s","HarnessMedia:D","*:S");
const ready=(s:string)=>{const m=[...s.matchAll(/ready source=(\d+) durationMs=(\d+) positionMs=(\d+)/g)].at(-1);return m?{source:Number(m[1]),durationMs:Number(m[2]),positionMs:Number(m[3])}:undefined;};
async function wait(accept:(r:NonNullable<ReturnType<typeof ready>>,log:string)=>boolean){for(let i=0;i<330;i++){const log=await logs(),r=ready(log);if(r&&accept(r,log))return r;await Bun.sleep(100);}throw Error("Actual Media3 callback condition not reached");}
try {
 await device("phone");await device("adb","shell","am","force-stop","com.mihaisaru.harness");await device("launch");await project(/Android real checkout \(faux model\)/);await find(/^Message the coordinator…$/);await tap(/^Open project panels$/);await tap(/^Artifacts(?:,.*)?$/);await device("adb","logcat","-c");await tap(new RegExp("^"+artifact.title.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+"$"),"down");
 const initial=await wait((r,log)=>r.durationMs===2000&&/frame source=/.test(log));await capture("final-real-video-initial",false);
 if(process.argv.includes("--open-only")){console.log(JSON.stringify({source:installed.source,initial,note:"Fresh initial PNG available; no renewal assertion yet"}));process.exit(0);}
 // Same unmodified phone MediaViewer geometry as accepted prior proof. Fresh initial PNG retained.
 await device("adb","shell","input","tap","650","1678");const pausedBefore=await wait(r=>r.positionMs>=1100&&r.positionMs<=1400);const pausedAfter=await wait(r=>r.source>pausedBefore.source);assert(Math.abs(pausedAfter.positionMs-pausedBefore.positionMs)<=100);const renewedAt=Date.now();await capture("final-real-video-paused-after-renewal",false);
 await Bun.sleep(Math.max(0,23300-(Date.now()-renewedAt)));await device("adb","shell","input","tap","63","1678");await device("adb","shell","input","tap","540","1510");const playingAfter=await wait(r=>r.source>pausedAfter.source);assert(playingAfter.positionMs>0&&playingAfter.positionMs<playingAfter.durationMs);await capture("final-real-video-playing-after-renewal",false);
 const callbacks=await logs();await Bun.write(`${out}/final-real-media-callbacks.log`,callbacks);const proof={pass:true,source:installed.source,apkSha256:installed.apkSha256,projectId,artifactId:artifact.id,initial,decodedFrame:/frame source=/.test(callbacks),pausedBefore,pausedAfter,playingAfter,actualTimedSignedSourceRenewal:true,physicalDecoderClaim:false,note:"Inspect retained fresh PNG Play/Pause controls; actual callbacks verify positions. Expiry rejection separately covered by live JVM/HTTP contracts."};await Bun.write(`${out}/final-real-media-renewal.json`,JSON.stringify(proof,null,2)+"\n");console.log(JSON.stringify(proof));await device("adb","shell","input","tap","755","221");
}finally{c.close();}
