/**
 * Background threads in the app's words: which calls and inputs are about a thread, how a thread reads, the Background
 * tab's order, the pinned questions, the board's owner chip, and the transcript's thread items.
 */
import { describe, expect, test } from "bun:test";
import type { BoardQuestion, EntryRecord, ThreadSummary } from "@kemiri/protocol";
import {
	backgroundThreadsText,
	isThreadTool,
	ownedTasksText,
	questionPin,
	questionAskedBy,
	runningWorkersText,
	sortThreads,
	startedThreadId,
	parseHandoff,
	checkInThreads,
	taskOwner,
	threadActivityLine,
	threadCallDetail,
	threadCallSummary,
	hasThreadCard,
	threadIdOfCall,
	threadName,
	threadStartedByText,
	threadStatusLabel,
	inThread,
} from "../src/lib/threads.ts";
import { buildTranscript } from "../src/lib/transcript.ts";
import { boardCallView } from "../src/lib/board.ts";

function thread(overrides: Partial<ThreadSummary> = {}): ThreadSummary {
	return {
		id: "jira-run",
		title: "Jira run",
		status: "running",
		main: false,
		startedBy: "main",
		scheduleId: null,
		conversationId: 7,
		model: null,
		thinkingLevel: null,
		onFinish: "review",
		runningWorkers: 0,
		ownedTasks: [],
		openQuestions: 0,
		current: null,
		summary: null,
		failure: null,
		createdAt: "2026-11-04T09:00:00.000Z",
		updatedAt: "2026-11-04T09:00:00.000Z",
		finishedAt: null,
		archived: false,
		...overrides,
	};
}

const MAIN = thread({ id: "main", title: "Main", main: true, startedBy: null });

describe("thread calls", () => {
	test("knows the thread tools", () => {
		expect(isThreadTool("thread_start")).toBe(true);
		expect(isThreadTool("thread_finish")).toBe(true);
		expect(isThreadTool("worker_spawn")).toBe(false);
	});

	test("finds the started thread in the details, JSON output or text", () => {
		expect(startedThreadId({ details: { threadId: "a1", conversationId: 7 } })).toBe("a1");
		expect(startedThreadId({ details: undefined })).toBeUndefined();
	});

	test("names the thread a call is about", () => {
		const threads = [MAIN, thread()];
		expect(threadIdOfCall({ name: "thread_send", arguments: { id: "jira-run", message: "skip PR 123" } })).toBe("jira-run");
		expect(threadIdOfCall({ name: "thread_peek", arguments: JSON.stringify({ id: "jira-run" }) })).toBe("jira-run");
		expect(threadIdOfCall({ name: "thread_start", arguments: { title: "Jira run" }, details: { threadId: "jira-run", conversationId: 9 } })).toBe(
			"jira-run",
		);
		// Still running: no result yet, so no thread.
		expect(threadIdOfCall({ name: "thread_start", arguments: { title: "Jira run" } })).toBeUndefined();
		expect(threadIdOfCall({ name: "bash", arguments: { id: "x" } })).toBeUndefined();
		expect(threadCallDetail({ name: "thread_send", arguments: { id: "x", message: "skip PR 123" } })).toBe("skip PR 123");
		expect(threadCallDetail({ name: "thread_start", arguments: { title: "t", brief: "Triage Jira" } })).toBe("Triage Jira");
	});
});

describe("how a thread reads", () => {
	test("says what it does now, or how it ended", () => {
		expect(threadStatusLabel("idle")).toBe("Waiting");
		expect(threadActivityLine(thread({ current: "Running bash · 3m" }))).toBe("Running bash · 3m");
		expect(threadActivityLine(thread({ status: "idle" }))).toBe("Waiting for a message or its workers.");
		expect(threadActivityLine(thread({ status: "failed", failure: "Model refused" }))).toBe("Model refused");
		expect(threadActivityLine(thread({ status: "done", summary: "## Done\nTriaged 12 tickets." }))).toBe("Done");
		expect(threadActivityLine(thread({ status: "stopped" }))).toBe("Stopped; nothing runs.");
	});

	test("counts workers, tasks and questions in words", () => {
		expect(runningWorkersText(0)).toBeUndefined();
		expect(runningWorkersText(1)).toBe("1 worker running");
		expect(runningWorkersText(3)).toBe("3 workers running");
		expect(ownedTasksText([])).toBeUndefined();
		expect(ownedTasksText(["T1", "T2"])).toBe("Owns T1, T2");
		expect(ownedTasksText(["T1", "T2", "T3", "T4", "T5"])).toBe("Owns T1, T2, T3 +2");
		expect(backgroundThreadsText(undefined)).toBeUndefined();
		expect(backgroundThreadsText(0)).toBeUndefined();
		expect(backgroundThreadsText(2)).toBe("2 in background");
	});

	test("says who started it", () => {
		expect(threadStartedByText(thread())).toBe("Started by main");
		expect(threadStartedByText(thread({ startedBy: "user" }))).toBe("Started by you");
		expect(threadStartedByText(thread({ startedBy: "schedule", scheduleId: "s1" }), () => "Nightly triage")).toBe(
			"Scheduled · Nightly triage",
		);
		expect(threadStartedByText(thread({ startedBy: "schedule", scheduleId: "s1" }))).toBe("Started by a schedule");
	});

	test("lists threads that need the user first, then by status and recency, without main", () => {
		const list = [
			MAIN,
			thread({ id: "done", status: "done", updatedAt: "2026-11-04T12:00:00.000Z" }),
			thread({ id: "idle", status: "idle", updatedAt: "2026-11-04T11:00:00.000Z" }),
			thread({ id: "asks", status: "idle", openQuestions: 1, updatedAt: "2026-11-04T08:00:00.000Z" }),
			thread({ id: "old-run", status: "running", updatedAt: "2026-11-04T09:00:00.000Z" }),
			thread({ id: "new-run", status: "running", updatedAt: "2026-11-04T10:00:00.000Z" }),
			thread({ id: "failed", status: "failed" }),
		];
		expect(sortThreads(list).map((entry) => entry.id)).toEqual(["asks", "new-run", "old-run", "idle", "failed", "done"]);
	});
});

describe("threads on the board", () => {
	const threads = [MAIN, thread()];

	test("names an owner and an asker", () => {
		expect(threadName("main", threads)).toBe("Main");
		expect(threadName(undefined, threads)).toBe("Main");
		expect(threadName("jira-run", threads)).toBe("Jira run");
		expect(threadName("gone", threads)).toBe("gone");
		expect(taskOwner({}, threads)).toBeUndefined();
		expect(taskOwner({ ownerThreadId: null }, threads)).toEqual({ claimed: false, label: "Unclaimed", threadId: null, main: false });
		expect(taskOwner({ ownerThreadId: "jira-run" }, threads)).toEqual({
			claimed: true,
			label: "Jira run",
			threadId: "jira-run",
			main: false,
		});
		expect(taskOwner({ ownerThreadId: "main" }, threads)?.main).toBe(true);
		expect(questionAskedBy({ threadId: "jira-run" }, threads)).toBe("Jira run");
		expect(questionAskedBy({ threadId: "main" }, threads)).toBeUndefined();
		expect(questionAskedBy({}, threads)).toBeUndefined();
	});

	test("pins one question to answer and lists the others, every asker first", () => {
		const q = (id: string, threadId?: string) => ({ id, ...(threadId === undefined ? {} : { threadId }) }) as BoardQuestion;
		const open = [q("Q1", "main"), q("Q2", "main"), q("Q3", "jira-run"), q("Q4", "docs")];
		expect(questionPin(open, undefined)).toEqual({ current: open[0], others: [open[2], open[3]], more: 1 });
		expect(questionPin(open, "Q3")).toEqual({ current: open[2], others: [open[0], open[3]], more: 1 });
		// A question answered elsewhere drops out; the pin falls back to the oldest.
		expect(questionPin(open, "Q9").current?.id).toBe("Q1");
		expect(questionPin([q("Q1"), q("Q2")], undefined)).toEqual({ current: q("Q1"), others: [q("Q2")], more: 0 });
		expect(questionPin([], undefined)).toEqual({ current: undefined, others: [], more: 0 });
	});

	test("reads claim, release and hand-over calls", () => {
		expect(boardCallView({ arguments: { action: "claim", id: "T4" } })?.summary).toBe("Claimed T4");
		expect(boardCallView({ arguments: { action: "release", id: "T4" } })?.summary).toBe("Released T4");
		expect(boardCallView({ arguments: { action: "handoff", id: "T4", toThread: "main" } })?.summary).toBe("Handed T4 over to main");
	});
});

test("keeps main's workers apart from a background thread's", () => {
	expect(inThread({}, undefined)).toBe(true);
	expect(inThread({ threadId: "main" }, undefined)).toBe(true);
	expect(inThread({ threadId: "jira-run" }, undefined)).toBe(false);
	expect(inThread({ threadId: "jira-run" }, "jira-run")).toBe(true);
	expect(inThread({}, "jira-run")).toBe(false);
});

describe("thread inputs in the transcript", () => {
	function userEntry(id: number, text: string): EntryRecord {
		return { id, conversationId: 1, kind: "pi.user", model: [{ role: "user", content: text, timestamp: 1_000 }] };
	}

	test("draws what threads post as thread items, never as typed text", () => {
		const items = buildTranscript(
			[
				userEntry(1, "[thread jira-run finished] Triaged **12** tickets."),
				userEntry(2, "[thread jira-run failed: out of budget]"),
				userEntry(3, "[from jira-run] Can you take PR 123?"),
				userEntry(4, "[thread jira-run paused by the harness]"),
				userEntry(5, "[from me] just a note"),
				userEntry(6, "Tell the thread to skip PR 123"),
			],
			undefined,
		);
		expect(items.map((item) => item.kind)).toEqual(["thread", "thread", "thread", "thread", "thread", "user"]);
		const [finished, failed, message, other] = items;
		expect(finished).toMatchObject({ kind: "thread", threadId: "jira-run", notice: { kind: "finished", summary: "Triaged **12** tickets." } });
		expect(failed).toMatchObject({ notice: { kind: "failed", reason: "out of budget" } });
		expect(message).toMatchObject({ threadId: "jira-run", notice: { kind: "message", message: "Can you take PR 123?" } });
		expect(other).toMatchObject({ threadId: "jira-run", notice: { kind: "other" } });
	});
});

describe("thread notes in other inputs", () => {
	test("reads a handoff from the board note's body", () => {
		expect(
			parseHandoff('Thread "jira-run" handed T1 "Fix the \\"parser\\"" (r4) to you. It is yours now: read it with the board tool and carry it on.'),
		).toEqual({ from: "jira-run", taskId: "T1", title: 'Fix the "parser"' });
		expect(parseHandoff("T1 moved to done.")).toBeUndefined();
	});

	test("lists the threads a check-in covers", () => {
		const body = "1 worker and 1 background thread are still running. Decide …\n\nw1 — task\n  status\n\nthread jira-run — Jira run\n  status: running";
		expect(checkInThreads(body)).toEqual([{ id: "jira-run", title: "Jira run" }]);
		expect(checkInThreads("2 workers are still running.")).toEqual([]);
	});
});

describe("one-line summaries of thread calls", () => {
	const call = (name: string, args: unknown, rest: Record<string, unknown> = {}) => ({
		name,
		arguments: args,
		status: "done",
		...rest,
	});

	test("thread_list says how many background threads it listed", () => {
		const output = 'You are main. 3 background threads.\n\nposter — Poster';
		expect(threadCallSummary(call("thread_list", {}, { output }))).toEqual({
			text: "Listed 3 background threads",
			failed: false,
			pending: false,
		});
		expect(threadCallSummary(call("thread_list", {}, { output: "You are main. 1 background thread.\n\nx" })).text).toBe(
			"Listed 1 background thread",
		);
		expect(threadCallSummary(call("thread_list", {}, { output: "You are main. No background threads.\n\nmain" })).text).toBe(
			"Listed no background threads",
		);
		expect(threadCallSummary(call("thread_list", {}, { output: "unreadable" })).text).toBe("Listed background threads");
	});

	test("thread_peek names the thread by its title, from the list or from the result", () => {
		const threads = [thread({ id: "poster", title: "Poster" })];
		expect(threadCallSummary(call("thread_peek", { id: "poster" }), threads).text).toBe("Looked in on Poster");
		expect(threadCallSummary(call("thread_peek", { id: "gone" }, { output: "gone — Old work\nstatus: done" })).text).toBe(
			"Looked in on Old work",
		);
		expect(threadCallSummary(call("thread_peek", { id: "gone" })).text).toBe("Looked in on gone");
		expect(threadCallSummary(call("thread_peek", { id: "main" })).text).toBe("Looked in on main");
	});

	test("a call in flight says so, and an error is marked failed", () => {
		expect(threadCallSummary(call("thread_peek", { id: "poster" }, { status: "running" })).text).toBe("Looking in on poster…");
		expect(threadCallSummary(call("thread_list", {}, { status: "running" })).pending).toBe(true);
		expect(threadCallSummary(call("thread_peek", { id: "x" }, { isError: true, output: "no such thread" }))).toEqual({
			text: "Could not look in on x",
			failed: true,
			pending: false,
		});
	});

	test("a thread tool the app does not know reads as words", () => {
		expect(threadCallSummary(call("thread_rename_all", {})).text).toBe("Ran thread rename all");
		expect(threadCallSummary(call("thread_rename_all", {}, { isError: true })).text).toBe("Thread rename all failed");
	});

	test("only list and peek have no card of their own", () => {
		expect(hasThreadCard("thread_start")).toBe(true);
		expect(hasThreadCard("thread_finish")).toBe(true);
		expect(hasThreadCard("thread_list")).toBe(false);
		expect(hasThreadCard("thread_peek")).toBe(false);
		expect(hasThreadCard("thread_unknown")).toBe(false);
	});
});
