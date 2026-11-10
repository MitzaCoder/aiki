/**
 * Helpers on top of the protocol's board types: which project a pushed board belongs to, how a refused change reads, and
 * which transcript inputs are the harness's `[board]` notes, and how long a task has been in progress.
 */
import { BOARD_PREFIX, TASK_REFERENCE_PREFIX, type Board, type BoardStateEvent, type BoardTask } from "@aiki/protocol";

/** A project's board as `board.get` and `board.state` carry it. */
export type BoardSnapshot = { board: Board };

/** The server's error code for a change made on a revision the row has moved past. */
export const BOARD_CONFLICT_CODE = "board_conflict";

/** Whether a pushed board belongs to the project this screen watches: one connection may watch several. */
export function boardStateIsFor(state: Pick<BoardStateEvent, "projectId">, projectId: string): boolean {
	return state.projectId === projectId;
}

/**
 * Whether an error is the server refusing a task save or an answer because the row changed since it was read. Nothing was
 * written then; the caller reads the row again and lets the user decide.
 */
export function boardConflict(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		(error as { code?: unknown }).code === BOARD_CONFLICT_CODE
	);
}

/** Whether a user input is a note the harness posted about the board (`[board]` and what changed), not typed text. */
export function isBoardMessage(text: string): boolean {
	const trimmed = text.trimStart();
	if (!trimmed.startsWith(BOARD_PREFIX)) return false;
	const next = trimmed.charAt(BOARD_PREFIX.length);
	return next === "" || /\s/.test(next);
}

/**
 * The task a user message names, from the `[task T12] ` (or `[task T12, feedback F3] `) the server puts in front of it,
 * and the text after it. Text without the prefix comes back with a null `taskId`; `feedbackId` is null unless the server
 * recorded the message as feedback.
 */
export function parseTaskReference(text: string): { taskId: string | null; feedbackId: string | null; text: string } {
	if (!text.startsWith(TASK_REFERENCE_PREFIX)) return { taskId: null, feedbackId: null, text };
	const end = text.indexOf("]", TASK_REFERENCE_PREFIX.length);
	if (end < 0) return { taskId: null, feedbackId: null, text };
	const [taskId = "", rest] = text.slice(TASK_REFERENCE_PREFIX.length, end).split(",", 2).map((part) => part.trim());
	if (taskId === "" || /\s/.test(taskId)) return { taskId: null, feedbackId: null, text };
	const feedbackId = rest?.match(/^feedback (\S+)$/)?.[1] ?? null;
	return { taskId, feedbackId, text: text.slice(end + 1).replace(/^ /, "") };
}

/** The input text for a message about a task, as the server writes it. */
export function withTaskReference(taskId: string, text: string): string {
	return `${TASK_REFERENCE_PREFIX}${taskId}] ${text}`;
}

/** Minutes as a person reads them: `45m`, `2h`, `1h 30m`. */
export function formatMinutes(minutes: number): string {
	const whole = Math.max(0, Math.round(minutes));
	if (whole < 60) return `${whole}m`;
	const hours = Math.floor(whole / 60);
	const rest = whole % 60;
	return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/**
 * How long a task has been in progress, as a task row and the editor show it: "In progress 1h 20m". Undefined when the
 * server does not track the time (an older one sends no `inProgressMinutes`).
 */
export function inProgressText(task: Pick<BoardTask, "inProgressMinutes">): string | undefined {
	if (task.inProgressMinutes === undefined) return undefined;
	return `In progress ${formatMinutes(task.inProgressMinutes)}`;
}
