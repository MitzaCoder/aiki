/** Wait until all8 matrix children have exited successfully; then take exclusive device ownership. */
import {openSync,closeSync} from "node:fs";
import assert from "node:assert/strict";
const root="/tmp/harness-verification/scratch/android-screens/ROUND2",output=root+"/native-final-probes-progress.json";
const marker=await Bun.file(root+"/installed-post-review-candidate.json").json();assert.equal(marker.source,"64152b6");
for(;;){const matrix=await Bun.file(root+"/matrix-progress.json").json();if(matrix.some((r:any)=>r.status==="FAILED"))throw Error("Matrix failed; do not steal device or hide failure");if(matrix.length===8&&matrix.every((r:any)=>r.status==="complete"))break;await Bun.sleep(5000);}
const previous=await Bun.file(output).exists()?await Bun.file(output).json():[];
const results:any[]=[];
for(const name of ["round2-visual-finish","round2-first-run","round2-board-ui","round2-artifact-actions-ui","round2-saf-ui"]){
 const prior=previous.find((r:any)=>r.name===name&&r.status==="complete"&&r.apkSha256===marker.apkSha256);if(prior){results.push(prior);console.log(`${name}: retained complete without repeating successful flow`);continue;}
 const log=`/tmp/harness-verification/scratch/android-cache/r2-final-${name}.log`;results.push({name,source:marker.source,apkSha256:marker.apkSha256,status:"running",log});await Bun.write(output,JSON.stringify(results,null,2)+"\n");
 const fd=openSync(log,"w"),child=Bun.spawn(["bun",`apps/android/verification/${name}.ts`],{env:{...process.env,HARNESS_ANDROID_DEVICE_CAPTURES:root+"/NATIVE"},stdout:fd,stderr:fd});const code=await child.exited;closeSync(fd);Object.assign(results.at(-1)!,{status:code===0?"complete":"FAILED",exitCode:code});await Bun.write(output,JSON.stringify(results,null,2)+"\n");console.log(`${name}: ${code===0?"COMPLETE":"FAILED"}`);if(code!==0)process.exit(code);
}
await Bun.write(output,JSON.stringify(results,null,2)+"\n");
console.log("Required post-matrix native probes completed; fresh media/cleanup/signoff remain separate.");
