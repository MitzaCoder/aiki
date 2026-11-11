import "./clean-env.ts";
import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { appendDeployJournal, JOURNAL_KEEP_ATTEMPTS, JOURNAL_KEEP_BYTES } from "../deploy-journal.ts";
import { parseDeployFeed } from "../../packages/server/src/task-deploys.ts";

function git(path: string, ...args: string[]): string {
 const result = Bun.spawnSync(["git", "-C",path,...args], { timeout: 5000, env: { ...process.env, GIT_CONFIG_GLOBAL:"/dev/null",GIT_CONFIG_NOSYSTEM:"1" } });
 if (result.exitCode) throw new Error(result.stderr.toString()); return result.stdout.toString().trim();
}
test("origin journal is atomic, ordered and deduplicated; preserves rollback, pending, catch-up and unchanged details",()=>{
 const path=mkdtempSync(join(tmpdir(),"deploy-journal-"));
 try {
  git(path,"init","-b","main");
  const file=join(path,"deploy-journal.json"), previous="a".repeat(40), intended="b".repeat(40);
  const put=(sequence:number,target="",state="queued",resume=false,status="", id="one")=>appendDeployJournal(file,path,{id,sequence,intendedCommit:intended,names:["web","host","portable"],resume,target,state,status,previous,hostBaseline:JSON.stringify({commit:"c".repeat(40)})+"\n---\n"+JSON.stringify({state:"ok",commit:previous,backendUnchanged:true}),observedAt:"2026-01-01T12:00:00Z"});
  put(1); put(4,"portable","pending"); put(2,"web","ok");
  const status=JSON.stringify({commit:previous})+"\n---\n"+JSON.stringify({commit:intended,state:"rolled_back",message:"health failed"});
  put(3,"host","failed",false,status); put(3,"host","failed",false,status);
  let feed=parseDeployFeed(readFileSync(file,"utf8"));
  expect(feed.events.map(e=>e.sequence)).toEqual([1,2,3,4]);
  expect(feed.events[0]!.targets.host!.previousCommit).toBe(previous);
  expect(feed.events.at(-1)!.targets.host).toMatchObject({state:"rolled_back",servingCommit:previous,message:"health failed"});
  expect(feed.events.at(-1)!.targets.portable!.state).toBe("pending");
  const unchanged=JSON.stringify({commit:previous})+"\n---\n"+JSON.stringify({commit:intended,state:"ok",backendUnchanged:true});
  put(5,"host","ok",true,unchanged,"catch-up"); put(6,"portable","ok",true,"","catch-up");
  feed=parseDeployFeed(readFileSync(file,"utf8"));
  expect(feed.events.at(-1)!.attemptId).toBe("one");
  expect(feed.events.at(-1)!.targets.host).toMatchObject({state:"ok",servingCommit:previous,backendUnchanged:true});
  expect(Object.values(feed.events.at(-1)!.targets).every(t=>t.state==="ok")).toBe(true);
  expect(readFileSync(file,"utf8")).not.toContain(".tmp");
 }finally{rmSync(path,{recursive:true,force:true});}
});

test("journal evicts oldest attempts automatically and preserves frozen baselines and sequence allocation",()=>{
 const path=mkdtempSync(join(tmpdir(),"deploy-journal-retention-"));
 try {
  git(path,"init","-b","main"); const file=join(path,"journal.json");
  const hash=(n:number)=>n.toString(16).padStart(40,"0");
  const put=(n:number)=>appendDeployJournal(file,path,{id:`attempt-${n}`,sequence:n*1000+1,intendedCommit:hash(n),names:["host"],resume:false,target:"host",state:"ok",previous:hash(0),observedAt:"2026-01-01T12:00:00Z"});
  for(let n=1;n<=250;n++) put(n);
  const text=readFileSync(file,"utf8"), feed=parseDeployFeed(text), journal=JSON.parse(text);
  expect(new Set(feed.events.map(e=>e.attemptId)).size).toBe(JOURNAL_KEEP_ATTEMPTS);
  expect(feed.events[0]!.attemptId).toBe("attempt-51");
  expect(feed.events[0]!.targets.host!.previousCommit).toBe(hash(50));
  expect(feed.events.at(-1)!.sequence).toBe(250001);
  expect(Buffer.byteLength(text)).toBeLessThanOrEqual(JOURNAL_KEEP_BYTES);
  expect(journal.updates).toHaveLength(200); expect(Object.keys(journal.bases)).toHaveLength(200); expect(Object.keys(journal.seeds)).toHaveLength(200);
  // Survives a process restart and a clock regression without reusing evicted reservations.
  appendDeployJournal(file,path,{id:"after-clock-regression",sequence:1,intendedCommit:hash(251),names:["host"],resume:false,target:"host",state:"ok",observedAt:"2026-01-01T12:01:00Z"});
  const next=parseDeployFeed(readFileSync(file,"utf8"));
  expect(next.events.at(-1)!.sequence).toBe(251001);
  expect(next.events.at(-1)!.targets.host!.previousCommit).toBe(hash(250));
  expect(next.events[0]!.attemptId).toBe("attempt-52");
 }finally{rmSync(path,{recursive:true,force:true});}
},30_000);

test("journal byte retention trims below 1 MiB, including a single noisy attempt",()=>{
 const path=mkdtempSync(join(tmpdir(),"deploy-journal-bytes-"));
 try {
  git(path,"init","-b","main"); const file=join(path,"journal.json"), commit="b".repeat(40);
  const status=JSON.stringify({commit})+"\n---\n"+JSON.stringify({commit,state:"failed",message:"synthetic detail ".repeat(125)});
  const put=(id:string,sequence:number)=>appendDeployJournal(file,path,{id,sequence,intendedCommit:commit,names:["host"],resume:false,target:"host",state:"failed",previous:"a".repeat(40),status,observedAt:"2026-01-01T12:00:00Z"});
  for(let n=1;n<=25;n++) for(let event=1;event<=10;event++) put(`attempt-${n}`,n*1000+event);
  let text=readFileSync(file,"utf8"), feed=parseDeployFeed(text);
  expect(Buffer.byteLength(text)).toBeLessThanOrEqual(JOURNAL_KEEP_BYTES);
  expect(new Set(feed.events.map(e=>e.attemptId)).size).toBeLessThan(25);
  expect(feed.events.at(-1)!.attemptId).toBe("attempt-25");
  // This attempt alone exceeds the history budget: keep its latest snapshot, not an ever-full file.
  for(let event=1;event<=350;event++) put("noisy-attempt",26000+event);
  text=readFileSync(file,"utf8"); feed=parseDeployFeed(text);
  expect(Buffer.byteLength(text)).toBeLessThanOrEqual(JOURNAL_KEEP_BYTES);
  expect(feed.events.at(-1)!.sequence).toBe(26350);
  expect(feed.events.at(-1)!.targets.host!.message).toHaveLength(2000);
  expect(feed.events.length).toBeLessThan(350);
  put("noisy-attempt",26351);
  expect(parseDeployFeed(readFileSync(file,"utf8")).events.at(-1)!.sequence).toBe(26351);
 }finally{rmSync(path,{recursive:true,force:true});}
},30_000);

test("journal CLI cannot fail the caller even with unwritable output",async()=>{
 const child=Bun.spawn([process.execPath,"run",join(import.meta.dir,"../deploy-journal.ts"),"/dev/null/no-file","/dev/null","synthetic","1","a".repeat(40),"host","0"],{timeout:5000,stdout:"pipe",stderr:"pipe"});
 expect(await child.exited).toBe(0);
});
