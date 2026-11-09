/** Serialized emulator ownership. Stop on first failure; retain old panel images with ORIGINAL source/hash. */
import {openSync,closeSync} from "node:fs";
const jobs=[
 ["Jarvis","Dark","phone","chat-panels"], // this APK’s6 settings/Usage images already passed before a chat-position probe failed
 ["Neutral","Light","tablet","schedules-artifacts"], // earlier same64152b6 attempt completed settings/chat/panels before centered-dialog scroll probe failed
 ["Neutral","Dark","tablet","all"],
 ["Jarvis","Light","tablet","all"],["Jarvis","Dark","tablet","all"],
 ["Jarvis","Light","phone","chat"],["Neutral","Light","phone","chat"],["Neutral","Dark","phone","chat"],
];
if(jobs.length!==8||new Set(jobs.map(j=>j.slice(0,3).join("-"))).size!==8)throw Error("Matrix must schedule exactly8 distinct cells");
const output="/tmp/harness-verification/scratch/android-screens/ROUND2/matrix-progress.json";
const marker=await Bun.file("/tmp/harness-verification/scratch/android-screens/ROUND2/installed-post-review-candidate.json").json();
if(marker.source!=="64152b6")throw Error("Install approved V4/V5 source before updated captures");
const previous=await Bun.file(output).exists()?await Bun.file(output).json():[];
const results:Record<string,unknown>[]=[];
for(const job of jobs){
 const name=job.slice(0,3).join("-").toLowerCase();const prior=previous.find((r:any)=>r.cell===name&&r.status==="complete"&&r.apkSha256===marker.apkSha256);if(prior){results.push(prior);console.log(`${name}: retained complete with original source/hash`);continue;}
 const log=`/tmp/harness-verification/scratch/android-cache/r2-literal-${name}.log`;
 results.push({cell:name,section:job[3],source:marker.source,apkSha256:marker.apkSha256,status:"running",log});await Bun.write(output,JSON.stringify(results,null,2)+"\n");
 const fd=openSync(log,"w");
 const proc=Bun.spawn(["bun","apps/android/verification/round2-captures.ts",...job],{env:{...process.env,HARNESS_ANDROID_DEVICE_CAPTURES:"/tmp/harness-verification/scratch/android-screens/ROUND2/NATIVE"},stdout:fd,stderr:fd});
 const code=await proc.exited;closeSync(fd);Object.assign(results.at(-1)!,{status:code===0?"complete":"FAILED",exitCode:code});await Bun.write(output,JSON.stringify(results,null,2)+"\n");
 console.log(`${name}: ${code===0?"COMPLETE":"FAILED"}`);if(code!==0)process.exit(code);
}
await Bun.write(output,JSON.stringify(results,null,2)+"\n");
console.log("ALL8 updated chat cells complete; unchanged earlier phone panels retain01ec5a5/source hash metadata.");
