/**
 * How tasks relate in the app: the links a task has (a parent, subtasks, the task it was found while working on, what
 * it led to, what it waits for and blocks, related tasks), their progress, the feedback entries on it, and the timeline's
 * kinds. Also the two list filters ("only top-level tasks", "this task and everything linked to it"). Pure functions, so
 * they are tested without a component. A backend without `task-links` sends none of the fields; every reader here takes
 * their absence as no links and no feedback.
 */
import type {
	BoardFeedback,
	BoardFeedbackState,
	BoardTask,
	BoardTaskBrief,
	BoardTaskStatus,
	BoardTimelineEntry,
	BoardTimelineKind,
} from "@aiki/protocol";

// --- links -------------------------------------------------------------------------------------------------------

/** What a link points at: a task on the board, or an archived one the board names only by title and status. */
export type LinkTarget = {
	id: string;
	/** Empty when the board knows nothing of the task (it was never listed, or the board has not loaded). */
	title: string;
	status: BoardTaskStatus | "unknown";
	archived: boolean;
	/** Done, dropped or archived: the link stays, and the app shows it dimmed. */
	closed: boolean;
};

export type LinkGroupKind = "parent" | "subtasks" | "foundWhile" | "ledTo" | "blockedBy" | "blocks" | "related";

export type LinkGroup = { kind: LinkGroupKind; label: string; items: LinkTarget[] };

export const LINK_LABELS: Record<LinkGroupKind, string> = {
	parent: "Subtask of",
	subtasks: "Subtasks",
	foundWhile: "Found while working on",
	ledTo: "Led to",
	blockedBy: "Blocked by",
	blocks: "Blocks",
	related: "Related to",
};

type TaskLike = Pick<BoardTask, "id" | "title" | "status" | "archived">;

/** A task a link names, from the board's tasks or, for an archived one, its `archivedLinks`. */
export function linkTarget(id: string, tasks: readonly TaskLike[], archivedLinks: readonly BoardTaskBrief[] = []): LinkTarget {
	const found: TaskLike | BoardTaskBrief | undefined = tasks.find((task) => task.id === id) ?? archivedLinks.find((brief) => brief.id === id);
	if (found === undefined) return { id, title: "", status: "unknown", archived: false, closed: false };
	return {
		id,
		title: found.title,
		status: found.status,
		archived: found.archived,
		closed: found.archived || found.status === "done" || found.status === "dropped",
	};
}

/** The task's links grouped by kind, each group in the order the board gives, without the empty ones. */
export function linkGroups(
	task: Pick<BoardTask, "parent" | "subtasks" | "foundWhile" | "ledTo" | "blockedBy" | "blocks" | "related">,
	tasks: readonly TaskLike[],
	archivedLinks: readonly BoardTaskBrief[] = [],
): LinkGroup[] {
	const ids: Record<LinkGroupKind, readonly string[]> = {
		parent: task.parent == null ? [] : [task.parent],
		subtasks: task.subtasks ?? [],
		foundWhile: task.foundWhile == null ? [] : [task.foundWhile],
		ledTo: task.ledTo ?? [],
		blockedBy: task.blockedBy,
		blocks: task.blocks ?? [],
		related: task.related ?? [],
	};
	const order: LinkGroupKind[] = ["parent", "subtasks", "foundWhile", "ledTo", "blockedBy", "blocks", "related"];
	return order
		.filter((kind) => ids[kind].length > 0)
		.map((kind) => ({ kind, label: LINK_LABELS[kind], items: ids[kind].map((id) => linkTarget(id, tasks, archivedLinks)) }));
}

/** Whether the task has any link at all. */
export function hasLinks(task: Parameters<typeof linkGroups>[0]): boolean {
	return linkGroups(task, []).length > 0;
}

/** "2/5 done", or undefined when the task has no subtasks (dropped ones are not counted). */
export function subtaskProgressText(task: Pick<BoardTask, "subtaskCount">): string | undefined {
	const count = task.subtaskCount;
	if (count === undefined || count.total === 0) return undefined;
	return `${count.done}/${count.total} done`;
}

/** How far a parent's subtasks are, 0 to 1; undefined without subtasks. */
export function subtaskFraction(task: Pick<BoardTask, "subtaskCount">): number | undefined {
	const count = task.subtaskCount;
	if (count === undefined || count.total === 0) return undefined;
	return count.done / count.total;
}

/** The count on a parent's card: "3 subtasks"; undefined without subtasks. */
export function subtaskCountText(task: Pick<BoardTask, "subtasks">): string | undefined {
	const count = task.subtasks?.length ?? 0;
	return count === 0 ? undefined : `${count} subtask${count === 1 ? "" : "s"}`;
}

// --- feedback ----------------------------------------------------------------------------------------------------

/** Feedback still waiting on someone: open ones and the ones a coordinator is handling. */
export function openFeedbackCount(task: Pick<BoardTask, "feedback">): number {
	return (task.feedback?.open ?? 0) + (task.feedback?.handling ?? 0);
}

export function feedbackStateWords(state: BoardFeedbackState): string {
	switch (state) {
		case "open":
			return "Open";
		case "handling":
			return "Being handled";
		case "addressed":
			return "Addressed";
		case "dismissed":
			return "Dismissed";
	}
}

/** "1 open feedback", "3 open feedback": the title of the badge. */
export function openFeedbackTitle(count: number): string {
	return `${count} open feedback`;
}

/** Open and handling entries first, oldest first; then the rest, newest first. The server sorts too; this keeps a stale list in order. */
export function sortedFeedback(entries: readonly BoardFeedback[]): BoardFeedback[] {
	const live = (entry: BoardFeedback): boolean => entry.state === "open" || entry.state === "handling";
	const byTime = (left: BoardFeedback, right: BoardFeedback): number => left.at.localeCompare(right.at);
	return [...entries.filter(live).sort(byTime), ...entries.filter((entry) => !live(entry)).sort((left, right) => byTime(right, left))];
}

// --- filters -----------------------------------------------------------------------------------------------------

/** The two filters on the task list, the board and the legacy panel. */
export type TaskFilter = {
	/** Hide tasks that are subtasks of another. */
	topLevelOnly: boolean;
	/** Show only this task and everything linked to it; null for no focus. */
	focus: string | null;
};

export const NO_TASK_FILTER: TaskFilter = { topLevelOnly: false, focus: null };

export function filterIsActive(filter: TaskFilter): boolean {
	return filter.topLevelOnly || filter.focus !== null;
}

/**
 * The task and everything linked to it: the task itself, every task it links to or that links to it (any kind), and
 * everything below it: its subtasks and the tasks found while working on it or on them, to any depth.
 */
export function linkedIds(taskId: string, tasks: readonly Pick<BoardTask, "id" | "subtasks" | "parent" | "foundWhile" | "ledTo" | "blockedBy" | "blocks" | "related">[]): Set<string> {
	const byId = new Map(tasks.map((task) => [task.id, task]));
	const ids = new Set<string>([taskId]);
	const focus = byId.get(taskId);
	if (focus === undefined) return ids;
	for (const group of linkGroups(focus, [])) for (const item of group.items) ids.add(item.id);
	const below = new Set<string>();
	const queue = [...(focus.subtasks ?? []), ...(focus.ledTo ?? [])];
	while (queue.length > 0) {
		const next = queue.pop() as string;
		if (below.has(next)) continue;
		below.add(next);
		ids.add(next);
		const task = byId.get(next);
		queue.push(...(task?.subtasks ?? []), ...(task?.ledTo ?? []));
	}
	return ids;
}

/** The tasks the filter lets through, in their order. */
export function applyTaskFilter<T extends Pick<BoardTask, "id" | "subtasks" | "parent" | "foundWhile" | "ledTo" | "blockedBy" | "blocks" | "related">>(
	tasks: readonly T[],
	filter: TaskFilter,
): T[] {
	if (!filterIsActive(filter)) return tasks as T[];
	const keep = filter.focus === null ? undefined : linkedIds(filter.focus, tasks);
	return tasks.filter((task) => (keep === undefined || keep.has(task.id)) && (!filter.topLevelOnly || task.parent == null || task.id === filter.focus));
}

/** Per device, like the Tasks view's mode. */
export const TASK_FILTER_STORAGE_KEY = "aiki.task-filter.v1";

export function loadTopLevelOnly(storage: Pick<Storage, "getItem"> | undefined = browserStorage()): boolean {
	try {
		return storage?.getItem(TASK_FILTER_STORAGE_KEY) === "top-level";
	} catch {
		return false;
	}
}

export function saveTopLevelOnly(on: boolean, storage: Pick<Storage, "setItem" | "removeItem"> | undefined = browserStorage()): void {
	try {
		if (on) storage?.setItem(TASK_FILTER_STORAGE_KEY, "top-level");
		else storage?.removeItem(TASK_FILTER_STORAGE_KEY);
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

// --- timeline ----------------------------------------------------------------------------------------------------

export const TIMELINE_KINDS: { kind: BoardTimelineKind; label: string }[] = [
	{ kind: "feedback", label: "Feedback" },
	{ kind: "status", label: "Status" },
	{ kind: "worker", label: "Workers" },
	{ kind: "question", label: "Questions" },
	{ kind: "decision", label: "Decisions" },
	{ kind: "milestone", label: "Milestones" },
	{ kind: "link", label: "Links" },
];

/** The entries of the kinds that are on; `hidden` holds the kinds the user turned off. */
export function visibleTimeline(entries: readonly BoardTimelineEntry[], hidden: ReadonlySet<BoardTimelineKind>): BoardTimelineEntry[] {
	return hidden.size === 0 ? [...entries] : entries.filter((entry) => !hidden.has(entry.kind));
}

/** How many entries each kind has. */
export function timelineCounts(entries: readonly BoardTimelineEntry[]): Map<BoardTimelineKind, number> {
	const counts = new Map<BoardTimelineKind, number>();
	for (const entry of entries) counts.set(entry.kind, (counts.get(entry.kind) ?? 0) + 1);
	return counts;
}
