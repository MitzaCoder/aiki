import { markdownText } from "@mihai-harness/protocol";
/**
 * How tasks read in the app once agents keep a report on each: the Tasks view's sections by what a task needs, the
 * `?task=` link that opens a task's sheet, a report's lines for a row, and what changed between two snapshots. Pure
 * functions, so they are tested without a component.
 */
import {
	MAIN_THREAD_ID,
	type Board,
	type BoardQuestion,
	type BoardTask,
	type BoardTaskStatus,
	type BoardWriter,
	type ProjectLinks,
	type ThreadSummary,
	resolveRef,
} from "@mihai-harness/protocol";
import { threadName } from "./threads.ts";

// --- the link that opens a task ----------------------------------------------------------------------------------

/** The query parameter that opens a task's sheet over the project chat, on main's page and on a thread's. */
export const TASK_PARAM = "task";

/** The task a URL asks to open, or null. */
export function taskFromUrl(url: { searchParams: { get(name: string): string | null } }): string | null {
	const value = url.searchParams.get(TASK_PARAM)?.trim() ?? "";
	return value.length === 0 ? null : value;
}

/** The same page with a task open (or, with null, closed): other parameters stay, the hash goes. */
export function withTask(url: Pick<URL, "pathname" | "search">, taskId: string | null): string {
	const params = new URLSearchParams(url.search);
	if (taskId === null) params.delete(TASK_PARAM);
	else params.set(TASK_PARAM, taskId);
	const query = params.toString();
	return query.length === 0 ? url.pathname : `${url.pathname}?${query}`;
}

// --- words -------------------------------------------------------------------------------------------------------

/** A status as a person says it. */
export function taskStatusWords(status: BoardTaskStatus): string {
	switch (status) {
		case "todo":
			return "To do";
		case "in_progress":
			return "Working";
		case "blocked":
			return "Blocked";
		case "waiting":
			return "Waiting";
		case "review":
			return "Ready for review";
		case "done":
			return "Done";
		case "dropped":
			return "Dropped";
		default:
			return String(status).replaceAll("_", " ");
	}
}

export function isSettled(status: BoardTaskStatus): boolean {
	return status === "done" || status === "dropped";
}

export type TaskStatusTone = "todo" | "working" | "review" | "waiting" | "blocked" | "done" | "dropped";

/**
 * The tone a status wears: one colour per status, named after what the status means rather than its wire name (a task
 * `in_progress` reads "working"). `base.css` defines each tone as a `--task-status-<tone>` colour from the theme's own
 * tones, and a `.task-status-<tone>` class that hands it to `--task-status`.
 */
export function taskStatusTone(status: BoardTaskStatus): TaskStatusTone {
	switch (status) {
		case "in_progress":
			return "working";
		case "waiting":
			return "waiting";
		case "review":
			return "review";
		case "blocked":
			return "blocked";
		case "done":
			return "done";
		case "dropped":
			return "dropped";
		case "todo":
		default:
			return "todo";
	}
}

/** The class that sets `--task-status` to the status' colour: a row's edge, a badge, a chip's dot. */
export function taskStatusToneClass(status: BoardTaskStatus): string {
	return `task-status-${taskStatusTone(status)}`;
}

/** Who wrote a report or a snapshot, in words. `workerTitle` names a worker when the list knows it. */
export function writerLabel(
	writer: BoardWriter | null,
	threads: readonly ThreadSummary[] = [],
	workerTitle?: (workerId: string) => string | undefined,
): string {
	if (writer === null) return "nobody yet";
	switch (writer.author) {
		case "user":
			return "you";
		case "harness":
			return "the harness";
		case "coordinator":
			return writer.threadId === null || writer.threadId === MAIN_THREAD_ID
				? "the coordinator"
				: threadName(writer.threadId, threads);
		case "worker": {
			const title = writer.workerId === null ? undefined : workerTitle?.(writer.workerId);
			return title === undefined || title.length === 0 ? "a worker" : title;
		}
	}
}

/**
 * Who wrote, in a couple of words for a header: a worker by its ID, since its title can be a whole sentence. Everyone
 * else reads as `writerLabel` says.
 */
export function shortWriterLabel(writer: BoardWriter | null, threads: readonly ThreadSummary[] = []): string {
	if (writer?.author === "worker") return writer.workerId ?? "a worker";
	return writerLabel(writer, threads);
}

/** "2 questions waiting for you", "1 warning waiting for you", "1 question and 1 warning waiting for you". */
export function itemsWaitingLabel(items: readonly Pick<BoardQuestion, "kind">[]): string {
	const warnings = items.filter((item) => item.kind === "warning").length;
	const questions = items.length - warnings;
	const part = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? "" : "s"}`;
	if (warnings === 0) return `${part(questions, "question")} waiting for you`;
	if (questions === 0) return `${part(warnings, "warning")} waiting for you`;
	return `${part(questions, "question")} and ${part(warnings, "warning")} waiting for you`;
}

export function isWarning(item: Pick<BoardQuestion, "kind">): boolean {
	return item.kind === "warning";
}

// --- refs: tickets, PRs and links ---------------------------------------------------------------------------------

/** A task's refs; none from a backend older than refs. */
export function taskRefs(task: Pick<BoardTask, "refs">): readonly string[] {
	return task.refs ?? [];
}

/** A ref that is a web address, as a URL; undefined for a ticket key, a PR number or anything else. */
export function refUrl(ref: string): URL | undefined {
	if (!/^https?:\/\//i.test(ref)) return undefined;
	try {
		return new URL(ref);
	} catch {
		return undefined;
	}
}

/**
 * A ref as a chip says it: a ticket key or PR number as written, a link by what it points at ("#1234" for a pull
 * request or issue, "web#1234" when the project has several repositories, "EX-1234" for a ticket's page), else by its
 * site.
 */
export function refLabel(ref: string, links?: ProjectLinks): string {
	const url = refUrl(ref);
	if (url === undefined) return ref.trim();
	const path = url.pathname.split("/").filter((part) => part.length > 0);
	const numbered = path.findIndex((part) => ["pull", "pulls", "issues", "merge_requests"].includes(part));
	if (numbered >= 0 && /^\d+$/.test(path[numbered + 1] ?? "")) {
		// With several repositories, or one that is not the project's, "#12" alone would not say which.
		const resolved = resolveRef(ref);
		const repos = links?.githubRepos.map((repo) => repo.toLowerCase()) ?? [];
		const own = resolved?.source === "github" && repos.length === 1 && repos[0] === resolved.repo.toLowerCase();
		if (resolved?.source === "github" && repos.length > 0 && !own) return `${resolved.repo.split("/")[1]}#${resolved.number}`;
		return `#${path[numbered + 1]}`;
	}
	const browse = path.indexOf("browse");
	if (browse >= 0 && path[browse + 1] !== undefined) return path[browse + 1]!;
	return url.hostname.replace(/^www\./, "");
}

/** One line of Markdown as plain text: list marks, headings, emphasis, code ticks and link syntax removed. */
function plainLine(line: string): string {
	return line
		.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
		.replace(/^#{1,6}\s+/, "")
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/[*_`~]+/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

/** The first line of some Markdown as plain text, shortened to `length`; empty for empty text. */
export function firstLine(markdown: string, length = 140): string {
	for (const line of markdown.split("\n")) {
		const plain = plainLine(line);
		if (plain.length === 0) continue;
		return plain.length > length ? `${plain.slice(0, length - 1).trimEnd()}…` : plain;
	}
	return "";
}

// --- the Tasks view ----------------------------------------------------------------------------------------------

export type TaskSectionId = "needs_you" | "review" | "waiting" | "blocked" | "working" | "todo" | "closed";

const SECTION_LABELS: Record<TaskSectionId, string> = {
	needs_you: "Needs you",
	review: "Ready for review",
	waiting: "Waiting",
	blocked: "Blocked",
	working: "Working",
	todo: "To do",
	closed: "Recently closed",
};

const SECTION_ORDER: readonly TaskSectionId[] = ["needs_you", "review", "waiting", "blocked", "working", "todo", "closed"];

export type TaskRow = {
	task: BoardTask;
	/** The task's open questions and warnings, warnings first. */
	waiting: BoardQuestion[];
	section: TaskSectionId;
};

export type TaskSection = {
	id: TaskSectionId;
	label: string;
	rows: TaskRow[];
	/** Closed tasks are history: their section starts folded. */
	collapsedByDefault: boolean;
};

/** A task's open questions and warnings, warnings first, then in the board's order. */
export function waitingOn(questions: readonly BoardQuestion[], taskId: string): BoardQuestion[] {
	const open = questions.filter((question) => question.status === "open" && question.taskId === taskId);
	return [...open.filter(isWarning), ...open.filter((question) => !isWarning(question))];
}

/** Open questions and warnings that name no task on the board; the Tasks view answers them where it lists tasks. */
export function looseWaiting(board: Pick<Board, "tasks" | "questions">): BoardQuestion[] {
	const known = new Set(board.tasks.map((task) => task.id));
	const open = board.questions.filter(
		(question) => question.status === "open" && (question.taskId === null || !known.has(question.taskId)),
	);
	return [...open.filter(isWarning), ...open.filter((question) => !isWarning(question))];
}

function byOrder(left: BoardTask, right: BoardTask): number {
	return left.order - right.order || left.id.localeCompare(right.id, undefined, { numeric: true });
}

function settledTime(task: BoardTask): number {
	const time = Date.parse(task.settledAt ?? task.updatedAt);
	return Number.isFinite(time) ? time : 0;
}

/** Where a task belongs: closed ones are history, then anything waiting on the user, then its status. */
export function taskSectionOf(task: Pick<BoardTask, "status">, waiting: number): TaskSectionId {
	if (isSettled(task.status)) return "closed";
	if (task.status === "waiting") return "waiting";
	if (waiting > 0) return "needs_you";
	switch (task.status) {
		case "review":
			return "review";
		case "blocked":
			return "blocked";
		case "in_progress":
			return "working";
		default:
			return "todo";
	}
}

/**
 * The tasks grouped by what each needs from the user, in the order that matters: needs you, ready for review, blocked,
 * working, to do, recently closed. Empty sections are left out. Archived tasks are left out unless asked for.
 */
export function taskSections(
	board: Pick<Board, "tasks" | "questions">,
	options: { includeArchived?: boolean } = {},
): TaskSection[] {
	const rows = board.tasks
		.filter((task) => options.includeArchived === true || !task.archived)
		.map((task): TaskRow => {
			const waiting = waitingOn(board.questions, task.id);
			return { task, waiting, section: taskSectionOf(task, waiting.length) };
		});
	const sections: TaskSection[] = [];
	for (const id of SECTION_ORDER) {
		const inSection = rows.filter((row) => row.section === id);
		if (inSection.length === 0) continue;
		inSection.sort((left, right) => {
			if (id === "closed") return settledTime(right.task) - settledTime(left.task);
			if (id === "needs_you") {
				const warned = Number(right.waiting.some(isWarning)) - Number(left.waiting.some(isWarning));
				if (warned !== 0) return warned;
			}
			return byOrder(left.task, right.task);
		});
		sections.push({ id, label: SECTION_LABELS[id], rows: inSection, collapsedByDefault: id === "closed" || id === "waiting" });
	}
	return sections;
}

/** What a row says under the title: the report line that matters for where the task stands. */
export function rowGist(row: TaskRow): string {
	const { task, section } = row;
	if (task.status === "waiting") return task.waiting?.note ?? "";
	if (section === "needs_you") return markdownText(row.waiting[0]?.text ?? "");
	const report = task.report;
	const candidates =
		section === "review" || section === "closed"
			? [report.results, report.now, task.description]
			: section === "blocked"
				? [task.blockedReason ?? "", report.now, report.results]
				: section === "working"
					? [report.now, report.results, task.description]
					: [task.description, report.next];
	for (const text of candidates) {
		const line = firstLine(text);
		if (line.length > 0) return line;
	}
	return "";
}

// --- what changed between two snapshots --------------------------------------------------------------------------

export type DiffLine = { kind: "same" | "added" | "removed"; text: string };

function linesOf(text: string): string[] {
	return text
		.split("\n")
		.map((line) => line.trimEnd())
		.filter((line) => line.trim().length > 0);
}

/** A line diff of two texts, blank lines ignored: the longest common run of lines stays, the rest is removed or added. */
export function diffLines(before: string, after: string): DiffLine[] {
	const left = linesOf(before);
	const right = linesOf(after);
	const common: number[][] = Array.from({ length: left.length + 1 }, () => new Array<number>(right.length + 1).fill(0));
	for (let i = left.length - 1; i >= 0; i -= 1) {
		for (let j = right.length - 1; j >= 0; j -= 1) {
			common[i]![j] =
				left[i] === right[j] ? common[i + 1]![j + 1]! + 1 : Math.max(common[i + 1]![j]!, common[i]![j + 1]!);
		}
	}
	const lines: DiffLine[] = [];
	let i = 0;
	let j = 0;
	while (i < left.length && j < right.length) {
		if (left[i] === right[j]) {
			lines.push({ kind: "same", text: left[i]! });
			i += 1;
			j += 1;
		} else if (common[i + 1]![j]! >= common[i]![j + 1]!) {
			lines.push({ kind: "removed", text: left[i]! });
			i += 1;
		} else {
			lines.push({ kind: "added", text: right[j]! });
			j += 1;
		}
	}
	for (; i < left.length; i += 1) lines.push({ kind: "removed", text: left[i]! });
	for (; j < right.length; j += 1) lines.push({ kind: "added", text: right[j]! });
	return lines;
}

/** Runs of unchanged lines folded into one count, so a diff shows what moved. */
export type FoldedDiffLine = DiffLine | { kind: "unchanged"; count: number };

export function foldUnchanged(lines: readonly DiffLine[]): FoldedDiffLine[] {
	const folded: FoldedDiffLine[] = [];
	for (const line of lines) {
		const last = folded[folded.length - 1];
		if (line.kind !== "same") folded.push(line);
		else if (last?.kind === "unchanged") last.count += 1;
		else folded.push({ kind: "unchanged", count: 1 });
	}
	return folded;
}

export type ReportSectionKey = "now" | "results" | "next";
export const REPORT_SECTIONS: readonly { key: ReportSectionKey; label: string }[] = [
	{ key: "now", label: "Now" },
	{ key: "results", label: "Results" },
	{ key: "next", label: "Next" },
];

/** What a snapshot or the current task says: enough to compare two of them. */
export type TaskState = {
	title: string;
	status: BoardTaskStatus;
	report: { now: string; results: string; next: string };
};

export type TaskChanges = {
	title?: { from: string; to: string };
	status?: { from: BoardTaskStatus; to: BoardTaskStatus };
	sections: { key: ReportSectionKey; label: string; lines: FoldedDiffLine[] }[];
};

/**
 * What changed from one state to another. Without a `from` (a task's first snapshot) every written section reads as
 * added and the title and status are left out, since nothing came before them.
 */
export function taskChanges(from: TaskState | undefined, to: TaskState): TaskChanges {
	const changes: TaskChanges = { sections: [] };
	if (from !== undefined && from.title !== to.title) changes.title = { from: from.title, to: to.title };
	if (from !== undefined && from.status !== to.status) changes.status = { from: from.status, to: to.status };
	for (const { key, label } of REPORT_SECTIONS) {
		const lines = diffLines(from?.report[key] ?? "", to.report[key]);
		if (lines.every((line) => line.kind === "same")) continue;
		changes.sections.push({ key, label, lines: foldUnchanged(lines) });
	}
	return changes;
}

export function hasChanges(changes: TaskChanges): boolean {
	return changes.title !== undefined || changes.status !== undefined || changes.sections.length > 0;
}
