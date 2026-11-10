import { afterEach, describe, expect, it } from "bun:test";
import type { JsonObject } from "@earendil-works/pi-durable";
import { fauxAssistantMessage, fauxToolCall, type FauxResponseFactory } from "@earendil-works/pi-ai/providers/faux";
import type { Board, BoardTask, BoardTaskInput, ModelRef, ProjectSummary } from "@aiki/protocol";
import { ARCHIVE_AFTER_MS, boardView, emptyBoardState, normalizeBoard, saveTask } from "../src/board.ts";
import { createSetup, entryText, errorOf, TestClient, ViewClient, type TestSetup } from "./support.ts";

const cleanups: (() => Promise<void>)[] = [];
const clients: TestClient[] = [];
const FAUX: ModelRef = { provider: "faux", modelId: "faux-1" };
const START = Date.UTC(2026, 10, 5, 12, 0, 0);

afterEach(async () => {
	for (const client of clients.splice(0)) client.close();
	for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function until(check: () => boolean | Promise<boolean>, timeoutMs = 10_000): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		if (await check()) return;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	throw new Error("timed out waiting for a condition");
}

async function start(options?: Parameters<typeof createSetup>[0]): Promise<{ test: TestSetup; client: TestClient; projectId: string }> {
	const test = await createSetup({ boardEditDebounceMs: 60, ...options });
	cleanups.push(test.cleanup);
	const client = await TestClient.open(test.server);
	clients.push(client);
	await client.hello();
	const added = await client.request({ type: "projects.add", path: test.projectDir });
	if (added.type !== "projects.add") throw errorOf(added);
	const configured = await client.request({
		type: "projects.configure",
		projectId: added.project.id,
		coordinatorModel: FAUX,
		coordinatorThinkingLevel: "low",
	});
	if (configured.type !== "projects.configure") throw errorOf(configured);
	return { test, client, projectId: added.project.id };
}

function input(title: string, extra: Partial<BoardTaskInput> = {}): BoardTaskInput {
	return { title, description: "", acceptance: null, status: "todo", blockedBy: [], blockedReason: null, writeScopes: [], ...extra };
}

async function save(
	client: TestClient,
	projectId: string,
	task: BoardTaskInput,
	existing?: { taskId: string; expectedRevision: number },
): Promise<BoardTask> {
	const response = await client.request({ type: "board.task.save", projectId, task, ...(existing ?? {}) });
	if (response.type !== "board.task.save") throw errorOf(response);
	return response.task;
}

async function getBoard(client: TestClient, projectId: string, includeArchived = false): Promise<Board> {
	const response = await client.request({ type: "board.get", projectId, includeArchived });
	if (response.type !== "board.get") throw errorOf(response);
	return response.board;
}

async function summary(client: TestClient, projectId: string): Promise<ProjectSummary> {
	const list = await client.request({ type: "projects.list" });
	if (list.type !== "projects.list") throw errorOf(list);
	return list.projects.find((project) => project.id === projectId) as ProjectSummary;
}

function boardInputs(view: { entries: { kind: string; model?: unknown }[] } | undefined): string[] {
	return (view?.entries ?? [])
		.filter((entry) => entry.kind === "pi.user")
		.map((entry) => entryText(entry as never))
		.filter((text) => text.startsWith("[board]"));
}

describe("board rows", () => {
	it("refuses a stale revision with board_conflict and keeps the newer edit", async () => {
		const { client, projectId } = await start();
		const created = await save(client, projectId, input("First"));
		expect(created).toMatchObject({ id: "T1", revision: 1, status: "todo", createdBy: "user" });

		const updated = await save(client, projectId, input("First, renamed"), { taskId: "T1", expectedRevision: 1 });
		expect(updated.revision).toBe(2);

		const stale = await client.request({
			type: "board.task.save",
			projectId,
			taskId: "T1",
			expectedRevision: 1,
			task: input("Overwrite"),
		});
		expect(errorOf(stale).code).toBe("board_conflict");
		expect((await getBoard(client, projectId)).tasks[0]?.title).toBe("First, renamed");
	});

	it("refuses unknown blockers and dependency cycles", async () => {
		const { client, projectId } = await start();
		await save(client, projectId, input("A"));
		await save(client, projectId, input("B", { blockedBy: ["T1"] }));

		const unknown = await client.request({
			type: "board.task.save",
			projectId,
			task: input("C", { blockedBy: ["T99"] }),
		});
		expect(errorOf(unknown).code).toBe("unknown_task");

		const cycle = await client.request({
			type: "board.task.save",
			projectId,
			taskId: "T1",
			expectedRevision: 1,
			task: input("A", { blockedBy: ["T2"] }),
		});
		expect(errorOf(cycle).code).toBe("bad_request");
		const self = await client.request({
			type: "board.task.save",
			projectId,
			taskId: "T1",
			expectedRevision: 1,
			task: input("A", { blockedBy: ["T1"] }),
		});
		expect(errorOf(self).code).toBe("bad_request");
		const board = await getBoard(client, projectId);
		expect(board.tasks.map((task) => [task.id, task.revision])).toEqual([["T1", 1], ["T2", 1]]);
	});

	it("keeps refs trimmed and once each, and leaves them alone when a save leaves them out", async () => {
		const { client, projectId } = await start();
		const created = await save(client, projectId, input("Complete the example change", { refs: [" EX-1234 ", "#1234", "", "#1234"] }));
		expect(created.refs).toEqual(["EX-1234", "#1234"]);

		// An app that does not know refs (the Android app) saves without them.
		const { refs: _, ...withoutRefs } = input("Complete the example change, renamed");
		const renamed = await save(client, projectId, withoutRefs, { taskId: "T1", expectedRevision: 1 });
		expect(renamed.refs).toEqual(["EX-1234", "#1234"]);

		const cleared = await save(client, projectId, input("Complete the example change", { refs: [] }), { taskId: "T1", expectedRevision: 2 });
		expect(cleared.refs).toEqual([]);
		expect((await getBoard(client, projectId)).tasks[0]?.refs).toEqual([]);
	});

	it("reads tasks saved before refs with none", () => {
		const state = emptyBoardState();
		saveTask(state, { task: input("Old"), author: "user", now: new Date(START).toISOString() });
		delete (state.tasks[0] as Partial<BoardTask>).refs;
		expect(boardView(state, START, false).tasks[0]?.refs).toEqual([]);
		expect(normalizeBoard(state).tasks[0]?.refs).toEqual([]);
	});

	it("reorders the named tasks first and refuses an unknown one", async () => {
		const { client, projectId } = await start();
		for (const title of ["A", "B", "C"]) await save(client, projectId, input(title));
		const reordered = await client.request({ type: "board.tasks.reorder", projectId, taskIds: ["T3"] });
		expect(reordered.type).toBe("board.tasks.reorder");
		expect((await getBoard(client, projectId)).tasks.map((task) => task.id)).toEqual(["T3", "T1", "T2"]);
		const unknown = await client.request({ type: "board.tasks.reorder", projectId, taskIds: ["T9"] });
		expect(errorOf(unknown).code).toBe("unknown_task");
	});

	it("archives done and dropped tasks 7 days after they settle, and shows them only when asked", async () => {
		let now = START;
		const { client, projectId } = await start({ now: () => now });
		await save(client, projectId, input("Finished", { status: "done" }));
		await save(client, projectId, input("Open"));
		const settled = (await getBoard(client, projectId)).tasks.find((task) => task.id === "T1");
		expect(settled).toMatchObject({ status: "done", settledAt: new Date(START).toISOString(), archived: false });

		now = START + ARCHIVE_AFTER_MS - 1000;
		expect((await getBoard(client, projectId)).tasks.map((task) => task.id)).toEqual(["T1", "T2"]);

		now = START + ARCHIVE_AFTER_MS + 1000;
		expect((await getBoard(client, projectId)).tasks.map((task) => task.id)).toEqual(["T2"]);
		const all = await getBoard(client, projectId, true);
		expect(all.tasks.map((task) => [task.id, task.archived])).toEqual([["T1", true], ["T2", false]]);
	});
});

describe("board and the coordinator", () => {
	it("tells the coordinator about the user's edits as one coalesced [board] input", async () => {
		const { test, client, projectId } = await start();
		test.faux.setResponses(Array.from({ length: 5 }, () => fauxAssistantMessage("noted")));
		const view = new ViewClient(client);
		await view.start(projectId);

		const first = await save(client, projectId, input("Write docs"));
		await save(client, projectId, input("Fix bug"));
		await save(client, projectId, input("Write docs, properly", { status: "in_progress" }), {
			taskId: first.id,
			expectedRevision: first.revision,
		});

		await view.waitForView((value) => boardInputs(value).length >= 1);
		await new Promise((resolve) => setTimeout(resolve, 250));
		const inputs = boardInputs(view.view);
		expect(inputs).toHaveLength(1);
		expect(inputs[0]).toContain("T1 added");
		expect(inputs[0]).toContain("[in_progress]");
		expect(inputs[0]).toContain("T2 added");
	});

	it("passes the user's reason for a move on with the change, and the to-do order", async () => {
		const { test, client, projectId } = await start();
		test.faux.setResponses(Array.from({ length: 5 }, () => fauxAssistantMessage("noted")));
		const view = new ViewClient(client);
		await view.start(projectId);

		const task = await save(client, projectId, input("Fix login", { status: "review" }));
		await save(client, projectId, input("Write docs"));
		await view.waitForView((value) => boardInputs(value).length >= 1);

		const moved = await client.request({
			type: "board.task.save",
			projectId,
			taskId: task.id,
			expectedRevision: task.revision,
			task: input("Fix login", { status: "in_progress" }),
			note: "  The tests still fail on Safari  ",
		});
		if (moved.type !== "board.task.save") throw errorOf(moved);
		const reordered = await client.request({ type: "board.tasks.reorder", projectId, taskIds: ["T2", "T1"] });
		expect(reordered.type).toBe("board.tasks.reorder");

		await view.waitForView((value) => boardInputs(value).length >= 2);
		const last = boardInputs(view.view)[1] ?? "";
		expect(last).toContain('T1 "Fix login" (r2): status "review" -> "in_progress"; the user says: "The tests still fail on Safari"');
		expect(last).toContain("order: T2, T1 first");
	});

	it("delivers an answer to a busy coordinator as a steer and keeps openQuestions current", async () => {
		const { test, client, projectId } = await start();
		const sawAnswer: boolean[] = [];
		const asked: FauxResponseFactory = () =>
			fauxAssistantMessage([fauxToolCall("board", { action: "ask", text: "Which database?", options: ["sqlite", "postgres"] })], {
				stopReason: "toolUse",
			});
		const slow: FauxResponseFactory = () =>
			fauxAssistantMessage([fauxToolCall("bash", { command: "sleep 0.6 && echo done" })], { stopReason: "toolUse" });
		const check: FauxResponseFactory = (request) => {
			const text = JSON.stringify(request.messages);
			sawAnswer.push(text.includes("[board] The user answered Q1") && text.includes("postgres"));
			return fauxAssistantMessage("ok, postgres");
		};
		test.faux.setResponses([asked, () => fauxAssistantMessage("asked"), slow, check]);
		const view = new ViewClient(client);
		await view.start(projectId);

		const first = await client.request({ type: "conversation.submit", projectId, requestId: "r1", content: "Plan it." });
		expect(first.type).toBe("conversation.submit");
		await until(async () => (await getBoard(client, projectId)).questions.length === 1);
		await view.waitForView((value) => value.entries.some((entry) => entryText(entry) === "asked"));
		await until(async () => (await summary(client, projectId)).activity?.openQuestions === 1);

		const second = await client.request({ type: "conversation.submit", projectId, requestId: "r2", content: "Do the slow thing." });
		expect(second.type).toBe("conversation.submit");
		await new Promise((resolve) => setTimeout(resolve, 200));

		const question = (await getBoard(client, projectId)).questions[0]!;
		expect(question).toMatchObject({ id: "Q1", status: "open", options: ["sqlite", "postgres"] });
		const stale = await client.request({
			type: "board.question.answer",
			projectId,
			questionId: "Q1",
			expectedRevision: 9,
			answer: "postgres",
		});
		expect(errorOf(stale).code).toBe("board_conflict");

		const answered = await client.request({
			type: "board.question.answer",
			projectId,
			questionId: "Q1",
			expectedRevision: question.revision,
			answer: "postgres",
		});
		if (answered.type !== "board.question.answer") throw errorOf(answered);
		expect(answered.question).toMatchObject({ status: "answered", answer: "postgres" });

		await view.waitForView((value) => value.entries.some((entry) => entryText(entry) === "ok, postgres"));
		expect(sawAnswer).toEqual([true]);
		await until(async () => (await summary(client, projectId)).activity?.openQuestions === 0);
	});

	it("lets the coordinator add and update tasks with the board tool", async () => {
		const { test, client, projectId } = await start();
		const call = (args: JsonObject): FauxResponseFactory => () =>
			fauxAssistantMessage([fauxToolCall("board", args)], { stopReason: "toolUse" });
		const outputs: string[] = [];
		const capture = (args: JsonObject): FauxResponseFactory => (request) => {
			outputs.push(JSON.stringify(request.messages.at(-1)));
			return fauxAssistantMessage([fauxToolCall("board", args)], { stopReason: "toolUse" });
		};
		const finish: FauxResponseFactory = (request) => {
			outputs.push(JSON.stringify(request.messages.at(-1)));
			return fauxAssistantMessage("finished");
		};
		test.faux.setResponses([
			call({ action: "add_task", title: "Ship it" }),
			call({ action: "update_task", id: "T1", expectedRevision: 1, status: "in_progress" }),
			call({ action: "update_task", id: "T1", expectedRevision: 1, status: "review" }),
			capture({ action: "update_task", id: "T1", expectedRevision: 2, status: "done" }),
			capture({ action: "drop_task", id: "T1", expectedRevision: 2 }),
			capture({ action: "list" }),
			finish,
		]);
		const view = new ViewClient(client);
		await view.start(projectId);
		await client.request({ type: "conversation.submit", projectId, requestId: "r1", content: "Go." });
		await view.waitForView((value) => value.entries.some((entry) => entryText(entry) === "finished"));

		expect(outputs[0]).toContain("changed since you read it");
		// Only the user closes a task.
		expect(outputs[1]).toContain("Only the user closes a task");
		expect(outputs[2]).toContain("Only the user closes a task");
		expect(outputs[3]).toContain("T1 r2 [in_progress] Ship it | 0m in progress");
		const board = await getBoard(client, projectId);
		expect(board.tasks[0]).toMatchObject({
			id: "T1",
			status: "in_progress",
			inProgressMinutes: 0,
			updatedBy: "coordinator",
			createdBy: "coordinator",
		});
	});

	it("lets the coordinator set a task's refs with add_task and update_task", async () => {
		const { test, client, projectId } = await start();
		const call = (args: JsonObject): FauxResponseFactory => () =>
			fauxAssistantMessage([fauxToolCall("board", args)], { stopReason: "toolUse" });
		let listed = "";
		test.faux.setResponses([
			call({ action: "add_task", title: "Complete the example change", refs: ["#1234"] }),
			call({ action: "update_task", id: "T1", expectedRevision: 1, refs: ["#1234", "#1250"] }),
			call({ action: "update_task", id: "T1", expectedRevision: 2, status: "in_progress" }),
			call({ action: "list" }),
			(request) => {
				listed = JSON.stringify(request.messages.at(-1));
				return fauxAssistantMessage("finished");
			},
		]);
		const view = new ViewClient(client);
		await view.start(projectId);
		await client.request({ type: "conversation.submit", projectId, requestId: "r1", content: "Go." });
		await view.waitForView((value) => value.entries.some((entry) => entryText(entry) === "finished"));

		expect((await getBoard(client, projectId)).tasks[0]).toMatchObject({ status: "in_progress", refs: ["#1234", "#1250"] });
		expect(listed).toContain("T1 r3 [in_progress] Complete the example change | refs #1234,#1250");
	});
});
