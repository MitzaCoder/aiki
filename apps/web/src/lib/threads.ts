/**
 * Background threads in the app's words: which tool calls and transcript inputs are about a thread, how a thread's
 * status and current work read, the Background tab's order, and the labels the board, the pinned questions and the
 * schedules put on a thread. Pure functions, so the components only draw them.
 *
 * The user talks to main and never has to know which thread they are in, so everything here names a thread by its
 * title and says plainly that it works in the background.
 */
import type { Snippet } from "svelte";
import { isMainThread, parseThreadInput, type ThreadInput } from "@mihai-harness/client";
import {
	MAIN_THREAD_ID,
	type BoardQuestion,
	type BoardTask,
	type ThreadStatus,
	type ThreadSummary,
} from "@mihai-harness/protocol";

/** The coordinator's thread tools. `thread_finish` is a background thread's own. */
export const THREAD_TOOL_NAMES = [
	"thread_start",
	"thread_send",
	"thread_peek",
	"thread_list",
	"thread_stop",
	"thread_archive",
	"thread_finish",
] as const;
export type ThreadToolName = (typeof THREAD_TOOL_NAMES)[number];

export function isThreadTool(name: string): name is ThreadToolName {
	return (THREAD_TOOL_NAMES as readonly string[]).includes(name);
}

/** What a thread call did, as the card's first words. */
export function threadToolAction(name: string): string {
	switch (name) {
		case "thread_start":
			return "Started in the background";
		case "thread_send":
			return "Sent a message";
		case "thread_peek":
			return "Checked on it";
		case "thread_list":
			return "Listed background threads";
		case "thread_stop":
			return "Stopped it";
		case "thread_archive":
			return "Archived it";
		case "thread_finish":
			return "Finished";
		default:
			return name;
	}
}

/** The calls that have their own card, for the thread they start or act on; every other `thread_*` call is one line. */
export function hasThreadCard(name: string): boolean {
	return isThreadTool(name) && name !== "thread_list" && name !== "thread_peek";
}

type Args = Record<string, unknown>;

function asRecord(value: unknown): Args | undefined {
	if (typeof value === "string") {
		try {
			return asRecord(JSON.parse(value));
		} catch {
			return undefined;
		}
	}
	return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Args) : undefined;
}

function stringField(record: Args | undefined, key: string): string | undefined {
	const value = record?.[key];
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/** The thread a `thread_start` result created: the server puts `{ threadId, conversationId }` in its details. */
export function startedThreadId(result: { details?: unknown }): string | undefined {
	return stringField(asRecord(result.details), "threadId");
}

/** The thread a call is about: its `id` argument, or the thread `thread_start` created. */
export function threadIdOfCall(call: { name: string; arguments?: unknown; details?: unknown }): string | undefined {
	if (!isThreadTool(call.name)) return undefined;
	if (call.name === "thread_start") return startedThreadId(call);
	return stringField(asRecord(call.arguments), "id");
}

/** What a thread call shows besides the thread: the message sent, the brief, the stop's reason. */
export function threadCallDetail(call: { name: string; arguments?: unknown }): string | undefined {
	const args = asRecord(call.arguments);
	switch (call.name) {
		case "thread_start":
			return stringField(args, "brief");
		case "thread_send":
			return stringField(args, "message");
		case "thread_finish":
			return stringField(args, "summary");
		default:
			return undefined;
	}
}

/** The title a `thread_start` gave, for a card whose thread the list does not have (yet, or any more). */
export function threadCallTitle(call: { arguments?: unknown }): string | undefined {
	return stringField(asRecord(call.arguments), "title");
}

export type ThreadTone = "running" | "idle" | "done" | "failed" | "stopped";

export function threadStatusLabel(status: ThreadStatus): string {
	switch (status) {
		case "running":
			return "Working";
		case "idle":
			return "Waiting";
		case "failed":
			return "Failed";
		case "stopped":
			return "Stopped";
		case "done":
			return "Finished";
	}
}

/** The status badge's colours, in the chat's tokens; red only for a failure. */
export function threadStatusClass(status: ThreadStatus): string {
	switch (status) {
		case "running":
			return "border-(--accent-2)/40 bg-(--accent-2)/10 text-(--accent-2)";
		case "idle":
			return "border-(--chat-border) bg-(--chat-surface-2) text-(--chat-fg-muted)";
		case "failed":
			return "border-(--chat-danger)/40 bg-(--chat-danger)/10 text-(--chat-danger)";
		case "stopped":
			return "border-(--chat-border) bg-transparent text-(--chat-fg-subtle)";
		case "done":
			return "border-(--chat-success)/40 bg-(--chat-success)/10 text-(--chat-success)";
	}
}

/** "2 workers running", or nothing. */
export function runningWorkersText(count: number): string | undefined {
	if (count <= 0) return undefined;
	return count === 1 ? "1 worker running" : `${count} workers running`;
}

/** "Owns T3, T7", or nothing. Long lists keep the first three and count the rest. */
export function ownedTasksText(taskIds: readonly string[]): string | undefined {
	if (taskIds.length === 0) return undefined;
	const shown = taskIds.slice(0, 3).join(", ");
	return taskIds.length > 3 ? `Owns ${shown} +${taskIds.length - 3}` : `Owns ${shown}`;
}

/** "Needs you: 1 question", or nothing. */
export function openQuestionsText(count: number): string | undefined {
	if (count <= 0) return undefined;
	return count === 1 ? "1 question for you" : `${count} questions for you`;
}

/** The one line under a thread's title: what it does now, or how it ended. */
export function threadActivityLine(thread: Pick<ThreadSummary, "status" | "current" | "failure" | "summary">): string {
	if (thread.status === "failed") return thread.failure ?? "Its last turn failed.";
	if (thread.status === "stopped") return "Stopped; nothing runs.";
	if (thread.status === "done") return firstLine(thread.summary) ?? "Finished.";
	if (thread.current !== null && thread.current.trim().length > 0) return thread.current;
	return thread.status === "running" ? "Working…" : "Waiting for a message or its workers.";
}

function firstLine(text: string | null): string | undefined {
	const line = text
		?.split("\n")
		.map((part) => part.replace(/^#+\s*/, "").trim())
		.find((part) => part.length > 0);
	return line === undefined ? undefined : line.length > 140 ? `${line.slice(0, 139)}…` : line;
}

/** Who started a thread, in words: "Started by main", "Scheduled · Nightly triage", "Started by you". */
export function threadStartedByText(
	thread: Pick<ThreadSummary, "startedBy" | "scheduleId">,
	scheduleName?: (scheduleId: string) => string | undefined,
): string {
	switch (thread.startedBy) {
		case "schedule": {
			const name = thread.scheduleId === null ? undefined : scheduleName?.(thread.scheduleId);
			return name === undefined ? "Started by a schedule" : `Scheduled · ${name}`;
		}
		case "user":
			return "Started by you";
		case "main":
			return "Started by main";
		default:
			return "Main";
	}
}

/**
 * The Background tab's order: threads still at work first (one that needs the user before the others), then the
 * settled ones, newest change first inside each group. Main is not listed.
 */
export function sortThreads(threads: readonly ThreadSummary[]): ThreadSummary[] {
	const rank = (thread: ThreadSummary): number =>
		thread.openQuestions > 0 && (thread.status === "running" || thread.status === "idle")
			? 0
			: thread.status === "running"
				? 1
				: thread.status === "idle"
					? 2
					: thread.status === "failed"
						? 3
						: 4;
	return threads
		.filter((thread) => !thread.main && thread.id !== MAIN_THREAD_ID)
		.sort((a, b) => rank(a) - rank(b) || b.updatedAt.localeCompare(a.updatedAt));
}

/** The name a thread goes by on the board and the question cards: its title, "Main" for main, else its ID. */
export function threadName(threadId: string | null | undefined, threads: readonly ThreadSummary[]): string {
	if (isMainThread(threadId)) return "Main";
	const thread = threads.find((entry) => entry.id === threadId);
	return thread?.title || (threadId as string);
}

/** Which thread asked a question: undefined for main (or an older server), so main's questions read as before. */
export function questionAskedBy(question: Pick<BoardQuestion, "threadId">, threads: readonly ThreadSummary[]): string | undefined {
	if (isMainThread(question.threadId)) return undefined;
	return threadName(question.threadId, threads);
}

/** A task's claim, for the board's owner chip; undefined for a server without claims. */
export type TaskOwner = { claimed: boolean; label: string; threadId: string | null; main: boolean };

export function taskOwner(task: Pick<BoardTask, "ownerThreadId">, threads: readonly ThreadSummary[]): TaskOwner | undefined {
	if (task.ownerThreadId === undefined) return undefined;
	if (task.ownerThreadId === null) return { claimed: false, label: "Unclaimed", threadId: null, main: false };
	const main = isMainThread(task.ownerThreadId);
	return { claimed: true, label: threadName(task.ownerThreadId, threads), threadId: task.ownerThreadId, main };
}

/** How the left sidebar notes a project's background threads: "2 in background", or nothing. */
export function backgroundThreadsText(count: number | undefined): string | undefined {
	if (count === undefined || count <= 0) return undefined;
	return `${count} in background`;
}

// --- the transcript ----------------------------------------------------------------------------------------------

/** What another thread posted into this one, as the transcript draws it. */
export type ThreadNotice = ThreadInput;

export function parseThreadNotice(text: string): ThreadNotice | undefined {
	return parseThreadInput(text);
}

/** The thread a notice is about, for its card's link and highlight. */
export function threadIdOfNotice(notice: ThreadNotice): string | null {
	return notice.kind === "message" ? notice.from : notice.threadId;
}

/**
 * Whether a worker or a board question belongs to a thread: main's carry no thread (an older server) or "main"; a
 * background thread's carry its ID.
 */
export function inThread(item: { threadId?: string }, threadId: string | undefined): boolean {
	if (isMainThread(threadId)) return isMainThread(item.threadId);
	return item.threadId === threadId;
}

/**
 * What the transcript needs to draw thread cards: the live list (so a card follows `threads.state`), where a thread
 * opens, and the slot that lists a thread's artifacts under its finished card.
 */
export type ThreadCards = {
	threads: readonly ThreadSummary[];
	href: (threadId: string) => string;
	scheduleName?: (scheduleId: string) => string | undefined;
	/** A thread's artifacts under its finished card: those saved by the finish (epoch ms), when it is known. */
	artifacts?: Snippet<[threadId: string, finishedAt: number | undefined]>;
};

/**
 * What the question pin above the composer shows: one question open to answer (the chosen one, else the oldest), and
 * the others waiting as one-line rows the user taps to switch to, so the pin stays small on a phone. The rows give
 * every other asker a turn before a second question from the same one; the rest is counted for the Board.
 */
export function questionPin<T extends Pick<BoardQuestion, "id" | "threadId">>(
	open: readonly T[],
	chosenId: string | undefined,
	rows = 2,
): { current: T | undefined; others: T[]; more: number } {
	const current = open.find((question) => question.id === chosenId) ?? open[0];
	const rest = open.filter((question) => question !== current);
	const asker = (question: T): string => (isMainThread(question.threadId) ? MAIN_THREAD_ID : (question.threadId as string));
	const seen = new Set(current === undefined ? [] : [asker(current)]);
	const first: T[] = [];
	const later: T[] = [];
	for (const question of rest) {
		if (seen.has(asker(question))) later.push(question);
		else {
			seen.add(asker(question));
			first.push(question);
		}
	}
	const others = [...first, ...later].slice(0, rows);
	return { current, others: rest.filter((question) => others.includes(question)), more: rest.length - others.length };
}

/** A task another thread handed to this one: the `[board]` note's body, `Thread "<from>" handed T1 "<title>" (rN) to you. …`. */
export type Handoff = { from: string; taskId: string; title: string };

export function parseHandoff(body: string): Handoff | undefined {
	const match = /^Thread "([^"]+)" handed (\S+) ("(?:[^"\\]|\\.)*") \(r\d+\) to you\./.exec(body.trim());
	if (match === null) return undefined;
	let title: string;
	try {
		title = JSON.parse(match[3] as string) as string;
	} catch {
		return undefined;
	}
	return { from: match[1] as string, taskId: match[2] as string, title };
}

/** The background threads a check-in covers: its digests that start `thread <id> — <title>`. */
export function checkInThreads(body: string): { id: string; title: string }[] {
	return [...body.matchAll(/^thread (\S+) — (.+)$/gm)].map((match) => ({ id: match[1] as string, title: (match[2] as string).trim() }));
}

/** One line for a `thread_*` call: what it did, whether it still runs, and whether it failed. */
export type ThreadCallSummary = { text: string; failed: boolean; pending: boolean };

/** "thread_foo_bar" as words, for a thread tool this app does not know. */
function threadToolWords(name: string): string {
	const words = name.replace(/^thread_/, "").replace(/_/g, " ").trim();
	return words.length === 0 ? "thread" : words;
}

/** The count a `thread_list` result opens with ("3 background threads." or "No background threads."). */
function listedThreadCount(output: string | undefined): number | undefined {
	if (output === undefined) return undefined;
	if (/No background threads\./.test(output)) return 0;
	const match = /(\d+) background threads?\./.exec(output);
	return match === null ? undefined : Number(match[1]);
}

/** The title in a `thread_peek` result's first line, "<id> — <title>". */
function peekedTitle(output: string | undefined): string | undefined {
	const first = output?.split("\n", 1)[0];
	const dash = first?.indexOf(" — ") ?? -1;
	return first === undefined || dash < 0 ? undefined : first.slice(dash + 3).trim() || undefined;
}

function callTargetName(call: { name: string; arguments?: unknown; output?: string }, threads: readonly ThreadSummary[]): string {
	const id = threadIdOfCall(call) ?? stringField(asRecord(call.arguments), "id");
	if (id === undefined) return threadCallTitle(call) ?? "a thread";
	if (isMainThread(id)) return "main";
	return threads.find((entry) => entry.id === id)?.title || (call.name === "thread_peek" ? peekedTitle(call.output) : undefined) || id;
}

export function threadCallSummary(
	call: { name: string; arguments?: unknown; output?: string; isError?: boolean; status: string },
	threads: readonly ThreadSummary[] = [],
): ThreadCallSummary {
	const failed = call.isError === true;
	const pending = !failed && call.status !== "done";
	const target = callTargetName(call, threads);
	const verbs: Record<string, [string, string, string]> = {
		thread_list: ["Listing background threads", "Listed background threads", "Could not list background threads"],
		thread_peek: [`Looking in on ${target}`, `Looked in on ${target}`, `Could not look in on ${target}`],
		thread_start: [`Starting ${target} in the background`, `Started ${target} in the background`, `Could not start ${target}`],
		thread_send: [`Messaging ${target}`, `Messaged ${target}`, `Could not message ${target}`],
		thread_stop: [`Stopping ${target}`, `Stopped ${target}`, `Could not stop ${target}`],
		thread_archive: [`Archiving ${target}`, `Archived ${target}`, `Could not archive ${target}`],
		thread_finish: ["Finishing the thread", "Finished the thread", "Could not finish the thread"],
	};
	const words = threadToolWords(call.name);
	const [running, done, error] = verbs[call.name] ?? [
		`Running thread ${words}`,
		`Ran thread ${words}`,
		`Thread ${words} failed`,
	];
	let text = failed ? error : pending ? running : done;
	if (call.name === "thread_list" && !failed && !pending) {
		const count = listedThreadCount(call.output);
		if (count !== undefined) text = `Listed ${count === 0 ? "no" : count} background thread${count === 1 ? "" : "s"}`;
	}
	return { text: pending ? `${text}…` : text, failed, pending };
}
