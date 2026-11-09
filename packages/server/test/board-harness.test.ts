/**
 * The board, part 2: what the harness does to it by itself — a worker's spawn, report and failure move its task, a done
 * task tells the coordinator what it unblocked, overlapping write scopes warn, a failed scheduled run opens a task — and
 * the compact view a compaction summary carries.
 */
import { afterEach, describe, expect, it } from "bun:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { TranscriptContext } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { estimateTextTokens } from "@earendil-works/pi-ai/utils/estimate";
import type { Board, BoardTask, BoardTaskInput, ConversationView, ModelRef, WorkerModel } from "@mihai-harness/protocol";
import {
	type BoardState,
	addDecision,
	askQuestion,
	emptyBoardState,
	moveTaskForWorker,
	recordScheduleProblem,
	saveTask,
	scopesOverlap,
	boardView,
	describeTask,
	summaryBoardView,
	unblockedBy,
} from "../src/board.ts";
import { WorkersDoc, type WorkersState, type WorkerRecord, workerTaskTime } from "../src/workers.ts";
import { createSetup, entryText, errorOf, TestClient, ViewClient, type TestSetup } from "./support.ts";

const cleanups: (() => Promise<void>)[] = [];
const clients: TestClient[] = [];
const FAUX: ModelRef = { provider: "faux", modelId: "faux-1" };
const BRIEF = "Summarize the project's README for me.";
const NOW = "2026-11-05T12:00:00.000Z";

afterEach(async () => {
	for (const client of clients.splice(0)) client.close();
	for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function until(check: () => boolean | Promise<boolean>, timeoutMs = 20_000): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		if (await check()) return;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	throw new Error("timed out waiting for a condition");
}

async function connect(server: TestSetup["server"]): Promise<TestClient> {
	const client = await TestClient.open(server);
	clients.push(client);
	await client.hello();
	return client;
}

async function configure(client: TestClient, projectId: string, workerModels: WorkerModel[]): Promise<void> {
	const configured = await client.request({
		type: "projects.configure",
		projectId,
		coordinatorModel: FAUX,
		coordinatorThinkingLevel: "low",
		workerModels,
	});
	if (configured.type !== "projects.configure") throw errorOf(configured);
}

async function start(workerModels: WorkerModel[] = [FAUX]): Promise<{ test: TestSetup; client: TestClient; projectId: string }> {
	const test = await createSetup({ boardEditDebounceMs: 30 });
	cleanups.push(test.cleanup);
	const client = await connect(test.server);
	const added = await client.request({ type: "projects.add", path: test.projectDir });
	if (added.type !== "projects.add") throw errorOf(added);
	await configure(client, added.project.id, workerModels);
	return { test, client, projectId: added.project.id };
}

function input(title: string, extra: Partial<BoardTaskInput> = {}): BoardTaskInput {
	return { title, description: "", acceptance: null, status: "todo", blockedBy: [], blockedReason: null, writeScopes: [], ...extra };
}

async function save(client: TestClient, projectId: string, task: BoardTaskInput, existing?: { taskId: string; expectedRevision: number }): Promise<BoardTask> {
	const response = await client.request({ type: "board.task.save", projectId, task, ...(existing ?? {}) });
	if (response.type !== "board.task.save") throw errorOf(response);
	return response.task;
}

async function getBoard(client: TestClient, projectId: string): Promise<Board> {
	const response = await client.request({ type: "board.get", projectId, includeArchived: false });
	if (response.type !== "board.get") throw errorOf(response);
	return response.board;
}

async function taskOf(client: TestClient, projectId: string, id: string): Promise<BoardTask | undefined> {
	return (await getBoard(client, projectId)).tasks.find((task) => task.id === id);
}

function userTexts(view: ConversationView | undefined): string[] {
	return (view?.entries ?? []).filter((entry) => entry.kind === "pi.user").map((entry) => entryText(entry));
}

function toolResultTexts(view: ConversationView | undefined): string[] {
	return (view?.entries ?? []).filter((entry) => entry.kind === "pi.tool-result").map((entry) => entryText(entry));
}

function lastText(request: TranscriptContext): { role: string; text: string } {
	const last = request.messages.findLast((message) => message.role !== "system");
	const content = (last as { content?: unknown } | undefined)?.content;
	const text =
		typeof content === "string"
			? content
			: Array.isArray(content)
				? content.map((part: { type?: string; text?: string }) => (part.type === "text" ? (part.text ?? "") : "")).join("")
				: "";
	return { role: last?.role ?? "", text };
}

// --- the pure rules ----------------------------------------------------------------------------------------------

function boardWith(...titles: string[]): BoardState {
	const state = emptyBoardState();
	for (const title of titles) saveTask(state, { task: input(title), author: "coordinator", now: NOW });
	return state;
}

describe("harness moves", () => {
	it("moves a task for its worker once per key and leaves a settled task alone", () => {
		const state = boardWith("Ship it");
		const spawn = moveTaskForWorker(state, { key: "worker-spawn:c1", taskId: "T1", move: { kind: "spawned", workerId: "w" }, now: NOW });
		expect(spawn?.after).toMatchObject({ status: "in_progress", workerIds: ["w"], updatedBy: "harness", revision: 2 });
		// A rerun after a restart finds the key and changes nothing.
		expect(moveTaskForWorker(state, { key: "worker-spawn:c1", taskId: "T1", move: { kind: "spawned", workerId: "w" }, now: NOW })).toBeUndefined();
		expect(state.tasks[0]?.revision).toBe(2);

		moveTaskForWorker(state, { key: "worker-report:c1", taskId: "T1", move: { kind: "failed", workerId: "w", reason: "worker w failed: boom" }, now: NOW });
		expect(state.tasks[0]).toMatchObject({ status: "blocked", blockedReason: "worker w failed: boom", revision: 3 });
		moveTaskForWorker(state, { key: "worker-spawn:c2", taskId: "T1", move: { kind: "spawned", workerId: "w2" }, now: NOW });
		expect(state.tasks[0]).toMatchObject({ status: "in_progress", blockedReason: null, workerIds: ["w", "w2"], revision: 4 });

		saveTask(state, { taskId: "T1", expectedRevision: 4, task: input("Ship it", { status: "done" }), author: "user", now: NOW });
		expect(
			moveTaskForWorker(state, { key: "worker-report:c3", taskId: "T1", move: { kind: "failed", workerId: "w2", reason: "late" }, now: NOW }),
		).toBeUndefined();
		expect(state.tasks[0]?.status).toBe("done");
	});

	it("adds up the time a task spends in progress across spells, across a restart", () => {
		const state = emptyBoardState();
		const at = (minute: number): string => new Date(Date.parse(NOW) + minute * 60_000).toISOString();
		saveTask(state, { task: input("Ship it"), author: "coordinator", now: at(0) });
		expect(boardView(state, Date.parse(at(5)), false).tasks[0]?.inProgressMinutes).toBeUndefined();
		moveTaskForWorker(state, { key: "s1", taskId: "T1", move: { kind: "spawned", workerId: "w" }, now: at(0) });
		saveTask(state, { taskId: "T1", expectedRevision: 2, task: input("Ship it", { status: "review" }), author: "coordinator", now: at(20) });
		// Time in review does not count.
		expect(boardView(state, Date.parse(at(50)), false).tasks[0]?.inProgressMinutes).toBe(20);
		moveTaskForWorker(state, { key: "s2", taskId: "T1", move: { kind: "spawned", workerId: "w" }, now: at(50) });
		// The current spell counts up to now, read from the persisted start, so a restart loses nothing.
		const restarted = JSON.parse(JSON.stringify(state)) as BoardState;
		const task = boardView(restarted, Date.parse(at(62)), false).tasks[0]!;
		expect(task.inProgressMinutes).toBe(32);
		expect(describeTask(task)).toContain("| 32m in progress");
		const record = { id: "w", taskId: "T1" } as WorkerRecord;
		expect(workerTaskTime(restarted, record, Date.parse(at(55)))).toBe("task T1: 25m in progress");
		expect(workerTaskTime(restarted, { id: "x", taskId: null } as WorkerRecord, Date.parse(at(55)))).toBeUndefined();
		// A user's edit that keeps it in progress keeps the spell going; done stops the clock.
		saveTask(state, { taskId: "T1", expectedRevision: 4, task: input("Ship it", { status: "in_progress" }), author: "user", now: at(63) });
		saveTask(state, { taskId: "T1", expectedRevision: 5, task: input("Ship it", { status: "done" }), author: "user", now: at(70) });
		expect(boardView(state, Date.parse(at(90)), false).tasks[0]?.inProgressMinutes).toBe(40);
	});

	it("keeps one open task per schedule, updated by later failures, and opens a new one once it is done", () => {
		const state = emptyBoardState();
		const first = recordScheduleProblem(state, { key: "schedule-run:s@1", scheduleId: "s", title: "Nightly", reason: "failed: no model", now: NOW });
		expect(first?.after).toMatchObject({ id: "T1", status: "blocked", scheduleId: "s", createdBy: "harness", blockedReason: "failed: no model" });
		expect(recordScheduleProblem(state, { key: "schedule-run:s@1", scheduleId: "s", title: "Nightly", reason: "again", now: NOW })).toBeUndefined();
		recordScheduleProblem(state, { key: "schedule-run:s@2", scheduleId: "s", title: "Nightly", reason: "skipped: still running", now: NOW });
		expect(state.tasks).toHaveLength(1);
		expect(state.tasks[0]).toMatchObject({ revision: 2, blockedReason: "skipped: still running" });

		saveTask(state, { taskId: "T1", expectedRevision: 2, task: input("Nightly", { status: "done" }), author: "coordinator", now: NOW });
		recordScheduleProblem(state, { key: "schedule-run:s@3", scheduleId: "s", title: "Nightly", reason: "failed again", now: NOW });
		expect(state.tasks.map((task) => [task.id, task.status])).toEqual([["T1", "done"], ["T2", "blocked"]]);
	});

	it("names the tasks a done task leaves with every blocker done", () => {
		const state = boardWith("Base", "Other");
		saveTask(state, { task: input("After base", { blockedBy: ["T1"] }), author: "coordinator", now: NOW });
		saveTask(state, { task: input("After both", { blockedBy: ["T1", "T2"] }), author: "coordinator", now: NOW });
		const done = saveTask(state, { taskId: "T1", expectedRevision: 1, task: input("Base", { status: "done" }), author: "user", now: NOW });
		expect(unblockedBy(state, done).map((task) => task.id)).toEqual(["T3"]);
		// Another edit of a task that was already done unblocks nothing new.
		const again = saveTask(state, { taskId: "T1", expectedRevision: 2, task: input("Base!", { status: "done" }), author: "user", now: NOW });
		expect(unblockedBy(state, again)).toEqual([]);
	});

	it("treats write scopes as path prefixes", () => {
		expect(scopesOverlap(["packages/server"], ["packages/server/src/board.ts"])).toBe(true);
		expect(scopesOverlap(["./apps/web/"], ["apps/web"])).toBe(true);
		expect(scopesOverlap(["packages/server"], ["packages/serverless"])).toBe(false);
		expect(scopesOverlap(["."], ["anything"])).toBe(true);
		expect(scopesOverlap([], ["anything"])).toBe(false);
	});
});

describe("the board in a compaction summary", () => {
	const at = (minutes: number): string => new Date(Date.parse(NOW) + minutes * 60_000).toISOString();

	function busyBoard(todos: number): BoardState {
		const state = emptyBoardState();
		const add = (title: string, extra: Partial<BoardTaskInput>, minute: number): BoardTask =>
			saveTask(state, { task: input(title, extra), author: "coordinator", now: at(minute) }).after;
		add("Running task", { status: "in_progress", description: "The full description of the running task." }, 0);
		add("Reviewed task", { status: "review" }, 1);
		add("Stuck task", { status: "blocked", blockedReason: "waiting on CI" }, 2);
		add("Old done", { status: "done" }, -600);
		add("Fresh done", { status: "done" }, 3);
		add("Long gone", { status: "dropped" }, -30 * 24 * 60);
		for (let index = 1; index <= todos; index += 1) add(`Todo number ${index}`, {}, 10 + index);
		askQuestion(state, { text: "Which database?", options: ["sqlite", "postgres"], taskId: null, now: at(4) });
		for (let index = 1; index <= 12; index += 1) addDecision(state, { text: `Decision ${index}`, why: null, taskId: null, now: at(5) });
		return state;
	}

	it("carries active tasks and questions in full, the newest 20 todos, 10 decisions and what was done since", () => {
		const text = summaryBoardView(busyBoard(25), { now: Date.parse(at(60)), since: Date.parse(at(-60)), budgetTokens: 100_000 });
		expect(text).toContain("T1 r1 [in_progress] Running task");
		expect(text).toContain("The full description of the running task.");
		expect(text).toContain("[review] Reviewed task");
		expect(text).toContain("blocked: waiting on CI");
		expect(text).toContain("Q1 r1 [open] Which database? options: sqlite / postgres");
		expect(text).toContain("To do, newest first:\nT31 Todo number 25");
		expect(text).toContain("Todo number 6\n+5 more");
		expect(text).not.toContain("Todo number 5\n");
		expect(text).toContain("D12 Decision 12");
		expect(text).toContain("D3 Decision 3");
		expect(text).not.toContain("D2 Decision 2");
		expect(text).toContain("Done since the last summary:\nT5 Fresh done");
		expect(text).not.toContain("Old done");
		expect(text).not.toContain("Long gone");
		expect(text.endsWith("always available through the `board` tool (action `list`).")).toBe(true);
	});

	it("shrinks the todo list first, then the done list, and never cuts active tasks or questions", () => {
		const state = busyBoard(25);
		for (let index = 1; index <= 30; index += 1) {
			saveTask(state, { task: input(`Finished piece ${index} with a fairly long title to take room`, { status: "done" }), author: "coordinator", now: at(6) });
		}
		const full = summaryBoardView(state, { now: Date.parse(at(60)), since: null, budgetTokens: 100_000 });
		const tight = summaryBoardView(state, { now: Date.parse(at(60)), since: null, budgetTokens: 600 });
		expect(full).toContain("Todo number 25");
		expect(tight.length).toBeLessThan(full.length);
		// The todo list goes first: none left, only the count.
		expect(tight).toContain("To do, newest first:\n+25 more");
		// Then the done list, from its oldest.
		expect(tight).toMatch(/Done since the last summary:\n[\s\S]*\+\d+ more/);
		expect(tight).toContain("Running task");
		expect(tight).toContain("Stuck task");
		expect(tight).toContain("Which database?");
		// At any budget, a todo line shows only once every done line is back; the default budget holds.
		for (let budget = 300; budget <= 3_000; budget += 50) {
			const text = summaryBoardView(state, { now: Date.parse(at(60)), since: null, budgetTokens: budget });
			if (/\nT\d+ Todo number/.test(text)) expect(text).not.toMatch(/Done since the last summary:[\s\S]*\+\d+ more/);
			expect(text).toContain("Running task");
		}
		expect(estimateTextTokens(summaryBoardView(state, { now: Date.parse(at(60)), since: null }))).toBeLessThanOrEqual(1_500);
	});

	it("says so when the board is empty", () => {
		const text = summaryBoardView(undefined, { now: Date.parse(NOW), since: null });
		expect(text).toContain("Active tasks: none");
		expect(text).toContain("Open questions: none");
		expect(text).toContain("`board` tool");
	});
});

// --- the harness at work -----------------------------------------------------------------------------------------

describe("workers on the board", () => {
	it("moves a task to in_progress on spawn once across a restart, and leaves it there on the report", async () => {
		const { test, client, projectId } = await start();
		await save(client, projectId, input("Read the README"));
		let asked = 0;
		let release: () => void = () => undefined;
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		test.faux.setResponses(
			Array.from({ length: 60 }, () => async (request: TranscriptContext, options: { signal?: AbortSignal } | undefined) => {
				const { role, text } = lastText(request);
				if (role === "toolResult") return fauxAssistantMessage("Tool call finished.");
				if (text === BRIEF) {
					asked += 1;
					if (asked === 1) {
						await new Promise<void>((resolve) => {
							options?.signal?.addEventListener("abort", () => resolve(), { once: true });
							held.then(resolve);
						});
						return fauxAssistantMessage("interrupted");
					}
					return fauxAssistantMessage("## Report\nOutcome: done");
				}
				if (text.includes("Delegate")) {
					return fauxAssistantMessage([fauxToolCall("worker_spawn", { id: "reader", task: BRIEF, taskId: "T1" })], { stopReason: "toolUse" });
				}
				return fauxAssistantMessage("Nothing to do.");
			}),
		);
		await client.request({ type: "conversation.submit", projectId, requestId: "r1", content: "Delegate the reading." });
		await until(async () => (await taskOf(client, projectId, "T1"))?.status === "in_progress");
		expect(await taskOf(client, projectId, "T1")).toMatchObject({ revision: 2, workerIds: ["reader"], updatedBy: "harness" });
		await until(() => asked > 0);

		// The process dies while the worker works; its report after the restart does not move the task: the coordinator does.
		const restarted = await test.restart();
		release();
		const next = await connect(restarted);
		await until(async () => {
			const workers = await next.request({ type: "workers.list", projectId });
			return workers.type === "workers.list" && workers.workers.some((worker) => worker.id === "reader" && worker.status === "idle");
		}, 30_000);
		expect(await taskOf(next, projectId, "T1")).toMatchObject({ status: "in_progress", revision: 2, workerIds: ["reader"] });

		// Another restart reruns nothing that moves it again, and the spawn's status change was saved as one snapshot.
		const again = await connect(await test.restart());
		await new Promise((resolve) => setTimeout(resolve, 300));
		expect(await taskOf(again, projectId, "T1")).toMatchObject({ status: "in_progress", revision: 2, workerIds: ["reader"], snapshots: 1 });
	}, 60_000);

	it("refuses an unknown task without starting a worker", async () => {
		const { test, client, projectId } = await start();
		test.faux.setResponses([
			() => fauxAssistantMessage([fauxToolCall("worker_spawn", { id: "reader", task: BRIEF, taskId: "T9" })], { stopReason: "toolUse" }),
			() => fauxAssistantMessage("finished"),
		]);
		const view = new ViewClient(client);
		await view.start(projectId);
		await client.request({ type: "conversation.submit", projectId, requestId: "r1", content: "Go." });
		const done = await view.waitForView((value) => userTexts(value).length > 0 && toolResultTexts(value).length > 0);
		expect(toolResultTexts(done)[0]).toContain("unknown_task");
		const workers = await client.request({ type: "workers.list", projectId });
		if (workers.type !== "workers.list") throw errorOf(workers);
		expect(workers.workers).toHaveLength(0);
	}, 30_000);

	it("warns when a shared worker's write scopes overlap a running shared worker's, never a workspace one's", async () => {
		const { test, client, projectId } = await start();
		await save(client, projectId, input("Server", { writeScopes: ["packages/server"] }));
		await save(client, projectId, input("Board", { writeScopes: ["packages/server/src/board.ts"] }));
		await save(client, projectId, input("Web", { writeScopes: ["apps/web"] }));
		await save(client, projectId, input("Web page", { writeScopes: ["apps/web/src"] }));
		// Two workers already running: a shared one on T1 and a workspace one on T3.
		const { runtime } = await test.server.manager.open(projectId);
		await runtime.harness.commit(async (tx) => {
			const state = (await tx.doc(WorkersDoc, runtime.conversation.id)) as WorkersState;
			const record = (id: string, isolation: "shared" | "workspace", taskId: string) => ({
				id,
				title: id,
				conversationId: 999,
				isolation,
				workspacePath: isolation === "workspace" ? `/tmp/${id}` : null,
				model: FAUX,
				thinkingLevel: null,
				status: "running" as const,
				taskId,
				spawnedByCallId: null,
				createdAt: NOW,
				updatedAt: NOW,
				lastReport: null,
				failure: null,
				anchorTaskId: 1,
			});
			state.workers.busy = record("busy", "shared", "T1");
			state.workers.apart = record("apart", "workspace", "T3");
		}, BACKGROUND_CONTEXT);
		test.faux.setResponses(
			Array.from({ length: 30 }, () => (request: TranscriptContext) => {
				const { role, text } = lastText(request);
				if (text.startsWith("Brief")) return fauxAssistantMessage("## Report\nOutcome: done");
				if (role === "toolResult") return fauxAssistantMessage("Tool call finished.");
				if (text === "Go.") {
					return fauxAssistantMessage(
						[
							fauxToolCall("worker_spawn", { id: "b", task: "Brief b", taskId: "T2" }),
							fauxToolCall("worker_spawn", { id: "c", task: "Brief c", taskId: "T4" }),
						],
						{ stopReason: "toolUse" },
					);
				}
				return fauxAssistantMessage("Nothing to do.");
			}),
		);
		const view = new ViewClient(client);
		await view.start(projectId);
		await client.request({ type: "conversation.submit", projectId, requestId: "r1", content: "Go." });
		const done = await view.waitForView((value) => toolResultTexts(value).length >= 2);
		const [b, c] = toolResultTexts(done);
		expect(b).toContain('Started worker "b"');
		expect(b).toContain("Warning: T2's write scopes (packages/server/src/board.ts) overlap T1's (packages/server)");
		expect(b).toContain('shared worker "busy"');
		expect(c).toContain('Started worker "c"');
		expect(c).not.toContain("Warning");
	}, 30_000);
});

describe("the unblocked-task notice", () => {
	it("tells the coordinator once which tasks a done task unblocked", async () => {
		const { test, client, projectId } = await start();
		test.faux.setResponses(Array.from({ length: 30 }, () => () => fauxAssistantMessage("Noted.")));
		const base = await save(client, projectId, input("Base"));
		const other = await save(client, projectId, input("Other"));
		await save(client, projectId, input("After base", { blockedBy: ["T1"] }));
		await save(client, projectId, input("After both", { blockedBy: ["T1", "T2"] }));
		const view = new ViewClient(client);
		await view.start(projectId);
		const doneBase = await save(client, projectId, input("Base", { status: "done" }), { taskId: base.id, expectedRevision: base.revision });
		await save(client, projectId, input("Base, renamed", { status: "done" }), { taskId: base.id, expectedRevision: doneBase.revision });
		const notices = (value: ConversationView | undefined) => userTexts(value).filter((text) => text.includes("blockers done"));
		await view.waitForView((value) => notices(value).length > 0);
		await new Promise((resolve) => setTimeout(resolve, 200));
		expect(notices(view.view)).toEqual(['[board] T1 "Base" is done, so T3 "After base" has all its blockers done and can start.']);

		await save(client, projectId, input("Other", { status: "done" }), { taskId: other.id, expectedRevision: other.revision });
		await view.waitForView((value) => notices(value).length > 1);
		expect(notices(view.view)[1]).toContain('T4 "After both" has all its blockers done');
		// The harness never starts a worker by itself.
		const workers = await client.request({ type: "workers.list", projectId });
		if (workers.type !== "workers.list") throw errorOf(workers);
		expect(workers.workers).toHaveLength(0);
		void test;
	}, 30_000);
});

describe("schedules on the board", () => {
	it("opens one blocked task for a failing schedule, updates it, and adds nothing for a success", async () => {
		const { test, client, projectId } = await start([]);
		test.faux.setResponses(
			Array.from({ length: 30 }, () => (request: TranscriptContext) =>
				lastText(request).text === BRIEF ? fauxAssistantMessage("## Report\nOutcome: done") : fauxAssistantMessage("Noted."),
			),
		);
		const saved = await client.request({
			type: "schedules.save",
			projectId,
			schedule: {
				title: "Nightly check",
				brief: BRIEF,
				spec: { kind: "daily", time: "03:30" },
				model: null,
				thinkingLevel: null,
				isolation: "shared",
				onReport: "record",
				enabled: true,
			},
		});
		if (saved.type !== "schedules.save") throw errorOf(saved);
		const scheduleId = saved.schedule.id;
		const run = async (): Promise<void> => {
			const response = await client.request({ type: "schedules.run", projectId, scheduleId });
			if (response.type !== "schedules.run") throw errorOf(response);
			// Two manual runs within one clock tick would share a slot.
			await new Promise((resolve) => setTimeout(resolve, 5));
		};
		await run();
		await run();
		let board = await getBoard(client, projectId);
		expect(board.tasks).toHaveLength(1);
		expect(board.tasks[0]).toMatchObject({ status: "blocked", scheduleId, createdBy: "harness", revision: 3 });
		expect(board.tasks[0]?.title).toBe("Scheduled: Nightly check");
		expect(board.tasks[0]?.blockedReason).toContain("No worker model is set");

		// Once it is done, the next failure opens a new task.
		await save(client, projectId, input(board.tasks[0]!.title, { status: "done" }), { taskId: "T1", expectedRevision: 3 });
		await run();
		board = await getBoard(client, projectId);
		expect(board.tasks.map((task) => [task.id, task.status])).toEqual([["T1", "done"], ["T2", "blocked"]]);

		// A run that starts adds nothing.
		await configure(client, projectId, [FAUX]);
		await run();
		expect((await getBoard(client, projectId)).tasks).toHaveLength(2);
	}, 30_000);
});

