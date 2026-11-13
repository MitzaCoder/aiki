/**
 * Task links, feedback entries and the task timeline: the pure rules on board state, then the board tool, a user's
 * message about a task (in main and in a background thread) and a restart against a real server.
 */
import { afterEach, describe, expect, it } from "bun:test";
import type { TranscriptContext } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import type { JsonObject } from "@earendil-works/pi-durable";
import type { Board, BoardFeedback, BoardTask, BoardTaskInput, ModelRef } from "@kemiri/protocol";
import {
	type BoardState,
	type TaskHistoryState,
	HARNESS_WRITER,
	USER_WRITER,
	addSnapshot,
	addTimelineEvent,
	askQuestion,
	addDecision,
	boardView,
	buildTimeline,
	changeLink,
	coordinatorWriter,
	describeTask,
	describeTaskInFull,
	emptyBoardState,
	normalizeBoard,
	recordFeedback,
	saveTask,
	setFeedbackState,
	settleQuestion,
	sortFeedback,
	withTaskReference,
} from "../src/board.ts";
import { splitTaskReference } from "../src/queued-inputs.ts";
import { createSetup, entryText, errorOf, TestClient, ViewClient, type TestSetup } from "./support.ts";

const T0 = "2026-11-09T10:00:00.000Z";
const at = (minutes: number): string => new Date(Date.parse(T0) + minutes * 60_000).toISOString();
const FAUX: ModelRef = { provider: "faux", modelId: "faux-1" };

const cleanups: (() => Promise<void>)[] = [];
const clients: TestClient[] = [];

afterEach(async () => {
	for (const client of clients.splice(0)) client.close();
	for (const cleanup of cleanups.splice(0)) await cleanup();
});

function input(title: string, extra: Partial<BoardTaskInput> = {}): BoardTaskInput {
	return { title, description: "", acceptance: null, status: "todo", blockedBy: [], blockedReason: null, writeScopes: [], ...extra };
}

/** A board with `titles` as T1, T2, ... */
function boardOf(...titles: string[]): BoardState {
	const state = emptyBoardState();
	for (const title of titles) saveTask(state, { task: input(title), author: "coordinator", now: T0 });
	return state;
}

function task(state: BoardState, id: string): BoardTask {
	return state.tasks.find((candidate) => candidate.id === id) as BoardTask;
}

function viewOf(state: BoardState, includeArchived = false): Board {
	return boardView(state, Date.parse(T0), includeArchived);
}

function link(state: BoardState, taskId: string, kind: Parameters<typeof changeLink>[1]["link"], to: string | undefined, remove = false) {
	return changeLink(state, { taskId, link: kind, to, remove, now: T0 });
}

describe("task links", () => {
	it("gives a task one parent and shows both sides, with progress", () => {
		const state = boardOf("Big", "Piece a", "Piece b", "Piece c");
		for (const id of ["T2", "T3", "T4"]) link(state, id, "parent", "T1");
		state.tasks[1]!.status = "done";
		state.tasks[2]!.status = "dropped";
		const board = viewOf(state);
		const parent = board.tasks.find((candidate) => candidate.id === "T1") as BoardTask;
		expect(parent.subtasks).toEqual(["T2", "T3", "T4"]);
		// A dropped subtask will not be done, so the progress leaves it out.
		expect(parent.subtaskCount).toEqual({ total: 2, done: 1 });
		expect(board.tasks.find((candidate) => candidate.id === "T2")?.parent).toBe("T1");
		expect(describeTask(parent)).toContain("3 subtasks (1 done)");
		expect(describeTask(board.tasks[1] as BoardTask)).toContain("↳T1");

		expect(() => link(state, "T2", "parent", "T4")).toThrow("already");
		expect(() => link(state, "T2", "parent", "T2")).toThrow("itself");
		expect(() => link(state, "T2", "parent", "T9")).toThrow("No task");
	});

	it("refuses subtask cycles, through any depth, but not links that only look alike", () => {
		const state = boardOf("A", "B", "C");
		link(state, "T2", "parent", "T1");
		link(state, "T3", "parent", "T2");
		expect(() => link(state, "T1", "parent", "T3")).toThrow("cycle");
		expect(() => link(state, "T1", "parent", "T2")).toThrow("cycle");
		// Through a full save too.
		const bad = (): unknown => saveTask(state, { taskId: "T1", expectedRevision: 1, task: input("A", { parent: "T3" }), author: "user", now: T0 });
		expect(bad).toThrow("cycle");
		expect(task(state, "T1").parent).toBeNull();
		// Moving a subtask is a change of parent, and a null clears it.
		saveTask(state, { taskId: "T3", expectedRevision: 1, task: input("C", { parent: "T1" }), author: "user", now: T0 });
		expect(task(state, "T3").parent).toBe("T1");
		saveTask(state, { taskId: "T3", expectedRevision: 2, task: input("C", { parent: null }), author: "user", now: T0 });
		expect(task(state, "T3").parent).toBeNull();
		// Left out, it stays.
		saveTask(state, { taskId: "T2", expectedRevision: 1, task: input("B2"), author: "user", now: T0 });
		expect(task(state, "T2").parent).toBe("T1");
	});

	it("keeps one origin per task, shows led to, and refuses origin cycles", () => {
		const state = boardOf("Build it", "Bug", "Analysis");
		link(state, "T2", "foundWhile", "T1");
		link(state, "T3", "foundWhile", "T1");
		expect(() => link(state, "T2", "foundWhile", "T3")).toThrow("at most one");
		expect(() => link(state, "T1", "foundWhile", "T2")).toThrow("found through");
		const board = viewOf(state);
		expect(board.tasks[0]?.ledTo).toEqual(["T2", "T3"]);
		expect(describeTask(board.tasks[0] as BoardTask)).toContain("led to T2,T3");
		expect(describeTask(board.tasks[1] as BoardTask)).toContain("found while T1");
		link(state, "T2", "foundWhile", undefined, true);
		expect(task(state, "T2").foundWhile).toBeNull();
	});

	it("keeps related symmetric and blockedBy as it was", () => {
		const state = boardOf("A", "B", "C");
		link(state, "T1", "related", "T2");
		link(state, "T3", "related", "T1");
		expect(task(state, "T2").related).toEqual(["T1"]);
		expect(task(state, "T1").related).toEqual(["T2", "T3"]);
		// Replacing the list from one side updates the others.
		saveTask(state, { taskId: "T1", expectedRevision: 1, task: input("A", { related: ["T3"] }), author: "user", now: T0 });
		expect(task(state, "T2").related).toEqual([]);
		expect(task(state, "T3").related).toEqual(["T1"]);
		link(state, "T1", "related", "T3", true);
		expect(task(state, "T3").related).toEqual([]);
		// A link bumps no revision: the user's edit of the task does not conflict with it.
		expect(task(state, "T3").revision).toBe(1);

		link(state, "T2", "blockedBy", "T1");
		expect(() => link(state, "T1", "blockedBy", "T2")).toThrow("cycle");
		const board = viewOf(state);
		expect(board.tasks[0]?.blocks).toEqual(["T2"]);
		expect(describeTask(board.tasks[0] as BoardTask)).toContain("blocks T2");
		expect(describeTask(board.tasks[1] as BoardTask)).toContain("after T1");
	});

	it("can create a task with its links in one save", () => {
		const state = boardOf("Origin", "Other");
		const created = saveTask(state, {
			task: input("Found", { foundWhile: "T1", parent: "T2", related: ["T1"] }),
			author: "coordinator",
			now: T0,
		}).after;
		expect(created).toMatchObject({ id: "T3", foundWhile: "T1", parent: "T2", related: ["T1"] });
		expect(task(state, "T1").related).toEqual(["T3"]);
		expect(() => saveTask(state, { task: input("Bad", { parent: "T9" }), author: "coordinator", now: T0 })).toThrow("No task");
		expect(state.tasks).toHaveLength(3);
	});

	it("keeps links to closed and archived tasks, which the board view still names", () => {
		const state = boardOf("Parent", "Old child", "Origin");
		link(state, "T2", "parent", "T1");
		link(state, "T1", "foundWhile", "T3");
		link(state, "T1", "related", "T2");
		Object.assign(task(state, "T2"), { status: "done", settledAt: at(0) });
		Object.assign(task(state, "T3"), { status: "dropped", settledAt: at(0) });
		// 8 days later both are archived: the live view leaves them out, yet the links stay and name them.
		const later = Date.parse(T0) + 8 * 24 * 60 * 60 * 1000;
		const board = boardView(state, later, false);
		expect(board.tasks.map((candidate) => candidate.id)).toEqual(["T1"]);
		expect(board.tasks[0]).toMatchObject({ subtasks: ["T2"], foundWhile: "T3", related: ["T2"], subtaskCount: { total: 1, done: 1 } });
		expect(board.archivedLinks).toEqual([
			{ id: "T2", title: "Old child", status: "done", archived: true },
			{ id: "T3", title: "Origin", status: "dropped", archived: true },
		]);
		// With the archive included they are tasks and nothing is left to name.
		expect(boardView(state, later, true).archivedLinks).toBeUndefined();
		// A new link to a closed task is allowed.
		const fresh = saveTask(state, { task: input("New", { foundWhile: "T3", parent: "T2" }), author: "coordinator", now: T0 }).after;
		expect(fresh).toMatchObject({ foundWhile: "T3", parent: "T2" });
		const full = describeTaskInFull(board.tasks[0] as BoardTask, board, []);
		expect(full).toContain("has subtasks: T2 [done] Old child (archived)");
		expect(full).toContain("found while working on: T3 [dropped] Origin (archived)");
	});

	it("loads a board written before links and feedback", () => {
		const state = boardOf("Old");
		const old = JSON.parse(JSON.stringify(state)) as BoardState;
		for (const field of ["parent", "foundWhile", "related", "feedback", "timelineRevision"]) delete (old.tasks[0] as Record<string, unknown>)[field];
		const view = viewOf(old).tasks[0] as BoardTask;
		expect(view).toMatchObject({ parent: null, foundWhile: null, related: [], subtasks: [], ledTo: [], blocks: [] });
		expect(view.feedback).toBeUndefined();
		expect(normalizeBoard(old).tasks[0]).toMatchObject({ parent: null, foundWhile: null, related: [] });
		// And it can take links like any other.
		expect(describeTask(view)).not.toContain("feedback");
	});
});

describe("feedback entries", () => {
	function stateWithHistory(): { state: BoardState; history: TaskHistoryState } {
		return { state: boardOf("Task"), history: { snapshots: [], keys: [] } };
	}
	const record = (state: BoardState, history: TaskHistoryState, text: string, key: string, minutes = 0, images = 0): BoardFeedback =>
		recordFeedback(state, history, { taskId: "T1", text, images, threadId: "main", key, now: at(minutes) });

	it("records each message once, with short IDs unique on the board", () => {
		const { state, history } = stateWithHistory();
		saveTask(state, { task: input("Other"), author: "coordinator", now: T0 });
		const other: TaskHistoryState = { snapshots: [], keys: [] };
		const first = record(state, history, "  Make it blue.  ", "r1", 1);
		expect(first).toMatchObject({ id: "F1", text: "Make it blue.", state: "open", note: null, threadId: "main", changes: [] });
		expect(first.images).toBeUndefined();
		expect(record(state, history, "Make it blue.", "r1", 2).id).toBe("F1");
		expect(record(state, history, "[image]", "r2", 3, 2)).toMatchObject({ id: "F2", images: 2 });
		const second = recordFeedback(state, other, { taskId: "T2", text: "Elsewhere", images: 0, threadId: "jira", key: "r3", now: at(4) });
		expect(second).toMatchObject({ id: "F3", threadId: "jira" });
		expect(task(state, "T1").feedback).toEqual({ open: 2, handling: 0, addressed: 0, dismissed: 0 });
		expect(task(state, "T1").timelineRevision).toBe(2);
		expect(() => recordFeedback(state, history, { taskId: "T9", text: "x", images: 0, threadId: "main", key: "r4", now: T0 })).toThrow("No task");
	});

	it("moves open to handling to addressed with a note, and lets the user dismiss and reopen", () => {
		const { state, history } = stateWithHistory();
		record(state, history, "Fix the label.", "r1", 1);
		record(state, history, "Also the icon.", "r2", 2);
		const coordinator = coordinatorWriter("main");
		const move = (id: string, next: Parameters<typeof setFeedbackState>[2]["state"], note: string | null, by = coordinator, minutes = 5) =>
			setFeedbackState(state, history, { taskId: "T1", feedbackId: id, state: next, note, by, now: at(minutes) });

		expect(move("F1", "handling", "Started worker w1").feedback).toMatchObject({ state: "handling", note: "Started worker w1" });
		expect(() => move("F1", "addressed", null)).toThrow("needs a note");
		const done = move("F1", "addressed", "Fixed in commit abc123", coordinator, 8);
		expect(done).toMatchObject({ changed: true, before: "handling" });
		expect(done.feedback).toMatchObject({ state: "addressed", note: "Fixed in commit abc123", updatedAt: at(8) });
		expect(done.feedback.changes.map((change) => [change.state, change.by.author])).toEqual([
			["handling", "coordinator"],
			["addressed", "coordinator"],
		]);
		// The same state and note is nothing; a new note rewrites it.
		expect(move("F1", "addressed", "Fixed in commit abc123").changed).toBe(false);
		expect(move("F1", "addressed", "Fixed in abc123 and released").feedback.note).toBe("Fixed in abc123 and released");

		move("F2", "dismissed", null, USER_WRITER, 9);
		expect(task(state, "T1").feedback).toEqual({ open: 0, handling: 0, addressed: 1, dismissed: 1 });
		const reopened = move("F2", "open", null, USER_WRITER, 10);
		expect(reopened.feedback).toMatchObject({ state: "open", note: null });
		expect(task(state, "T1").feedback).toEqual({ open: 1, handling: 0, addressed: 1, dismissed: 0 });
		expect(() => move("F9", "handling", null)).toThrow('No feedback "F9"');
		expect(describeTask(viewOf(state).tasks[0] as BoardTask)).toContain("1 open feedback");
	});

	it("lists open entries first, oldest first, then the settled ones, newest first", () => {
		const { state, history } = stateWithHistory();
		for (const [index, text] of ["a", "b", "c", "d"].entries()) record(state, history, text, `k${index}`, index);
		setFeedbackState(state, history, { taskId: "T1", feedbackId: "F1", state: "addressed", note: "done", by: USER_WRITER, now: at(9) });
		setFeedbackState(state, history, { taskId: "T1", feedbackId: "F3", state: "dismissed", note: null, by: USER_WRITER, now: at(9) });
		setFeedbackState(state, history, { taskId: "T1", feedbackId: "F4", state: "handling", note: null, by: USER_WRITER, now: at(9) });
		expect(sortFeedback(history.feedback ?? []).map((entry) => entry.id)).toEqual(["F2", "F4", "F3", "F1"]);
	});
});

describe("the timeline", () => {
	it("lists every kind of entry in time order and filters by kind", () => {
		const state = boardOf("Task", "Other");
		const history: TaskHistoryState = { snapshots: [], keys: [] };
		const t = task(state, "T1");
		const by = coordinatorWriter("main");
		recordFeedback(state, history, { taskId: "T1", text: "Please add dark mode.", images: 1, threadId: "main", key: "r1", now: at(1) });
		addSnapshot(history, t, { label: "todo → in_progress", by: HARNESS_WRITER, at: at(2) });
		addTimelineEvent(history, t, { at: at(2), kind: "worker", label: "Worker w1 started", ref: "w1", by: HARNESS_WRITER }, "spawn:1");
		setFeedbackState(state, history, { taskId: "T1", feedbackId: "F1", state: "handling", note: "w1 is on it", by, now: at(3) });
		const question = askQuestion(state, { text: "Which palette?", options: [], taskId: "T1", now: at(4), threadId: "main" });
		addSnapshot(history, t, { label: "First version", by, at: at(5) });
		settleQuestion(state, { questionId: question.id, answer: "The blue one", now: at(6) });
		addDecision(state, { text: "Use the blue palette", why: "The user chose it", taskId: "T1", now: at(7) });
		addTimelineEvent(history, t, { at: at(8), kind: "worker", label: "Worker w1 reported", detail: "Dark mode done", ref: "w1", by: HARNESS_WRITER }, "report:1");
		addTimelineEvent(history, t, { at: at(8), kind: "worker", label: "Worker w1 reported", ref: "w1", by: HARNESS_WRITER }, "report:1");
		setFeedbackState(state, history, { taskId: "T1", feedbackId: "F1", state: "addressed", note: "Commit abc123", by, now: at(9) });
		addSnapshot(history, t, { label: "in_progress → review", by, at: at(10) });
		// Something about another task stays out.
		askQuestion(state, { text: "Elsewhere?", options: [], taskId: "T2", now: at(11) });

		const { entries, feedback } = buildTimeline(t, state, history);
		expect(entries.map((entry) => [entry.at, entry.kind, entry.label])).toEqual([
			[at(1), "feedback", "Feedback F1"],
			[at(2), "status", "todo → in_progress"],
			[at(2), "worker", "Worker w1 started"],
			[at(3), "feedback", "F1 → handling"],
			[at(4), "question", "Question Q1"],
			[at(5), "milestone", "First version"],
			[at(6), "question", "Q1 answered"],
			[at(7), "decision", "Decision D1"],
			[at(8), "worker", "Worker w1 reported"],
			[at(9), "feedback", "F1 → addressed"],
			[at(10), "status", "in_progress → review"],
		]);
		expect(entries[0]).toMatchObject({ detail: "Please add dark mode. (1 image)", ref: "F1", state: "open", by: { author: "user" } });
		expect(entries[3]).toMatchObject({ detail: "w1 is on it", state: "handling", by: { author: "coordinator" } });
		expect(entries[6]).toMatchObject({ detail: "The blue one", ref: "Q1" });
		expect(entries[7]?.detail).toBe("Use the blue palette — The user chose it");
		expect(feedback.map((entry) => [entry.id, entry.state])).toEqual([["F1", "addressed"]]);
		expect(t.timelineRevision).toBe(history.revision);

		const kinds = (...wanted: Parameters<typeof buildTimeline>[3] & string[]) => buildTimeline(t, state, history, wanted).entries.map((entry) => entry.kind);
		expect(new Set(kinds("feedback", "decision"))).toEqual(new Set(["feedback", "decision"]));
		expect(kinds("worker")).toEqual(["worker", "worker"]);
		expect(kinds("status", "milestone")).toEqual(["status", "milestone", "status"]);
		expect(buildTimeline(t, state, history, []).entries).toHaveLength(entries.length);
	});

	it("is empty for a task nothing happened to", () => {
		const state = boardOf("Quiet");
		expect(buildTimeline(task(state, "T1"), state, undefined)).toEqual({ entries: [], feedback: [] });
	});
});

describe("the task reference", () => {
	it("carries the feedback ID and reads back with or without it", () => {
		expect(withTaskReference("Look again.", "T3", "F7")).toBe("[task T3, feedback F7] Look again.");
		expect(withTaskReference("[task T3, feedback F7] Look again.", "T3", "F7")).toBe("[task T3, feedback F7] Look again.");
		expect(withTaskReference("[task T3] Look again.", "T3", "F7")).toBe("[task T3] Look again.");
		expect(withTaskReference([{ type: "text", text: "See." }], "T3", "F7")).toEqual([{ type: "text", text: "[task T3, feedback F7] See." }]);
		expect(splitTaskReference("[task T12, feedback F3] fix it")).toEqual({ taskId: "T12", feedbackId: "F3", text: "fix it" });
		expect(splitTaskReference("[task T12] fix it")).toEqual({ taskId: "T12", text: "fix it" });
	});
});

// --- against a real server ---------------------------------------------------------------------------------------

type Reply = ReturnType<typeof fauxAssistantMessage>;

function call(name: string, args: JsonObject): Reply {
	return fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" });
}

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.map((block) => ((block as { type?: string }).type === "text" ? ((block as { text?: string }).text ?? "") : "")).join("");
}

function systemOf(request: TranscriptContext): string {
	return request.messages
		.filter((message) => message.role === "system")
		.map((message) => {
			const parts = (message as { sections?: Record<string, string> }).sections;
			return parts === undefined ? textOf((message as { content?: unknown }).content) : Object.values(parts).join("\n");
		})
		.join("\n");
}

function lastOf(request: TranscriptContext): { role: string; text: string; toolName: string | undefined } {
	const last = request.messages.findLast((message) => message.role !== "system") as { role: string; content?: unknown; toolName?: string } | undefined;
	return { role: last?.role ?? "", text: textOf(last?.content), toolName: last?.role === "toolResult" ? last.toolName : undefined };
}

async function until(check: () => boolean | Promise<boolean>, timeoutMs = 15_000): Promise<void> {
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		if (await check()) return;
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	throw new Error("timed out waiting for a condition");
}

async function start(): Promise<{ test: TestSetup; client: TestClient; projectId: string }> {
	const test = await createSetup({ boardEditDebounceMs: 60 });
	cleanups.push(test.cleanup);
	const client = await TestClient.open(test.server);
	clients.push(client);
	await client.hello();
	const added = await client.request({ type: "projects.add", path: test.projectDir });
	if (added.type !== "projects.add") throw errorOf(added);
	const configured = await client.request({ type: "projects.configure", projectId: added.project.id, coordinatorModel: FAUX, workerModels: [FAUX] });
	if (configured.type !== "projects.configure") throw errorOf(configured);
	return { test, client, projectId: added.project.id };
}

async function saveTaskVia(client: TestClient, projectId: string, title: string, extra: Partial<BoardTaskInput> = {}): Promise<BoardTask> {
	const saved = await client.request({ type: "board.task.save", projectId, task: input(title, extra) });
	if (saved.type !== "board.task.save") throw errorOf(saved);
	return saved.task;
}

async function boardOfProject(client: TestClient, projectId: string, includeArchived = false): Promise<Board> {
	const response = await client.request({ type: "board.get", projectId, includeArchived });
	if (response.type !== "board.get") throw errorOf(response);
	return response.board;
}

async function timelineOf(client: TestClient, projectId: string, taskId: string, kinds?: ("feedback" | "status" | "worker" | "question" | "decision" | "milestone" | "link")[]) {
	const response = await client.request({ type: "board.task.timeline", projectId, taskId, ...(kinds === undefined ? {} : { kinds }) });
	if (response.type !== "board.task.timeline") throw errorOf(response);
	return response;
}

describe("a user's message about a task", () => {
	it("becomes a feedback entry the coordinator reads by ID and settles with the board tool, and survives a restart", async () => {
		const { test, client, projectId } = await start();
		await saveTaskVia(client, projectId, "Ship the sheet");
		const results: string[] = [];
		const steps: JsonObject[] = [
			{ action: "add_task", title: "Dark mode bug", foundWhile: "T1", related: ["T1"], description: "Found while on T1" },
			{ action: "add_task", title: "Polish", parent: "T1" },
			{ action: "feedback", id: "T1", feedbackId: "F1", state: "handling", note: "Reading it" },
			{ action: "feedback", id: "T1", feedbackId: "F1", state: "addressed" },
			{ action: "feedback", id: "T1", feedbackId: "F1", state: "dismissed", note: "no" },
			{ action: "feedback", id: "T1", feedbackId: "F1", state: "addressed", note: "Answered in chat" },
			{ action: "add_task", title: "Loop", parent: "T3" },
			{ action: "update_task", id: "T3", expectedRevision: 1, parent: "T4" },
			{ action: "link", id: "T3", link: "related", to: "T2" },
			{ action: "unlink", id: "T4", link: "parent" },
			{ action: "list" },
			{ action: "show_task", id: "T1" },
		];
		let heard = "";
		const factory = (request: TranscriptContext) => {
			const { role, text } = lastOf(request);
			if (systemOf(request).includes('You are the worker "')) return fauxAssistantMessage("## Report\nOutcome: done");
			if (role === "toolResult") {
				results.push(text);
				const next = steps.shift();
				return next === undefined ? fauxAssistantMessage("Filed.") : call("board", next);
			}
			if (text.startsWith("[task T1")) {
				heard = text;
				return call("board", steps.shift() as JsonObject);
			}
			return fauxAssistantMessage("Noted.");
		};
		test.faux.setResponses(Array.from({ length: 80 }, () => factory));

		const view = new ViewClient(client);
		await view.start(projectId);
		const sent = await client.request({ type: "conversation.submit", projectId, requestId: "m1", content: "Dark mode is broken in the sheet.", taskId: "T1" });
		if (sent.type !== "conversation.submit") throw errorOf(sent);
		// The entry exists as soon as the message is accepted, and the message names it.
		await view.waitForView((value) => value.entries.some((entry) => entryText(entry) === "[task T1, feedback F1] Dark mode is broken in the sheet."));
		// A re-sent request ID is the same message: the same entry, none added.
		await client.request({ type: "conversation.submit", projectId, requestId: "m1", content: "Dark mode is broken in the sheet.", taskId: "T1" });
		await until(() => results.length >= 12);
		expect(heard).toBe("[task T1, feedback F1] Dark mode is broken in the sheet.");

		// The tool's answers, in order.
		expect(results.slice(0, 4)).toEqual([
			"Added T2 (r1).",
			"Added T3 (r1).",
			"F1 on T1 is handling.",
			expect.stringContaining("needs a note"),
		]);
		// The tool's schema has no dismissed: only the user dismisses.
		expect(results[4]).toContain("Validation failed");
		expect(results[5]).toBe("F1 on T1 is addressed.");
		// T4 is a child of T3, so T3 cannot go under T4.
		expect(results[6]).toBe("Added T4 (r1).");
		expect(results[7]).toContain("cycle");
		expect(results[8]).toBe("Linked: T3 related to T2.");
		expect(results[9]).toBe("Unlinked: T4 was subtask of T3.");

		const list = results[10] as string;
		expect(list).toContain("T1 r1 [todo] Ship the sheet | led to T2 | 1 subtask (0 done) | related T2");
		expect(list).toContain("T2 r1 [todo] Dark mode bug | found while T1 | related T1,T3");
		expect(list).toContain("T3 r1 [todo] Polish | ↳T1 | related T2");
		const shown = results[11] as string;
		expect(shown).toContain("Links:");
		expect(shown).toContain("has subtasks: T3 [todo] Polish");
		expect(shown).toContain("led to: T2 [todo] Dark mode bug");
		expect(shown).toContain("F1 [addressed]");
		expect(shown).toContain("-> Answered in chat");
		expect(shown).toContain("Timeline (latest");

		// What the app reads.
		const board = await boardOfProject(client, projectId);
		const t1 = board.tasks.find((candidate) => candidate.id === "T1") as BoardTask;
		expect(t1.feedback).toEqual({ open: 0, handling: 0, addressed: 1, dismissed: 0 });
		expect(t1.subtasks).toEqual(["T3"]);
		expect(t1.ledTo).toEqual(["T2"]);
		const timeline = await timelineOf(client, projectId, "T1");
		expect(timeline.feedback).toHaveLength(1);
		expect(timeline.feedback[0]).toMatchObject({ id: "F1", state: "addressed", note: "Answered in chat", threadId: "main" });
		expect(timeline.entries.map((entry) => entry.label).sort()).toEqual(
			["Feedback F1", "F1 → handling", "F1 → addressed", "Has subtask T3", "Led to T2", "Related to T2"].sort(),
		);
		expect((await timelineOf(client, projectId, "T1", ["link"])).entries.map((entry) => entry.label)).toEqual([
			"Related to T2",
			"Led to T2",
			"Has subtask T3",
		]);
		const links = await timelineOf(client, projectId, "T2", ["link"]);
		expect(links.entries.map((entry) => entry.label)).toEqual(["Found while working on T1", "Related to T1", "Related to T3"]);
		const feedbackOnly = await timelineOf(client, projectId, "T1", ["feedback"]);
		expect(feedbackOnly.entries.every((entry) => entry.kind === "feedback")).toBe(true);
		expect(feedbackOnly.entries.map((entry) => entry.label)).toEqual(["Feedback F1", "F1 → handling", "F1 → addressed"]);
		expect(await client.request({ type: "board.task.timeline", projectId, taskId: "T9" })).toMatchObject({ type: "error", error: { code: "unknown_task" } });

		// The user dismisses and reopens from the app; the coordinator is told.
		const dismissed = await client.request({ type: "board.feedback.set", projectId, taskId: "T1", feedbackId: "F1", state: "dismissed", note: "not needed" });
		if (dismissed.type !== "board.feedback.set") throw errorOf(dismissed);
		expect(dismissed.feedback).toMatchObject({ state: "dismissed", note: "not needed" });
		await view.waitForView((value) => value.entries.some((entry) => entryText(entry).startsWith('[board] The user dismissed it (not needed): feedback F1 on T1')));
		const reopened = await client.request({ type: "board.feedback.set", projectId, taskId: "T1", feedbackId: "F1", state: "open" });
		if (reopened.type !== "board.feedback.set") throw errorOf(reopened);
		expect(reopened.feedback).toMatchObject({ state: "open", note: null });
		expect((await boardOfProject(client, projectId)).tasks[0]?.feedback).toEqual({ open: 1, handling: 0, addressed: 0, dismissed: 0 });
		expect(await client.request({ type: "board.feedback.set", projectId, taskId: "T1", feedbackId: "F9", state: "open" })).toMatchObject({
			type: "error",
			error: { code: "unknown_task" },
		});

		// A restart loses nothing.
		const before = await timelineOf(client, projectId, "T1");
		client.close();
		await test.restart();
		const again = await TestClient.open(test.server);
		clients.push(again);
		await again.hello();
		const after = await timelineOf(again, projectId, "T1");
		expect(after.entries).toEqual(before.entries);
		expect(after.feedback).toEqual(before.feedback);
		expect(after.feedback[0]?.changes.map((change) => change.state)).toEqual(["handling", "addressed", "dismissed", "open"]);
		const board2 = await boardOfProject(again, projectId);
		expect(board2.tasks.find((candidate) => candidate.id === "T2")).toMatchObject({ foundWhile: "T1", related: ["T1", "T3"] });
		// The counter goes on from where it was: the next message is F2.
		test.faux.setResponses(Array.from({ length: 5 }, () => () => fauxAssistantMessage("Noted.")));
		await again.request({ type: "conversation.submit", projectId, requestId: "m2", content: "One more.", taskId: "T1" });
		expect((await timelineOf(again, projectId, "T1")).feedback.map((entry) => entry.id)).toEqual(["F1", "F2"]);
	}, 60_000);

	it("records the worker's start, report and failure on its task's timeline", async () => {
		const { test, client, projectId } = await start();
		await saveTaskVia(client, projectId, "Read the README");
		const factory = (request: TranscriptContext) => {
			const { role, text } = lastOf(request);
			if (systemOf(request).includes('You are the worker "')) return fauxAssistantMessage("## Report\nOutcome: the README covers setup.");
			if (text.endsWith("Go.")) return call("worker_spawn", { id: "reader", task: "Read it.", taskId: "T1" });
			if (role === "toolResult") return fauxAssistantMessage("Started.");
			return fauxAssistantMessage("Noted.");
		};
		test.faux.setResponses(Array.from({ length: 30 }, () => factory));
		await client.request({ type: "conversation.submit", projectId, requestId: "g1", content: "Go.", taskId: "T1" });
		await until(async () => (await timelineOf(client, projectId, "T1", ["worker"])).entries.length === 2);
		const timeline = await timelineOf(client, projectId, "T1");
		expect(timeline.entries.map((entry) => [entry.kind, entry.label])).toEqual([
			["feedback", "Feedback F1"],
			["status", "todo → in_progress"],
			["worker", "Worker reader started"],
			["worker", "Worker reader reported"],
		]);
		expect(timeline.entries[3]?.detail).toContain("README covers setup");
		// A report moves nothing: the task is still in progress.
		expect((await boardOfProject(client, projectId)).tasks[0]?.status).toBe("in_progress");
	}, 30_000);

	it("is recorded in a background thread's chat too, under the thread's name", async () => {
		const { test, client, projectId } = await start();
		const factory = (request: TranscriptContext) => {
			const system = systemOf(request);
			const { role, text, toolName } = lastOf(request);
			if (system.includes('You are the worker "')) return fauxAssistantMessage("## Report\nOutcome: done");
			if (system.includes('You are the background thread "')) {
				if (text === "Triage the tickets.") return call("thread_finish", { summary: "Triaged." });
				return fauxAssistantMessage(role === "toolResult" ? "Done." : "Thread: noted.");
			}
			const added = toolName === "board" ? /^Added (T\d+) /.exec(text) : null;
			if (added !== null) return call("thread_start", { title: "Jira run", brief: "Triage the tickets.", taskId: added[1] as string });
			if (text === "Start it.") return call("board", { action: "add_task", title: "Jira run" });
			return fauxAssistantMessage(role === "toolResult" ? "Noted." : "Nothing to do.");
		};
		test.faux.setResponses(Array.from({ length: 80 }, () => factory));
		await client.request({ type: "conversation.submit", projectId, requestId: "s1", content: "Start it." });
		await until(async () => {
			const list = await client.request({ type: "threads.list", projectId });
			return list.type === "threads.list" && list.threads.some((entry) => entry.id === "jira-run" && entry.status === "done");
		}, 30_000);

		const threadView = new ViewClient(client);
		await threadView.start(projectId, { threadId: "jira-run" });
		const sent = await client.request({ type: "conversation.submit", projectId, threadId: "jira-run", requestId: "s2", content: "Also check the Q3 ones.", taskId: "T1" });
		if (sent.type !== "conversation.submit") throw errorOf(sent);
		await threadView.waitForView((value) => value.entries.some((entry) => entryText(entry) === "[task T1, feedback F1] Also check the Q3 ones."));
		const { feedback } = await timelineOf(client, projectId, "T1");
		expect(feedback).toHaveLength(1);
		expect(feedback[0]).toMatchObject({ id: "F1", text: "Also check the Q3 ones.", threadId: "jira-run", state: "open" });
		// Threads share the board, so the thread uses the same tool and counts.
		expect((await boardOfProject(client, projectId)).tasks[0]?.feedback?.open).toBe(1);
	}, 60_000);

	it("refuses a message about an unknown task and records nothing", async () => {
		const { client, projectId } = await start();
		const refused = await client.request({ type: "conversation.submit", projectId, requestId: "x1", content: "Hello.", taskId: "T7" });
		expect(refused).toMatchObject({ type: "error", error: { code: "unknown_task" } });
	});
});
