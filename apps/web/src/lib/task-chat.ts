/**
 * How the chat names board tasks: the link to a task, the places a task ID turns up in text, the `T12` mentions in the
 * coordinator's replies and the `#` picker in the composer. The chat stays short; the task is where the detail lives.
 */
import type { BoardTask, BoardTaskStatus } from "@aiki/protocol";

/** The link to a task: the task sheet opens from `?task=` on the page the reader is on. */
export function taskHref(taskId: string): string {
	return `?task=${encodeURIComponent(taskId)}`;
}

const TASK_ID = /(?<![\w/#.:-])T\d+(?![\w-])/g;

/** The task IDs a text names, first mention first, each once. */
export function taskIdsIn(text: string): string[] {
	return [...new Set(text.match(TASK_ID) ?? [])];
}

/** The tasks a check-in's digest names (`task T3: 42m in progress`). */
export function checkInTaskIds(body: string): string[] {
	return [...new Set([...body.matchAll(/\btask (T\d+)\b/g)].map((match) => match[1] as string))];
}

export type TextPiece = { text: string } | { taskId: string };

/** A text cut into plain pieces and the tasks it names, for the tasks `known` accepts. */
export function splitTaskMentions(text: string, known: (taskId: string) => boolean): TextPiece[] {
	const pieces: TextPiece[] = [];
	let last = 0;
	for (const match of text.matchAll(TASK_ID)) {
		const taskId = match[0];
		if (!known(taskId)) continue;
		if (match.index > last) pieces.push({ text: text.slice(last, match.index) });
		pieces.push({ taskId });
		last = match.index + taskId.length;
	}
	if (last < text.length) pieces.push({ text: text.slice(last) });
	return pieces;
}

const PROTECTED_OR_MENTION = new RegExp(
	[
		"```[\\s\\S]*?(?:```|$)",
		"~~~[\\s\\S]*?(?:~~~|$)",
		"`[^`\\n]*`",
		"\\[[^\\]\\n]*\\]\\([^)\\n]*\\)",
		"<[^>\\n]+>",
		"https?:\\/\\/\\S+",
		TASK_ID.source,
	].join("|"),
	"g",
);

function linkTitle(title: string): string {
	return title.replace(/["\\\n]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Markdown with each `T12` of an existing task turned into a link to it, leaving code, existing links and URLs alone.
 * While the text is still arriving, a mention at its very end may be half of a longer ID, so it is left for now.
 */
export function linkTaskMentions(
	markdown: string,
	options: { title: (taskId: string) => string | undefined; streaming?: boolean },
): string {
	if (!/T\d/.test(markdown)) return markdown;
	return markdown.replace(PROTECTED_OR_MENTION, (match, offset: number) => {
		if (!/^T\d+$/.test(match)) return match;
		const title = options.title(match);
		if (title === undefined) return match;
		if (options.streaming === true && offset + match.length === markdown.length) return match;
		const shown = linkTitle(title);
		return shown.length === 0 ? `[${match}](${taskHref(match)})` : `[${match}](${taskHref(match)} "${shown}")`;
	});
}

/** What the picker offers for a task. */
export type TaskOption = { id: string; title: string; status: BoardTaskStatus };

const STATUS_RANK: Record<BoardTaskStatus, number> = {
	review: 0,
	waiting: 0.5,
	blocked: 1,
	in_progress: 2,
	todo: 3,
	done: 4,
	dropped: 5,
};

export function taskOptions(tasks: readonly Pick<BoardTask, "id" | "title" | "status" | "archived">[]): TaskOption[] {
	return tasks
		.filter((task) => task.archived !== true)
		.map((task) => ({ id: task.id, title: task.title, status: task.status }));
}

/** Open tasks first (what needs the user, then what runs); finished ones only when a search asks for them. */
export function pickerChoices(options: readonly TaskOption[], query: string, limit = 50): TaskOption[] {
	const needle = query.trim().toLowerCase();
	const matching = options.filter((option) => {
		if (needle.length === 0) return option.status !== "done" && option.status !== "dropped";
		return option.id.toLowerCase().includes(needle) || option.title.toLowerCase().includes(needle);
	});
	const number = (id: string): number => Number(id.slice(1)) || 0;
	return matching
		.toSorted((left, right) => STATUS_RANK[left.status] - STATUS_RANK[right.status] || number(right.id) - number(left.id))
		.slice(0, limit);
}

/** The `#word` the caret is in the middle of, when it starts a word: where it starts and what was typed after `#`. */
export function hashTrigger(text: string, caret: number): { start: number; query: string } | undefined {
	const match = /(^|\s)#([^\s#]*)$/.exec(text.slice(0, caret));
	if (match === null) return undefined;
	return { start: caret - match[2].length - 1, query: match[2] };
}

/** The text without `#query` once a task is picked, with the caret where it was. */
export function withoutTrigger(text: string, trigger: { start: number; query: string }): { text: string; caret: number } {
	const end = trigger.start + 1 + trigger.query.length;
	const before = text.slice(0, trigger.start);
	const after = text.slice(end).replace(/^ /, "");
	return { text: before + after, caret: before.length };
}
