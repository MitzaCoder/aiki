import { describe, expect, it } from "bun:test";
import type { BoardFeedback, BoardTask, BoardTimelineEntry } from "@kemiri/protocol";
import {
	NO_TASK_FILTER,
	applyTaskFilter,
	feedbackStateWords,
	hasLinks,
	linkGroups,
	linkTarget,
	linkedIds,
	openFeedbackCount,
	sortedFeedback,
	subtaskCountText,
	subtaskFraction,
	subtaskProgressText,
	timelineCounts,
	visibleTimeline,
} from "../src/lib/task-relations.ts";

function task(id: string, extra: Partial<BoardTask> = {}): BoardTask {
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
		createdAt: "2026-11-09T10:00:00.000Z",
		updatedAt: "2026-11-09T10:00:00.000Z",
		settledAt: null,
		archived: false,
		...extra,
	};
}

/** T1 has subtasks T2 and T3 (T3 has T4, and T8 was found while on T4); T5 was found while on T1; T6 is related to T1; T7 is alone. */
const TASKS = [
	task("T1", { subtasks: ["T2", "T3"], ledTo: ["T5"], related: ["T6"], subtaskCount: { total: 2, done: 1 } }),
	task("T2", { parent: "T1", status: "done" }),
	task("T3", { parent: "T1", subtasks: ["T4"] }),
	task("T4", { parent: "T3", ledTo: ["T8"] }),
	task("T5", { foundWhile: "T1" }),
	task("T6", { related: ["T1"] }),
	task("T7"),
	task("T8", { foundWhile: "T4" }),
];

describe("links", () => {
	it("groups a task's links by kind, naming closed and archived targets", () => {
		const groups = linkGroups(TASKS[0] as BoardTask, TASKS);
		expect(groups.map((group) => [group.label, group.items.map((item) => item.id)])).toEqual([
			["Subtasks", ["T2", "T3"]],
			["Led to", ["T5"]],
			["Related to", ["T6"]],
		]);
		expect(groups[0]?.items.map((item) => item.closed)).toEqual([true, false]);
		const child = linkGroups(TASKS[1] as BoardTask, TASKS);
		expect(child.map((group) => group.label)).toEqual(["Subtask of"]);
		expect(child[0]?.items[0]).toMatchObject({ id: "T1", title: "Task T1", status: "todo", closed: false });
	});

	it("names an archived task from the board's briefs, and an unknown one by its ID", () => {
		const briefs = [{ id: "T9", title: "Old", status: "done" as const, archived: true }];
		expect(linkTarget("T9", [], briefs)).toEqual({ id: "T9", title: "Old", status: "done", archived: true, closed: true });
		expect(linkTarget("T8", [], briefs)).toEqual({ id: "T8", title: "", status: "unknown", archived: false, closed: false });
		const groups = linkGroups(task("T1", { blockedBy: ["T9"], blocks: ["T8"] }), [], briefs);
		expect(groups.map((group) => [group.label, group.items[0]?.closed])).toEqual([
			["Blocked by", true],
			["Blocks", false],
		]);
	});

	it("reads a task from a backend without links as having none", () => {
		expect(hasLinks(task("T1"))).toBe(false);
		expect(hasLinks(TASKS[4] as BoardTask)).toBe(true);
		expect(subtaskProgressText(task("T1"))).toBeUndefined();
		expect(subtaskCountText(task("T1"))).toBeUndefined();
		expect(openFeedbackCount(task("T1"))).toBe(0);
	});

	it("says progress as 2/5 done and the count as subtasks", () => {
		expect(subtaskProgressText(TASKS[0] as BoardTask)).toBe("1/2 done");
		expect(subtaskFraction(TASKS[0] as BoardTask)).toBe(0.5);
		expect(subtaskCountText(TASKS[0] as BoardTask)).toBe("2 subtasks");
		expect(subtaskCountText(task("T1", { subtasks: ["T2"] }))).toBe("1 subtask");
		expect(subtaskProgressText(task("T1", { subtasks: ["T2"], subtaskCount: { total: 0, done: 0 } }))).toBeUndefined();
	});
});

describe("filters", () => {
	it("keeps everything while no filter is on", () => {
		expect(applyTaskFilter(TASKS, NO_TASK_FILTER)).toHaveLength(8);
	});

	it("shows a task with everything linked to it, and everything below it", () => {
		// T8 was found while on T4, a subtask of a subtask: it is below T1.
		expect([...linkedIds("T1", TASKS)].sort()).toEqual(["T1", "T2", "T3", "T4", "T5", "T6", "T8"]);
		expect(applyTaskFilter(TASKS, { focus: "T6" }).map((entry) => entry.id)).toEqual(["T1", "T6"]);
		expect(applyTaskFilter(TASKS, { focus: "T7" }).map((entry) => entry.id)).toEqual(["T7"]);
		expect([...linkedIds("T99", TASKS)]).toEqual(["T99"]);
		// A focused subtask stays visible with its links.
		expect(applyTaskFilter(TASKS, { focus: "T3" }).map((entry) => entry.id)).toEqual(["T1", "T3", "T4", "T8"]);
	});
});

describe("feedback", () => {
	const entry = (id: string, state: BoardFeedback["state"], at: string): BoardFeedback => ({
		id,
		text: id,
		threadId: "main",
		at,
		state,
		note: null,
		updatedAt: at,
		changes: [],
	});

	it("counts open and handling entries as waiting", () => {
		expect(openFeedbackCount(task("T1", { feedback: { open: 2, handling: 1, addressed: 4, dismissed: 1 } }))).toBe(3);
	});

	it("lists open ones first, oldest first, then the rest newest first", () => {
		const entries = [
			entry("F1", "addressed", "2026-11-09T10:01:00Z"),
			entry("F2", "open", "2026-11-09T10:02:00Z"),
			entry("F3", "dismissed", "2026-11-09T10:03:00Z"),
			entry("F4", "handling", "2026-11-09T10:00:00Z"),
		];
		expect(sortedFeedback(entries).map((item) => item.id)).toEqual(["F4", "F2", "F3", "F1"]);
		expect(feedbackStateWords("handling")).toBe("Being handled");
	});
});

describe("timeline kinds", () => {
	const entries: BoardTimelineEntry[] = [
		{ at: "1", kind: "feedback", label: "Feedback F1" },
		{ at: "2", kind: "status", label: "todo → in_progress" },
		{ at: "3", kind: "feedback", label: "F1 → handling" },
	];

	it("hides the kinds turned off and counts each kind", () => {
		expect(visibleTimeline(entries, new Set()).map((item) => item.label)).toHaveLength(3);
		expect(visibleTimeline(entries, new Set(["feedback"])).map((item) => item.label)).toEqual(["todo → in_progress"]);
		expect([...timelineCounts(entries)]).toEqual([
			["feedback", 2],
			["status", 1],
		]);
	});
});
