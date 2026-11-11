import { expect, it } from "bun:test";
import type { BoardActivityActor, BoardTimelineFact } from "@aiki/protocol";
import { PROTOCOL_SCHEMAS } from "@aiki/protocol";
import { HARNESS_FEATURES, LEGACY_HARNESS_FEATURES } from "../../protocol/src/projects.ts";
import { Value } from "typebox/value";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { addDecision, addSnapshot, addTimelineEvent, applyTaskDeploy, askQuestion, buildTimeline, coordinatorWriter, emptyBoardState, recordFeedback, saveTask, setFeedbackState, settleQuestion, writeReport, type TaskHistoryState } from "../src/board.ts";
import { buildTimelineGroups, recordTimelineRun, timelineId, upsertTimelineFact } from "../src/task-timeline.ts";
import { syncWorkerActivity, type WorkerRecord } from "../src/workers.ts";
import { createSetup, TestClient } from "./support.ts";

const at = (minute = 0) => new Date(Date.UTC(2026, 10, 12, 14, minute)).toISOString();
const input = { title: "Synthetic card view", description: "", acceptance: null, status: "in_progress" as const, blockedBy: [], blockedReason: null, writeScopes: [] };
function fixture() {
 const state = emptyBoardState();
 saveTask(state, { task: input, author: "harness", now: at() });
 const history: TaskHistoryState = { snapshots: [], keys: [] };
 return { state, history, task: state.tasks[0]! };
}
const actor = (name = "fern", conversationId = 2, runId = "run-1", threadId = "main"): BoardActivityActor => ({ id: `${threadId}:${conversationId}:${runId}`, kind: "worker", name, conversationId, runId, threadId });
function put(f: ReturnType<typeof fixture>, source: string, kind: BoardTimelineFact["kind"], group: BoardTimelineFact["group"], label: string, minute: number, outcome = "recorded") {
 return upsertTimelineFact(f.history, f.task, { id: timelineId(f.task.id, source), at: at(minute), endAt: at(minute), kind, group, label, outcome, ref: source, source });
}

it("advertises grouped timelines explicitly and keeps them off legacy feature inference", () => {
 expect(HARNESS_FEATURES).toContain("task-timeline-groups");
 expect(LEGACY_HARNESS_FEATURES).not.toContain("task-timeline-groups");
});

it("a busy hour has only three groups, exact fact counts and meaningful latest outcomes", () => {
 const f = fixture();
 for (let i = 0; i < 12; i++) {
  recordTimelineRun(f.history, f.task, actor(`worker-${i}`, i + 2), "running", at(i), "Implement");
  recordTimelineRun(f.history, f.task, actor(`worker-${i}`, i + 2), "reported", at(20 + i), "Checks pass");
 }
 addSnapshot(f.history, f.task, { label: "in_progress → review", at: at(36), by: coordinatorWriter("main") });
 const question = askQuestion(f.state, { text: "Choose layout", options: [], taskId: f.task.id, now: at(8) });
 settleQuestion(f.state, { questionId: question.id, answer: "Compact", now: at(22) });
 const feedback = recordFeedback(f.state, f.history, { taskId: f.task.id, text: "Tighten spacing", images: 0, key: "f1", threadId: "main", now: at(9) });
 setFeedbackState(f.state, f.history, { taskId: f.task.id, feedbackId: feedback.id, state: "addressed", note: "Done", by: coordinatorWriter("main"), now: at(23) });
 put(f, "change", "milestone", "delivery", "3 changes landed on main", 38, "landed");
 const deploy = { scope: "synthetic-feed", order: 1, attemptId: "d7", sequence: 1, intendedCommit: "b".repeat(40), expectedTargets: ["one", "two", "three"], observedAt: at(40), taskIds: [f.task.id], targets: { one: { state: "queued" as const }, two: { state: "queued" as const }, three: { state: "queued" as const } } };
 applyTaskDeploy(f.state, f.history, f.task, deploy);
 applyTaskDeploy(f.state, f.history, f.task, { ...deploy, sequence: 2, observedAt: at(47), targets: { one: { state: "ok" }, two: { state: "ok" }, three: { state: "ok" } } });
 const groups = buildTimelineGroups(f.task, f.state, f.history);
 expect(groups).toHaveLength(3);
 expect(groups.find(g => g.kind === "work")).toMatchObject({ label: "12 workers reported; ready for review", factCount: 25, range: { start: at(), end: at(36) } });
 expect(groups.find(g => g.kind === "decisions")).toMatchObject({ label: "Q1 answered; F1 addressed", factCount: 4, range: { start: at(8), end: at(23) } });
 expect(groups.find(g => g.kind === "delivery")).toMatchObject({ label: "3 changes landed; live on 3/3 targets", factCount: 3, range: { start: at(38), end: at(47) } });
 for (const group of groups) expect(Value.Check(PROTOCOL_SCHEMAS.BoardTimelineGroup!, group)).toBe(true);
});

it("failures and open questions dominate later routine successes", () => {
 const f = fixture();
 recordTimelineRun(f.history, f.task, actor(), "running", at(), "Implement");
 recordTimelineRun(f.history, f.task, actor(), "failed", at(5), "Check failed");
 recordTimelineRun(f.history, f.task, actor("moss", 3), "reported", at(9), "Checks pass");
 askQuestion(f.state, { taskId: f.task.id, text: "Choose", options: [], now: at(1) });
 const answered = askQuestion(f.state, { taskId: f.task.id, text: "Another", options: [], now: at(2) });
 settleQuestion(f.state, { questionId: answered.id, answer: "Yes", now: at(10) });
 put(f, "deploy", "milestone", "delivery", "Deploy failed on one target", 3, "failed");
 put(f, "retry", "milestone", "delivery", "Deploy queued", 11, "running");
 const groups = buildTimelineGroups(f.task, f.state, f.history);
 expect(groups.find(g => g.kind === "work")!.label).toBe("Worker fern failed");
 expect(groups.find(g => g.kind === "decisions")!.label).toBe("Q1 awaiting answer");
 expect(groups.find(g => g.kind === "delivery")!.label).toBe("Deploy failed on one target");
});

it("a cross-hour run keeps its ID, start, group and position as the outcome and end change", () => {
 const f = fixture();
 recordTimelineRun(f.history, f.task, actor(), "running", at(58), "Implement");
 const before = buildTimelineGroups(f.task, f.state, f.history)[0]!;
 recordTimelineRun(f.history, f.task, actor(), "reported", at(88), "Tests pass");
 const after = buildTimelineGroups(f.task, f.state, f.history);
 expect(after).toHaveLength(1);
 expect(after[0]!.id).toBe(before.id);
 expect(after[0]!.hour).toBe(at());
 expect(after[0]!.entries[0]).toMatchObject({ id: before.entries[0]!.id, at: at(58), endAt: at(88), revision: 2, factCount: 2 });
 expect(after[0]!.range).toEqual({ start: at(58), end: at(88) });
});

it("question and feedback entries evolve in place and retain answers and handling evidence", () => {
 const f = fixture();
 const q = askQuestion(f.state, { text: "Choose", options: [], taskId: f.task.id, now: at(1) });
 const feedback = recordFeedback(f.state, f.history, { taskId: f.task.id, text: "Spacing", images: 0, key: "f", threadId: "main", now: at(2) });
 const before = buildTimelineGroups(f.task, f.state, f.history)[0]!;
 settleQuestion(f.state, { questionId: q.id, answer: "Compact", now: at(61) });
 for (const [index, status] of (["handling", "addressed"] as const).entries()) setFeedbackState(f.state, f.history, { taskId: f.task.id, feedbackId: feedback.id, state: status, note: "Evidence", by: coordinatorWriter("main"), now: at(62 + index) });
 const after = buildTimelineGroups(f.task, f.state, f.history)[0]!;
 expect(after.entries.map(e => e.id)).toEqual(before.entries.map(e => e.id));
 expect(after.entries).toHaveLength(2);
 expect(after.entries[0]!.detail).toContain("Compact");
 expect(after.entries[1]!.detail).toContain("handling: Evidence");
 expect(after.entries[1]!.revision).toBe(3);
 expect(after.range.end).toBe(at(63));
});

it("kind filters run inside groups and recalculate labels, ranges and counts; empty groups disappear", () => {
 const f = fixture();
 put(f, "link", "link", "work", "Related T2", 3);
 recordTimelineRun(f.history, f.task, actor(), "failed", at(6), "Failure");
 askQuestion(f.state, { text: "Choose", options: [], taskId: f.task.id, now: at(1) });
 addDecision(f.state, { text: "Use compact", why: null, taskId: f.task.id, now: at(9) });
 const groups = buildTimelineGroups(f.task, f.state, f.history, ["link", "decision"]);
 expect(groups).toHaveLength(2);
 expect(groups.flatMap(g => g.entries).map(e => e.kind).sort()).toEqual(["decision", "link"]);
 expect(groups.find(g => g.kind === "work")).toMatchObject({ label: "Related T2", factCount: 1, range: { start: at(3), end: at(3) } });
 expect(groups.find(g => g.kind === "decisions")!.label).toBe("Decision D1");
 expect(buildTimelineGroups(f.task, f.state, f.history, ["feedback"])).toEqual([]);
});

it("legacy worker rows fold on read, reused names start new episodes, snapshots never mutate", () => {
 const f = fixture();
 for (const [minute, label] of [[1, "Worker fern started"], [2, "Worker fern reported"], [3, "Worker fern started"], [65, "Worker fern failed"]] as const) addTimelineEvent(f.history, f.task, { at: at(minute), kind: "worker", label, ref: "fern" });
 addSnapshot(f.history, f.task, { at: at(), label: "new → in_progress", by: coordinatorWriter("main") });
 f.history.snapshots[0]!.report.now = "Legacy prose";
 const before = JSON.stringify(f);
 const first = buildTimelineGroups(f.task, f.state, f.history);
 const second = buildTimelineGroups(f.task, f.state, f.history);
 expect(first).toEqual(second);
 expect(first).toHaveLength(1);
 expect(first[0]!.entries.filter(e => e.kind === "worker")).toHaveLength(2);
 expect(first[0]!.factCount).toBe(5);
 expect(JSON.stringify(f)).toBe(before);
 expect(f.history.snapshots[0]!.report.now).toBe("Legacy prose");
});

it("legacy flat entries are unchanged and do not gain duplicate rows from curated runs", () => {
 const f = fixture();
 addTimelineEvent(f.history, f.task, { at: at(1), kind: "worker", label: "Worker fern started", ref: "fern" });
 addTimelineEvent(f.history, f.task, { at: at(4), kind: "worker", label: "Worker fern reported", ref: "fern" });
 const before = buildTimeline(f.task, f.state, f.history);
 recordTimelineRun(f.history, f.task, actor(), "running", at(1), "Implement");
 recordTimelineRun(f.history, f.task, actor(), "reported", at(4), "Checks pass");
 expect(buildTimeline(f.task, f.state, f.history)).toEqual(before);
 expect(before.entries).toHaveLength(2);
 expect(buildTimelineGroups(f.task, f.state, f.history)[0]!.entries).toHaveLength(1);
});

it("revision bumps on folded source changes, Q/decision changes and feedback; identical retries are inert", () => {
 const f = fixture();
 const revision = () => f.task.timelineRevision ?? 0;
 recordTimelineRun(f.history, f.task, actor(), "running", at(), "Implement");
 const started = revision();
 recordTimelineRun(f.history, f.task, actor(), "running", at(1), "Implement");
 expect(revision()).toBe(started);
 recordTimelineRun(f.history, f.task, actor(), "reported", at(2), "Checks pass");
 expect(revision()).toBeGreaterThan(started);
 let previous = revision();
 const q = askQuestion(f.state, { text: "Choose", options: [], taskId: f.task.id, now: at(3) });
 expect(revision()).toBeGreaterThan(previous); previous = revision();
 settleQuestion(f.state, { questionId: q.id, answer: "Yes", now: at(4) });
 expect(revision()).toBeGreaterThan(previous); previous = revision();
 addDecision(f.state, { taskId: f.task.id, text: "Use compact", why: null, now: at(5) });
 expect(revision()).toBeGreaterThan(previous); previous = revision();
 const feedback = recordFeedback(f.state, f.history, { taskId: f.task.id, text: "Spacing", images: 0, key: "revision-f", threadId: "main", now: at(6) });
 expect(revision()).toBeGreaterThan(previous); previous = revision();
 setFeedbackState(f.state, f.history, { taskId: f.task.id, feedbackId: feedback.id, state: "addressed", note: "Done", by: coordinatorWriter("main"), now: at(7) });
 expect(revision()).toBeGreaterThan(previous);
 expect(f.history.revision).toBe(revision());
});

it.each(["Report updated", "Report rewritten", "Now updated", "Phase changed", "Metadata edited", "Title updated", "Description updated", "Refs updated", "Stale marked", "Check-in sent", "Artifact saved", "Thread message", "Tool completed"])("excludes legacy noise: %s", label => {
 const f = fixture();
 addSnapshot(f.history, f.task, { label, by: coordinatorWriter("main"), at: at() });
 addTimelineEvent(f.history, f.task, { at: at(), kind: "milestone", label });
 expect(buildTimelineGroups(f.task, f.state, f.history)).toEqual([]);
});

it("metadata and report rewrites do not create grouped entries or revisions", () => {
 const f = fixture();
 const revision = f.task.timelineRevision;
 saveTask(f.state, { taskId: f.task.id, expectedRevision: f.task.revision, task: { ...input, title: "Renamed", description: "New description" }, author: "harness", now: at(1) });
 writeReport(f.state, { taskId: f.task.id, sections: { results: "Passed", next: "Review" }, by: coordinatorWriter("main"), now: at(2) });
 expect(buildTimelineGroups(f.task, f.state, f.history)).toEqual([]);
 expect(f.task.timelineRevision).toBe(revision);
});

it("resumes and reused worker names have separate IDs; thread and check outcomes share stable run rules", () => {
 const f = fixture();
 recordTimelineRun(f.history, f.task, actor(), "running", at(), "Implement");
 recordTimelineRun(f.history, f.task, actor(), "reported", at(1), "Done");
 recordTimelineRun(f.history, f.task, actor("fern", 2, "run-2"), "running", at(2), "Review");
 recordTimelineRun(f.history, f.task, actor("fern", 3), "running", at(3), "Other conversation");
 const thread = { ...actor("thread-a", 4, "run-1", "thread-a"), kind: "thread" as const };
 recordTimelineRun(f.history, f.task, thread, "running", at(4), "Review");
 recordTimelineRun(f.history, f.task, thread, "ended", at(5), "Review");
 recordTimelineRun(f.history, f.task, thread, "ended", at(6), "Review");
 put(f, "check", "milestone", "work", "Build running", 6, "running");
 put(f, "check", "milestone", "work", "Build failed", 7, "failed");
 const entries = buildTimelineGroups(f.task, f.state, f.history)[0]!.entries;
 expect(entries).toHaveLength(5);
 expect(new Set(entries.map(e => e.id)).size).toBe(5);
 expect(entries.find(e => e.source === "thread")).toMatchObject({ at: at(4), endAt: at(5), revision: 2 });
 expect(entries.find(e => e.source === "check")).toMatchObject({ at: at(6), endAt: at(7), revision: 2 });
});

it("the real endpoint gates groups, preserves flat clients and folds durable worker/deploy updates", async () => {
 const setup = await createSetup({ now: () => Date.parse(at()) });
 const client = await TestClient.open(setup.server);
 try {
  await client.hello();
  const project = await setup.server.manager.store.add(setup.projectDir);
  const { runtime } = await setup.server.manager.open(project.id);
  await runtime.board.saveTask({ task: input }, "harness");
  const worker = { id: "fern", taskId: "T1", status: "running", title: "Implement", conversationId: 10, updatedAt: at(1), createdAt: at(1), activityRunId: "run-1", failure: null } as WorkerRecord;
  const sync = () => runtime.harness.commit(tx => syncWorkerActivity(tx, runtime.workers, worker, runtime.conversation.id), BACKGROUND_CONTEXT);
  await sync();
  const started = await runtime.board.timeline("T1", undefined, true);
  worker.status = "idle"; worker.lastReport = "Checks pass"; worker.updatedAt = at(63);
  await sync();
  const updated = await runtime.board.timeline("T1", undefined, true);
  const run = updated.groups!.flatMap(g => g.entries).find(e => e.source === "worker")!;
  expect(run.id).toBe(started.groups!.flatMap(g => g.entries).find(e => e.source === "worker")!.id);
  expect(run).toMatchObject({ outcome: "reported", at: at(1), endAt: at(63), revision: 2 });
  expect(updated.timelineRevision!).toBeGreaterThan(started.timelineRevision!);
  const flat = await client.request({ type: "board.task.timeline", projectId: project.id, taskId: "T1" });
  expect(flat.type).toBe("board.task.timeline");
  expect(flat).not.toHaveProperty("groups");
  expect(flat).not.toHaveProperty("timelineRevision");
  const grouped = await client.request({ type: "board.task.timeline", projectId: project.id, taskId: "T1", grouped: true, kinds: ["worker"] });
  if (grouped.type !== "board.task.timeline") throw new Error("Expected timeline response");
  expect(grouped.groups).toHaveLength(1);
  expect(grouped.groups![0]!.entries).toEqual([run]);
  expect(grouped.entries).toEqual([]); // No extra flat rows were manufactured by the new lifecycle projection.
 } finally { client.close(); await setup.cleanup(); }
}, 30_000);

it("an initial thread claim becomes its run without moving the row; later handoffs remain inspectable", () => {
 const f = fixture();
 put(f, "ownership", "milestone", "work", "Claimed by thread-a", 1, "claimed");
 const before = buildTimelineGroups(f.task, f.state, f.history)[0]!.entries[0]!;
 const thread = { ...actor("thread-a", 4, "run-1", "thread-a"), kind: "thread" as const };
 recordTimelineRun(f.history, f.task, thread, "running", at(2), "Review");
 recordTimelineRun(f.history, f.task, thread, "ended", at(4), "Review");
 put(f, "handoff", "milestone", "work", "Handed from thread-a to thread-b", 5);
 const entries = buildTimelineGroups(f.task, f.state, f.history)[0]!.entries;
 expect(entries).toHaveLength(2);
 expect(entries[0]).toMatchObject({ id: before.id, at: before.at, endAt: at(4), source: "thread" });
});

it("a legacy deploy keeps its source ID when a new target outcome arrives", () => {
 const f = fixture();
 const ref = "deploy:synthetic-feed:d7";
 addTimelineEvent(f.history, f.task, { kind: "milestone", at: at(1), label: "Deploy queued", ref });
 const before = buildTimelineGroups(f.task, f.state, f.history)[0]!.entries[0]!;
 applyTaskDeploy(f.state, f.history, f.task, { scope: "synthetic-feed", order: 1, attemptId: "d7", sequence: 2, intendedCommit: "b".repeat(40), expectedTargets: ["one"], observedAt: at(66), taskIds: [f.task.id], targets: { one: { state: "ok" } } });
 const entries = buildTimelineGroups(f.task, f.state, f.history)[0]!.entries;
 expect(entries).toHaveLength(1);
 expect(entries[0]).toMatchObject({ id: before.id, at: at(1), endAt: at(66), outcome: "ok" });
});

it("a server without the grouped capability ignores the opt-in and returns the same flat response", async () => {
 const setup = await createSetup({ features: HARNESS_FEATURES.filter(feature => feature !== "task-timeline-groups") });
 const client = await TestClient.open(setup.server);
 try {
  await client.hello();
  const project = await setup.server.manager.store.add(setup.projectDir);
  const { runtime } = await setup.server.manager.open(project.id);
  await runtime.board.saveTask({ task: input }, "harness");
  const response = await client.request({ type: "board.task.timeline", projectId: project.id, taskId: "T1", grouped: true });
  expect(response.type).toBe("board.task.timeline");
  expect(response).not.toHaveProperty("groups");
  expect(response).not.toHaveProperty("timelineRevision");
 } finally { client.close(); await setup.cleanup(); }
}, 30_000);
