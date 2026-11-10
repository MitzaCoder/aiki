/** Real native add-backend, add-project, model selection and committed faux-response smoke.
 * Start launch-real.ts first. Uses ONLY its scratch path/loopback port; never production data. */
import {connect} from "./wire.ts";
import {device,find,tap,type,capture,tree,backends} from "./native-ui.ts";
const client = await connect("http://127.0.0.1:4790");
await client.request("hello", {protocolVersion:1});
const models = await client.request("models.list");
if(!models.models?.some((m:any)=>m.provider === "faux" && m.configured)) throw new Error("Use the isolated faux launcher, not another server");
const path = `${process.env.HOME}/scratch/android-verification-real/ui-project`;
await Bun.write(`${path}/.android-verification`, "Scratch-only native UI test project\n");
await device("start"); await device("phone");
await device("adb","shell","am","force-stop","io.github.mitzacoder.aiki"); await device("launch");
// Remove only our earlier local fixture registration, preventing ambiguous duplicate browser fields.
if ((await tree()).some(n => n.text === "Contract QA")) {
    await tap(/^Remove from device$/, "down");
    await tap(/^Remove$/);
}
await type(/^Name \(optional; filled from address\)$/, "Real checkout QA");
await type(/^URL, host, or published name$/, "http://127.0.0.1:4790");
await tap(/^Add backend$/, "down");
await backends();
await find(/^Real checkout QA$/, "up");
await type(/^Project directory on backend$/, path, false);
await tap(/^Add project here$/);
await tap(/^Project settings$/);
await tap(/^(No coordinator model|Faux Model · faux)$/);
await type(/^Filter models$/, "faux", false);
await tap(/^Faux Model · faux$/);
await tap(/^Back$/);
await type(/^Message the coordinator…$/, "Native final UI real checkout verification");
await tap(/^Send$/);
await find(/This answer uses the/);
await capture("jarvis-system-light-chat-real");
const projects = await client.request("projects.list");
const project = projects.projects.find((p:any)=>p.path === path);
if(!project) throw new Error("UI project addition did not reach the real server");
const page = await client.request("conversation.page",{projectId:project.id,limit:100,order:"descending"});
if(!page.entries.some((entry:any)=>entry.kind === "pi.assistant")) throw new Error("No committed assistant response");
console.log(JSON.stringify({pass:true, scope:"REAL checkout persistence/streaming; faux provider; no OAuth",projectId:project.id,path,entries:page.entries.length}));
await Bun.write(`${process.env.HOME}/scratch/android-screens/real-ui-result.json`,JSON.stringify({projectId:project.id,path,entries:page.entries.length,at:new Date().toISOString()},null,2));
client.close();
