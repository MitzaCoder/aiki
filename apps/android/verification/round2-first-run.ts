/** Onboarding appearance only: back up owned emulator's local connection preferences, clear,
 * capture actual empty-backend screens in eight modes, then restore preferences in finally.
 * No remote data/auth/provider changes. Do not run concurrently with any emulator script. */
import assert from "node:assert/strict";
import {device,tree,tapNode,capture} from "./native-ui.ts";
const out=process.env.HARNESS_ANDROID_DEVICE_CAPTURES;if(!out?.endsWith("/ROUND2/NATIVE"))throw Error("Use isolated captures");
const wrapper=`${process.cwd()}/apps/android/verification/device.sh`,pkg="io.github.mitzacoder.aiki",relative="files/datastore/harness-device.preferences_pb";
const backup="/tmp/harness-verification/scratch/android-cache/r2-before-onboarding.preferences_pb";
const installed=await Bun.file("/tmp/harness-verification/scratch/android-screens/ROUND2/installed-post-review-candidate.json").json();
await device("adb","shell","am","force-stop",pkg);
const save=Bun.spawn([wrapper,"adb","exec-out","run-as",pkg,"cat",relative],{stdout:Bun.file(backup),stderr:"pipe"});const error=await new Response(save.stderr).text();assert.equal(await save.exited,0,error);assert(Bun.file(backup).size>50,"Refusing clear without nonempty connection backup");
const beforeHash=new Bun.CryptoHasher("sha256").update(await Bun.file(backup).arrayBuffer()).digest("hex");
const results:string[]=[];
try {
 assert((await device("adb","shell","pm","clear",pkg)).includes("Success"));await device("launch");
 for(const palette of ["Jarvis","Neutral"])for(const mode of ["Light","Dark"])for(const size of ["phone","tablet"]) {
  const seek=async(label:RegExp,direction:"up"|"down")=>{for(let i=0;i<24;i++){const n=(await tree()).find(n=>label.test(n.text)||label.test(n.desc));if(n)return n;const x=size==="phone"?550:900,a=size==="phone"?700:350,b=a+(size==="phone"?1250:800);await device("adb","shell","input","swipe",String(x),String(direction==="down"?b:a),String(x),String(direction==="down"?a:b),"550");}throw Error(`Actual onboarding control missing ${label}`);};
  await device(size);await seek(/^Appearance$/,"down");await tapNode(await seek(new RegExp(`^${palette}$`),"down"));await tapNode(await seek(new RegExp(`^${mode}$`),"down"));
  const prefix=`${palette.toLowerCase()}-${mode.toLowerCase()}-${size}`;
  await seek(/^Connect your first backend$/,"up");await capture(`${prefix}-first-backend-top`,false);
  await seek(/^Name \(optional; filled from address\)$/,"down");await seek(/^Add backend$/,"down");await capture(`${prefix}-first-backend-form`,false);
  for(const screen of ["first-backend-top","first-backend-form"])await Bun.write(`${out}/${prefix}-${screen}.capture.json`,JSON.stringify({source:installed.source,apkSha256:installed.apkSha256,palette,mode,size,screen,data:"Actual empty local connection store; no remote state change",readiness:"Visible first-backend card and real native form"},null,2)+"\n");
  results.push(prefix);
 }
} catch(error) { await capture(`first-backend-failure-before-restore-${Date.now()}`); throw error;
} finally {
 await device("adb","shell","am","force-stop",pkg);await device("adb","shell","run-as",pkg,"mkdir","-p","files/datastore");
 const restore=Bun.spawn([wrapper,"adb","shell","-T",`run-as ${pkg} sh -c 'cat > ${relative}'`],{stdin:Bun.file(backup),stdout:"pipe",stderr:"pipe"});const stderr=await new Response(restore.stderr).text();assert.equal(await restore.exited,0,stderr);
 const verify=Bun.spawn([wrapper,"adb","exec-out","run-as",pkg,"cat",relative],{stdout:"pipe",stderr:"pipe"});const bytes=await new Response(verify.stdout).arrayBuffer();assert.equal(await verify.exited,0);assert.equal(new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),beforeHash,"Local connections must restore byte-for-byte");
 await device("launch");
 await Bun.write(`${out}/first-backend-native-matrix.json`,JSON.stringify({pass:results.length===8,cells:results,source:installed.source,apkSha256:installed.apkSha256,localConnectionPreferencesRestoredByteIdentically:true,remoteStateChanged:false},null,2)+"\n");
}
