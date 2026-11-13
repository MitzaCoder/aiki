/**
 * The Tasks board outside the components: columns and how each sorts, the "Needs you" count, what a move may do and
 * asks for, the save it sends, To do's order after a drop, and the remembered List | Board choice.
 */
import { describe, expect, test } from "bun:test";
import type { BoardQuestion, BoardTask } from "@kemiri/protocol";
import {
	columnOfStatus,
	dropTarget,
	kanbanColumns,
	loadTasksViewMode,
	moveChoices,
	moveInput,
	moveNotice,
	moveQuestion,
	needsYouCount,
	reasonMessage,
	saveTasksViewMode,
	TASKS_VIEW_STORAGE_KEY,
	todoOrderWith,
} from "../src/lib/kanban.ts";

function task(id: string, overrides: Partial<BoardTask> = {}): BoardTask {
	return {
		id,
		revision: 1,
		title: `Task ${id}`,
		description: "",
		acceptance: null,
		refs: [],
		status: "todo",
		blockedBy: [],
		blockedReason: null,
		writeScopes: [],
		workerIds: [],
		scheduleId: null,
		report: { now: "", results: "", next: "", revision: 0, updatedAt: null, updatedBy: null },
		snapshots: 0,
		order: Number(id.slice(1)),
		createdBy: "coordinator",
		updatedBy: "coordinator",
		createdAt: "2026-11-05T10:00:00Z",
		updatedAt: "2026-11-05T10:00:00Z",
		settledAt: null,
		archived: false,
		...overrides,
	};
}

function question(id: string, taskId: string | null, overrides: Partial<BoardQuestion> = {}): BoardQuestion {
	return { id, revision: 1, text: `Question ${id}`, options: [], taskId, status: "open", answer: null, ...overrides } as BoardQuestion;
}

function ids(columns: ReturnType<typeof kanbanColumns>, column: string): string[] {
	return columns.find((entry) => entry.id === column)?.cards.map((card) => card.task.id) ?? [];
}

describe("columns", () => {
	test("put each status in its column, done and dropped together, every column present", () => {
		expect(columnOfStatus("in_progress")).toBe("working");
		expect(columnOfStatus("dropped")).toBe("done");
		const columns = kanbanColumns({ tasks: [task("T1")], questions: [] });
		expect(columns.map((column) => column.label)).toEqual(["To do", "Working", "Blocked", "Ready for review", "Waiting", "Done"]);
		expect(columns.find((column) => column.id === "blocked")?.cards).toEqual([]);
	});

	test("sort To do by priority, Working by time in progress, review by time waited, Done newest first", () => {
		const tasks = [
			task("T1", { order: 3 }),
			task("T2", { order: 1 }),
			task("T3", { status: "in_progress", inProgressMinutes: 10 }),
			task("T4", { status: "in_progress", inProgressMinutes: 90 }),
			task("T5", { status: "review", updatedAt: "2026-11-05T12:00:00Z" }),
			task("T6", { status: "review", updatedAt: "2026-11-05T09:00:00Z" }),
			task("T7", { status: "done", settledAt: "2026-11-04T09:00:00Z" }),
			task("T8", { status: "dropped", settledAt: "2026-11-05T09:00:00Z" }),
		];
		const columns = kanbanColumns({ tasks, questions: [] });
		expect(ids(columns, "todo")).toEqual(["T2", "T1"]);
		expect(ids(columns, "working")).toEqual(["T4", "T3"]);
		expect(ids(columns, "review")).toEqual(["T6", "T5"]);
		expect(ids(columns, "done")).toEqual(["T8", "T7"]);
	});

	test("keep a task that needs the user in its status column", () => {
		const columns = kanbanColumns({ tasks: [task("T1", { status: "in_progress" })], questions: [question("Q1", "T1")] });
		const card = columns.find((column) => column.id === "working")?.cards[0];
		expect(card?.waiting.map((entry) => entry.id)).toEqual(["Q1"]);
	});

	test("show only the newest closed tasks, archived ones only when asked, and filter to what needs the user", () => {
		const closed = Array.from({ length: 5 }, (_, index) =>
			task(`T${index + 1}`, { status: "done", settledAt: `2026-11-0${index + 1}T09:00:00Z` }),
		);
		const archived = task("T9", { status: "done", settledAt: "2026-10-01T09:00:00Z", archived: true });
		const done = kanbanColumns({ tasks: [...closed, archived], questions: [] }, { doneShown: 3 }).find((column) => column.id === "done");
		expect(done?.cards.map((card) => card.task.id)).toEqual(["T5", "T4", "T3"]);
		expect(done?.hidden).toBe(2);
		const withArchived = kanbanColumns({ tasks: [...closed, archived], questions: [] }, { includeArchived: true, doneShown: 10 });
		expect(ids(withArchived, "done")).toContain("T9");

		const filtered = kanbanColumns({ tasks: [task("T1"), task("T2")], questions: [question("Q1", "T2")] }, { onlyNeedsYou: true });
		expect(ids(filtered, "todo")).toEqual(["T2"]);
	});

	test("count what needs the user: open tasks with a question or warning, and loose questions", () => {
		const tasks = [task("T1"), task("T2", { status: "done" }), task("T3")];
		const questions = [
			question("Q1", "T1"),
			question("Q2", "T1", { kind: "warning" }),
			question("Q3", "T2"),
			question("Q4", null),
			question("Q5", "T3", { status: "answered" }),
		];
		expect(needsYouCount({ tasks, questions })).toBe(2);
	});
});

describe("moves", () => {
	test("never offer review, which is the agents' call, nor where the task already is", () => {
		expect(moveChoices("todo").map((choice) => choice.target)).toEqual(["in_progress", "blocked", "done", "dropped"]);
		expect(moveChoices("review").map((choice) => choice.target)).toEqual(["todo", "in_progress", "blocked", "done", "dropped"]);
		expect(dropTarget("review")).toBeUndefined();
		expect(dropTarget("done")).toBe("done");
		expect(dropTarget("done", true)).toBe("dropped");
		expect(dropTarget("working")).toBe("in_progress");
	});

	test("ask for a reason back from review, and what a task waits on when it is blocked", () => {
		expect(moveQuestion("review", "in_progress")).toBe("reason");
		expect(moveQuestion("todo", "in_progress")).toBe("none");
		expect(moveQuestion("in_progress", "blocked")).toBe("blocked-reason");
		expect(moveQuestion("review", "done")).toBe("none");
	});

	test("change only the status, keep the refs out, and keep a blocked reason only while blocked", () => {
		const blocked = task("T1", { status: "blocked", blockedReason: "CI is down", blockedBy: ["T2"], refs: ["#12"] });
		const input = moveInput(blocked, "in_progress");
		expect(input).toEqual({
			title: "Task T1",
			description: "",
			acceptance: null,
			status: "in_progress",
			blockedBy: ["T2"],
			blockedReason: null,
			writeScopes: [],
		});
		expect("refs" in input).toBe(false);
		expect(moveInput(task("T3"), "blocked", "  Waiting for the API key ").blockedReason).toBe("Waiting for the API key");
		expect(moveInput(blocked, "blocked", "").blockedReason).toBe("CI is down");
	});

	test("put a dropped card at its place in To do", () => {
		expect(todoOrderWith(["T1", "T2", "T3"], "T9", 1)).toEqual(["T1", "T9", "T2", "T3"]);
		expect(todoOrderWith(["T1", "T2", "T3"], "T1", 2)).toEqual(["T2", "T3", "T1"]);
		expect(todoOrderWith(["T1", "T2"], "T3", 99)).toEqual(["T1", "T2", "T3"]);
		expect(todoOrderWith(["T1", "T2"], "T3", -1)).toEqual(["T3", "T1", "T2"]);
	});

	test("say what happened in plain words", () => {
		expect(moveNotice({ id: "T3" }, "in_progress")).toBe("T3 moved to Working. The coordinator will start it.");
		expect(moveNotice({ id: "T3" }, "dropped")).toBe("T3 was dropped.");
		expect(reasonMessage("  Tests fail on Safari ")).toBe("Back to working: Tests fail on Safari");
	});
});

describe("the remembered view", () => {
	test("defaults to the list and keeps the board once chosen", () => {
		const stored = new Map<string, string>();
		const storage = { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => void stored.set(key, value) };
		expect(loadTasksViewMode(storage)).toBe("list");
		saveTasksViewMode("board", storage);
		expect(stored.get(TASKS_VIEW_STORAGE_KEY)).toBe("board");
		expect(loadTasksViewMode(storage)).toBe("board");
		stored.set(TASKS_VIEW_STORAGE_KEY, "nonsense");
		expect(loadTasksViewMode(storage)).toBe("list");
		expect(loadTasksViewMode(undefined)).toBe("list");
	});
});
