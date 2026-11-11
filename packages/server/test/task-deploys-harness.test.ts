import { expect, test } from "bun:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createSetup } from "./support.ts";
import { type TaskDeployFact } from "../src/task-deploys.ts";
import { BoardDoc, type BoardState } from "../src/board.ts";
import { prepareReportNudges } from "../src/task-freshness.ts";

const task = { title: "Synthetic task", description: "", acceptance: null, status: "todo" as const, blockedBy: [], blockedReason: null, writeScopes: [] };
const at = "2026-01-01T12:00:00.000Z";
function attempt(sequence = 1, attemptId = "attempt-one"): TaskDeployFact {
 return { scope: "synthetic-feed", order: sequence, attemptId, sequence, intendedCommit: "b".repeat(40), expectedTargets: ["one","two","three"], observedAt: at, taskIds: Array.from({length:12},(_,i) => `T${i+1}`), targets: Object.fromEntries(["one","two","three"].map(name => [name,{ state: "queued", previousCommit: "a".repeat(40) }])) };
}

test("atomic fan-out includes many tasks, closed and archived; outcomes stale open reports only; one evolving row and replay dedupe", async () => {
 const setup = await createSetup({ now: () => Date.parse(at) });
 try {
  const project = await setup.server.manager.store.add(setup.projectDir);
  const { runtime } = await setup.server.manager.open(project.id);
  for (let n=0;n<12;n++) await runtime.board.saveTask({ task },"harness");
  const commit = <R>(change: Parameters<typeof runtime.harness.commit<R>>[0]) => runtime.harness.commit(change, BACKGROUND_CONTEXT);
  await commit(async tx => {
   const state = await tx.doc(BoardDoc,runtime.conversation.id);
   state.tasks[10]!.status = "done"; state.tasks[10]!.archived = true;
   state.tasks[11]!.status = "dropped";
  });
  await runtime.board.configureDeployFeed(true);
  const start = attempt(); await runtime.board.recordDeployAttempt(start);
  let board = await runtime.board.state();
  expect(board.tasks.every(t => t.activity?.text === "Deploy queued for bbbbbbbbbbbb")).toBe(true);
  expect(board.tasks[0]!.report.freshness!.results.stale).toBe(false);
  const failed = structuredClone(start); failed.sequence = 2;
  failed.targets.one!.state = "ok"; failed.targets.two!.state = "rolled_back"; failed.targets.two!.servingCommit = "a".repeat(40); failed.targets.three!.state = "pending";
  await runtime.board.recordDeployAttempt(failed); board = await runtime.board.state();
  for (const t of board.tasks) {
   expect(t.activity?.text).toBe("Deploy failed on 1 of 3 targets");
   expect(t.report.freshness!.results.stale).toBe(!["done","dropped"].includes(t.status));
   expect(t.report.freshness!.next.stale).toBe(!["done","dropped"].includes(t.status));
   const entries = (await runtime.board.timeline(t.id)).entries.filter(e => e.ref?.startsWith("deploy:"));
   expect(entries).toHaveLength(1); expect(entries[0]!.detail).toContain(`Attempted ${"b".repeat(12)}`); expect(entries[0]!.detail).toContain(`serving ${"a".repeat(12)}`);
  }
  await runtime.board.recordDeployAttempt(failed); expect(await runtime.board.state()).toEqual(board);
  await commit(async tx => { prepareReportNudges(await tx.doc(BoardDoc,runtime.conversation.id) as BoardState,Date.parse(at)+30_000,()=>"main"); });
  board = await runtime.board.state();
  const nudged = board.reportOutbox!.flatMap(b => b.admissions).map(a=>a.taskId);
  expect(nudged.length).toBeGreaterThan(0); expect(nudged).not.toContain("T11"); expect(nudged).not.toContain("T12");
  expect(board.reportTracking!.T11!.pending).toBeUndefined(); expect(board.reportTracking!.T12!.pending).toBeUndefined();
  const partial = structuredClone(failed); partial.sequence = 3; partial.targets.two!.state = "ok";
  await runtime.board.recordDeployAttempt(partial);
  expect((await runtime.board.state()).tasks[0]!.activity?.text).toBe("Live on 2 of 3 targets · 1 pending");
  const live = structuredClone(partial); live.sequence = 4; live.targets.three!.state = "ok";
  await runtime.board.recordDeployAttempt(live);
  board = await runtime.board.state();
  expect(board.tasks[0]!.activity?.text).toBe("Live on all backends");
  await runtime.board.deployFeedAvailability(false);
  expect((await runtime.board.state()).tasks[0]!.activity?.text).toBe("Status unknown");
  await runtime.board.deployFeedAvailability(true);
  await runtime.board.configureDeployFeed(false);
  expect((await runtime.board.state()).tasks[0]!.activity?.text).not.toBe("Live on all backends");
  await runtime.board.configureDeployFeed(true);
  expect((await runtime.board.state()).tasks[0]!.activity?.text).toBe("Live on all backends");
  expect(board.tasks[10]!.status).toBe("done"); expect(board.tasks[10]!.archived).toBe(true); expect(board.tasks[11]!.status).toBe("dropped");
  expect((await runtime.board.timeline("T1")).entries.filter(e=>e.ref?.startsWith("deploy:"))).toHaveLength(1);
  const retry = attempt(5,"attempt-two"); await runtime.board.recordDeployAttempt(retry);
  const late = structuredClone(failed); late.sequence=6;
  await runtime.board.recordDeployAttempt(late);
  expect((await runtime.board.state()).tasks[0]!.activity?.text).toBe("Deploy queued for bbbbbbbbbbbb");
  const newFailure = structuredClone(retry); newFailure.sequence = 7; newFailure.targets.one!.state = "failed";
  await runtime.board.recordDeployAttempt(newFailure);
  const newRetry = attempt(8, "attempt-three"); await runtime.board.recordDeployAttempt(newRetry);
  expect((await runtime.board.state()).tasks[0]!.activity?.text).toBe("Deploy failed on 1 of 3 targets");
  const recovered = structuredClone(newRetry); recovered.sequence = 9;
  for (const target of Object.values(recovered.targets)) target.state = "ok";
  await runtime.board.recordDeployAttempt(recovered);
  expect((await runtime.board.state()).tasks[0]!.activity?.text).toBe("Live on all backends");
 } finally { await setup.cleanup(); }
},30_000);

test("no feed makes no delivery claim; configuration adds not deployed yet only to landings, and disabling hides deploy slots",async()=>{
 const setup = await createSetup({now:()=>Date.parse(at)});
 try {
  const project=await setup.server.manager.store.add(setup.projectDir); const {runtime}=await setup.server.manager.open(project.id);
  await runtime.board.saveTask({task},"harness");
  const landed = { id:"landed-one",projectId:project.id,repository:"synthetic",ref:"refs/heads/main",previous:"a".repeat(40),tip:"b".repeat(40),at,taskIds:["T1"],commits:[{hash:"b".repeat(40),subject:"Synthetic",taskIds:["T1"]}],removed:[],reverted:[] };
  await runtime.board.recordChangesLanded(landed);
  expect((await runtime.board.state()).tasks[0]!.activity?.text).toBe("1 change landed on main");
  await expect(setup.server.manager.configure(project.id,{deployFeed:"command:run"})).rejects.toThrow("absolute local file");
  expect((await setup.server.manager.configure(project.id,{deployFeed:null})).deployFeed).toBe(null);
  await runtime.board.configureDeployFeed(true);
  expect((await runtime.board.state()).tasks[0]!.activity?.text).toEndWith(" · not deployed yet");
  await runtime.board.recordDeployAttempt(attempt());
  await runtime.board.configureDeployFeed(false);
  expect((await runtime.board.state()).tasks[0]!.activity?.kind).not.toBe("deploy");
 }finally{await setup.cleanup();}
},30_000);
