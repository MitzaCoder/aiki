/** Final stable appearance matrix: actual checkout/tool states except visibly SYNTHETIC Usage. */
import {device,tap,tapNode,find,tree,capture,project,swipe} from "./native-ui.ts";
const [palette="Jarvis",mode="Light",size="phone",section="all"]=process.argv.slice(2);
if(!["Jarvis","Neutral"].includes(palette)||!["Light","Dark"].includes(mode)||!["phone","tablet"].includes(size))throw Error("Invalid matrix cell");
const out=process.env.HARNESS_ANDROID_DEVICE_CAPTURES;if(!out?.endsWith("/ROUND2/NATIVE"))throw Error("Use isolated captures");
const installed=await Bun.file("/tmp/harness-verification/scratch/android-screens/ROUND2/installed-post-review-candidate.json").json();
const visualProject=await Bun.file("/tmp/harness-verification/scratch/android-screens/ROUND2/visual-real-project.json").json();
const prefix=`${palette.toLowerCase()}-${mode.toLowerCase()}-${size}`;
async function shot(screen:string){
 const label=`${prefix}-${screen}`;await capture(label,false);
 await Bun.write(`${out}/${label}.capture.json`,JSON.stringify({source:installed.source,apkSha256:installed.apkSha256,visualScenarioProjectId:visualProject.projectId,palette,mode,size,screen,visualReviewEligible:screen!=="settings-provider-catalog-real",security:screen==="settings-provider-catalog-real"?"SecureOn protected dialog: black screenshot is NOT a visual pass; source/contracts only":undefined,data:screen.includes("SYNTHETIC")?"explicitly labelled synthetic Usage appearance only":"actual imported checkout server, deterministic faux model",readiness:"committed visible transcript / loaded panel / stable empty body, not header Ready or fixed sleep alone"},null,2)+"\n");
}
async function panelTap(label:RegExp) {
 if(size==="phone")return tap(label,"down");
 for(let i=0;i<12;i++) {
  const node=(await tree()).find(n=>n.enabled&&(label.test(n.text)||label.test(n.desc))&&n.bounds.length===4&&n.bounds[3]!>n.bounds[1]!);
  if(node)return tapNode(node);
  await device("adb","shell","input","swipe","2300","1250","2300","450","250");
 }
 throw Error(`Missing tablet panel control ${label}`);
}
const tab=(name:string)=>tap(new RegExp(`^${name}(?:,.*)?$`));
async function chatFind(label:RegExp,direction:"up"|"down") {
 for(let i=0;i<24;i++) {
  const node=(await tree()).find(n=>n.enabled&&(label.test(n.text)||label.test(n.desc)));
  if(node)return node;
  // The pinned question + two composer rows reduce the viewport: global 1250px
  // swipes can skip an entire short disclosure. Keep chat strides overlapping.
  const x=size==="phone"?550:900,a=size==="phone"?700:350,b=a+500;
  await device("adb","shell","input","swipe",String(x),String(direction==="up"?a:b),String(x),String(direction==="up"?b:a),"250");
 }
 throw Error(`Missing committed chat row ${label}`);
}
async function pageFind(label:RegExp,direction:"up"|"down"="down") {
 for(let i=0;i<24;i++){const n=(await tree()).find(n=>n.enabled&&(label.test(n.text)||label.test(n.desc)));if(n)return n;
 const x=size==="phone"?550:1400,a=size==="phone"?650:350,b=a+500;await device("adb","shell","input","swipe",String(x),String(direction==="up"?a:b),String(x),String(direction==="up"?b:a),"500");}
 throw Error(`Missing stable page body ${label}`);
}
async function scheduleFind(label:RegExp){for(let i=0;i<24;i++){const n=(await tree()).find(n=>n.enabled&&(label.test(n.text)||label.test(n.desc)));if(n)return n;const x=size==="phone"?550:1280,a=size==="phone"?700:450;await device("adb","shell","input","swipe",String(x),String(a+400),String(x),String(a),"500");}throw Error(`Missing centered schedule control ${label}`);}
async function frameChatText(label:RegExp,direction:"up"|"down"="down") {
 for(let i=0;i<4;i++){const n=await chatFind(label,direction),desired=size==="phone"?650:400;if(n.bounds[1]!<=desired+80)return;
 const x=size==="phone"?550:900,start=size==="phone"?1250:900,delta=Math.min(500,n.bounds[1]!-desired);await device("adb","shell","input","swipe",String(x),String(start),String(x),String(start-delta),"700");}
}
async function committed(){
 const jump=(await tree()).find(n=>n.text==="Jump to latest");if(jump)await tapNode(jump);
 await chatFind(/Changed one scratch file and verified its contents/,"down");
 await find(/Faux verification model with a deliberately long name/,false,20);
 await find(/^Worker model: default;/,false,20);
 await find(/^Coordinator thinking: automatic$/,false,20);
}
async function stableEmptyUsage(){
 let stable=0;
 for(let i=0;i<20;i++) {
  const nodes=await tree();
  stable=nodes.some(n=>n.text==="No subscription usage")&&!nodes.some(n=>n.className==="android.widget.ProgressBar")?stable+1:0;
  if(stable>=2)return;
  await Bun.sleep(150);
 }
 throw Error("Usage body never reached stable non-loading empty state");
}
await device(size);for(const port of [4794,4795])await device("adb","reverse",`tcp:${port}`,`tcp:${port}`);
await device("adb","shell","am","force-stop","com.mihaisaru.harness");await device("launch");
await find(/^Appearance$/,"down");await tap(new RegExp(`^${palette}$`),"down");await tap(new RegExp(`^${mode}$`),"down");await swipe("down");
if(section==="all"||section==="settings") {
 await shot("settings-appearance");await find(/^Backends$/,"up");await shot("settings-backends-real");
 await tap(/^Providers and credentials$/,"down");await find(/^Providers · Round 2 real checkout$/);await shot("settings-provider-catalog-real");await tap(/^Close$/);
 await tap(/^Open projects$/);await tap(/^Usage$/);await stableEmptyUsage();await shot("usage-empty-real");
 await pageFind(/^SYNTHETIC Usage - no provider login$/);await pageFind(/^Claude · SYNTHETIC$/);await shot("usage-populated-SYNTHETIC");
 await pageFind(/^Usage history: 4 samples\./);await shot("usage-chart-SYNTHETIC");
}
if(section==="settings"){console.log(`STABLE SETTINGS CELL PASS ${prefix}`);process.exit(0);}
await project(/Native visual states \(faux\)/);await committed();
if(section==="board") {await tap(/^Open project panels$/);await tab("Board");await find(/^Which release channel should native delivery target\?$/);await shot("panel-board-real");console.log(`POST-REVIEW BOARD CELL PASS ${prefix}`);process.exit(0);}
if(section==="schedules-artifacts"){await tap(/^Open project panels$/);await tailScreens();console.log(`STABLE TAIL CELL PASS ${prefix}`);process.exit(0);}
await shot("chat-main-real");
// Explicit collapsed/expanded thinking and coding states, with actual tool results.
if(section!=="panels") {
 await tap(/^1 open question · Answer here$/);await find(/^Thread: release-channel-review$/);await shot("chat-question-pin-expanded-real");await tap(/^1 open question · Collapse$/);
 await chatFind(/^Thought$/,"up");await tap(/^Thought$/);await shot("chat-thinking-expanded-real");await tap(/^Thought$/);
 await frameChatText(/^Copy code$/);await shot("chat-code-header-copy-real");
 const group=/^Wrote 1 file · Read 1 file · Ran 1 command$/;
 await chatFind(group,"down");await shot("chat-coding-collapsed-real");await tap(group);await chatFind(/^native-proof\.ts$/,"down");
 let files=(await tree()).filter(n=>n.text==="native-proof.ts");if(!files[0])throw Error("No actual write row in coding group");await tapNode(files[0]);
 await frameChatText(/^export function verificationScope/);await shot("chat-coding-selected-file-real");
 await chatFind(/^native-proof\.ts$/,"up");await tap(/^native-proof\.ts$/); // close selected write
 files=(await tree()).filter(n=>n.text==="native-proof.ts");if(!files[1])throw Error("No actual read row in coding group");await tapNode(files[1]);
 await frameChatText(/^export function verificationScope/);await shot("chat-coding-selected-read-real");
 await chatFind(/^sed -n '1,8p' native-proof\.ts$/,"down");await tap(/^sed -n '1,8p' native-proof\.ts$/);await frameChatText(/^Copy command$/,"up");await shot("chat-coding-selected-command-real");
 await frameChatText(/^export function verificationScope/);await shot("chat-coding-selected-output-real");
}
if(section==="chat"){console.log(`NEW LITERAL CHAT CELL PASS ${prefix}`);process.exit(0);}
await tap(/^Project settings$/);await find(/^Project settings$/);await shot("project-settings-real");await tap(/^Back$/);await committed();
await tap(/^Open project panels$/);await find(/^CONTEXT USAGE$/);await shot("panel-info-real");
await tab("Board");await find(/^Which release channel should native delivery target\?$/);await shot("panel-board-real");
await tab("Background");await find(/^Release channel review$/);await find(/^Native readiness validation$/);await shot("panel-background-real");
await panelTap(/^Stop Native readiness validation$/);await find(/^Stop Native readiness validation\?$/);await shot("background-stop-confirm-real");await tap(/^Keep running$/);
await tab("Workers");const allThreads=(await tree()).find(n=>n.desc==="All threads");if(allThreads)await tapNode(allThreads);await find(/^R2 visual long worker$/);await shot("panel-workers-real");
await tab("Memory");await find(/^Read Native verification boundaries$/);await shot("panel-memory-real");
await tap(/^Read Native verification boundaries$/);await find(/^Evidence$/);await shot("panel-memory-file-real");
await tap(/^Memory maintenance$/);await find(/^Run maintenance$/);await shot("panel-memory-maintenance-real");
await tailScreens();
console.log(`STABLE MATRIX CELL PASS ${prefix}`);
async function tailScreens(){
await tab("Schedules");await find(/^Review native evidence \(disabled\)$/);await shot("panel-schedules-real");
await tap(/^New schedule$/);await find(/^Each run: Run one worker$/);await shot("schedule-editor-real");
await tap(/^Each run: Run one worker$/);await tap(/^Start a background thread$/);await find(/^Prompt$/);await shot("schedule-editor-thread-prompt-real");
await scheduleFind(/^Each background thread runs in its own workspace\./);await scheduleFind(/^On report:/);await shot("schedule-editor-thread-report-footer-real");await tap(/^Cancel$/);
await tab("Artifacts");await find(/^Native implementation proof$/);await shot("panel-artifacts-real");
await panelTap(/^Native implementation proof$/);await find(/^native-proof\.ts$/);await shot("artifact-text-real");
await shot("artifact-details-real");
await tap(/^Open project panels$/);await tab("Artifacts");await panelTap(/^Native image evidence$/);await find(/^proof\.png$/);await shot("artifact-image-real");
await tap(/^Open project panels$/);await tab("Artifacts");await device("adb","logcat","-c");await panelTap(/^Native video evidence$/);
let mediaReady=false;
for(let i=0;i<50;i++){const log=await device("adb","logcat","-d","-s","HarnessMedia:D","*:S");if(/ready source=/.test(log)&&/frame source=/.test(log)){mediaReady=true;break;}await Bun.sleep(100);}
if(!mediaReady)throw Error("Actual video never decoded READY + first frame");
await shot("artifact-video-real");await Bun.write(`${out}/${prefix}-artifact-video.callbacks.log`,await device("adb","logcat","-d","-s","HarnessMedia:D","*:S"));
}
