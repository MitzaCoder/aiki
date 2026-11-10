import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Board, WorkerSummary, ProjectAttention } from "@aiki/protocol";
import { boardAttention, workerAttention, threadAttention, EMPTY_ATTENTION, ProjectAttentionStore } from "../src/sidebar-attention.ts";
import { createSetup, TestClient, type TestSetup } from "./support.ts";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { BoardDoc, askQuestion, settleQuestion } from "../src/board.ts";
import { readStoredAttention } from "../src/sidebar-attention-migration.ts";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

test("questions and warnings are separate; only review and dated waits count", () => {
	const summary = boardAttention({
		questions: [
			{ status: "open", taskId: "T1" }, { status: "open", kind: "warning", taskId: "T2" },
			{ status: "answered" }, { status: "withdrawn", kind: "warning" },
		],
		tasks: [
			{ id: "T1", status: "review" }, { id: "T2", status: "blocked" },
			{ status: "waiting", waiting: { until: "2026-11-20T08:00:00Z" } },
			{ status: "waiting", waiting: { until: "2026-11-16T08:00:00Z" } }, { status: "waiting" },
			{ status: "done", waiting: { until: "2026-11-10T08:00:00Z" } },
		],
	} as Board);
	expect(summary).toEqual({ questions: 1, warnings: 1, reviewTasks: 1, waitingTasks: 3, nextReturnAt: "2026-11-16T08:00:00Z", questionTaskId: "T1", warningTaskId: "T2", reviewTaskId: "T1" });
});

test("all threads' running/failed workers, but no dependency blockage is called a failure", () => {
	expect(workerAttention([
		{ status: "running", threadId: "main" }, { status: "running", threadId: "bg" },
		{ status: "failed", taskId: "T2" }, { status: "done" }, { status: "stopped" },
	] as WorkerSummary[])).toEqual({ runningWorkers: 2, failedWorkers: 1, failedWorkerTaskId: "T2" });
	expect(threadAttention([
		{ id: "main", main: true, archived: false, status: "failed" }, { id: "bg", main: false, archived: false, status: "failed" },
		{ id: "old", main: false, status: "failed", archived: true }, { id: "done", main: false, archived: false, status: "done" },
	])).toEqual({ failedThreads: 1, failedThreadId: "bg" });
});

test("summary store deduplicates, serializes and clears stale running counts on restart", async () => {
	const root = await mkdtemp(join(tmpdir(), "sidebar-attention-"));
	cleanups.push(() => rm(root, { recursive: true, force: true }));
	const store = new ProjectAttentionStore(() => root);
	expect(await store.read("p")).toBeUndefined();
	expect(store.update("p", { ...EMPTY_ATTENTION, questions: 1, runningWorkers: 3 })).toBe(true);
	expect(store.update("p", { questions: 1 })).toBe(false);
	store.update("p", { reviewTasks: 2 });
	await store.flush();
	expect(await new ProjectAttentionStore(() => root).read("p")).toEqual({ ...EMPTY_ATTENTION, questions: 1, runningWorkers: 0, reviewTasks: 2 });
	await Bun.write(join(root, "attention.json"), '{"questions":-1}');
	expect(await new ProjectAttentionStore(() => root).read("p")).toBeUndefined();
});

async function setup(): Promise<{ test: TestSetup; client: TestClient; id: string }> {
	const test = await createSetup({ boardEditDebounceMs: 60_000 });
	cleanups.push(() => test.cleanup());
	const client = await TestClient.open(test.server);
	cleanups.push(async () => client.close());
	await client.request({ type: "hello", protocolVersion: 1 });
	const added = await client.request({ type: "projects.add", path: test.projectDir });
	if (added.type !== "projects.add") throw Error(JSON.stringify(added));
	return { test, client, id: added.project.id };
}

async function waitAttention(client: TestClient, id: string, accept: (summary: ProjectAttention) => boolean) {
	return client.waitFor((message) => message.type === "project.state" && message.project.id === id && message.project.attention !== undefined && accept(message.project.attention));
}

test("board review/wait changes push without a conversation/board subscription; survive restart closed", async () => {
	const { test, client, id } = await setup();
	const save = await client.request({ type: "board.task.save", projectId: id, task: { title: "Check contrast", description: "", acceptance: null, refs: [], status: "review", blockedBy: [], blockedReason: null, writeScopes: [] } });
	expect(save.type).toBe("board.task.save");
	const review = await waitAttention(client, id, (summary) => summary.reviewTasks === 1);
	expect(review.type).toBe("project.state");
	const board = await client.request({ type: "board.get", projectId: id });
	if (board.type !== "board.get") throw Error(JSON.stringify(board));
	const task = board.board.tasks[0]!;
	await client.request({ type: "board.task.save", projectId: id, taskId: task.id, expectedRevision: task.revision, task: { ...task, status: "waiting", waitingFor: "Release", waitUntil: "2099-11-16T08:00:00Z" } });
	await waitAttention(client, id, (summary) => summary.reviewTasks === 0 && summary.waitingTasks === 1);
	await test.restart();
	const next = await TestClient.open(test.server);
	cleanups.push(async () => next.close());
	await next.request({ type: "hello", protocolVersion: 1 });
	const list = await next.request({ type: "projects.list" });
	if (list.type !== "projects.list") throw Error(JSON.stringify(list));
	expect(list.projects[0]?.state).toBe("closed");
	expect(list.projects[0]?.attention?.waitingTasks).toBe(1);
	expect(list.projects[0]?.attention?.nextReturnAt).toBe("2099-11-16T08:00:00.000Z");
});


test("question/warning and answer pushes are separate without board subscriptions", async () => {
    const { test, client, id } = await setup();
    const { runtime } = await test.server.manager.open(id);
    await runtime.harness.commit(async (tx) => {
        const board = await tx.doc(BoardDoc, runtime.conversation.id);
        askQuestion(board, { text: "Which rollout?", options: [], taskId: null, now: new Date().toISOString() });
        askQuestion(board, { text: "Watch quota", options: [], taskId: null, kind: "warning", now: new Date().toISOString() });
    }, BACKGROUND_CONTEXT);
    await waitAttention(client, id, (summary) => summary.questions === 1 && summary.warnings === 1);
    await runtime.harness.commit(async (tx) => {
        const board = await tx.doc(BoardDoc, runtime.conversation.id);
        settleQuestion(board, { questionId: "Q1", answer: "Pilot", now: new Date().toISOString() });
    }, BACKGROUND_CONTEXT);
    await waitAttention(client, id, (summary) => summary.questions === 0 && summary.warnings === 1);
});

test("worker failure reaches projects subscription without a worker watch", async () => {
    const { test, client, id } = await setup();
    const model = { provider: "faux", modelId: "faux-1" };
    await client.request({ type: "projects.configure", projectId: id, coordinatorModel: model, workerModels: [model] });
    test.faux.setResponses(Array.from({ length: 30 }, () => async (context) => {
        const last = context.messages.findLast((message) => message.role !== "system");
        const text = JSON.stringify(last?.content);
        if (text.includes("WORKER_FAIL")) throw Error("Test worker failure");
        if (last?.role !== "toolResult" && text.includes("Delegate")) return fauxAssistantMessage([fauxToolCall("worker_spawn", { id: "broken", task: "WORKER_FAIL", isolation: "shared", model })], { stopReason: "toolUse" });
        return fauxAssistantMessage("Noted.");
    }));
    await client.request({ type: "conversation.submit", projectId: id, requestId: "delegate", content: "Delegate" });
    await waitAttention(client, id, (summary) => summary.failedWorkers === 1 && summary.runningWorkers === 0);
});

test("one-time upgrade reads closed durable boards without opening a Harness", async () => {
    const { test, client, id } = await setup();
    await client.request({ type: "board.task.save", projectId: id, task: { title: "Review", description: "", acceptance: null, refs: [], status: "review", blockedBy: [], blockedReason: null, writeScopes: [] } });
    await waitAttention(client, id, (summary) => summary.reviewTasks === 1);
    await test.server.stop();
    const file = join(test.dataDir, "projects", id, "attention.json");
    await rm(file);
    expect((await readStoredAttention(join(test.dataDir, "projects", id, "session.sqlite"))).reviewTasks).toBe(1);
    await test.restart();
    const next = await TestClient.open(test.server);
    cleanups.push(async () => next.close());
    await next.hello();
    const list = await next.request({ type: "projects.list" });
    if (list.type !== "projects.list") throw Error(JSON.stringify(list));
    expect(list.projects[0]?.state).toBe("closed");
    expect(list.projects[0]?.attention?.reviewTasks).toBe(1);
});

test("waiting date passes while server is off: compact deadline wakes just that project into review", async () => {
    let now = Date.parse("2026-11-15T08:00:00Z");
    const test = await createSetup({ now: () => now, boardEditDebounceMs: 60_000 });
    cleanups.push(() => test.cleanup());
    const client = await TestClient.open(test.server);
    cleanups.push(async () => client.close());
    await client.hello();
    const added = await client.request({ type: "projects.add", path: test.projectDir });
    if (added.type !== "projects.add") throw Error(JSON.stringify(added));
    const id = added.project.id;
    await client.request({ type: "board.task.save", projectId: id, task: { title: "Release", description: "", acceptance: null, refs: [], status: "waiting", waitingFor: "Release approval", waitUntil: "2026-11-16T08:00:00Z", blockedBy: [], blockedReason: null, writeScopes: [] } });
    await waitAttention(client, id, (summary) => summary.waitingTasks === 1);
    await test.server.stop();
    now = Date.parse("2026-11-17T08:00:00Z");
    await test.restart();
    const next = await TestClient.open(test.server);
    cleanups.push(async () => next.close());
    await next.hello();
    // The callback may beat the socket connection, so read the projects subscription's snapshot too.
    for (let attempt = 0; attempt < 100; attempt++) {
        const list = await next.request({ type: "projects.list" });
        if (list.type === "projects.list" && list.projects[0]?.attention?.reviewTasks === 1) {
            expect(list.projects[0]?.attention?.waitingTasks).toBe(0);
            return;
        }
        await Bun.sleep(20);
    }
    throw Error("Waiting task did not return to review");
});


test("failed background thread is pushed independently of main coordinator activity", async () => {
    const { test, client, id } = await setup();
    const model = { provider: "faux", modelId: "faux-1" };
    await client.request({ type: "projects.configure", projectId: id, coordinatorModel: model, workerModels: [model] });
    await client.request({ type: "board.task.save", projectId: id, task: { title: "Background work", description: "", acceptance: null, refs: [], status: "todo", blockedBy: [], blockedReason: null, writeScopes: [] } });
    test.faux.setResponses(Array.from({ length: 30 }, () => async (context) => {
        const last = context.messages.findLast((message) => message.role !== "system");
        const text = JSON.stringify(last?.content);
        if (text.includes("THREAD_FAIL")) throw Error("Test thread failure");
        if (last?.role !== "toolResult" && text.includes("Start background")) return fauxAssistantMessage([fauxToolCall("thread_start", { title: "Broken background", brief: "THREAD_FAIL", taskId: "T1", model })], { stopReason: "toolUse" });
        return fauxAssistantMessage("Noted.");
    }));
    await client.request({ type: "conversation.submit", projectId: id, requestId: "background", content: "Start background" });
    const failure = await waitAttention(client, id, (summary) => summary.failedThreads === 1);
    if (failure.type !== "project.state") throw Error("Wrong message");
    expect(failure.project.attention?.failedThreadId).not.toBeNull();
    expect(failure.project.attention?.failedWorkers).toBe(0);
});
