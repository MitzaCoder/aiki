import { markdownText } from '@kemiri/protocol';
/**
 * How the board reads in the app: tasks grouped by status, the questions waiting on the user, a task's editor draft and
 * the checks on it, the order after a move, and the transcript's one-line cards for the coordinator's `board` calls and
 * the harness' `[board]` notes. Pure functions, so they are tested without a component.
 */
import { isBoardMessage } from "@kemiri/client";
import {
	BOARD_PREFIX,
	type Board,
	type BoardDecision,
	type BoardQuestion,
	type BoardTask,
	type BoardTaskInput,
	type BoardTaskStatus,
	type ProjectActivity,
} from "@kemiri/protocol";

/** The statuses in the order the editor offers them. */
export const TASK_STATUSES: readonly BoardTaskStatus[] = ["todo", "in_progress", "blocked", "review", "done", "dropped"];

export function taskStatusLabel(status: BoardTaskStatus): string {
	switch (status) {
		case "todo":
			return "Todo";
		case "in_progress":
			return "In progress";
		case "blocked":
			return "Blocked";
		case "waiting":
			return "Waiting";
		case "review":
			return "Review";
		case "done":
			return "Done";
		case "dropped":
			return "Dropped";
	}
}

/** Badge colours per status, in the chat's tokens so a theme carries them. */
export function taskStatusClass(status: BoardTaskStatus): string {
	switch (status) {
		case "in_progress":
			return "border-transparent bg-(--accent-2)/15 text-(--accent-2)";
		case "waiting":
		case "review":
			return "border-(--chat-warning)/40 bg-(--chat-warning)/10 text-(--chat-warning)";
		case "blocked":
			return "border-(--chat-danger)/40 bg-(--chat-danger)/10 text-(--chat-danger)";
		case "todo":
			return "border-(--chat-border) text-(--chat-fg-muted)";
		case "done":
		case "dropped":
			return "border-(--chat-border) text-(--chat-fg-subtle)";
	}
}

export type TaskGroup = {
	status: BoardTaskStatus;
	label: string;
	tasks: BoardTask[];
	/** Done and dropped tasks are history: their groups start folded. */
	collapsedByDefault: boolean;
};

const GROUP_ORDER: readonly BoardTaskStatus[] = ["in_progress", "review", "waiting", "blocked", "todo", "done", "dropped"];

function byOrder(left: BoardTask, right: BoardTask): number {
	return left.order - right.order || left.id.localeCompare(right.id, undefined, { numeric: true });
}

/** Tasks grouped in the order the panel shows them. Archived tasks only show when asked for; empty groups are left out. */
export function groupTasks(tasks: readonly BoardTask[], options: { includeArchived?: boolean } = {}): TaskGroup[] {
	const shown = tasks.filter((task) => options.includeArchived === true || !task.archived);
	const groups: TaskGroup[] = [];
	for (const status of GROUP_ORDER) {
		const inGroup = shown.filter((task) => task.status === status || (status === "todo" && !GROUP_ORDER.includes(task.status))).sort(byOrder);
		if (inGroup.length === 0) continue;
		groups.push({
			status,
			label: taskStatusLabel(status),
			tasks: inGroup,
			collapsedByDefault: status === "done" || status === "dropped" || status === "waiting",
		});
	}
	return groups;
}

export function archivedCount(tasks: readonly BoardTask[]): number {
	return tasks.filter((task) => task.archived).length;
}

export function openQuestions(board: Pick<Board, "questions">): BoardQuestion[] {
	return board.questions.filter((question) => question.status === "open");
}

export function answeredQuestions(board: Pick<Board, "questions">): BoardQuestion[] {
	return board.questions.filter((question) => question.status === "answered");
}

/** What a project's row shows: nothing for zero or a server that does not report it, else the count capped at 9+. */
export function questionBadgeText(count: number | undefined): string | undefined {
	if (count === undefined || !Number.isFinite(count) || count <= 0) return undefined;
	return count > 9 ? "9+" : String(Math.floor(count));
}

export function activityOpenQuestions(activity: Pick<ProjectActivity, "openQuestions"> | undefined): number {
	return activity?.openQuestions ?? 0;
}

export function questionsWaitingLabel(count: number): string {
	return count === 1 ? "1 question waiting for you" : `${count} questions waiting for you`;
}

/** The decisions a task or question is tied to, newest first as the board has them. */
export function decisionsFor(decisions: readonly BoardDecision[], taskId: string): BoardDecision[] {
	return decisions.filter((decision) => decision.taskId === taskId);
}

export type Blocker = { id: string; title: string; status: BoardTaskStatus | "unknown"; settled: boolean };

/** The tasks a task waits for, with whether each is finished (done or dropped). An unknown ID is an archived or removed task. */
export function blockersOf(task: Pick<BoardTask, "blockedBy">, tasks: readonly BoardTask[]): Blocker[] {
	return task.blockedBy.map((id) => {
		const found = tasks.find((entry) => entry.id === id);
		if (found === undefined) return { id, title: "", status: "unknown", settled: true };
		return { id, title: found.title, status: found.status, settled: found.status === "done" || found.status === "dropped" };
	});
}

/** Ordered IDs of the tasks the panel can reorder: the non-archived ones, by order. */
export function orderedTaskIds(tasks: readonly BoardTask[]): string[] {
	return tasks.filter((task) => !task.archived).sort(byOrder).map((task) => task.id);
}

/**
 * The full order after moving a task within its status group: `delta` places up or down, or to `toIndex` in the group.
 * Other groups keep their places in the order. Undefined when nothing would move.
 */
export function reorderedIds(
	tasks: readonly BoardTask[],
	taskId: string,
	move: { delta: number } | { toIndex: number },
): string[] | undefined {
	const moved = tasks.find((task) => task.id === taskId);
	if (moved === undefined) return undefined;
	const all = orderedTaskIds(tasks);
	const group = all.filter((id) => tasks.find((task) => task.id === id)?.status === moved.status);
	const from = group.indexOf(taskId);
	if (from === -1) return undefined;
	const to = "delta" in move ? from + move.delta : move.toIndex;
	const clamped = Math.max(0, Math.min(group.length - 1, to));
	if (clamped === from) return undefined;
	const nextGroup = [...group];
	nextGroup.splice(from, 1);
	nextGroup.splice(clamped, 0, taskId);
	// The group's slots in the full order are refilled in the new sequence.
	let cursor = 0;
	return all.map((id) => (group.includes(id) ? (nextGroup[cursor++] as string) : id));
}

// --- the task editor ---------------------------------------------------------------------------------------------

/** What the editor holds: the task's input with the list fields as text the user types. */
export type TaskDraft = {
	title: string;
	description: string;
	acceptance: string;
	/** Tickets, PR numbers and links, one per line. */
	refs: string;
	status: BoardTaskStatus;
	blockedBy: string[];
	blockedReason: string;
	/** One path per line. */
	writeScopes: string;
};

export function emptyDraft(): TaskDraft {
	return { title: "", description: "", acceptance: "", refs: "", status: "todo", blockedBy: [], blockedReason: "", writeScopes: "" };
}

export function draftFromTask(task: BoardTask): TaskDraft {
	return {
		title: task.title,
		description: task.description,
		acceptance: task.acceptance ?? "",
		refs: (task.refs ?? []).join("\n"),
		status: task.status,
		blockedBy: [...task.blockedBy],
		blockedReason: task.blockedReason ?? "",
		writeScopes: task.writeScopes.join("\n"),
	};
}

/** Lines or comma-separated entries, trimmed, without empties or repeats. */
export function parseList(text: string): string[] {
	const seen = new Set<string>();
	for (const entry of text.split(/[\n,]/)) {
		const trimmed = entry.trim();
		if (trimmed.length > 0) seen.add(trimmed);
	}
	return [...seen];
}

export function draftToInput(draft: TaskDraft): BoardTaskInput {
	const acceptance = draft.acceptance.trim();
	const reason = draft.blockedReason.trim();
	return {
		title: draft.title.trim(),
		description: draft.description.trim(),
		acceptance: acceptance.length === 0 ? null : acceptance,
		refs: parseList(draft.refs),
		status: draft.status,
		blockedBy: [...new Set(draft.blockedBy)],
		blockedReason: reason.length === 0 ? null : reason,
		writeScopes: parseList(draft.writeScopes),
	};
}

function inputOfTask(task: BoardTask): BoardTaskInput {
	return draftToInput(draftFromTask(task));
}

/** The fields the editor shows. The links (`parent`, `foundWhile`, `related`) are not in it: a save that leaves them out keeps them. */
const FIELD_LABELS: Record<Exclude<keyof BoardTaskInput, "parent" | "foundWhile" | "related" | "waitingFor" | "waitUntil">, string> = {
	title: "Title",
	description: "Description",
	acceptance: "Acceptance",
	refs: "Tickets and links",
	status: "Status",
	blockedBy: "Blocked by",
	blockedReason: "Blocked reason",
	writeScopes: "Write scopes",
};

/** The fields where the draft differs from a task, by label; empty when the draft says what the task says. */
export function changedFields(draft: TaskDraft, task: BoardTask): string[] {
	const mine = draftToInput(draft);
	const theirs = inputOfTask(task);
	return (Object.keys(FIELD_LABELS) as (keyof typeof FIELD_LABELS)[])
		.filter((key) => JSON.stringify(mine[key]) !== JSON.stringify(theirs[key]))
		.map((key) => FIELD_LABELS[key]);
}

/** Whether a task listed `blockerId` anywhere in its chain of dependencies. */
function dependsOn(tasks: readonly BoardTask[], taskId: string, targetId: string, seen = new Set<string>()): boolean {
	if (seen.has(taskId)) return false;
	seen.add(taskId);
	const task = tasks.find((entry) => entry.id === taskId);
	if (task === undefined) return false;
	return task.blockedBy.some((id) => id === targetId || dependsOn(tasks, id, targetId, seen));
}

/** The tasks a task may wait for: not itself and not one that waits for it, so the graph stays acyclic. */
export function blockerChoices(tasks: readonly BoardTask[], taskId: string | undefined): BoardTask[] {
	return tasks
		.filter((task) => task.id !== taskId)
		.filter((task) => taskId === undefined || !dependsOn(tasks, task.id, taskId))
		.sort(byOrder);
}

/** What stops a draft from being saved, or undefined. The server checks again; this spares a round trip. */
export function draftProblem(draft: TaskDraft, taskId: string | undefined, tasks: readonly BoardTask[]): string | undefined {
	if (draft.title.trim().length === 0) return "A task needs a title.";
	if (taskId !== undefined && draft.blockedBy.includes(taskId)) return "A task cannot wait for itself.";
	if (taskId !== undefined) {
		const cyclic = draft.blockedBy.find((id) => dependsOn(tasks, id, taskId));
		if (cyclic !== undefined) return `${cyclic} already waits for ${taskId}.`;
	}
	return undefined;
}

export function draftIsDirty(draft: TaskDraft, task: BoardTask | undefined): boolean {
	if (task === undefined) return JSON.stringify(draftToInput(draft)) !== JSON.stringify(draftToInput(emptyDraft()));
	return changedFields(draft, task).length > 0;
}

/** The text a changed field shows in the "newer version" view. */
export function fieldValueText(task: BoardTask, label: string): string {
	switch (label) {
		case "Title":
			return task.title;
		case "Description":
			return task.description.length === 0 ? "(empty)" : task.description;
		case "Acceptance":
			return task.acceptance ?? "(none)";
		case "Tickets and links":
			return (task.refs ?? []).length === 0 ? "(none)" : task.refs.join(", ");
		case "Status":
			return taskStatusLabel(task.status);
		case "Blocked by":
			return task.blockedBy.length === 0 ? "(nothing)" : task.blockedBy.join(", ");
		case "Blocked reason":
			return task.blockedReason ?? "(none)";
		case "Write scopes":
			return task.writeScopes.length === 0 ? "(none)" : task.writeScopes.join(", ");
		default:
			return "";
	}
}

/** Who last changed a row, for the conflict notice. */
export function authorLabel(author: BoardTask["updatedBy"]): string {
	return author === "user" ? "you" : author === "coordinator" ? "the coordinator" : "the harness";
}

// --- the transcript ----------------------------------------------------------------------------------------------

/** A `[board]` note the harness posted: what changed, in the harness' words, addressed to the reader (the notes say "The user" to the model). */
export function parseBoardNotice(text: string): { summary: string; body: string } | undefined {
	if (!isBoardMessage(text)) return undefined;
	const rest = text
		.trimStart()
		.slice(BOARD_PREFIX.length)
		.trim()
		.replace(/^The user (answered|changed) /, "You $1 ");
	const [head = "", ...after] = rest.split("\n");
	const summary = head.trim();
	// "You changed the board:" on its own says nothing; the list under it does, so the line carries its first change
	// and the rest of the list opens under the line.
	if (summary.endsWith(":")) {
		const first = after.find((line) => line.trim().length > 0)?.trim();
		const change = first?.replace(/^[-*]\s+/, "").trim();
		if (change !== undefined && change.length > 0 && first !== change) return { summary: `${summary} ${change}`, body: rest };
	}
	return { summary, body: rest };
}

export type BoardCallView = {
	/** One line in words, e.g. "Added T4 · Fix parser recovery". */
	summary: string;
	/** Longer text (a question, a decision's reason) for the opened card. */
	detail?: string;
};

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

function firstString(record: Args | undefined, keys: readonly string[]): string | undefined {
	if (record === undefined) return undefined;
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "string" && value.trim().length > 0) return value.trim();
	}
	return undefined;
}

function clip(text: string, length = 90): string {
	const line = markdownText(text);
	return line.length > length ? `${line.slice(0, length - 1)}…` : line;
}

/**
 * A `board` tool call as one line. It reads the server tool's arguments (`{ action, id?, title?, status?, text?, … }`)
 * and takes a new row's ID from the output ("Added T4 (r1)."); an unknown action gives `undefined`, and the generic
 * tool card then shows the call as it is.
 */
export function boardCallView(call: { arguments?: unknown; output?: string; isError?: boolean }): BoardCallView | undefined {
	const args = asRecord(call.arguments);
	if (args === undefined) return undefined;
	const action = firstString(args, ["action"]);
	const outputId = (prefix: string): string | undefined => new RegExp(`\\b(${prefix}\\d+)\\b`).exec(call.output ?? "")?.[1];
	const id = firstString(args, ["id"]);
	const title = firstString(args, ["title"]);
	const text = firstString(args, ["text"]);
	const status = firstString(args, ["status"]);
	const withTitle = (head: string, shown: string | undefined): string => (shown === undefined ? head : `${head} · ${clip(shown)}`);
	switch (action) {
		case "list":
			return { summary: "Listed the board" };
		case "add_task":
			return { summary: withTitle(`Added ${outputId("T") ?? "a task"}`, title), detail: firstString(args, ["description"]) };
		case "update_task": {
			const head = `Updated ${id ?? outputId("T") ?? "a task"}`;
			return {
				summary: status === undefined ? withTitle(head, title) : `${head} → ${status.replace(/_/g, " ")}`,
				detail: firstString(args, ["blockedReason", "description"])
			};
		}
		case "drop_task":
			return { summary: `Dropped ${id ?? outputId("T") ?? "a task"}` };
		case "ask":
			return { summary: withTitle(`Asked ${outputId("Q") ?? "a question"}`, text), detail: text };
		case "resolve_question":
			return { summary: `Resolved ${id ?? outputId("Q") ?? "a question"}`, detail: firstString(args, ["answer"]) };
		case "write_report":
			return { summary: withTitle(`Updated the report on ${id ?? "a task"}`, firstString(args, ["milestone"])) };
		case "show_task":
			return { summary: `Opened ${id ?? "a task"}` };
		case "claim":
			return { summary: `Claimed ${id ?? outputId("T") ?? "a task"}` };
		case "release":
			return { summary: `Released ${id ?? outputId("T") ?? "a task"}` };
		case "handoff": {
			const to = firstString(args, ["toThread"]);
			const head = `Handed ${id ?? outputId("T") ?? "a task"} over`;
			return { summary: to === undefined ? head : `${head} to ${to}`, detail: firstString(args, ["note", "message", "why"]) };
		}
		case "decide":
			return { summary: withTitle(`Decided ${outputId("D") ?? ""}`.trimEnd(), text), detail: firstString(args, ["why"]) };
		default:
			return undefined;
	}
}

export const BOARD_TOOL_NAME = "board";
