/** Final candidate: actual SAF bytes + picker recreation, not merely a restored viewer. */
import {createHash} from "node:crypto";
import {device,project,tap,find,tree,typeNode,capture} from "./native-ui.ts";
import {connect} from "./wire.ts";
const out=process.env.HARNESS_ANDROID_DEVICE_CAPTURES;
if(!out?.endsWith("/ROUND2/NATIVE"))throw Error("Use isolated round-two captures");
const installed=await Bun.file("/tmp/harness-verification/scratch/android-screens/ROUND2/installed-post-review-candidate.json").json();
const log=await Bun.file("/tmp/harness-verification/scratch/android-cache/r2-native-real-server.log").text();
const root=/root (\/tmp\/harness-verification\/scratch\/android-verification-real-smoke-[^;\s]+)/.exec(log)?.[1];
const projectId=/; project (project-[^;]+);/.exec(log)?.[1];
if(!root||!projectId)throw Error("Missing isolated native server identity");
const client=await connect("http://127.0.0.1:4790");await client.request("hello",{protocolVersion:1});
const artifacts=(await client.request("artifacts.list",{projectId})).artifacts;
const artifact=artifacts.find((a:any)=>a.title==="Real saved file");if(!artifact)throw Error("Missing actual saved artifact");client.close();
// Cancel a previous interrupted external picker before resetting the app task.
await device("adb","shell","input","keyevent","KEYCODE_BACK");
await device("phone");await device("adb","shell","am","force-stop","io.github.mitzacoder.aiki");await device("launch");
await project(/Android real checkout \(faux model\)/);await tap(/^Open project panels$/);await tap(/^Artifacts$/);await tap(/^Real saved file$/,"down");
await tap(/^Save a copy…$/);
const filename=`harness-r2-final-${Date.now()}.bin`;
await device("landscape");await find(/^proof\.bin$/);await find(/^SAVE$/i);
await capture(`final-${installed.source}-saf-picker-artifact-after-rotation`,false);
const field=(await tree()).find(n=>n.className.endsWith("EditText"));if(!field)throw Error("No actual SAF filename input after recreation");
// Set the destination AFTER DocumentsUI recreation. This does not claim Android's picker retains edited names.
await typeNode(field,filename,true);
await tap(/^SAVE$/i);await Bun.sleep(1600);await device("phone");
await find(/^Real saved file$/);await find(/^File · 256 B · Thread contract-proof · For T1$/);
const destination=`/sdcard/Download/${filename}`;
const result=await device("adb","shell","sha256sum",destination);
const destinationHash=/^[a-f0-9]{64}/.exec(result)?.[0];
const destinationBytes=Number((await device("adb","shell","stat","-c","%s",destination)).trim());
const sourceHash=createHash("sha256").update(new Uint8Array(await Bun.file(root+"/project/proof.bin").arrayBuffer())).digest("hex");
if(destinationHash!==sourceHash||destinationBytes!==256)throw Error("Actual SAF destination bytes differ from real saved source");
await capture(`final-${installed.source}-real-file-viewer-after-saf-rotation`,false);
const proof={images:[`final-${installed.source}-saf-picker-artifact-after-rotation.png`,`final-${installed.source}-real-file-viewer-after-saf-rotation.png`],installedSource:installed.source,installedApkSha256:installed.apkSha256,projectId,artifactId:artifact.id,threadId:artifact.threadId,filename,destination,destinationBytes,destinationHash,sourceHash,pickerRecreatedWithOriginalArtifactFilename:true,destinationNamedAfterPickerRecreation:true,viewerIdentityRetained:true,result:"PASS: actual destination read/hash matches the real 256-byte source; this is not inferred from viewer restoration"};
await Bun.write(`${out}/final-saf-${installed.source}-bytes-and-rotation.json`,JSON.stringify(proof,null,2)+"\n");console.log(JSON.stringify(proof));
