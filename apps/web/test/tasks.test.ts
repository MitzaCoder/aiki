/**
 * The Tasks view and the task sheet outside the components: the `?task=` link, the sections by what a task needs, the
 * lines a row shows and what changed between two snapshots.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Board, BoardQuestion, BoardTask } from "@mihai-harness/protocol";
import {
	diffLines,
	firstLine,
	foldUnchanged,
	itemsWaitingLabel,
	looseWaiting,
	refLabel,
	refUrl,
	rowGist,
	taskRefs,
	shortWriterLabel,
	taskChanges,
	taskFromUrl,
	taskSectionOf,
	taskSections,
	taskStatusTone,
	taskStatusToneClass,
	taskStatusWords,
	waitingOn,
	withTask,
	writerLabel,
} from "../src/lib/tasks.ts";

const web = fileURLToPath(new URL("..", import.meta.url));

describe("refs", () => {
	test("shows a ticket key or PR number as written and a link by what it points at", () => {
		expect(refLabel("EX-1234")).toBe("EX-1234");
		expect(refLabel(" #1234 ")).toBe("#1234");
		expect(refLabel("https://github.com/acme/core/pull/1234")).toBe("#1234");
		expect(refLabel("https://github.com/acme/core/pull/1234/files")).toBe("#1234");
		expect(refLabel("https://gitlab.com/a/b/-/merge_requests/12")).toBe("#12");
		expect(refLabel("https://acme.atlassian.net/browse/EX-1234")).toBe("EX-1234");
		expect(refLabel("https://www.example.com/docs/page")).toBe("example.com");
	});

	test("only http and https addresses are links", () => {
		expect(refUrl("https://example.com/a")?.href).toBe("https://example.com/a");
		expect(refUrl("EX-1234")).toBeUndefined();
		expect(refUrl("javascript:alert(1)")).toBeUndefined();
	});

	test("a task from a backend older than refs has none", () => {
		expect(taskRefs({ refs: ["#1"] })).toEqual(["#1"]);
		expect(taskRefs({} as Pick<BoardTask, "refs">)).toEqual([]);
	});
});

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
	return {
		id,
		revision: 1,
		text: `Question ${id}`,
		options: [],
		taskId,
		status: "open",
		answer: null,
		...overrides,
	} as BoardQuestion;
}

describe("the task link", () => {
	test("reads the task a URL names", () => {
		expect(taskFromUrl(new URL("https://x.test/b/h/projects/p?task=T12"))).toBe("T12");
		expect(taskFromUrl(new URL("https://x.test/b/h/projects/p?task="))).toBeNull();
		expect(taskFromUrl(new URL("https://x.test/b/h/projects/p"))).toBeNull();
	});

	test("opens and closes a task on the same page and keeps other parameters", () => {
		const url = new URL("https://x.test/b/h/projects/p/threads/t1?x=1#entry-4");
		expect(withTask(url, "T12")).toBe("/b/h/projects/p/threads/t1?x=1&task=T12");
		expect(withTask(new URL("https://x.test/p?task=T1"), null)).toBe("/p");
		expect(withTask(new URL("https://x.test/p?task=T1&x=1"), "T2")).toBe("/p?task=T2&x=1");
	});
});

describe("words", () => {
	test("says a status plainly", () => {
		expect(taskStatusWords("review")).toBe("Ready for review");
		expect(taskStatusWords("in_progress")).toBe("Working");
	});

	test("counts what waits for the user", () => {
		expect(itemsWaitingLabel([question("Q1", null)])).toBe("1 question waiting for you");
		expect(itemsWaitingLabel([{ kind: "warning" }])).toBe("1 warning waiting for you");
		expect(itemsWaitingLabel([question("Q1", null), { kind: "warning" }, { kind: "warning" }])).toBe(
			"1 question and 2 warnings waiting for you",
		);
	});

	test("names who wrote", () => {
		expect(writerLabel(null)).toBe("nobody yet");
		expect(writerLabel({ author: "user", threadId: null, workerId: null })).toBe("you");
		expect(writerLabel({ author: "coordinator", threadId: "main", workerId: null })).toBe("the coordinator");
		expect(writerLabel({ author: "worker", threadId: "main", workerId: "w1" }, [], () => "Parser fix")).toBe("Parser fix");
		expect(writerLabel({ author: "worker", threadId: "main", workerId: "w1" })).toBe("a worker");
	});

	test("names who wrote briefly, a worker by its id", () => {
		expect(shortWriterLabel({ author: "worker", threadId: "main", workerId: "status-bar-rewrite" })).toBe("status-bar-rewrite");
		expect(shortWriterLabel({ author: "worker", threadId: "main", workerId: null })).toBe("a worker");
		expect(shortWriterLabel({ author: "coordinator", threadId: "main", workerId: null })).toBe("the coordinator");
		expect(shortWriterLabel(null)).toBe("nobody yet");
	});

	test("gives every status one tone, coloured by a token base.css defines", () => {
		expect(taskStatusTone("in_progress")).toBe("working");
		expect(taskStatusTone("review")).toBe("review");
		expect(taskStatusTone("blocked")).toBe("blocked");
		expect(taskStatusTone("todo")).toBe("todo");
		expect(taskStatusTone("done")).toBe("done");
		expect(taskStatusTone("dropped")).toBe("dropped");
		expect(taskStatusToneClass("in_progress")).toBe("task-status-working");

		const css = readFileSync(`${web}src/lib/themes/base.css`, "utf8");
		for (const status of ["in_progress", "review", "blocked", "todo", "done", "dropped"] as const) {
			const tone = taskStatusTone(status);
			expect(css).toContain(`--task-status-${tone}:`);
			expect(css).toContain(`.task-status-${tone} {`);
		}
	});

	test("takes a report's first line as plain text", () => {
		expect(firstLine("\n- **Merged** the [fix](http://x) in `abc123`\n- more")).toBe("Merged the fix in abc123");
		expect(firstLine("")).toBe("");
		expect(firstLine("a".repeat(200), 20)).toBe(`${"a".repeat(19)}…`);
	});
});

describe("the Tasks view", () => {
	const questions = [
		question("Q1", "T2"),
		question("Q2", "T3", { kind: "warning" }),
		question("Q3", "T3"),
		question("Q4", "T5", { status: "answered", answer: "yes" }),
		question("Q5", null),
		question("Q6", "T99"),
	];

	test("lists a task's open questions with warnings first", () => {
		expect(waitingOn(questions, "T3").map((entry) => entry.id)).toEqual(["Q2", "Q3"]);
		expect(waitingOn(questions, "T5")).toEqual([]);
	});

	test("lists open questions that name no task on the board", () => {
		const board: Pick<Board, "tasks" | "questions"> = { tasks: [task("T2"), task("T3")], questions };
		expect(looseWaiting(board).map((entry) => entry.id)).toEqual(["Q5", "Q6"]);
	});

	test("puts a task where its need is greatest", () => {
		expect(taskSectionOf({ status: "in_progress" }, 1)).toBe("needs_you");
		expect(taskSectionOf({ status: "review" }, 0)).toBe("review");
		expect(taskSectionOf({ status: "review" }, 2)).toBe("needs_you");
		expect(taskSectionOf({ status: "done" }, 1)).toBe("closed");
		expect(taskSectionOf({ status: "blocked" }, 0)).toBe("blocked");
		expect(taskSectionOf({ status: "todo" }, 0)).toBe("todo");
	});

	test("groups tasks by what they need, in order, leaving empty groups out", () => {
		const tasks = [
			task("T1", { status: "done", settledAt: "2026-11-05T09:00:00Z" }),
			task("T2", { status: "in_progress" }),
			task("T3", { status: "review" }),
			task("T4", { status: "blocked" }),
			task("T5", { status: "in_progress" }),
			task("T6", { status: "dropped", settledAt: "2026-11-05T11:00:00Z" }),
			task("T7", { status: "todo", archived: true }),
		];
		const sections = taskSections({ tasks, questions });
		expect(sections.map((section) => section.id)).toEqual(["needs_you", "blocked", "working", "closed"]);
		expect(sections[0]?.rows.map((row) => row.task.id)).toEqual(["T3", "T2"]);
		expect(sections[2]?.rows.map((row) => row.task.id)).toEqual(["T5"]);
		expect(sections[3]?.rows.map((row) => row.task.id)).toEqual(["T6", "T1"]);
		expect(sections[3]?.collapsedByDefault).toBe(true);
		expect(taskSections({ tasks, questions }, { includeArchived: true }).some((section) => section.id === "todo")).toBe(true);
	});

	test("shows the line that matters for where a task stands", () => {
		const report = { now: "Running the tests", results: "- Merged abc123", next: "Review", revision: 1, updatedAt: null, updatedBy: null };
		const row = (status: BoardTask["status"], waiting: BoardQuestion[] = []) => {
			const entry = task("T1", { status, report, description: "Fix the parser", blockedReason: "Needs the key" });
			return { task: entry, waiting, section: taskSectionOf(entry, waiting.length) };
		};
		expect(rowGist(row("in_progress"))).toBe("Running the tests");
		expect(rowGist(row("review"))).toBe("Merged abc123");
		expect(rowGist(row("blocked"))).toBe("Needs the key");
		expect(rowGist(row("todo"))).toBe("Fix the parser");
		expect(rowGist(row("in_progress", [question("Q1", "T1")]))).toBe("Question Q1");
	});
});

describe("what changed between snapshots", () => {
	test("keeps the common lines and marks the rest", () => {
		expect(diffLines("a\nb\nc", "a\nc\nd")).toEqual([
			{ kind: "same", text: "a" },
			{ kind: "removed", text: "b" },
			{ kind: "same", text: "c" },
			{ kind: "added", text: "d" },
		]);
		expect(diffLines("a\n\n", "a")).toEqual([{ kind: "same", text: "a" }]);
		expect(diffLines("", "x")).toEqual([{ kind: "added", text: "x" }]);
	});

	test("folds runs of unchanged lines", () => {
		expect(foldUnchanged(diffLines("a\nb\nc\nd", "a\nb\nc\ne"))).toEqual([
			{ kind: "unchanged", count: 3 },
			{ kind: "removed", text: "d" },
			{ kind: "added", text: "e" },
		]);
	});

	test("reports the title, the status and only the sections that moved", () => {
		const before = { title: "Fix", status: "in_progress" as const, report: { now: "Testing", results: "- a", next: "" } };
		const after = { title: "Fix parser", status: "review" as const, report: { now: "", results: "- a", next: "Review it" } };
		const changes = taskChanges(before, after);
		expect(changes.title).toEqual({ from: "Fix", to: "Fix parser" });
		expect(changes.status).toEqual({ from: "in_progress", to: "review" });
		expect(changes.sections.map((section) => section.key)).toEqual(["now", "next"]);
		expect(changes.sections[0]?.lines).toEqual([{ kind: "removed", text: "Testing" }]);
	});

	test("reads a first snapshot as everything written", () => {
		const changes = taskChanges(undefined, { title: "Fix", status: "todo", report: { now: "", results: "- a", next: "" } });
		expect(changes.title).toBeUndefined();
		expect(changes.status).toBeUndefined();
		expect(changes.sections).toEqual([{ key: "results", label: "Results", lines: [{ kind: "added", text: "- a" }] }]);
	});
});
