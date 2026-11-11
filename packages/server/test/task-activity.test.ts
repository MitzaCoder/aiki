import { afterEach, expect, it, spyOn } from "bun:test";
import type { BoardActivityActor, BoardTask } from "@aiki/protocol";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { HARNESS_FEATURES, LEGACY_HARNESS_FEATURES } from "../../protocol/src/projects.ts";
import { activityTracking, endActivitySource, setActivityPhase, taskActivity, type TaskActivitySource } from "../src/task-activity.ts";
import { BoardDoc, addSnapshot, askQuestion, boardView, changeOwner, coordinatorWriter, emptyBoardState, normalizeBoard, recordFeedback, saveTask, setFeedbackState, settleQuestion, workerWriter, writeReport, type BoardState } from "../src/board.ts";
import { syncWorkerActivity, syncWorkerActivityRun, WorkersDoc, workerInstructions, coordinatorSection, threadCoordinatorSection, type WorkerRecord } from "../src/workers.ts";
import { threadInstructions } from "../src/threads.ts";
import { createSetup, errorOf, TestClient } from "./support.ts";

const START = Date.parse("2026-11-12T12:00:00.000Z");
const at = (ms = 0) => new Date(START + ms).toISOString();
function fixture(status: BoardTask["status"] = "in_progress") {
 const state = emptyBoardState(); state.taskActivityEnabled = true;
 saveTask(state, { task: { title: "Card view", description: "", acceptance: null, status, blockedBy: [], blockedReason: null, writeScopes: [], ...(status === "waiting" ? { waitingFor: "external review" } : {}) }, author: "coordinator", now: at() });
 return state;
}
function source(name = "fern", since = at(1), threadId = "main", conversationId = 2): TaskActivitySource {
 const actor: BoardActivityActor = { id: `${threadId}:${conversationId}:run-1`, kind: "worker", name, threadId, conversationId, runId: "run-1" };
 return { actor, state: "running", title: "Card view", since };
}
function add(state: BoardState, source: TaskActivitySource, taskId = "T1") { activityTracking(state, taskId).sources[source.actor.id] = source; return source; }
function activity(state: BoardState, ms = 10) { return taskActivity(state.tasks[0]!, state.questions, state.tasks, state.taskActivity?.T1, START + ms); }

it("advertises activity explicitly, never on legacy backends", () => {
 expect(HARNESS_FEATURES).toContain("task-activity"); expect(LEGACY_HARNESS_FEATURES).not.toContain("task-activity");
});

it.each([
 ["failure", "failure"], ["question", "question"], ["deploy", "deploy"], ["working", "working"], ["feedback", "feedback"], ["blocked", "blocked"], ["delivery", "delivery"], ["idle", "idle"],
] as const)("precedence: %s is the first matching rule", (highest, expected) => {
 const state = fixture(); const tracking = activityTracking(state, "T1");
 if (["failure"].includes(highest)) add(state, { ...source("moss", at(1), "other", 3), state: "failed", failure: "verification failed" });
 if (["failure", "question"].includes(highest)) askQuestion(state, { text: "Choose?", options: [], taskId: "T1", now: at(1) });
 if (["failure", "question", "deploy"].includes(highest)) tracking.deploy = { state: "active", text: "Deploy queued", since: at(2), refs: ["attempt-1"] };
 if (["failure", "question", "deploy", "working"].includes(highest)) add(state, source());
 if (["failure", "question", "deploy", "working", "feedback"].includes(highest)) tracking.feedback = [{ id: "F8", at: at(3) }];
 if (["failure", "question", "deploy", "working", "feedback", "blocked"].includes(highest)) state.tasks[0]!.blockedBy = ["T42"];
 if (highest !== "idle") tracking.delivery = { text: "3 changes landed on main", at: at(), count: 3, refs: ["commit-1"] };
 expect(activity(state).kind).toBe(expected);
});

it("two workers: latest real phase wins, stable IDs break ties, failure dominates, stop clears only itself", () => {
 const state = fixture(); const fern = add(state, source()); const moss = add(state, source("moss", at(1), "other", 3));
 expect(activity(state).text).toBe("fern is working on Card view · +1 worker");
 const tracking = activityTracking(state, "T1");
 setActivityPhase(tracking, moss.actor.id, "testing the card view", at(2));
 expect(activity(state)).toMatchObject({ text: "moss is testing the card view · +1 worker", since: at(2), actor: moss.actor });
 setActivityPhase(tracking, moss.actor.id, "testing the card view", at(8));
 expect(activity(state).since).toBe(at(2));
 fern.state = "failed"; fern.failure = "check failed"; fern.since = at(3);
 expect(activity(state)).toMatchObject({ kind: "failure", text: "fern failed: check failed" });
 endActivitySource(tracking, moss.actor.id, at(4));
 expect(activity(state).kind).toBe("failure");
 fern.state = "ended";
 expect(activity(state)).toMatchObject({ kind: "idle", since: at(4) });
});

it("blocking questions count only live workers; answering and withdrawing clear the wait immediately", () => {
 const state = fixture(); add(state, source()); add(state, source("moss", at(1), "other", 3));
 askQuestion(state, { text: "Nonblocking", options: [], taskId: "T1", now: at(1), blocksWork: false });
 askQuestion(state, { text: "Warning", options: [], taskId: "T1", now: at(1), kind: "warning" });
 const q = askQuestion(state, { text: "Choose", options: [], taskId: "T1", now: at(2) });
 const q2 = askQuestion(state, { text: "Choose again", options: [], taskId: "T1", now: at(3) });
 expect(activity(state).text).toBe("Waiting for your answer to Q3 and 1 more · 2 workers still running");
 settleQuestion(state, { questionId: q.id, answer: "Yes", now: at(4) });
 expect(activity(state).text).toBe("Waiting for your answer to Q4 · 2 workers still running");
 settleQuestion(state, { questionId: q2.id, answer: null, now: at(5) });
 expect(activity(state).kind).toBe("working");
});

it("only a linked warning acknowledgement clears a failure", () => {
 const state = fixture(); const worker = add(state, { ...source(), state: "failed" });
 const unrelated = askQuestion(state, { text: "Unrelated", options: [], taskId: "T1", kind: "warning", now: at(1) });
 settleQuestion(state, { questionId: unrelated.id, answer: "Seen", now: at(2) }); expect(activity(state).kind).toBe("failure");
 const linked = askQuestion(state, { text: "Failure", options: [], taskId: "T1", kind: "warning", activitySourceId: worker.actor.id, now: at(3) });
 settleQuestion(state, { questionId: linked.id, answer: "Seen", now: at(4) }); expect(activity(state).kind).toBe("idle");
});

it.each(["done", "dropped"] as const)("%s ignores lingering work, keeps failures and recent deliveries", status => {
 const state = fixture(status); add(state, source());
 expect(activity(state)).toMatchObject({ kind: status, since: at() });
 activityTracking(state, "T1").delivery = { text: "3 changes landed on main", at: at(2), refs: ["commit-1"], count: 3 };
 expect(activity(state).kind).toBe("delivery");
 add(state, { ...source("moss", at(4), "other", 3), state: "failed" }); expect(activity(state).kind).toBe("failure");
});

it.each(["todo", "waiting", "review", "blocked", "in_progress"] as const)("%s fallback has a stable since, not an age", status => {
 const state = fixture(status); const before = JSON.stringify(state);
 expect(activity(state).kind).toBe(({ todo: "not_started", waiting: "waiting", review: "review", blocked: "blocked", in_progress: "idle" } as const)[status]);
 expect(activity(state, 60_000)).toEqual(activity(state)); expect(JSON.stringify(state)).toBe(before);
});

it("24-hour delivery expires without a write and never implies deployment", () => {
 const state = fixture(); activityTracking(state, "T1").delivery = { text: "3 changes landed on main", at: at(), count: 3, refs: ["commit-1"] };
 const before = JSON.stringify(state);
 expect(activity(state, 86_399_999)).toMatchObject({ kind: "delivery", text: "3 changes landed on main", since: at() });
 expect(activity(state, 86_400_000).kind).toBe("idle"); expect(JSON.stringify(state)).toBe(before);
});

it("legacy Now is history only; canonical mirror never refreshes prose metadata, and phase changes add no history", () => {
 const state = fixture(); const task = state.tasks[0]!;
 task.report.now = "Old stale prose";
 const history = { snapshots: [], keys: [] };
 addSnapshot(history, task, { label: "Old snapshot", by: coordinatorWriter("main"), at: at() });
 normalizeBoard(state); expect(boardView(state, START, true).tasks[0]!.report.now).toBe("Idle");
 expect(history.snapshots[0]).toMatchObject({ report: { now: "Old stale prose" } });
 writeReport(state, { taskId: "T1", sections: { results: "Tests pass", next: "Review" }, by: coordinatorWriter("main"), now: at(1) });
 const report = structuredClone(task.report); const timeline = task.timelineRevision; const seq = task.eventSeq;
 const worker = add(state, source());
 writeReport(state, { taskId: "T1", sections: { now: "testing" }, by: workerWriter("main", "fern"), now: at(2) });
 const mirrored = boardView(state, START + 3, true).tasks[0]!;
 expect(mirrored.report.now).toBe("fern is testing"); expect(mirrored.report.now).toBe(mirrored.activity!.text);
 for (const field of ["updatedAt", "updatedBy", "revision", "freshness", "results", "next"] as const) expect(task.report[field]).toEqual(report[field]);
 expect(task.timelineRevision).toBe(timeline); expect(task.eventSeq).toBe(seq); expect(history.snapshots).toHaveLength(1);
 endActivitySource(activityTracking(state, "T1"), worker.actor.id, at(4));
 expect(activity(state).text).toBe("Idle");
});

it("unhandled feedback clears as soon as the coordinator handles it", () => {
 const state = fixture(); const history = { snapshots: [], keys: [] };
 const f = recordFeedback(state, history, { taskId: "T1", text: "Please check", images: 0, threadId: "main", key: "feedback-1", now: at(1) });
 expect(activity(state).text).toBe("Feedback F1 is waiting for the coordinator");
 setFeedbackState(state, history, { taskId: "T1", feedbackId: f.id, state: "handling", note: null, by: coordinatorWriter("main"), now: at(2) });
 expect(activity(state).kind).toBe("idle");
});

it("ownership alone is not activity, and release leaves another source working", () => {
 const state = fixture(); const task = state.tasks[0]!;
 changeOwner(state, { taskId: task.id, expectedRevision: task.revision, change: { kind: "claim", threadId: "thread-a" }, now: at(1) });
 expect(activity(state).kind).toBe("idle");
 const coordinator = add(state, { ...source("thread-a", at(2), "thread-a", 3), actor: { ...source("thread-a", at(2), "thread-a", 3).actor, kind: "thread" } });
 add(state, source());
 changeOwner(state, { taskId: task.id, expectedRevision: task.revision, change: { kind: "release", threadId: "thread-a" }, now: at(3) });
 expect(coordinator.state).toBe("ended"); expect(activity(state).text).toBe("fern is working on Card view");
});

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
async function integration() {
 const setup = await createSetup({ now: () => START, boardEditDebounceMs: 60_000 }); cleanups.push(setup.cleanup);
 const client = await TestClient.open(setup.server); cleanups.push(async () => client.close()); await client.hello();
 const added = await client.request({ type: "projects.add", path: setup.projectDir }); if (added.type !== "projects.add") throw errorOf(added);
 const configured = await client.request({ type: "projects.configure", projectId: added.project.id, coordinatorModel: { provider: "faux", modelId: "faux-1" } }); if (configured.type !== "projects.configure") throw errorOf(configured);
 const { runtime } = await setup.server.manager.open(added.project.id);
 await runtime.harness.commit(async tx => { const state = await tx.doc(BoardDoc, runtime.conversation.id); const seed = fixture(); Object.assign(state, seed); }, BACKGROUND_CONTEXT);
 return { setup, runtime, projectId: added.project.id };
}

it("reconciles ended and unreachable sources after restart, without inferring legacy phases", async () => {
 const { setup, runtime, projectId } = await integration();
 await runtime.harness.commit(async tx => {
  const state = await tx.doc(BoardDoc, runtime.conversation.id) as BoardState;
  add(state, source("fern", at(), "main", runtime.conversation.id));
  add(state, source("moss", at(), "other", 999999));
  state.tasks[0]!.report.now = "Old working claim";
 }, BACKGROUND_CONTEXT);
 await setup.restart(); const reopened = (await setup.server.manager.open(projectId)).runtime;
 expect((await reopened.board.get()).tasks[0]!.activity).toMatchObject({ kind: "unknown", text: "Status unknown" });
 const tracking = (await reopened.board.state()).taskActivity!.T1!;
 expect(Object.values(tracking.sources).find(s => s.actor.name === "fern")!.state).toBe("ended");
 expect(Object.values(tracking.sources).every(s => s.phase === undefined)).toBe(true);
}, 15_000);

it("worker retries use thread/conversation/run identity; phases expire and another worker's failure stays", async () => {
 const { runtime } = await integration();
 const record = (id: string, conversationId: number): WorkerRecord => ({ id, title: "Card view", conversationId, isolation: "shared", workspacePath: null, model: { provider: "faux", modelId: "faux-1" }, thinkingLevel: null, status: "running", taskId: "T1", spawnedByCallId: null, createdAt: at(), updatedAt: at(), lastReport: null, failure: null, anchorTaskId: 1 });
 const fern = record("fern", 10), moss = record("moss", 11);
 const sync = async (worker: WorkerRecord) => runtime.harness.commit(tx => syncWorkerActivity(tx, runtime.workers, worker, runtime.conversation.id), BACKGROUND_CONTEXT);
 await sync(fern); await sync(moss);
 moss.status = "failed"; moss.failure = "checks failed"; moss.updatedAt = at(1); await sync(moss);
 fern.status = "stopped"; fern.updatedAt = at(2); await sync(fern);
 expect((await runtime.board.get()).tasks[0]!.activity!.text).toBe("moss failed: checks failed");
 fern.status = "running"; fern.updatedAt = at(3); await sync(fern);
 const tracking = (await runtime.board.state()).taskActivity!.T1!;
 expect(Object.values(tracking.sources).filter(s => s.actor.name === "fern").map(s => s.actor.runId)).toEqual([at(), at(3)]);
 expect((await runtime.board.get()).tasks[0]!.activity!.kind).toBe("failure");
 moss.status = "running"; moss.updatedAt = at(4); await sync(moss);
 expect((await runtime.board.get()).tasks[0]!.activity!.text).toBe("moss is working on Card view · +1 worker");
 fern.status = "failed"; fern.failure = "old run failed"; fern.updatedAt = at(5); await sync(fern);
 await sync({ ...fern, conversationId: 20, status: "running", activityRunId: undefined, updatedAt: at(6) });
 expect((await runtime.board.get()).tasks[0]!.activity).toMatchObject({ kind: "failure", actor: { conversationId: 10 } });
}, 15_000);

it("a coordinator focuses one owned task, legacy Now becomes a turn phase, then expires with no timeline rows", async () => {
 const { setup, runtime } = await integration();
 await runtime.board.saveTask({ task: { ...fixture().tasks[0]!, title: "Other task" } }, "coordinator");
 const samples: BoardTask[][] = [];
 const call = (action: string, fields: Record<string, unknown> = {}) => fauxAssistantMessage([fauxToolCall("board", { action, ...fields })], { stopReason: "toolUse" });
 setup.faux.setResponses([
  call("claim", { id: "T1", expectedRevision: 1 }), call("claim", { id: "T2", expectedRevision: 1 }),
  async () => { samples.push((await runtime.board.get()).tasks); return call("write_report", { id: "T1", results: "Synthetic checks pass" }); },
  async () => { samples.push((await runtime.board.get()).tasks); return call("write_report", { id: "T1", now: "testing the card view" }); },
  async () => { samples.push((await runtime.board.get()).tasks); return fauxAssistantMessage("Finished."); },
 ]);
 const before = await runtime.board.timeline("T1");
 const submission = await runtime.conversation.submit({ type: "input", content: "Test focused work", requestId: "focus-test" }, BACKGROUND_CONTEXT);
 await submission.wait(BACKGROUND_CONTEXT); await runtime.conversation.waitForIdle(BACKGROUND_CONTEXT); await runtime.board.reconcileActivity();
 expect(samples[0]![0]!.activity!.kind).toBe("idle"); expect(samples[0]![1]!.activity!.kind).toBe("idle");
 expect(samples[1]![0]!.activity!.kind).toBe("working"); expect(samples[1]![1]!.activity!.kind).toBe("idle");
 expect(samples[2]![0]!.activity!.text).toBe("Coordinator is testing the card view");
 expect(samples[2]![0]!.report.updatedAt).toBe(samples[1]![0]!.report.updatedAt);
 expect((await runtime.board.get()).tasks[0]!.activity!.kind).toBe("idle");
 expect(await runtime.board.timeline("T1")).toEqual(before);
 expect((await runtime.board.state()).tasks[0]!.report.results).toBe("Synthetic checks pass");
}, 15_000);


it("all project prompts ask for Results/Next, automatic Now, and changed phases only", async () => {
 const { runtime } = await integration(); const project = { ...runtime.project, name: "Synthetic project", path: "." };
 const main = coordinatorSection(project), thread = threadCoordinatorSection(project);
 for (const prompt of [main, thread]) {
  expect(prompt).toContain("Now is written automatically.");
  expect(prompt).not.toContain("board action `focus`");
  expect(prompt).toContain("Keep `results`"); expect(prompt).toContain("`next`");
  expect(prompt).not.toContain("keeps the task's `now` current");
 }
 const worker = workerInstructions({ id: "fern", title: "Card view", project, cwd: ".", isolation: "shared", taskId: "T1" });
 expect(worker).toContain("Use optional `now` only for a few-word phase when the phase really changes");
 expect(worker).not.toContain("is what you are doing at this moment");
 const instructions = threadInstructions({ id: "thread-a", title: "Card view", project, checkout: ".", checkoutKind: "directory", startedBy: "main", taskId: "T1" });
 expect(instructions).toContain("keep Results and Next current"); expect(instructions).toContain("Now is automatic");
}, 15_000);


it("moves, questions and decisions infer cumulative focus without claims or extra tool calls", async () => {
 const { setup, runtime } = await integration();
 for (const title of ["Review assets", "Choose policy"]) await runtime.board.saveTask({ task: { ...fixture().tasks[0]!, title } }, "coordinator");
 const samples: BoardState[] = [];
 const call = (action: string, fields: Record<string, unknown>) => fauxAssistantMessage([fauxToolCall("board", { action, ...fields })], { stopReason: "toolUse" });
 setup.faux.setResponses([
  call("update_task", { id: "T1", expectedRevision: 1, status: "review" }),
  async () => { samples.push(await runtime.board.state()); return call("ask", { taskId: "T2", text: "Choose?", blocksWork: false }); },
  async () => { samples.push(await runtime.board.state()); return call("decide", { taskId: "T3", text: "Use synthetic evidence" }); },
  async () => { samples.push(await runtime.board.state()); return fauxAssistantMessage("Recorded."); },
 ]);
 const submission = await runtime.conversation.submit({ type: "input", content: "Act on the tasks", requestId: "inferred-actions" }, BACKGROUND_CONTEXT);
 await submission.wait(BACKGROUND_CONTEXT); await runtime.conversation.waitForIdle(BACKGROUND_CONTEXT);
 for (const [index, state] of samples.entries()) for (let task = 1; task <= 3; task++) {
  const live = Object.values(state.taskActivity?.[`T${task}`]?.sources ?? {}).some(source => source.actor.kind === "coordinator" && source.state === "running");
  expect(live).toBe(task <= index + 1);
 }
 const state = await runtime.board.state();
 expect(Object.values(state.taskActivity!).flatMap(t => Object.values(t.sources)).every(source => source.state !== "running")).toBe(true);
}, 15_000);

it("a task-scoped feedback submission infers focus before any task-writing action", async () => {
 const { setup, runtime } = await integration();
 let resolveFocus!: () => void;
 const focused = new Promise<void>(resolve => { resolveFocus = resolve; });
 const watch = await runtime.harness.watchDoc(BoardDoc, runtime.conversation.id, BACKGROUND_CONTEXT);
 if (!watch) throw new Error("Missing board");
 watch.start(async call => { if (call.kind !== "failed" && Object.values(call.value?.taskActivity?.T1?.sources ?? {}).some(source => source.actor.kind === "coordinator" && source.state === "running")) resolveFocus(); });
 setup.faux.setResponses([async () => { await focused; expect((await runtime.board.get()).tasks[0]!.activity!.kind).toBe("working"); return fauxAssistantMessage("Read."); }]);
 try {
  const submission = await runtime.conversation.submit({ type: "input", content: "[task T1, feedback F8] Please check this", requestId: "scoped-focus" }, BACKGROUND_CONTEXT);
  await submission.wait(BACKGROUND_CONTEXT); await runtime.conversation.waitForIdle(BACKGROUND_CONTEXT);
  expect((await runtime.board.get()).tasks[0]!.activity!.kind).toBe("idle");
 } finally { await watch.stop(); }
}, 15_000);

it("a thread's own task and touched tasks work this turn, not every task it holds", async () => {
 const { setup, runtime } = await integration();
 for (const title of ["Touched task", "Only held task"]) await runtime.board.saveTask({ task: { ...fixture().tasks[0]!, title } }, "coordinator");
 const samples: BoardTask[][] = [];
 let resolveSample!: () => void;
 const sampled = new Promise<void>(resolve => { resolveSample = resolve; });
 const call = (action: string, fields: Record<string, unknown>) => fauxAssistantMessage([fauxToolCall("board", { action, ...fields })], { stopReason: "toolUse" });
 setup.faux.setResponses([
  call("claim", { id: "T2", expectedRevision: 1 }), call("claim", { id: "T3", expectedRevision: 1 }),
  async () => { samples.push((await runtime.board.get()).tasks); return call("write_report", { id: "T2", results: "Synthetic evidence checked" }); },
  async () => { samples.push((await runtime.board.get()).tasks); return call("ask", { taskId: "T2", text: "Optional review?", blocksWork: false }); },
  call("decide", { taskId: "T2", text: "Keep synthetic evidence" }),
  async () => { resolveSample(); return fauxAssistantMessage("Finished this turn."); },
 ]);
 const started = await runtime.threads.start({ id: "thread-a", title: "Card view", brief: "Check the tasks", model: null, thinkingLevel: null, onFinish: "record", startedBy: "main", scheduleId: null, taskId: "T1", key: "inferred-thread" });
 if (!started.ok) throw new Error(started.message);
 await sampled;
 const conversation = await runtime.harness.conversation(started.record.conversationId as typeof runtime.conversation.id, BACKGROUND_CONTEXT);
 await conversation!.waitForIdle(BACKGROUND_CONTEXT);
 expect(samples[0]!.map(task => task.activity!.kind)).toEqual(["working", "idle", "idle"]);
 expect(samples[1]!.map(task => task.activity!.kind)).toEqual(["working", "working", "idle"]);
 expect((await runtime.board.get()).tasks.map(task => task.activity!.kind)).toEqual(["idle", "idle", "idle"]);
}, 15_000);

it("worker requests in the same run take the read-only fast path", async () => {
 const { runtime } = await integration();
 await runtime.harness.commit(async tx => {
  const doc = await tx.doc(WorkersDoc, runtime.conversation.id);
  doc.workers.fern = { id: "fern", title: "Card view", conversationId: 10, activityRunId: "run-1", isolation: "shared", workspacePath: null, model: { provider: "faux", modelId: "faux-1" }, thinkingLevel: null, status: "running", taskId: "T1", spawnedByCallId: null, createdAt: at(), updatedAt: at(), lastReport: null, failure: null, anchorTaskId: 1 };
  await syncWorkerActivity(tx, runtime.workers, doc.workers.fern, runtime.conversation.id);
 }, BACKGROUND_CONTEXT);
 const before = await runtime.board.state();
 const commit = spyOn(runtime.harness, "commit");
 try {
  await syncWorkerActivityRun(runtime.workers, 10, "run-1");
  await syncWorkerActivityRun(runtime.workers, 10, "run-1");
  expect(commit).not.toHaveBeenCalled();
  expect(await runtime.board.state()).toEqual(before);
  await syncWorkerActivityRun(runtime.workers, 10, "run-2");
  expect(commit).toHaveBeenCalledTimes(1);
  await syncWorkerActivityRun(runtime.workers, 10, "run-2");
  expect(commit).toHaveBeenCalledTimes(1);
 } finally { commit.mockRestore(); }
}, 15_000);


it("spawning and sending task workers infer coordinator focus in the existing action transaction", async () => {
 const { setup, runtime } = await integration();
 let releaseWorker!: () => void;
 const workerReady = new Promise<void>(resolve => { releaseWorker = resolve; });
 let finishSample!: () => void;
 const sampled = new Promise<void>(resolve => { finishSample = resolve; });
 const coordinatorSources: boolean[] = [];
 const isFocused = async () => Object.values((await runtime.board.state()).taskActivity?.T1?.sources ?? {}).some(source => source.actor.kind === "coordinator" && source.state === "running");
 setup.faux.setResponses(Array.from({ length: 15 }, () => async request => {
  if (JSON.stringify(request.messages.find(message => message.role === "system")).includes('You are the worker')) {
   await workerReady; return fauxAssistantMessage("Worker checked the evidence.");
  }
  const last = request.messages.findLast(message => message.role !== "system");
  if (last?.role === "toolResult" && last.toolName === "worker_spawn") {
   coordinatorSources.push(await isFocused());
   const state = await runtime.board.state();
   const runId = Object.values(state.taskActivity!.T1!.sources).find(source => source.actor.kind === "coordinator" && source.state === "running")!.actor.runId;
   await runtime.board.endTaskFocus(runtime.conversation.id, runId);
   return fauxAssistantMessage([fauxToolCall("worker_send", { id: "fern", message: "Check one more synthetic detail", interrupt: true })], { stopReason: "toolUse" });
  }
  if (last?.role === "toolResult" && last.toolName === "worker_send") {
   coordinatorSources.push(await isFocused()); finishSample(); releaseWorker(); return fauxAssistantMessage("Delegated.");
  }
  if (last?.role === "user" && typeof last.content === "string" && last.content === "Start the task worker") return fauxAssistantMessage([fauxToolCall("worker_spawn", { id: "fern", taskId: "T1", title: "Check card view", task: "Check synthetic evidence", model: { provider: "faux", modelId: "faux-1" } })], { stopReason: "toolUse" });
  return fauxAssistantMessage("Recorded.");
 }));
 try {
  const submission = await runtime.conversation.submit({ type: "input", content: "Start the task worker", requestId: "infer-worker-actions" }, BACKGROUND_CONTEXT);
  await sampled; await submission.wait(BACKGROUND_CONTEXT); await runtime.conversation.waitForIdle(BACKGROUND_CONTEXT);
  expect(coordinatorSources).toEqual([true, true]);
 } finally { releaseWorker(); }
}, 15_000);
