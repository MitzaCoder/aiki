/**
 * Helpers on top of the protocol's thread types: which project a pushed list belongs to, which threads are background
 * ones, how a request names a thread, and which transcript inputs are what other threads posted (`[thread <id>
 * finished] …`, `[thread <id> failed: …]`, `[from <thread>] …`) rather than typed text.
 */
import {
	MAIN_THREAD_ID,
	THREAD_FINISHED_PREFIX,
	THREAD_MESSAGE_PREFIX,
	type ThreadsStateEvent,
	type ThreadSummary,
} from "@kemiri/protocol";

/** A project's threads as `threads.list` and `threads.state` carry them. */
export type ThreadsSnapshot = { threads: ThreadSummary[] };

/** Whether a pushed list belongs to the project this screen watches: one connection may watch several. */
export function threadsStateIsFor(state: Pick<ThreadsStateEvent, "projectId">, projectId: string): boolean {
	return state.projectId === projectId;
}

/** Whether a thread ID names main: absent, empty and "main" all do. */
export function isMainThread(threadId: string | null | undefined): boolean {
	return threadId === undefined || threadId === null || threadId === "" || threadId === MAIN_THREAD_ID;
}

/**
 * The `threadId` field a request carries: nothing for main, so a request for main reads exactly as it did before
 * threads and an older backend accepts it.
 */
export function threadField(threadId: string | null | undefined): { threadId?: string } {
	return isMainThread(threadId) ? {} : { threadId: threadId as string };
}

/** The background threads of a list, without main. */
export function backgroundThreads(threads: readonly ThreadSummary[]): ThreadSummary[] {
	return threads.filter((thread) => !thread.main && thread.id !== MAIN_THREAD_ID);
}

/** Whether a thread still has work ahead of it: running or idle, not failed, stopped or done. */
export function isThreadActive(thread: Pick<ThreadSummary, "status">): boolean {
	return thread.status === "running" || thread.status === "idle";
}

/** What another thread posted into this one, parsed from a user input. */
export type ThreadInput =
	| { kind: "finished"; threadId: string; summary: string }
	| { kind: "failed"; threadId: string; reason: string }
	| { kind: "message"; from: string; message: string }
	/** Starts like a thread input but in a shape this client does not know; shown as a generic thread notice. */
	| { kind: "other"; threadId: string | null; text: string };

/**
 * Parse an input another thread posted: `[thread <id> finished] <summary>`, `[thread <id> failed: <reason>]` (anything
 * after the bracket is kept with the reason), or `[from <thread>] <message>`. A bracket that starts like one but reads
 * otherwise is `other`, so the app still shows it as a thread notice and never as typed text. Undefined when the text
 * is not a thread input at all.
 */
export function parseThreadInput(text: string): ThreadInput | undefined {
	const trimmed = text.trimStart();
	if (trimmed.startsWith(THREAD_FINISHED_PREFIX)) {
		// The server writes `[thread <id> failed: <reason>]`, and a reason may hold brackets of its own.
		const failedWhole = /^\[thread (\S+) failed: ([\s\S]*)\]$/.exec(trimmed);
		if (failedWhole) return { kind: "failed", threadId: failedWhole[1] as string, reason: (failedWhole[2] as string).trim() };
		const close = trimmed.indexOf("]");
		if (close < 0) return undefined;
		const head = trimmed.slice(THREAD_FINISHED_PREFIX.length, close).trim();
		const rest = trimmed.slice(close + 1).trim();
		const finished = /^(\S+)\s+finished$/.exec(head);
		if (finished) return { kind: "finished", threadId: finished[1] as string, summary: rest };
		const failed = /^(\S+)\s+failed(?::\s*([\s\S]*))?$/.exec(head);
		if (failed) {
			const reason = [failed[2]?.trim() ?? "", rest].filter((part) => part.length > 0).join("\n\n");
			return { kind: "failed", threadId: failed[1] as string, reason };
		}
		const id = /^(\S+)/.exec(head)?.[1] ?? null;
		return { kind: "other", threadId: id, text: trimmed };
	}
	if (trimmed.startsWith(THREAD_MESSAGE_PREFIX)) {
		const close = trimmed.indexOf("]");
		if (close < 0) return undefined;
		const from = trimmed.slice(THREAD_MESSAGE_PREFIX.length, close).trim();
		if (from.length === 0 || from.includes("\n")) return undefined;
		return { kind: "message", from, message: trimmed.slice(close + 1).trim() };
	}
	return undefined;
}

/** Whether a user input is something another thread posted, not text the user typed. */
export function isThreadInput(text: string): boolean {
	return parseThreadInput(text) !== undefined;
}
