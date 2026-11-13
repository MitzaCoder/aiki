/**
 * Board logic outside the components: grouping, reordering, the editor's draft and its checks, the question badge, the
 * `[board]` note and the one-line card for the coordinator's `board` calls.
 */
import { describe, expect, test } from "bun:test";
import type { Board, BoardTask } from "@kemiri/protocol";
import {
	activityOpenQuestions,
	archivedCount,
	blockerChoices,
	blockersOf,
	boardCallView,
	changedFields,
	draftFromTask,
	draftIsDirty,
	draftProblem,
	draftToInput,
	emptyDraft,
	groupTasks,
	openQuestions,
	parseBoardNotice,
	parseList,
	questionBadgeText,
	questionsWaitingLabel,
	reorderedIds,
	taskStatusLabel,
} from "../src/lib/board.ts";
import { buildTranscript } from "../src/lib/transcript.ts";
import type { EntryRecord } from "@kemiri/protocol";

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
		createdAt: "2026-11-04T10:00:00Z",
		updatedAt: "2026-11-04T10:00:00Z",
		settledAt: null,
		archived: false,
		report: { now: "", results: "", next: "", revision: 0, updatedAt: null, updatedBy: null },
		snapshots: 0,
		...overrides,
	};
}

describe("task groups", () => {
	const tasks = [
		task("T1", { status: "done", order: 1 }),
		task("T2", { status: "todo", order: 3 }),
		task("T3", { status: "in_progress", order: 2 }),
		task("T4", { status: "todo", order: 2 }),
		task("T5", { status: "dropped", archived: true, order: 5 }),
		task("T6", { status: "blocked", order: 6 }),
		task("T7", { status: "review", order: 7 }),
	];

	test("come in the panel's order, by task order inside a group, empty groups left out", () => {
		const groups = groupTasks(tasks);
		expect(groups.map((group) => group.status)).toEqual(["in_progress", "review", "blocked", "todo", "done"]);
		expect(groups.find((group) => group.status === "todo")?.tasks.map((entry) => entry.id)).toEqual(["T4", "T2"]);
	});

	test("fold done and dropped, and keep archived ones behind the toggle", () => {
		expect(groupTasks(tasks).map((group) => [group.status, group.collapsedByDefault])).toEqual([
			["in_progress", false],
			["review", false],
			["blocked", false],
			["todo", false],
			["done", true],
		]);
		const withArchived = groupTasks(tasks, { includeArchived: true });
		expect(withArchived.at(-1)).toMatchObject({ status: "dropped", collapsedByDefault: true });
		expect(archivedCount(tasks)).toBe(1);
		expect(taskStatusLabel("in_progress")).toBe("In progress");
	});
});

describe("blockers", () => {
	test("say whether each one is finished, and call a missing one archived", () => {
		const tasks = [task("T1", { status: "done" }), task("T2"), task("T3", { blockedBy: ["T1", "T2", "T9"] })];
		const blockers = blockersOf(tasks[2] as BoardTask, tasks);
		expect(blockers.map((blocker) => [blocker.id, blocker.settled])).toEqual([
			["T1", true],
			["T2", false],
			["T9", true],
		]);
		expect(blockers[2]?.status).toBe("unknown");
	});
});

describe("reordering", () => {
	const tasks = [
		task("T1", { status: "todo", order: 1 }),
		task("T2", { status: "review", order: 2 }),
		task("T3", { status: "todo", order: 3 }),
		task("T4", { status: "todo", order: 4 }),
	];

	test("moves a task within its status group and leaves the other groups in place", () => {
		expect(reorderedIds(tasks, "T3", { delta: -1 })).toEqual(["T3", "T2", "T1", "T4"]);
		expect(reorderedIds(tasks, "T1", { delta: 1 })).toEqual(["T3", "T2", "T1", "T4"]);
		expect(reorderedIds(tasks, "T4", { toIndex: 0 })).toEqual(["T4", "T2", "T1", "T3"]);
	});

	test("does nothing at an edge or for an unknown task", () => {
		expect(reorderedIds(tasks, "T1", { delta: -1 })).toBeUndefined();
		expect(reorderedIds(tasks, "T4", { delta: 1 })).toBeUndefined();
		expect(reorderedIds(tasks, "T2", { delta: 1 })).toBeUndefined();
		expect(reorderedIds(tasks, "T99", { delta: 1 })).toBeUndefined();
	});
});

describe("the task editor", () => {
	const base = task("T3", {
		description: "Retry on a bad frame",
		acceptance: "Parser recovers",
		refs: ["EX-1234", "#1234"],
		blockedBy: ["T1"],
		writeScopes: ["src/parser", "test"],
	});

	test("round-trips a task through its draft", () => {
		const draft = draftFromTask(base);
		expect(draft.writeScopes).toBe("src/parser\ntest");
		expect(draft.refs).toBe("EX-1234\n#1234");
		expect(draftToInput(draft)).toEqual({
			title: "Task T3",
			description: "Retry on a bad frame",
			acceptance: "Parser recovers",
			refs: ["EX-1234", "#1234"],
			status: "todo",
			blockedBy: ["T1"],
			blockedReason: null,
			writeScopes: ["src/parser", "test"],
		});
		expect(draftIsDirty(draft, base)).toBe(false);
		expect(draftIsDirty({ ...draft, title: "Other" }, base)).toBe(true);
		expect(draftIsDirty(emptyDraft(), undefined)).toBe(false);
		expect(changedFields({ ...draft, refs: "EX-1234" }, base)).toEqual(["Tickets and links"]);
	});

	test("trims, drops blanks and repeats, and sends an empty acceptance as null", () => {
		expect(parseList(" a/b ,c\n\n a/b\n d ")).toEqual(["a/b", "c", "d"]);
		const input = draftToInput({ ...emptyDraft(), title: "  Hello ", acceptance: "  ", blockedReason: " " });
		expect(input).toMatchObject({ title: "Hello", acceptance: null, blockedReason: null });
	});

	test("names the fields a newer version changed", () => {
		const draft = draftFromTask(base);
		const newer = task("T3", { ...base, status: "blocked", title: "Renamed", revision: 2 });
		expect(changedFields(draft, newer)).toEqual(["Title", "Status"]);
		expect(changedFields(draft, base)).toEqual([]);
	});

	test("refuses an empty title, a task waiting for itself and a cycle", () => {
		const tasks = [task("T1"), task("T2", { blockedBy: ["T1"] }), task("T3", { blockedBy: ["T2"] })];
		expect(draftProblem(emptyDraft(), undefined, tasks)).toBe("A task needs a title.");
		expect(draftProblem({ ...emptyDraft(), title: "x", blockedBy: ["T1"] }, "T1", tasks)).toBe("A task cannot wait for itself.");
		expect(draftProblem({ ...emptyDraft(), title: "x", blockedBy: ["T3"] }, "T1", tasks)).toBe("T3 already waits for T1.");
		expect(draftProblem({ ...emptyDraft(), title: "x", blockedBy: ["T1"] }, "T3", tasks)).toBeUndefined();
	});

	test("offers as blockers only tasks that would not make a cycle", () => {
		const tasks = [task("T1"), task("T2", { blockedBy: ["T1"] }), task("T3", { blockedBy: ["T2"] }), task("T4")];
		expect(blockerChoices(tasks, "T1").map((entry) => entry.id)).toEqual(["T4"]);
		expect(blockerChoices(tasks, "T3").map((entry) => entry.id)).toEqual(["T1", "T2", "T4"]);
		expect(blockerChoices(tasks, undefined)).toHaveLength(4);
	});
});

describe("questions", () => {
	test("count the open ones only", () => {
		const board: Pick<Board, "questions"> = {
			questions: [
				{ id: "Q1", revision: 1, text: "a", options: [], taskId: null, status: "open", answer: null, askedAt: "", answeredAt: null },
				{ id: "Q2", revision: 2, text: "b", options: [], taskId: null, status: "answered", answer: "x", askedAt: "", answeredAt: "" },
			],
		};
		expect(openQuestions(board).map((question) => question.id)).toEqual(["Q1"]);
	});

	test("badge text hides zero and an absent count, and caps at 9+", () => {
		expect(questionBadgeText(undefined)).toBeUndefined();
		expect(questionBadgeText(0)).toBeUndefined();
		expect(questionBadgeText(3)).toBe("3");
		expect(questionBadgeText(12)).toBe("9+");
		expect(activityOpenQuestions(undefined)).toBe(0);
		expect(activityOpenQuestions({ openQuestions: 2 })).toBe(2);
		expect(questionsWaitingLabel(1)).toBe("1 question waiting for you");
		expect(questionsWaitingLabel(2)).toBe("2 questions waiting for you");
	});
});

describe("[board] notes", () => {
	test("read as a summary and the whole note, and only when the prefix stands alone", () => {
		expect(parseBoardNotice("[board] You answered Q2: ship it\nT4 unblocked")).toEqual({
			summary: "You answered Q2: ship it",
			body: "You answered Q2: ship it\nT4 unblocked",
		});
		expect(parseBoardNotice('[board] The user answered Q1 ("Which db?"): pg')?.summary).toBe('You answered Q1 ("Which db?"): pg');
		expect(parseBoardNotice("[board] The user changed the board:\n- T1 done")?.body).toBe("You changed the board:\n- T1 done");
		expect(parseBoardNotice("[board]")).toEqual({ summary: "", body: "" });
		expect(parseBoardNotice("[boardroom] hello")).toBeUndefined();
		expect(parseBoardNotice("please [board] this")).toBeUndefined();
	});

	test("a line that only introduces a list carries its first change", () => {
		expect(parseBoardNotice("[board] The user changed the board:\n- T16 done\n- T4 review")).toEqual({
			summary: "You changed the board: T16 done",
			body: "You changed the board:\n- T16 done\n- T4 review",
		});
		// A colon with prose under it is not a list, so there is no single first change to lift into the line.
		expect(parseBoardNotice("[board] The user changed the board:\nfor the better")?.summary).toBe("You changed the board:");
		expect(parseBoardNotice("[board] Something to say:")?.summary).toBe("Something to say:");
	});

	test("become a board item in the transcript, not a user message", () => {
		const entry = (id: number, content: string, timestamp: number): EntryRecord => ({
			id,
			conversationId: 1,
			kind: "pi.user",
			model: [{ role: "user", content, timestamp }],
		});
		const items = buildTranscript(
			[entry(1, "[board] You edited T4 (status: todo → blocked)", 5), entry(2, "hello", 6)],
			undefined,
		);
		expect(items.map((item) => item.kind)).toEqual(["board", "user"]);
		expect(items[0]).toMatchObject({ summary: "You edited T4 (status: todo → blocked)", timestamp: 5 });
	});
});

describe("board tool calls", () => {
	test("a report write and a task lookup read as what they did", () => {
		expect(boardCallView({ arguments: { action: "write_report", id: "T3", milestone: "First version merged" } })).toEqual({
			summary: "Updated the report on T3 · First version merged",
		});
		expect(boardCallView({ arguments: { action: "write_report", id: "T3" } })?.summary).toBe("Updated the report on T3");
		expect(boardCallView({ arguments: { action: "show_task", id: "T3" } })?.summary).toBe("Opened T3");
	});

	test("read as one line from the tool's arguments and output", () => {
		expect(
			boardCallView({ arguments: { action: "add_task", title: "Fix parser recovery" }, output: "Added T4 (r1)." }),
		).toMatchObject({ summary: "Added T4 · Fix parser recovery" });
		expect(boardCallView({ arguments: { action: "update_task", id: "T4", status: "review" } })?.summary).toBe("Updated T4 → review");
		expect(boardCallView({ arguments: { action: "update_task", id: "T3", title: "New" } })?.summary).toBe("Updated T3 · New");
		expect(boardCallView({ arguments: { action: "drop_task", id: "T2" }, output: "Updated T2 (now r3, dropped)." })?.summary).toBe(
			"Dropped T2",
		);
		expect(
			boardCallView({ arguments: { action: "ask", text: "Which db?", options: ["pg"] }, output: "Asked Q2. The user's answer arrives as a [board] message." }),
		).toEqual({ summary: "Asked Q2 · Which db?", detail: "Which db?" });
		expect(boardCallView({ arguments: { action: "resolve_question", id: "Q2" }, output: "Q2 is answered." })?.summary).toBe("Resolved Q2");
		expect(boardCallView({ arguments: { action: "decide", text: "Use pg", why: "Team knows it" }, output: "Recorded D3." })).toEqual({
			summary: "Decided D3 · Use pg",
			detail: "Team knows it",
		});
		expect(boardCallView({ arguments: { action: "list" } })?.summary).toBe("Listed the board");
	});

	test("reads arguments that arrive as JSON text", () => {
		expect(boardCallView({ arguments: JSON.stringify({ action: "add_task", title: "Nested" }), output: "Added T9 (r1)." })?.summary).toBe(
			"Added T9 · Nested",
		);
	});

	test("gives up on a shape it does not know, so the generic card shows it", () => {
		expect(boardCallView({ arguments: undefined })).toBeUndefined();
		expect(boardCallView({ arguments: { frobnicate: 1 } })).toBeUndefined();
		expect(boardCallView({ arguments: { action: "zzz" } })).toBeUndefined();
	});
});
