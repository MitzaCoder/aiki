/** Additional real-tool programs for rendered states. Only a new isolated visual server uses these inputs.
 * No fake service payloads: board questions/tasks, threads, workers and coding calls execute actual tools. */
import type {TranscriptContext} from "../../../packages/server/node_modules/@earendil-works/pi-ai/dist/index.js";
import {fauxAssistantMessage as say,fauxToolCall} from "../../../packages/server/node_modules/@earendil-works/pi-ai/dist/providers/faux.js";
import {join} from "node:path";
const textOf=(content:unknown):string=>typeof content==="string"?content:Array.isArray(content)?content.map(p=>p?.type==="text"?p.text??"":"").join(""):"";
const call=(name:string,args:Parameters<typeof fauxToolCall>[1])=>say([fauxToolCall(name,args)],{stopReason:"toolUse"});
export const literalFile = "# Literal file heading\n**these are literal asterisks**\n- source list marker\n`inline bytes`\n";
export const literalCommand = "printf '%s\\n' '# Literal stdout heading' '**not bold**' '- not a list' '`inline bytes`'\n";
export const literalCode = "# Literal fenced-code heading\n**not bold**\n- not a rendered list\n";
export const literalScript = `const file = await tools.read({ path: "literal-copy-proof.md" });\nconst command = await tools.bash({ command: ${JSON.stringify(literalCommand)} });\nreturn ${JSON.stringify("# Literal CodeMode output\n**not bold**\n- raw bytes\n")};\n`;
export function visualScenario(request:TranscriptContext,root:string) {
 const system=request.messages.filter(m=>m.role==="system").map(m=>Object.values((m as any).sections??{}).join("\n")+textOf((m as any).content)).join("\n");
 const messages=request.messages.filter(m=>m.role!=="system") as any[],last=messages.at(-1);
 const inputIndex=messages.findLastIndex(m=>m.role==="user"),input=textOf(messages[inputIndex]?.content);
 const tool=last?.role==="toolResult"?last.toolName:undefined;
 const thread=/You are the background thread "([^"]+)"/.exec(system)?.[1],worker=system.includes('You are the worker "');
 const calls=messages.slice(inputIndex+1).flatMap(m=>Array.isArray(m.content)?m.content:[]).filter(p=>p.type==="toolCall");
 if(!thread&&!worker&&input==="R2 literal copy") {
  if(!tool)return call("write",{path:"literal-copy-proof.md",content:literalFile});
  if(tool==="write")return call("read",{path:"literal-copy-proof.md"});
  if(tool==="read")return call("bash",{command:literalCommand});
  return say("Literal copy proof ready.\n\n```text\n"+literalCode+"```");
 }
 if(!thread&&!worker&&input==="R2 literal codemode")return tool?say("Actual CodeMode copy proof ready."):call("codemode",{code:literalScript});
 if(!thread&&!worker&&input==="R2 literal error")return tool?say("Actual error output retained for literal-copy verification."):call("bash",{command:"printf '%s\\n' '# Literal stderr heading' '**not bold**' >&2; exit 7\n"});
 if(!thread&&!worker&&input==="R2 literal diff")return tool?say("Actual edit diff retained for literal-copy verification."):call("edit",{path:"literal-copy-proof.md",oldText:"**these are literal asterisks**",newText:"**changed literal bytes**"});
 if(worker&&input.includes("R2 visual long worker"))return tool?say("## Report\nOutcome: done\nIsolated readiness check ended."):call("bash",{command:"printf 'Isolated native readiness worker running\\n'; sleep 7200",timeout:7300});
 if(thread&&input==="R2 visual waiting") {
  if(!calls.some(c=>c.name==="board"&&c.arguments.action==="ask"))return call("board",{action:"ask",text:"Which release channel should native delivery target?",options:["Internal QA","Public beta"],taskId:"T1"});
  return say("Waiting for your release-channel decision while Main continues.");
 }
 if(thread&&input==="R2 visual working") {
  if(!calls.some(c=>c.name==="worker_spawn"))return call("worker_spawn",{id:"qa-runner",task:"R2 visual long worker",taskId:"T2",isolation:"shared"});
  return call("bash",{command:"printf 'Isolated native validation running\\n'; sleep 7200",timeout:7300});
 }
 if(!thread&&!worker&&input==="R2 visual states") {
  // Every thread starts for a board task, which it claims: T1 for the waiting thread, T2 for the working one.
  const adds=calls.filter(c=>c.name==="board"&&c.arguments.action==="add_task").length;
  if(adds===0)return call("board",{action:"add_task",title:"Choose native release channel",description:"An actual background question retains its task and thread context."});
  if(adds===1)return call("board",{action:"add_task",title:"Validate native readiness",description:"Actual isolated long-running tool and worker for Working-state evidence.",writeScopes:["apps/android"]});
  const starts=calls.filter(c=>c.name==="thread_start").length;
  if(starts===0)return call("thread_start",{title:"Release channel review",brief:"R2 visual waiting",onFinish:"record",taskId:"T1"});
  if(starts===1)return call("thread_start",{title:"Native readiness validation",brief:"R2 visual working",onFinish:"record",taskId:"T2"});
  return say("# Native workbench\n\nMain remains available while real background work runs. One thread needs your release-channel decision; another is validating the native evidence.\n\nThis is the actual checkout server with a deterministic **faux model**, not an external provider account.");
 }
 if(!thread&&!worker&&input==="R2 visual thinking")return say([
  {type:"thinking",thinking:"I will inspect the scratch implementation, keep ownership explicit, and verify the rendered result before delivery."},
  {type:"text",text:"## A small, verifiable change\n\nThe native client keeps backend, project, thread and worker identity separate. I will check the scratch implementation next.\n\n```typescript\nconst target = { projectId, threadId, workerId };\n```"}
 ]);
 if(!thread&&!worker&&input==="R2 visual coding") {
  if(!tool)return call("write",{path:"native-proof.ts",content:"export function verificationScope(projectId: string, threadId: string) {\n  return { projectId, threadId };\n}\n"});
  if(tool==="write")return call("read",{path:"native-proof.ts"});
  if(tool==="read")return call("bash",{command:"sed -n '1,8p' native-proof.ts"});
  return say("Changed one scratch file and verified its contents. The write, read and command above were real tool executions.");
 }
 if(!thread&&!worker&&input==="R2 visual artifacts") {
  const saved=calls.filter(c=>c.name==="artifact_save").length;
  const sources=["native-proof.ts",join(root,"project/proof.png"),join(root,"project/proof.mp4"),join(root,"project/proof.bin")];
  if(saved<sources.length)return call("artifact_save",{path:sources[saved],title:["Native implementation proof","Native image evidence","Native video evidence","Native file evidence"][saved],note:"Actual saved bytes; deterministic faux model, no provider account."});
  return say("Four actual artifacts were saved for native appearance verification.");
 }
 return undefined;
}
