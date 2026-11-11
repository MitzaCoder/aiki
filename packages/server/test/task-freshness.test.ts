import { afterEach, expect, it } from "bun:test";
import { Value } from "typebox/value";
import { BoardReportStaleRequestSchema, BoardTaskSchema } from "../../protocol/src/board.ts";
import { HARNESS_FEATURES, LEGACY_HARNESS_FEATURES } from "../../protocol/src/projects.ts";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { BoardDoc, BoardService, addDecision, moveTaskForWorker, changeOwner, askQuestion, coordinatorWriter, emptyBoardState, normalizeBoard, saveTask, settleQuestion, writeReport, type BoardState } from "../src/board.ts";
import { acknowledgeReportNudge, markReportStale, noteTaskFact, prepareReportNudges, reportDueAt, substantiveTaskMentions, sweepReportAge, type TaskFact } from "../src/task-freshness.ts";
import { createSetup, errorOf, TestClient } from "./support.ts";

const START = Date.parse("2026-11-12T12:00:00.000Z");
const at = (ms = 0) => new Date(START + ms).toISOString();
const by = coordinatorWriter("main");
function task(state = emptyBoardState(), status: "todo" | "in_progress" | "review" = "in_progress") {
	saveTask(state, { task: { title: "Synthetic delivery", description: "", acceptance: null, status, blockedBy: [], blockedReason: null, writeScopes: [] }, author: "coordinator", now: at() });
	return state;
}
function write(state: BoardState, sections: { results?: string; next?: string }, coverage = state.tasks[0]!.eventSeq, taskId = "T1") {
	return writeReport(state, { taskId, sections, coveredEventSeq: coverage, by, now: at() });
}
function fact(state: BoardState, kind: TaskFact["kind"], ms = 0, taskId = "T1") {
	noteTaskFact(state, taskId, { actor: "harness", kind, at: at(ms), reason: kind === "commit" ? "change landed" : "work advanced" });
}
const owner = () => "main";
const meta = (state: BoardState) => state.tasks[0]!.report.freshness!;
const tracking = (state: BoardState) => state.reportTracking!.T1!;

function move(state: BoardState, status: BoardState["tasks"][number]["status"], author: "user" | "coordinator" | "harness" = "user") {
	const row = state.tasks[0]!;
	return saveTask(state, { taskId: row.id, expectedRevision: row.revision, task: { ...row, status }, author, now: at() });
}

it.each(["done", "dropped"] as const)("owner closes as %s: clear stale/pending/frozen nudges, count facts, and reopen quietly", (status) => {
	const state = task(); write(state, { results: "Historical tests", next: "Review" });
	fact(state, "worker_report");
	expect(tracking(state).pending).toBeDefined();
	prepareReportNudges(state, START + 30_000, owner);
	expect(state.reportOutbox).toHaveLength(1);
	move(state, status);
	for (const name of ["results", "next"] as const) expect(meta(state)[name]).toMatchObject({ stale: false, reasons: [], eventsSince: 2 });
	expect(tracking(state).pending).toBeUndefined();
	expect(state.reportOutbox).toEqual([]);
	noteTaskFact(state, "T1", { actor: "worker", kind: "worker_report", reason: "late report", at: at() });
	markReportStale(state, "T1", ["results"], "late audit", at(), "harness");
	prepareReportNudges(state, START + 60_000, owner);
	expect(state.reportOutbox).toEqual([]);
	expect(state.tasks[0]!.eventSeq).toBe(4);
	expect(meta(state).results).toMatchObject({ stale: false, eventsSince: 4 });
	move(state, "in_progress");
	sweepReportAge(state, START); sweepReportAge(state, START + 4 * 3_600_000);
	prepareReportNudges(state, START + 4 * 3_600_000 + 30_000, owner);
	expect(meta(state).next.stale).toBe(false);
	expect(state.reportOutbox).toEqual([]);
});

it("closing a task before admission drops its pending nudge and closing one batched task preserves the others", () => {
	const state = task(); write(state, { next: "Review" }); fact(state, "worker_report");
	move(state, "done");
	prepareReportNudges(state, START + 30_000, owner);
	expect(state.reportOutbox).toEqual([]);
	move(state, "in_progress");
	fact(state, "worker_report");
	task(state); write(state, { next: "Review other task" }, 0, "T2"); fact(state, "worker_report", 0, "T2");
	prepareReportNudges(state, START + 30_000, owner);
	expect(state.reportOutbox![0]!.admissions).toHaveLength(2);
	move(state, "done");
	prepareReportNudges(state, START + 30_000, owner);
	expect(state.reportOutbox).toHaveLength(1);
	expect(state.reportOutbox![0]!.admissions.map(a => a.taskId)).toEqual(["T2"]);
	expect(state.reportOutbox![0]!.content).not.toContain("T1 ");
});

it("coordinator spawn/status/decision/claim/question facts count but never invalidate, even via the age backstop", () => {
	for (const threadId of ["main", "synthetic-thread"]) {
		const state = task(); write(state, { results: "Historical tests", next: "Continue" });
		moveTaskForWorker(state, { key: "spawn", taskId: "T1", move: { kind: "spawned", workerId: "synthetic" }, now: at() });
		move(state, "review", "coordinator");
		addDecision(state, { taskId: "T1", text: "Use synthetic fixtures", why: null, threadId, now: at() });
		changeOwner(state, { taskId: "T1", expectedRevision: state.tasks[0]!.revision, change: { kind: "claim", threadId }, now: at() });
		askQuestion(state, { taskId: "T1", text: "Choose?", options: [], threadId, now: at() });
		for (const kind of ["worker_start", "worker_resume"] as const) noteTaskFact(state, "T1", { actor: "harness", kind, reason: "started work", at: at() });
		sweepReportAge(state, START); sweepReportAge(state, START + 4 * 3_600_000);
		prepareReportNudges(state, START + 4 * 3_600_000 + 30_000, owner);
		for (const name of ["results", "next"] as const) expect(meta(state)[name]).toMatchObject({ stale: false, eventsSince: 7 });
		expect(state.reportOutbox).toEqual([]);
		expect(tracking(state).pending).toBeUndefined();
	}
});

it("coordinator review with empty Results nudges only Results, but done never nudges", () => {
	const state = task(); write(state, { next: "Review" });
	move(state, "review", "coordinator");
	expect(meta(state).results.stale).toBe(true);
	expect(meta(state).next.stale).toBe(false);
	prepareReportNudges(state, START + 30_000, owner);
	expect(state.reportOutbox).toHaveLength(1);
	expect(state.reportOutbox![0]!.content).toContain("T1 Results stale");
	move(state, "done");
	expect(state.reportOutbox).toEqual([]);
	expect(meta(state).results.stale).toBe(false);
});

it("worker outcomes still invalidate both written sections and queue a nudge", () => {
	const state = task(); write(state, { results: "Historical tests", next: "Continue" });
	noteTaskFact(state, "T1", { actor: "worker", kind: "worker_report", reason: "worker reported", at: at() });
	for (const name of ["results", "next"] as const) expect(meta(state)[name]).toMatchObject({ stale: true, eventsSince: 1 });
	prepareReportNudges(state, START + 30_000, owner);
	expect(state.reportOutbox).toHaveLength(1);
});

it("T71 replay: answered owner request merges into one nudge, suppresses unchanged versions, covered rewrite rearms", () => {
	const state = task();
	write(state, { results: "- Preparation checked (synthetic run)", next: "Owner: choose signing and licence policy." });
	const question = askQuestion(state, { taskId: "T1", text: "Choose policy?", options: [], now: at(1) });
	expect(meta(state).next.stale).toBe(false);
	settleQuestion(state, { questionId: question.id, answer: "Use local signing and include licences.", now: at(2) });
	expect(meta(state).next).toMatchObject({ stale: true, reasons: ["Q1 answered"], eventsSince: 2 });
	expect(meta(state).results.stale).toBe(false);
	const burst = tracking(state).pending!.burst;
	fact(state, "worker_report", 10_000);
	const row = state.tasks[0]!;
	saveTask(state, { taskId: row.id, expectedRevision: row.revision, task: { ...row, status: "review" }, author: "coordinator", now: at(20_000) });
	fact(state, "commit", 25_000);
	expect(tracking(state).pending!.burst).toBe(burst);
	prepareReportNudges(state, START + 54_999, owner);
	expect(state.reportOutbox).toEqual([]);
	prepareReportNudges(state, START + 55_000, owner);
	expect(state.reportOutbox).toHaveLength(1);
	expect(state.reportOutbox![0]!.content).toContain("T1 Results/Next stale");
	expect(state.reportOutbox![0]!.content).toContain("change landed");
	expect(meta(state).next.eventsSince).toBe(5);
	acknowledgeReportNudge(state, state.reportOutbox![0]!.key);
	fact(state, "publication", 70_000);
	expect(meta(state).next.eventsSince).toBe(6);
	expect(tracking(state).pending).toBeUndefined();
	write(state, { results: "- Preparation checked (synthetic run)", next: "Owner: choose signing and licence policy." });
	expect(meta(state).next.stale).toBe(true); // no-op is not coverage
	expect(tracking(state).pending).toBeUndefined();
	write(state, { results: "- Assets prepared and change landed (synthetic commit)", next: "Coordinator: verify draft assets; owner: approve publication." });
	expect(meta(state).next).toMatchObject({ stale: false, eventsSince: 0, version: 2 });
	fact(state, "deploy", 90_000);
	expect(tracking(state).pending).toBeDefined();
});

it("writes cannot cover a concurrent fact; an uncovered rewrite preserves the pending admission", () => {
	const state = task();
	write(state, { results: "- Old tests passed", next: "Merge" });
	const read = state.tasks[0]!.eventSeq;
	fact(state, "worker_report");
	write(state, { results: "- Tests reviewed", next: "Verify integration" }, read);
	expect(meta(state).next).toMatchObject({ coveredEventSeq: 0, stale: true, eventsSince: 1, version: 2 });
	prepareReportNudges(state, START + 30_000, owner);
	expect(state.reportOutbox![0]!.admissions[0]!.sections).toEqual({ results: 2, next: 2 });
	acknowledgeReportNudge(state, state.reportOutbox![0]!.key);
	fact(state, "commit", 40_000);
	write(state, { results: "- Results changed but not read", next: "Next changed but not read" }, read);
	expect(meta(state).next.stale).toBe(true);
	expect(tracking(state).pending).toBeUndefined();
});

it("omitted coverage clears stale sections at write time, rearms nudges, and still ignores no-op prose", () => {
	const state = task();
	write(state, { results: "- Old checks passed", next: "Review old assets" });
	fact(state, "worker_report");
	prepareReportNudges(state, START + 30_000, owner);
	acknowledgeReportNudge(state, state.reportOutbox![0]!.key);
	fact(state, "commit", 40_000);
	const rewrite = (sections: { results: string; next: string }) => writeReport(state, { taskId: "T1", sections, by, now: at(50_000) });
	rewrite({ results: "- Old checks passed", next: "Review old assets" });
	for (const name of ["results", "next"] as const) expect(meta(state)[name]).toMatchObject({ stale: true, coveredEventSeq: 0, eventsSince: 2, version: 1 });
	expect(tracking(state).pending).toBeUndefined();
	rewrite({ results: "- Updated checks and assets passed", next: "Owner: review the prepared assets" });
	for (const name of ["results", "next"] as const) expect(meta(state)[name]).toMatchObject({ stale: false, coveredEventSeq: 2, eventsSince: 0, version: 2, reasons: [] });
	fact(state, "worker_report", 60_000);
	expect(tracking(state).pending).toBeDefined();
});

it("section dates are independent of Now; explicit waitsOn narrows question invalidation", () => {
	const state = task();
	writeReport(state, { taskId: "T1", sections: { next: "Wait for Q2", results: "Historical checks" }, waitsOn: ["Q2"], coveredEventSeq: 0, now: at(), by });
	writeReport(state, { taskId: "T1", sections: { now: "Building" }, now: at(999), by });
	expect(meta(state).next.writtenAt).toBe(at());
	const q1 = askQuestion(state, { taskId: "T1", text: "First?", options: [], now: at() });
	settleQuestion(state, { questionId: q1.id, answer: "yes", now: at() });
	expect(meta(state).next.stale).toBe(false);
	const q2 = askQuestion(state, { taskId: "T1", text: "Second?", options: [], now: at() });
	settleQuestion(state, { questionId: q2.id, answer: null, now: at() });
	expect(meta(state).next).toMatchObject({ stale: true, reasons: ["Q2 withdrawn"] });
});

it("fixed fact catalogue: starts preserve Results, outcomes and decisions invalidate it", () => {
	for (const kind of ["blocker_resolved", "thread_handoff", "feedback"] as const) {
		const state = task(); write(state, { results: "Historical result", next: "Continue" }); fact(state, kind);
		expect(meta(state).results.stale).toBe(false);
		expect(meta(state).next.stale).toBe(true);
	}
	for (const kind of ["worker_report", "worker_fail", "worker_stop", "thread_finish", "feedback_addressed", "decision", "commit", "integration", "publication", "deploy", "check_outcome"] as const) {
		const state = task(); write(state, { results: "Historical result", next: "Continue" }); fact(state, kind);
		expect(meta(state).results.stale).toBe(true);
	}
	const state = task(undefined, "review");
	expect(meta(state).results).toMatchObject({ stale: true, reasons: ["Results empty at review"] });
});

it("30 s trailing debounce has a 2 min cap, batches tasks by owner, and leaves overflow queued", () => {
	const state = task();
	write(state, { next: "Continue" });
	for (const ms of [0, 25_000, 50_000, 75_000, 100_000]) fact(state, "worker_report", ms);
	expect(reportDueAt(tracking(state).pending!)).toBe(START + 120_000);
	prepareReportNudges(state, START + 119_999, owner);
	expect(state.reportOutbox).toHaveLength(0);
	prepareReportNudges(state, START + 120_000, owner);
	expect(state.reportOutbox).toHaveLength(1);
	const multi = emptyBoardState();
	for (let i = 1; i <= 8; i++) { task(multi); write(multi, { next: "Continue" }, 0, `T${i}`); fact(multi, "worker_report", 0, `T${i}`); }
	prepareReportNudges(multi, START + 30_000, (row) => row.id === "T8" ? "other" : "main", { maxTokens: 65 });
	expect(multi.reportOutbox).toHaveLength(2);
	expect(multi.reportOutbox!.find((batch) => batch.owner === "main")!.admissions.length).toBeGreaterThan(1);
	expect(multi.reportOutbox!.flatMap((batch) => batch.admissions).length).toBeLessThan(8);
	while (Object.values(multi.reportTracking!).some((value) => value.pending !== undefined)) {
		for (const batch of [...multi.reportOutbox!]) acknowledgeReportNudge(multi, batch.key);
		prepareReportNudges(multi, START + 30_000, owner, { maxTokens: 65 });
	}
	expect(multi.reportOutbox).toHaveLength(0);
});

it("outbox freezes admission, survives serialization, and acknowledgements are idempotent", () => {
	let state = task(); write(state, { next: "Continue" }); fact(state, "worker_report");
	prepareReportNudges(state, START + 30_000, owner);
	const batch = structuredClone(state.reportOutbox![0]!);
	state = JSON.parse(JSON.stringify(state)) as BoardState;
	fact(state, "worker_report", 35_000);
	prepareReportNudges(state, START + 80_000, owner);
	expect(state.reportOutbox).toEqual([batch]);
	acknowledgeReportNudge(state, batch.key); acknowledgeReportNudge(state, batch.key);
	state = JSON.parse(JSON.stringify(state)) as BoardState;
	fact(state, "commit", 90_000); prepareReportNudges(state, START + 150_000, owner);
	expect(state.reportOutbox).toHaveLength(0);
});

it("age backstop is at most hourly and only for new activity; legacy migration itself never nudges", () => {
	const state = task();
	write(state, { next: "Owner: decide", results: "Historical tests" });
	delete state.tasks[0]!.report.freshness;
	delete state.tasks[0]!.eventSeq;
	delete state.reportTracking;
	normalizeBoard(state);
	expect(meta(state).next).toMatchObject({ approximate: true, coveredEventSeq: null, stale: false });
	expect(tracking(state).pending).toBeUndefined();
	sweepReportAge(state, START); sweepReportAge(state, START + 3 * 3_600_000);
	expect(tracking(state).pending).toBeUndefined();
	askQuestion(state, { taskId: "T1", text: "Non-invalidating activity", options: [], now: at(3 * 3_600_000 + 1) });
	noteTaskFact(state, "T1", { actor: "user", kind: "question_asked", reason: "User activity", at: at(3 * 3_600_000 + 1) });
	sweepReportAge(state, START + 3 * 3_600_000 + 2);
	expect(meta(state).next.stale).toBe(false); // not an hour since last sweep
	sweepReportAge(state, START + 4 * 3_600_000);
	expect(meta(state).next.stale).toBe(true);
	prepareReportNudges(state, START + 4 * 3_600_000 + 30_000, owner);
	acknowledgeReportNudge(state, state.reportOutbox![0]!.key);
	sweepReportAge(state, START + 8 * 3_600_000);
	expect(tracking(state).pending).toBeUndefined();
	settleQuestion(state, { questionId: "Q1", answer: "Approved", now: at(8 * 3_600_000) });
	expect(meta(state).next.reasons).toContain("Q1 answered");
});

it("mention heuristic accepts substantive task prose and rejects quotes, code, prefixes, templates, bare refs and unknown IDs", () => {
	const valid = new Set(["T1", "T2"]);
	const substantive = "The synthetic assets now pass verification and need owner approval before publishing.";
	expect(substantiveTaskMentions(`T1: ${substantive} T2 also needs review.`, valid)).toEqual(["T1", "T2"]);
	for (const text of ["T1", "task T1", `> T1 ${substantive}`, `\`\`\`\nT1 ${substantive}\n\`\`\``, `\`T1 ${substantive}\``, `“T1 ${substantive}”`, `[from T1] ${substantive}`, `[task T1, feedback F1] ${substantive}`, `Filed under T1. ${substantive}`, `[T1](https://example.invalid/tasks/T1) ${substantive}`, `T99 ${substantive}`]) expect(substantiveTaskMentions(text, valid)).toEqual([]);
});

it("button/audit use the same stale path, do not move status, and are feature-gated; old task DTOs remain valid", () => {
	const state = task(); write(state, { results: "Tests", next: "Continue" });
	markReportStale(state, "T1", ["results"], "new evidence", at(), "user");
	expect(meta(state).results.reasons).toEqual(["new evidence"]);
	expect(meta(state).next.stale).toBe(false);
	expect(state.tasks[0]!.status).toBe("in_progress");
	state.taskFreshnessEnabled = false; fact(state, "worker_start");
	expect(meta(state).next.stale).toBe(false);
	const old = structuredClone(state.tasks[0]!); delete old.eventSeq; delete old.report.freshness;
	expect(Value.Check(BoardTaskSchema, old)).toBe(true);
	expect(Value.Check(BoardReportStaleRequestSchema, { type: "board.report.stale", id: "r1", projectId: "p1", taskId: "T1", sections: ["next"] })).toBe(true);
	expect(Value.Check(BoardReportStaleRequestSchema, { type: "board.report.stale", id: "r1", projectId: "p1", taskId: "T1", reason: "x".repeat(161) })).toBe(false);
	expect(HARNESS_FEATURES).toContain("task-freshness");
	expect(LEGACY_HARNESS_FEATURES).not.toContain("task-freshness");
});

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

async function integration(features?: readonly string[]) {
 const setup = await createSetup({ ...(features === undefined ? {} : { features }), now: () => START, boardEditDebounceMs: 60_000 });
 cleanups.push(setup.cleanup);
 const client = await TestClient.open(setup.server); cleanups.push(async () => client.close());
 await client.hello();
 const added = await client.request({ type: "projects.add", path: setup.projectDir });
 if (added.type !== "projects.add") throw errorOf(added);
 const configured = await client.request({ type: "projects.configure", projectId: added.project.id, coordinatorModel: { provider: "faux", modelId: "faux-1" } });
 if (configured.type !== "projects.configure") throw errorOf(configured);
 const { runtime } = await setup.server.manager.open(added.project.id);
 await runtime.board.saveTask({ task: { title: "Synthetic report", description: "", acceptance: null, status: "in_progress", blockedBy: [], blockedReason: null, writeScopes: [] } }, "coordinator");
 return { setup, client, runtime, projectId: added.project.id };
}

it("button request reaches durable storage, preserves status, rejects old backends and creates no timeline rows", async () => {
 const { client, runtime, projectId } = await integration();
 const before = await runtime.board.timeline("T1");
 const response = await client.request({ type: "board.report.stale", projectId, taskId: "T1", sections: ["results"], reason: "synthetic new evidence" });
 expect(response).toMatchObject({ type: "board.report.stale", task: { status: "in_progress", report: { freshness: { results: { stale: true, reasons: ["synthetic new evidence"] }, next: { stale: false } } } } });
 expect((await runtime.board.state()).reportTracking!.T1!.pending).toBeDefined();
 expect(await runtime.board.timeline("T1")).toEqual(before);
 const old = await integration(HARNESS_FEATURES.filter((feature) => feature !== "task-freshness"));
 expect(await old.client.request({ type: "board.report.stale", projectId: old.projectId, taskId: "T1" })).toMatchObject({ type: "error", error: { code: "unknown_request" } });
 expect((await old.runtime.board.state()).tasks[0]!.report.freshness).toBeUndefined();
}, 15_000);

it("restart: crash after durable admission but before acknowledgement delivers exactly once, and quiet migration never wakes", async () => {
 const { setup, runtime, projectId } = await integration();
 await runtime.board.noteTaskFact("T1", { actor: "harness", kind: "commit", reason: "synthetic change landed", at: at() });
 await runtime.harness.commit(async (tx) => {
  const state = await tx.doc(BoardDoc, runtime.conversation.id);
  prepareReportNudges(state as BoardState, START + 30_000, owner);
 }, BACKGROUND_CONTEXT);
 const batch = (await runtime.board.state()).reportOutbox![0]!;
 // This persisted input is the point immediately before a crash would lose the acknowledgement.
 const first = await runtime.conversation.submit({ type: "input", content: batch.content, whenBusy: "followUp", requestId: batch.key }, BACKGROUND_CONTEXT);
 await first.wait(BACKGROUND_CONTEXT);
 await setup.restart();
 const reopened = (await setup.server.manager.open(projectId)).runtime;
 await reopened.conversation.waitForIdle(BACKGROUND_CONTEXT);
 const replay = new BoardService({ project: () => reopened.project, harness: reopened.harness, coordinator: reopened.conversation, now: () => START + 40_000, log: () => undefined });
 cleanups.push(() => replay.stop());
 await replay.checkReports();
 await reopened.conversation.waitForIdle(BACKGROUND_CONTEXT);
 expect((await replay.state()).reportOutbox).toEqual([]);
 const entries = await reopened.conversation.entries({}, 100, undefined, BACKGROUND_CONTEXT);
 const inputs = entries.items.filter((entry) => entry.kind === "pi.user").flatMap((entry) => entry.model ?? []);
 const text = inputs.map((message) => JSON.stringify(message));
 expect(text.filter((message) => message.includes("[reports]"))).toHaveLength(1);
 const after = await replay.state();
 expect(after.reportTracking!.T1!.pending).toBeUndefined();
 await setup.restart();
 const again = (await setup.server.manager.open(projectId)).runtime;
 expect((await again.board.state()).tasks[0]!.eventSeq).toBe(after.tasks[0]!.eventSeq);
 expect((await again.board.state()).reportOutbox).toEqual([]);
}, 20_000);

it("outgoing coordinator prose stales and nudges once per turn; a same-turn report write prevents fallback", async () => {
 const { setup, runtime } = await integration();
 setup.faux.setResponses([
  fauxAssistantMessage("T1 now has synthetic verification evidence and is ready for a careful owner review before publication. T1 also needs a final evidence check."),
  fauxAssistantMessage([fauxToolCall("board", { action: "show_task", id: "T1" })], { stopReason: "toolUse" }),
  fauxAssistantMessage([fauxToolCall("board", { action: "write_report", id: "T1", results: "- Synthetic verification passed", next: "Owner: review the assets", coveredEventSeq: 1 })], { stopReason: "toolUse" }),
  fauxAssistantMessage("T1 now has synthetic verification evidence and is ready for a careful owner review before publication."),
 ]);
 const first = await runtime.conversation.submit({ type: "input", content: "Discuss the evidence.", requestId: "mention-first" }, BACKGROUND_CONTEXT);
 await first.wait(BACKGROUND_CONTEXT); await runtime.conversation.waitForIdle(BACKGROUND_CONTEXT);
 const mentioned = await runtime.board.state();
 for (const section of ["results", "next"] as const) expect(meta(mentioned)[section]).toMatchObject({ stale: true, reasons: ["discussed in chat"], eventsSince: 1 });
 expect(mentioned.tasks[0]!.eventSeq).toBe(1);
 prepareReportNudges(mentioned, START + 30_000, owner);
 prepareReportNudges(mentioned, START + 60_000, owner);
 expect(mentioned.reportOutbox).toHaveLength(1);
 expect(mentioned.reportOutbox![0]!.admissions).toHaveLength(1);
 const second = await runtime.conversation.submit({ type: "input", content: "Read and rewrite the report.", requestId: "mention-rewrite" }, BACKGROUND_CONTEXT);
 await second.wait(BACKGROUND_CONTEXT); await runtime.conversation.waitForIdle(BACKGROUND_CONTEXT);
 expect((await runtime.board.state()).tasks[0]!.report.freshness!.next).toMatchObject({ stale: false, coveredEventSeq: 1 });
 const rewritten = await runtime.board.state();
 expect(rewritten.tasks[0]!.eventSeq).toBe(1);
 expect(rewritten.reportTracking!.T1!.pending).toBeUndefined();
 prepareReportNudges(rewritten, START + 60_000, owner);
 expect(rewritten.reportOutbox).toEqual([]);
}, 15_000);

it("coordinator milestones count without invalidation and report rewrites alone do not add timeline rows", async () => {
 const { runtime } = await integration();
 const commit = <R>(change: Parameters<typeof runtime.harness.commit<R>>[0]) => runtime.harness.commit(change, BACKGROUND_CONTEXT);
 await runtime.board.writeReport(commit, { taskId: "T1", sections: { results: "- Synthetic tests pass", next: "Review assets" }, by, coveredEventSeq: 0 }, "initial-write");
 const before = await runtime.board.timeline("T1");
 await runtime.board.writeReport(commit, { taskId: "T1", sections: { results: "- Synthetic tests and assets checked" }, by, coveredEventSeq: 0, milestone: "Assets checked" }, "milestone-write");
 const state = await runtime.board.state();
 expect(meta(state).results).toMatchObject({ stale: false, coveredEventSeq: 1, eventsSince: 0 });
 expect(meta(state).next).toMatchObject({ stale: false, eventsSince: 1, reasons: [] });
 expect((await runtime.board.timeline("T1")).entries.length).toBe(before.entries.length + 1);
 await runtime.board.writeReport(commit, { taskId: "T1", sections: { results: "- Synthetic tests and assets checked" }, by, coveredEventSeq: 1, milestone: "Delivery advanced" }, "noop-milestone");
 expect(meta(await runtime.board.state()).results).toMatchObject({ stale: false, eventsSince: 1 });
}, 15_000);
