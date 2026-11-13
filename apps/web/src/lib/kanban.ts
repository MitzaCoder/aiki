/**
 * The Tasks board: the project's tasks in one column per status (To do, Working, Blocked, Ready for review, Done), and
 * what moving a card means. A move is the user changing the task's status, which the server passes on to the
 * coordinator as a `[board]` note; so the rules here are the board's own: only the agents put a task up for review, and
 * a task sent back from review needs the user's reason. Reordering To do sets the priority the coordinator works by;
 * the other columns sort themselves. Pure functions, so they are tested without a component.
 */
import { formatMinutes } from "@kemiri/client";
import type { Board, BoardQuestion, BoardTask, BoardTaskInput, BoardTaskStatus } from "@kemiri/protocol";
import { compactRelativeTime, relativeTime } from "./relative-time.ts";
import { isSettled, looseWaiting, rowGist, waitingOn, type TaskSectionId } from "./tasks.ts";

export type KanbanColumnId = "todo" | "working" | "blocked" | "review" | "waiting" | "done";

export const KANBAN_COLUMN_IDS: readonly KanbanColumnId[] = ["todo", "working", "blocked", "review", "waiting", "done"];

const COLUMN_LABELS: Record<KanbanColumnId, string> = {
	todo: "To do",
	working: "Working",
	blocked: "Blocked",
	review: "Ready for review",
	waiting: "Waiting",
	done: "Done",
};

/** What an empty column says. */
const COLUMN_EMPTY: Record<KanbanColumnId, string> = {
	todo: "Nothing waiting to start.",
	working: "Nothing running.",
	blocked: "Nothing stuck.",
	review: "Nothing to look at yet.",
	waiting: "No external dependencies waiting.",
	done: "Nothing closed this week.",
};

export function kanbanColumnLabel(id: KanbanColumnId): string {
	return COLUMN_LABELS[id];
}

/** The column a status sits in: done and dropped share Done. */
export function columnOfStatus(status: BoardTaskStatus): KanbanColumnId {
	switch (status) {
		case "todo":
			return "todo";
		case "in_progress":
			return "working";
		case "blocked":
			return "blocked";
		case "waiting":
			return "waiting";
		case "review":
			return "review";
		case "done":
		case "dropped":
			return "done";
		default:
			return "todo";
	}
}

export type KanbanCard = {
	task: BoardTask;
	/** The task's open questions and warnings, warnings first. A card with any wears the needs-you look. */
	waiting: BoardQuestion[];
	column: KanbanColumnId;
};

export type KanbanColumn = {
	id: KanbanColumnId;
	label: string;
	empty: string;
	cards: KanbanCard[];
	/** Closed tasks left out of Done because only the newest show; 0 elsewhere. */
	hidden: number;
};

/** How many closed tasks Done shows before "Show N more". */
export const DONE_SHOWN = 12;

function byOrder(left: BoardTask, right: BoardTask): number {
	return left.order - right.order || left.id.localeCompare(right.id, undefined, { numeric: true });
}

function timeOf(iso: string | null): number {
	const time = Date.parse(iso ?? "");
	return Number.isFinite(time) ? time : 0;
}

/**
 * How a column sorts: To do and Blocked by the board's order (To do's is the user's priority), Working by time in
 * progress (longest first), Ready for review by how long it has waited (longest first), Done by when it closed (newest
 * first).
 */
function compareIn(column: KanbanColumnId): (left: BoardTask, right: BoardTask) => number {
	switch (column) {
		case "working":
			return (left, right) => (right.inProgressMinutes ?? 0) - (left.inProgressMinutes ?? 0) || byOrder(left, right);
		case "review":
			return (left, right) => timeOf(left.updatedAt) - timeOf(right.updatedAt) || byOrder(left, right);
		case "done":
			return (left, right) => timeOf(right.settledAt ?? right.updatedAt) - timeOf(left.settledAt ?? left.updatedAt) || byOrder(left, right);
		default:
			return byOrder;
	}
}

/**
 * The board's columns, every one present even when empty. Archived tasks are left out unless asked for; Done shows the
 * newest `doneShown` closed tasks and counts the rest in `hidden`. `onlyNeedsYou` keeps just the cards with open
 * questions or warnings.
 */
export function kanbanColumns(
	board: Pick<Board, "tasks" | "questions">,
	options: { includeArchived?: boolean; doneShown?: number; onlyNeedsYou?: boolean } = {},
): KanbanColumn[] {
	const cards = board.tasks
		.filter((task) => options.includeArchived === true || !task.archived)
		.map((task): KanbanCard => ({ task, waiting: waitingOn(board.questions, task.id), column: columnOfStatus(task.status) }))
		.filter((card) => options.onlyNeedsYou !== true || card.waiting.length > 0);
	return KANBAN_COLUMN_IDS.map((id) => {
		const compare = compareIn(id);
		const inColumn = cards.filter((card) => card.column === id).sort((left, right) => compare(left.task, right.task));
		const limit = id === "done" ? (options.doneShown ?? DONE_SHOWN) : Number.POSITIVE_INFINITY;
		return {
			id,
			label: COLUMN_LABELS[id],
			empty: COLUMN_EMPTY[id],
			cards: inColumn.slice(0, limit),
			hidden: Math.max(0, inColumn.length - limit),
		};
	});
}

/**
 * The board header's "Needs you" count: open tasks with a question or warning waiting, plus the questions and warnings
 * that name no task.
 */
export function needsYouCount(board: Pick<Board, "tasks" | "questions">): number {
	const tasks = board.tasks.filter(
		(task) => !task.archived && !isSettled(task.status) && waitingOn(board.questions, task.id).length > 0,
	).length;
	return tasks + looseWaiting(board).length;
}

const COLUMN_SECTIONS: Record<KanbanColumnId, TaskSectionId> = {
	todo: "todo",
	working: "working",
	blocked: "blocked",
	review: "review",
	waiting: "waiting",
	done: "closed",
};

/** The line under a card's title: the waiting question when one is, else the report line that fits its column. */
export function cardGist(card: KanbanCard, activityEnabled = false): string {
	const section = card.waiting.length > 0 ? "needs_you" : COLUMN_SECTIONS[card.column];
	return rowGist({ task: card.task, waiting: card.waiting, section }, activityEnabled);
}

/**
 * A card's time and its tooltip: time in progress while working, how long it has waited in review, when it closed in
 * Done, else when it last changed.
 */
export function cardTime(card: KanbanCard, now: number): { text: string; title: string } {
	const { task } = card;
	switch (card.column) {
		case "working":
			if (task.inProgressMinutes !== undefined) {
				return { text: formatMinutes(task.inProgressMinutes), title: `${formatMinutes(task.inProgressMinutes)} in progress` };
			}
			break;
		case "review":
			return { text: compactRelativeTime(task.updatedAt, now), title: `Ready for review ${relativeTime(task.updatedAt, now)}` };
		case "done": {
			const at = task.settledAt ?? task.updatedAt;
			return { text: compactRelativeTime(at, now), title: `${task.status === "dropped" ? "Dropped" : "Done"} ${relativeTime(at, now)}` };
		}
	}
	return { text: compactRelativeTime(task.updatedAt, now), title: `Updated ${relativeTime(task.updatedAt, now)}` };
}

// --- moves -------------------------------------------------------------------------------------------------------

/** Where the user may move a task: any status but review, which is the agents' call. */
export type MoveTarget = Exclude<BoardTaskStatus, "review" | "waiting">;

export type MoveChoice = { target: MoveTarget; label: string; hint: string };

const MOVE_CHOICES: readonly MoveChoice[] = [
	{ target: "todo", label: "To do", hint: "Not started" },
	{ target: "in_progress", label: "Working", hint: "Start it now" },
	{ target: "blocked", label: "Blocked", hint: "Waiting on something" },
	{ target: "done", label: "Done", hint: "Close it" },
	{ target: "dropped", label: "Dropped", hint: "It will not be done" },
];

/** The moves a "Move to…" menu offers for a task: every target but where it already is. */
export function moveChoices(status: BoardTaskStatus): MoveChoice[] {
	return MOVE_CHOICES.filter((choice) => choice.target !== status);
}

/** The status a drop on a column means; undefined for Ready for review, which only the agents fill. */
export function dropTarget(column: KanbanColumnId, dropped = false): MoveTarget | undefined {
	switch (column) {
		case "todo":
			return "todo";
		case "working":
			return "in_progress";
		case "blocked":
			return "blocked";
		case "waiting":
		case "review":
			return undefined;
		case "done":
			return dropped ? "dropped" : "done";
	}
}

/**
 * What a move needs from the user first: sending a task back from review to work needs a reason the agents get;
 * blocking one asks, optionally, what it waits on. Other moves go at once.
 */
export type MoveQuestion = "none" | "reason" | "blocked-reason";

export function moveQuestion(from: BoardTaskStatus, to: MoveTarget): MoveQuestion {
	if (from === "review" && to === "in_progress") return "reason";
	if (to === "blocked" && from !== "blocked") return "blocked-reason";
	return "none";
}

/**
 * The save that moves a task: everything as it is but the status. A task leaving Blocked loses its reason (what it was
 * waiting on is over); one moved to Blocked takes the user's. Refs are left out, so the server keeps them.
 */
export function moveInput(task: BoardTask, to: MoveTarget, blockedReason?: string): BoardTaskInput {
	const reason = blockedReason?.trim() ?? "";
	return {
		title: task.title,
		description: task.description,
		acceptance: task.acceptance,
		status: to,
		blockedBy: [...task.blockedBy],
		blockedReason: to === "blocked" ? (reason.length > 0 ? reason : task.blockedReason) : null,
		writeScopes: [...task.writeScopes],
	};
}

/** To do's order with `taskId` put at `index` (counted without it): the IDs `board.tasks.reorder` takes. */
export function todoOrderWith(todoIds: readonly string[], taskId: string, index: number): string[] {
	const rest = todoIds.filter((id) => id !== taskId);
	const at = Math.max(0, Math.min(index, rest.length));
	return [...rest.slice(0, at), taskId, ...rest.slice(at)];
}

/** What the board says after a move, with an Undo beside it. */
export function moveNotice(task: Pick<BoardTask, "id">, to: MoveTarget): string {
	switch (to) {
		case "todo":
			return `${task.id} is back in To do.`;
		case "in_progress":
			return `${task.id} moved to Working. The coordinator will start it.`;
		case "blocked":
			return `${task.id} moved to Blocked.`;
		case "done":
			return `${task.id} is done.`;
		case "dropped":
			return `${task.id} was dropped.`;
	}
}

/**
 * The chat message that carries the reason on a backend whose saves take no note (older than `board-moves`): the
 * task chip says which task, this says why it is back.
 */
export function reasonMessage(reason: string): string {
	return `Back to working: ${reason.trim()}`;
}

// --- the remembered view -----------------------------------------------------------------------------------------

/** How the full-width Tasks view shows the tasks; the narrow sidebar always shows the list. */
export type TasksViewMode = "list" | "board" | "graph";

/** Per device, like the sidebar. */
export const TASKS_VIEW_STORAGE_KEY = "aiki.tasks-view.v1";

export function loadTasksViewMode(storage: Pick<Storage, "getItem"> | undefined = browserStorage(), scope?: string): TasksViewMode {
	try {
		const mode = storage?.getItem(scope ? `tasks.view.v2:${encodeURIComponent(scope)}` : TASKS_VIEW_STORAGE_KEY);
		return mode === "board" || mode === "graph" ? mode : "list";
	} catch {
		return "list";
	}
}

export function saveTasksViewMode(mode: TasksViewMode, storage: Pick<Storage, "setItem"> | undefined = browserStorage(), scope?: string): void {
	try {
		storage?.setItem(scope ? `tasks.view.v2:${encodeURIComponent(scope)}` : TASKS_VIEW_STORAGE_KEY, mode);
	} catch {
		// Storage can be full or disabled; the choice holds for this page.
	}
}

function browserStorage(): Storage | undefined {
	if (typeof window === "undefined") return undefined;
	try {
		return window.localStorage;
	} catch {
		return undefined;
	}
}
