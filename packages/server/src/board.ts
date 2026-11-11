import { initializeTaskFreshness, coverReportSection, noteTaskFact, markReportStale, prepareReportNudges, acknowledgeReportNudge, reportDueAt, sweepReportAge, substantiveTaskMentions, REPORT_SWEEP_MS, type ReportSection, type TaskFact, type TaskReportTracking, type ReportOutbox } from "./task-freshness.ts";
import { stateKind } from "./state-identity.ts";
/**
 * The board: the coordinator's tasks, questions for the user and decisions, kept as a durable document on the
 * coordinator conversation (`aiki.board`) so it never has to be recalled from a summary. The contract is
 * `packages/protocol/src/board.ts`.
 *
 * Three writers share the same pure mutators below, each run inside one commit: the coordinator's `board` tool, the user
 * (protocol requests) and, later, the harness itself. A row change names the revision it was made on and is refused with
 * `board_conflict` when the row moved on. Reordering does not bump revisions: dragging one task would otherwise conflict
 * every edit of every task below it.
 *
 * The board is the project's, shared by main and its background threads (`threads.ts`): the document stays on main's
 * conversation, any coordinator thread changes it with the same tool, a thread claims a task (`ownerThreadId`, with the
 * same revision check) before working on it, and a question or decision carries the thread that made it.
 *
 * The user's edits reach the coordinator as one coalesced `[board]` input after a short quiet period; an answer reaches
 * the thread that asked at once as a steer. `done` and `dropped` tasks are archived 7 days after they settle; the view applies that by the
 * clock and every write or `get` persists it, so nothing depends on a timer.
 */
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Context } from "@earendil-works/chord/context";
import type { Conversation, ConversationId, Extension, Harness, JsonObject, ToolRegistration, Tx } from "@earendil-works/pi-durable";
import { GenerationTask, hook, defineDoc, defineDocFamily, defineExtension, defineTool } from "@earendil-works/pi-durable";
import {
	BOARD_PREFIX,
	type InputContent,
	TASK_REFERENCE_PREFIX,
	type Board,
	type BoardAuthor,
	type BoardDecision,
	type BoardFeedback,
	type BoardFeedbackCounts,
	type BoardFeedbackState,
	type BoardLinkKind,
	type BoardQuestion,
	type BoardTask,
	type BoardTaskBrief,
	type BoardTaskInput,
	type BoardTaskReport,
	type BoardTaskSnapshot,
	type BoardTimelineEntry,
	type BoardTimelineKind,
	type BoardWriter,
} from "@aiki/protocol";
import { estimateTextTokens } from "@earendil-works/pi-ai/utils/estimate";
import { createHash } from "node:crypto";
import { type Static, Type } from "typebox";
import type { Coordinators } from "./coordinators.ts";
import { ServerError, errorMessage } from "./errors.ts";
import { type Notifier, boardQuestionNotification, taskReviewNotification } from "./notifications.ts";
import type { Project } from "./projects.ts";

/** How long a done or dropped task stays in the coordinator's view. */
export const ARCHIVE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
/** How long the user's edits wait for a further edit before they reach the coordinator as one input. */
export const BOARD_EDIT_DEBOUNCE_MS = 3_000;
/** Answered and withdrawn questions the view keeps after the open ones. */
const KEPT_SETTLED_QUESTIONS = 20;
const LIST_DESCRIPTION_CHARS = 200;
/** How many harness change keys the board remembers; far more than the changes a restart can rerun. */
const KEPT_HARNESS_KEYS = 500;
/** What the board's view in a compaction summary may take, in tokens. */
export const SUMMARY_BOARD_TOKENS = 1_500;
/** Todo tasks the summary view lists before "+N more", and decisions it keeps. */
const SUMMARY_TODO_TASKS = 20;
const SUMMARY_DECISIONS = 10;
/** How much of an open task's report `now` the compaction view shows: a line, not the report. */
const SUMMARY_NOW_CHARS = 200;

export type BoardState = {
	taskFreshnessEnabled?: boolean;
	reportTracking?: Record<string, TaskReportTracking>;
	reportOutbox?: ReportOutbox[];
	reportInFlight?: Record<string, number>;
	reportChatCandidates?: Record<string, { text: string; key: string }[]>;
	lastReportSweep?: number;
	tasks: BoardTask[];
	questions: BoardQuestion[];
	decisions: BoardDecision[];
	/** The last number given to a task, question and decision; IDs are never reused. */
	counters: { task: number; question: number; decision: number; /** Absent on boards written before feedback. */ feedback?: number };
	updatedAt: string | null;
	/** Durable return notices, removed only after delivery; request IDs make replay harmless. */
	waitingReturns?: { task: BoardTask; note: string }[];
	/**
	 * The harness's own changes already applied, by the request ID they derive from (the spawn's tool call, the report's
	 * message, the schedule's run), so a rerun after a restart finds its change instead of applying it again. Newest last,
	 * capped; absent on boards written before the harness changed them.
	 */
	harnessKeys?: string[];
	/**
	 * Time each task spent in_progress, by task ID: finished spells in `ms`, and when the current spell began in `since`
	 * (null when it is not in_progress). Kept here rather than on the task, so the view derives `inProgressMinutes` at
	 * read time and a restart loses nothing. Absent on boards written before the clock.
	 */
	inProgress?: Record<string, { ms: number; since: string | null }>;
};

export const BoardDoc = defineDoc<BoardState>({
	kind: stateKind("board"),
	version: 1,
	scope: "conversation",
	history: "latest",
	fork: "initial",
	checkpointWhen: () => false,
	initial: () => emptyBoardState(),
});

export function emptyBoardState(): BoardState {
	return { tasks: [], questions: [], decisions: [], counters: { task: 0, question: 0, decision: 0 }, updatedAt: null };
}

/**
 * The task reference a message starts with: `[task T12] `, or `[task T12, feedback F3] ` when the message was recorded as
 * feedback on the task.
 */
export function taskReference(taskId: string, feedbackId?: string): string {
	return `${TASK_REFERENCE_PREFIX}${taskId}${feedbackId === undefined ? "" : `, feedback ${feedbackId}`}] `;
}

/**
 * A message's content with the task reference in front, unless it is already there. A content without text up front gets
 * a text block of its own.
 */
export function withTaskReference(content: InputContent, taskId: string, feedbackId?: string): InputContent {
	const prefix = taskReference(taskId, feedbackId);
	const named = `${TASK_REFERENCE_PREFIX}${taskId}`;
	const has = (text: string): boolean => text.startsWith(`${named}]`) || text.startsWith(`${named},`);
	if (typeof content === "string") return has(content) ? content : `${prefix}${content}`;
	const first = content[0];
	if (first?.type === "text") {
		return has(first.text) ? content : [{ ...first, text: `${prefix}${first.text}` }, ...content.slice(1)];
	}
	return [{ type: "text", text: prefix.trimEnd() }, ...content];
}

export function emptyReport(): BoardTaskReport {
	return { now: "", results: "", next: "", revision: 0, updatedAt: null, updatedBy: null };
}

/** Give every task of a board written before reports, snapshots and refs the empty ones. Changes `state` in place. */
export function normalizeBoard<T extends BoardState>(state: T): T {
	for (const task of state.tasks) {
		task.report ??= emptyReport();
		task.snapshots ??= 0;
		task.refs ??= [];
		task.parent ??= null;
		task.foundWhile ??= null;
		task.related ??= [];
		initializeTaskFreshness(state, task);
	}
	return state;
}

/** A task's snapshots, kept outside the board document so its every rewrite stays small. One document per task. */
export type TaskHistoryState = {
	snapshots: BoardTaskSnapshot[];
	/** Snapshot keys already saved (a tool call's, a worker report's), so a rerun after a restart saves nothing twice. */
	keys: string[];
	/** What happened that nothing else on the board records: workers started and reported, link changes. Oldest first. Absent before links. */
	events?: BoardTimelineEntry[];
	/** The task's feedback entries, oldest first. Absent before feedback. */
	feedback?: BoardFeedback[];
	/** Request IDs of messages already recorded as feedback, with the entry each made, so a re-sent message adds none. */
	feedbackKeys?: { key: string; id: string }[];
	/** Bumped on every change of the above, snapshots included; the task carries it as `timelineRevision`. */
	revision?: number;
};

/** The newest snapshots a task keeps, and the keys remembered; far more than a rerun can repeat. */
const KEPT_SNAPSHOTS = 200;
const KEPT_SNAPSHOT_KEYS = 100;
/** Timeline events and feedback entries a task keeps; the oldest settled feedback goes first. */
const KEPT_EVENTS = 500;
const KEPT_FEEDBACK = 300;
const KEPT_FEEDBACK_KEYS = 100;

export const TaskHistoryDoc = defineDocFamily<TaskHistoryState, null>({
	kind: stateKind("board-history"),
	version: 1,
	scope: "conversation",
	history: "latest",
	fork: "initial",
	family: true,
	checkpointWhen: () => false,
	initial: () => ({ snapshots: [], keys: [] }),
});

export const USER_WRITER: BoardWriter = { author: "user", threadId: null, workerId: null };
export const HARNESS_WRITER: BoardWriter = { author: "harness", threadId: null, workerId: null };

export function coordinatorWriter(threadId: string): BoardWriter {
	return { author: "coordinator", threadId, workerId: null };
}

export function workerWriter(threadId: string, workerId: string): BoardWriter {
	return { author: "worker", threadId, workerId };
}

/**
 * Open the project's board in a commit, with every task given a report: the board is main's document, whichever thread
 * or worker changes it.
 */
export async function openBoard(tx: Tx, mainId: ConversationId): Promise<BoardState> {
	return normalizeBoard((await tx.doc(BoardDoc, mainId)) as BoardState);
}

/**
 * Open a task's history in a commit. Open it before the commit's first table write (a created task, conversation or
 * submission) when a snapshot may follow.
 */
export function openTaskHistory(tx: Tx, mainId: ConversationId, taskId: string): Promise<TaskHistoryState> {
	return tx.doc(TaskHistoryDoc, mainId, taskId, null) as Promise<TaskHistoryState>;
}

/**
 * Save a snapshot of `task` as it is now, labelled and credited, unless one with `key` was saved already. Counts it on
 * the task. Returns whether one was saved.
 */
export function addSnapshot(
	history: TaskHistoryState,
	task: BoardTask,
	input: { label: string; by: BoardWriter; at: string; key?: string | undefined },
): boolean {
	if (input.key !== undefined) {
		if (history.keys.includes(input.key)) return false;
		history.keys.push(input.key);
		if (history.keys.length > KEPT_SNAPSHOT_KEYS) history.keys.splice(0, history.keys.length - KEPT_SNAPSHOT_KEYS);
	}
	const last = history.snapshots[history.snapshots.length - 1];
	history.snapshots.push({
		seq: (last?.seq ?? 0) + 1,
		at: input.at,
		label: input.label,
		by: input.by,
		title: task.title,
		status: task.status,
		...(task.waiting === undefined ? {} : { waiting: plain(task.waiting) }),
		report: { now: task.report.now, results: task.report.results, next: task.report.next },
	});
	if (history.snapshots.length > KEPT_SNAPSHOTS) history.snapshots.splice(0, history.snapshots.length - KEPT_SNAPSHOTS);
	task.snapshots = history.snapshots.length;
	bumpTimeline(history, task);
	return true;
}

/** Note that the task's timeline gained something the board document does not carry, so readers read it again. */
function bumpTimeline(history: TaskHistoryState, task: BoardTask): void {
	history.revision = (history.revision ?? 0) + 1;
	task.timelineRevision = history.revision;
}

/** Add an entry to a task's own timeline, once per `key` when one is given. Returns whether it was added. */
export function addTimelineEvent(history: TaskHistoryState, task: BoardTask, entry: BoardTimelineEntry, key?: string): boolean {
	if (key !== undefined) {
		const eventKey = `${key}:event`;
		if (history.keys.includes(eventKey)) return false;
		history.keys.push(eventKey);
		if (history.keys.length > KEPT_SNAPSHOT_KEYS) history.keys.splice(0, history.keys.length - KEPT_SNAPSHOT_KEYS);
	}
	history.events ??= [];
	// Read the list back from the history: inside a commit it is the document's own, which tracks the push.
	const events = history.events;
	events.push(entry);
	if (events.length > KEPT_EVENTS) events.splice(0, events.length - KEPT_EVENTS);
	bumpTimeline(history, task);
	return true;
}

/** Each task's status, to compare with after a change. */
export function statusesOf(state: Readonly<BoardState>): Map<string, BoardTask["status"]> {
	return new Map(state.tasks.map((task) => [task.id, task.status]));
}

/**
 * Snapshot every task whose status differs from `before` (a task that did not exist then is new, not changed), labelled
 * `old → new`. `key` names the change that did it, so a rerun saves nothing twice; absent for the user's, which never rerun.
 */
export async function snapshotStatusChanges(
	tx: Tx,
	mainId: ConversationId,
	state: BoardState,
	before: ReadonlyMap<string, BoardTask["status"]>,
	input: { by: BoardWriter; at: string; key?: string | undefined },
): Promise<void> {
	for (const task of state.tasks) {
		const was = before.get(task.id);
		if ((was === undefined && task.waiting === undefined) || was === task.status) continue;
		const history = await openTaskHistory(tx, mainId, task.id);
		addSnapshot(history, task, {
			label: `${was ?? "new"} → ${task.status}`,
			by: input.by,
			at: input.at,
			key: input.key === undefined ? undefined : `${input.key}:${task.id}:status`,
		});
	}
}

export type ReportWrite = {
	taskId: string;
	/** Replace these sections whole; an empty string clears one. */
	sections: { now?: string | undefined; results?: string | undefined; next?: string | undefined };
	/** A line added to the end of `results`, as a bullet. */
	addResult?: string | undefined;
	by: BoardWriter;
	now: string;
	coveredEventSeq?: number | undefined;
	waitsOn?: string[] | undefined;
};

/**
 * Rewrite the named sections of a task's report. Bumps only the report's revision, never the task's, so the user's edits
 * of the task do not conflict with it.
 */
export function writeReport(state: BoardState, input: ReportWrite): BoardTask {
	const task = state.tasks.find((candidate) => candidate.id === input.taskId);
	if (task === undefined) throw unknownTask(input.taskId);
	const { now, results, next } = input.sections;
	if (now === undefined && results === undefined && next === undefined && input.addResult === undefined) {
		throw new ServerError("bad_request", "A report write names at least one of now, results and next");
	}
	const report = (task.report ??= emptyReport());
	initializeTaskFreshness(state, task);
	const previous = { results: report.results, next: report.next };
	if (now !== undefined) report.now = now.trim();
	if (results !== undefined) report.results = results.trim();
	if (next !== undefined) report.next = next.trim();
	if (input.addResult !== undefined) {
		const line = input.addResult.trim();
		const bullet = /^[-*] /.test(line) ? line : `- ${line}`;
		// The same line twice in a row is a rerun after a restart, not two results.
		if (report.results === "") report.results = bullet;
		else if (report.results.split("\n").pop() !== bullet) report.results = `${report.results}\n${bullet}`;
	}
	for (const name of ["results", "next"] as const) {
		coverReportSection(state, task, name, { previous: previous[name], by: input.by, at: input.now, coveredEventSeq: input.coveredEventSeq, waitsOn: input.waitsOn });
	}
	report.revision += 1;
	report.updatedAt = input.now;
	report.updatedBy = { ...input.by };
	state.updatedAt = input.now;
	return plain(task);
}

/**
 * One report write in a commit: rewrite the sections, then snapshot the task when a milestone is named. `key` names the
 * call that does it, so a rerun after a restart saves the snapshot once.
 */
export async function writeReportIn(
	tx: Tx,
	mainId: ConversationId,
	input: Omit<ReportWrite, "now"> & { milestone?: string | undefined },
	key: string,
	at: string,
): Promise<BoardTask> {
	const state = await openBoard(tx, mainId);
	let coverage = input.coveredEventSeq;
	if (input.milestone?.trim()) {
		const task = state.tasks.find((task) => task.id === input.taskId);
		const before = task?.eventSeq ?? 0;
		const unchanged = (["results", "next"] as const).filter((name) => {
			const prose = input.sections[name]?.trim() ?? task?.report[name] ?? "";
			if (prose !== task?.report[name]) return false;
			if (name !== "results" || input.addResult === undefined) return true;
			const line = input.addResult.trim();
			const bullet = /^[-*] /.test(line) ? line : `- ${line}`;
			return prose.split("\n").pop() === bullet;
		});
		noteTaskFact(state, input.taskId, { actor: input.by.author, kind: "milestone", reason: input.milestone, at, sections: unchanged });
		if (coverage === before) coverage += 1; // The writer authored this fact, but cannot cover an earlier unseen gap.
	}
	const written = writeReport(state, { ...input, coveredEventSeq: coverage, now: at });
	const label = input.milestone?.trim() ?? "";
	if (label === "") return written;
	return snapshotMilestone(tx, mainId, state, { taskId: input.taskId, label, by: input.by, at, key });
}

/** Snapshot a task under `label` because a report write named a milestone; opens its history in the commit. */
export async function snapshotMilestone(
	tx: Tx,
	mainId: ConversationId,
	state: BoardState,
	input: { taskId: string; label: string; by: BoardWriter; at: string; key?: string | undefined },
): Promise<BoardTask> {
	const task = state.tasks.find((candidate) => candidate.id === input.taskId);
	if (task === undefined) throw unknownTask(input.taskId);
	addSnapshot(await openTaskHistory(tx, mainId, task.id), task, {
		label: input.label.trim(),
		by: input.by,
		at: input.at,
		key: input.key === undefined ? undefined : `${input.key}:${task.id}:milestone`,
	});
	return plain(task);
}

// --- feedback ----------------------------------------------------------------------------------------------------

/** The longest user message a feedback entry keeps whole. */
const FEEDBACK_TEXT_CHARS = 8_000;
/** What the user may do with an entry from the app; the coordinator may not dismiss. */
export const COORDINATOR_FEEDBACK_STATES: readonly BoardFeedbackState[] = ["open", "handling", "addressed"];

export function feedbackCounts(entries: readonly BoardFeedback[]): BoardFeedbackCounts {
	const counts = { open: 0, handling: 0, addressed: 0, dismissed: 0 };
	for (const entry of entries) counts[entry.state] += 1;
	return counts;
}

function unknownFeedback(taskId: string, feedbackId: string): ServerError {
	return new ServerError("unknown_task", `No feedback "${feedbackId}" on task ${taskId}`, { taskId, feedbackId });
}

/**
 * Record a user message about a task as a feedback entry, `open`. `key` is the message's request ID: a re-sent message finds
 * its entry instead of adding another. Returns the entry. Counts it on the task.
 */
export function recordFeedback(
	state: BoardState,
	history: TaskHistoryState,
	input: { taskId: string; text: string; images: number; threadId: string; key: string; now: string },
): BoardFeedback {
	const task = state.tasks.find((candidate) => candidate.id === input.taskId);
	if (task === undefined) throw unknownTask(input.taskId);
	history.feedback ??= [];
	history.feedbackKeys ??= [];
	// Read the lists back from the history: inside a commit they are the document's own, which tracks the pushes.
	const entries = history.feedback;
	const keys = history.feedbackKeys;
	const known = keys.find((entry) => entry.key === input.key);
	const existing = known === undefined ? undefined : entries.find((entry) => entry.id === known.id);
	if (existing !== undefined) return plain(existing);
	state.counters.feedback = (state.counters.feedback ?? 0) + 1;
	const text = input.text.trim();
	const entry: BoardFeedback = {
		id: `F${state.counters.feedback}`,
		text: text.length <= FEEDBACK_TEXT_CHARS ? text : `${text.slice(0, FEEDBACK_TEXT_CHARS - 1)}…`,
		...(input.images > 0 ? { images: input.images } : {}),
		threadId: input.threadId,
		at: input.now,
		state: "open",
		note: null,
		updatedAt: input.now,
		changes: [],
	};
	entries.push(entry);
	keys.push({ key: input.key, id: entry.id });
	if (keys.length > KEPT_FEEDBACK_KEYS) keys.splice(0, keys.length - KEPT_FEEDBACK_KEYS);
	if (entries.length > KEPT_FEEDBACK) {
		const closed = entries.findIndex((candidate) => candidate.state === "addressed" || candidate.state === "dismissed");
		entries.splice(closed < 0 ? 0 : closed, 1);
	}
	task.feedback = feedbackCounts(entries);
	state.updatedAt = input.now;
	noteTaskFact(state, task.id, { actor: "user", kind: "feedback", reason: `${entry.id} received`, at: input.now });
	bumpTimeline(history, task);
	return plain(entry);
}

/**
 * Move a feedback entry to `state`, with a note (what addressed it, what is being done). The same state with a new note
 * rewrites the note; the same state and note changes nothing. Returns the entry and whether anything changed.
 */
export function setFeedbackState(
	state: BoardState,
	history: TaskHistoryState,
	input: { taskId: string; feedbackId: string; state: BoardFeedbackState; note: string | null; by: BoardWriter; now: string },
): { feedback: BoardFeedback; changed: boolean; before: BoardFeedbackState } {
	const task = state.tasks.find((candidate) => candidate.id === input.taskId);
	if (task === undefined) throw unknownTask(input.taskId);
	const entry = (history.feedback ?? []).find((candidate) => candidate.id === input.feedbackId);
	if (entry === undefined) throw unknownFeedback(input.taskId, input.feedbackId);
	const note = input.note === null || input.note.trim() === "" ? null : input.note.trim();
	if (input.state === "addressed" && note === null) {
		throw new ServerError("bad_request", `Marking ${entry.id} addressed needs a note: what addressed it (a commit, a result, "answered in chat")`);
	}
	const before = entry.state;
	// Leaving a state without saying why must not keep the old reason: a note belongs to the change that wrote it.
	const nextNote = note ?? (input.state === entry.state ? entry.note : null);
	if (input.state === entry.state && nextNote === entry.note) return { feedback: plain(entry), changed: false, before };
	entry.state = input.state;
	entry.note = nextNote;
	entry.updatedAt = input.now;
	entry.changes.push({ state: input.state, at: input.now, by: input.by, note });
	if (input.state === "addressed") noteTaskFact(state, task.id, { actor: input.by.author, kind: "feedback_addressed", reason: `${entry.id} addressed`, at: input.now });
	task.feedback = feedbackCounts(history.feedback ?? []);
	state.updatedAt = input.now;
	bumpTimeline(history, task);
	return { feedback: plain(entry), changed: true, before };
}

/** Open and handling entries first (oldest first), then the settled ones, newest first. */
export function sortFeedback(entries: readonly BoardFeedback[]): BoardFeedback[] {
	const live = (entry: BoardFeedback): boolean => entry.state === "open" || entry.state === "handling";
	const byTime = (left: BoardFeedback, right: BoardFeedback): number => left.at.localeCompare(right.at) || compareIds(left.id, right.id);
	return [
		...entries.filter(live).sort(byTime),
		...entries.filter((entry) => !live(entry)).sort((left, right) => byTime(right, left)),
	];
}

// --- links -------------------------------------------------------------------------------------------------------

/** What each kind of link says from the task that stores it, and from the task it points at. */
export const LINK_WORDS: Record<BoardLinkKind, { out: string; in: string }> = {
	parent: { out: "subtask of", in: "has subtask" },
	foundWhile: { out: "found while working on", in: "led to" },
	related: { out: "related to", in: "related to" },
	blockedBy: { out: "blocked by", in: "blocks" },
};

type TaskLinks = { parent: string | null; foundWhile: string | null; related: string[]; blockedBy: string[] };

function linksOfTask(task: BoardTask): TaskLinks {
	return {
		parent: task.parent ?? null,
		foundWhile: task.foundWhile ?? null,
		related: [...(task.related ?? [])],
		blockedBy: [...task.blockedBy],
	};
}

/** Each task's links, to compare with after a change. */
export function linksOfBoard(state: Readonly<BoardState>): Map<string, TaskLinks> {
	return new Map(state.tasks.map((task) => [task.id, linksOfTask(task)]));
}

/** The links a task stores, as `[kind, target]` pairs. */
function linkPairs(links: TaskLinks): [BoardLinkKind, string][] {
	const pairs: [BoardLinkKind, string][] = [];
	if (links.parent !== null) pairs.push(["parent", links.parent]);
	if (links.foundWhile !== null) pairs.push(["foundWhile", links.foundWhile]);
	for (const id of links.related) pairs.push(["related", id]);
	for (const id of links.blockedBy) pairs.push(["blockedBy", id]);
	return pairs;
}

/**
 * Add a timeline entry to both ends of every link a change added or removed: "Subtask of T8" on the subtask, "Has subtask
 * T5" on T8. `related` is stored on both tasks, so each end logs its own diff. Opens the histories it needs in `tx`.
 */
export async function logLinkChanges(
	tx: Tx,
	mainId: ConversationId,
	state: BoardState,
	before: ReadonlyMap<string, TaskLinks>,
	input: { by: BoardWriter; at: string },
): Promise<void> {
	const empty: TaskLinks = { parent: null, foundWhile: null, related: [], blockedBy: [] };
	const changes: { task: BoardTask; kind: BoardLinkKind; other: string; added: boolean; out: boolean }[] = [];
	for (const task of state.tasks) {
		const was = linkPairs(before.get(task.id) ?? empty).map(([kind, id]) => `${kind}:${id}`);
		const now = linkPairs(linksOfTask(task)).map(([kind, id]) => `${kind}:${id}`);
		for (const entry of now.filter((key) => !was.includes(key))) changes.push(split(task, entry, true));
		for (const entry of was.filter((key) => !now.includes(key))) changes.push(split(task, entry, false));
	}
	function split(task: BoardTask, key: string, added: boolean): (typeof changes)[number] {
		const [kind, other] = key.split(":") as [BoardLinkKind, string];
		return { task, kind, other: other as string, added, out: true };
	}
	for (const change of changes) {
		const ends = [{ task: change.task, other: change.other, out: true }];
		if (change.kind !== "related") {
			const target = state.tasks.find((candidate) => candidate.id === change.other);
			if (target !== undefined) ends.push({ task: target, other: change.task.id, out: false });
		}
		for (const end of ends) {
			const words = LINK_WORDS[change.kind][end.out ? "out" : "in"];
			const history = await openTaskHistory(tx, mainId, end.task.id);
			addTimelineEvent(history, end.task, {
				at: input.at,
				kind: "link",
				label: change.added ? `${capitalize(words)} ${end.other}` : `No longer ${words} ${end.other}`,
				ref: end.other,
				by: { ...input.by },
			});
		}
	}
}

function capitalize(text: string): string {
	return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Whether following `kind` links up from `from` reaches `taskId`. */
function chainReaches(state: Readonly<BoardState>, kind: "parent" | "foundWhile", from: string, taskId: string): boolean {
	const seen = new Set<string>();
	let current: string | null = from;
	while (current !== null && !seen.has(current)) {
		if (current === taskId) return true;
		seen.add(current);
		current = state.tasks.find((task) => task.id === current)?.[kind] ?? null;
	}
	return false;
}

/**
 * Refuse links that cannot hold: a task that does not exist, a link to itself, a parent or origin chain that comes back to
 * the task. Links to settled or archived tasks are fine. `taskId` is null for a task not made yet.
 */
function checkLinks(
	state: Readonly<BoardState>,
	taskId: string | null,
	links: { parent?: string | null | undefined; foundWhile?: string | null | undefined; related?: readonly string[] | undefined },
): void {
	const ids = new Set(state.tasks.map((task) => task.id));
	const known = (id: string, link: string): void => {
		if (!ids.has(id)) throw unknownTask(id);
		if (id === taskId) throw new ServerError("bad_request", `Task ${id} cannot be ${link} itself`);
	};
	for (const kind of ["parent", "foundWhile"] as const) {
		const target = links[kind];
		if (target === undefined || target === null) continue;
		known(target, LINK_WORDS[kind].out);
		if (taskId !== null && chainReaches(state, kind, target, taskId)) {
			throw new ServerError(
				"bad_request",
				kind === "parent"
					? `${taskId} cannot be a subtask of ${target}: ${target} is already ${taskId}'s own subtask, or below it. Subtasks cannot form a cycle.`
					: `${taskId} cannot be found while working on ${target}: ${target} was itself found through ${taskId}.`,
			);
		}
	}
	for (const id of links.related ?? []) known(id, LINK_WORDS.related.out);
}

/** Make `task`'s related list `ids`, and keep each other task's list in step. Does not touch revisions. */
function setRelated(state: BoardState, task: BoardTask, ids: readonly string[]): void {
	const next = unique(ids);
	const previous = task.related ?? [];
	for (const id of previous.filter((other) => !next.includes(other))) {
		const other = state.tasks.find((candidate) => candidate.id === id);
		if (other !== undefined) other.related = (other.related ?? []).filter((back) => back !== task.id);
	}
	for (const id of next.filter((other) => !previous.includes(other))) {
		const other = state.tasks.find((candidate) => candidate.id === id);
		if (other !== undefined && !(other.related ?? []).includes(task.id)) other.related = [...(other.related ?? []), task.id];
	}
	task.related = next;
}

/**
 * Add or remove one link on a task. It bumps no revision (links are not part of what the user edits), so a coordinator
 * links without reading the task first. A second parent or origin is refused: unlink the first, or change it with
 * `update_task`.
 */
export function changeLink(
	state: BoardState,
	input: { taskId: string; link: BoardLinkKind; to: string | undefined; remove: boolean; now: string },
): TaskChange {
	const task = state.tasks.find((candidate) => candidate.id === input.taskId);
	if (task === undefined) throw unknownTask(input.taskId);
	const before = plain(task);
	const { link, to } = input;
	if (link === "parent" || link === "foundWhile") {
		const words = LINK_WORDS[link].out;
		if (input.remove) {
			if (to !== undefined && task[link] !== to) throw new ServerError("bad_request", `${task.id} is not ${words} ${to}`);
			task[link] = null;
		} else {
			const target = need(to, "link", "to");
			checkLinks(state, task.id, { [link]: target });
			const current = task[link] ?? null;
			if (current !== null && current !== target) {
				throw new ServerError("bad_request", `${task.id} is already ${words} ${current}: a task has at most one. Unlink it first, or change it with update_task.`);
			}
			task[link] = target;
		}
	} else if (link === "related") {
		const target = need(to, input.remove ? "unlink" : "link", "to");
		if (input.remove) setRelated(state, task, (task.related ?? []).filter((id) => id !== target));
		else {
			checkLinks(state, task.id, { related: [target] });
			setRelated(state, task, [...(task.related ?? []), target]);
		}
	} else {
		const target = need(to, input.remove ? "unlink" : "link", "to");
		if (input.remove) task.blockedBy = task.blockedBy.filter((id) => id !== target);
		else {
			const blockedBy = unique([...task.blockedBy, target]);
			checkBlockedBy(state, task.id, blockedBy);
			task.blockedBy = blockedBy;
		}
	}
	state.updatedAt = input.now;
	if (before.blockedBy.some((id) => !task.blockedBy.includes(id))) noteTaskFact(state, task.id, { actor: "coordinator", kind: "blocker_resolved", reason: "blocker resolved", at: input.now });
	return { before, after: plain(task) };
}

function need<T>(value: T | undefined, action: string, field: string): T {
	if (value === undefined) throw new ServerError("bad_request", `${action} needs \`${field}\``);
	return value;
}

// --- the timeline ------------------------------------------------------------------------------------------------

/** A snapshot label of the form "in_progress → review" is a status move; any other label names a report milestone. */
function isStatusLabel(label: string): boolean {
	return /^[a-z_]+ → [a-z_]+$/.test(label);
}

/**
 * Everything that happened to a task, oldest first, from what the board and the task's own history hold: feedback and
 * its state changes, status moves and milestones (snapshots), workers and link changes (events), the task's questions
 * and warnings, and its decisions. Entries with the same time keep that order. `kinds` keeps only those kinds.
 */
export function buildTimeline(
	task: Pick<BoardTask, "id">,
	state: Readonly<BoardState>,
	history: Readonly<TaskHistoryState> | undefined,
	kinds?: readonly BoardTimelineKind[],
): { entries: BoardTimelineEntry[]; feedback: BoardFeedback[] } {
	const entries: BoardTimelineEntry[] = [];
	const feedback = history?.feedback ?? [];
	for (const entry of feedback) {
		const images = entry.images === undefined ? "" : ` (${entry.images} image${entry.images === 1 ? "" : "s"})`;
		entries.push({
			at: entry.at,
			kind: "feedback",
			label: `Feedback ${entry.id}`,
			detail: `${entry.text}${images}`,
			ref: entry.id,
			state: "open",
			by: USER_WRITER,
		});
		for (const change of entry.changes) {
			entries.push({
				at: change.at,
				kind: "feedback",
				label: `${entry.id} → ${change.state}`,
				...(change.note === null ? {} : { detail: change.note }),
				ref: entry.id,
				state: change.state,
				by: change.by,
			});
		}
	}
	for (const snapshot of history?.snapshots ?? []) {
		entries.push({
			at: snapshot.at,
			kind: isStatusLabel(snapshot.label) ? "status" : "milestone",
			label: snapshot.label,
			...(snapshot.waiting === undefined ? {} : { detail: `Waiting for ${snapshot.waiting.note}${snapshot.waiting.until === undefined ? "" : ` · back on ${snapshot.waiting.until}`}` }),
			ref: String(snapshot.seq),
			by: snapshot.by,
		});
	}
	entries.push(...(history?.events ?? []));
	for (const question of state.questions.filter((candidate) => candidate.taskId === task.id)) {
		const word = question.kind === "warning" ? "Warning" : "Question";
		entries.push({ at: question.askedAt, kind: "question", label: `${word} ${question.id}`, detail: question.text, ref: question.id });
		if (question.status !== "open" && question.answeredAt !== null) {
			entries.push({
				at: question.answeredAt,
				kind: "question",
				label: `${question.id} ${question.status === "answered" ? (question.kind === "warning" ? "acknowledged" : "answered") : "withdrawn"}`,
				...(question.answer === null ? {} : { detail: question.answer }),
				ref: question.id,
				by: question.status === "answered" ? USER_WRITER : undefined,
			});
		}
	}
	for (const decision of state.decisions.filter((candidate) => candidate.taskId === task.id)) {
		entries.push({
			at: decision.at,
			kind: "decision",
			label: `Decision ${decision.id}`,
			detail: decision.why === null ? decision.text : `${decision.text} — ${decision.why}`,
			ref: decision.id,
		});
	}
	const ordered = entries
		.map((entry, index) => ({ entry: stripUndefined(entry), index }))
		.sort((left, right) => left.entry.at.localeCompare(right.entry.at) || left.index - right.index)
		.map(({ entry }) => entry);
	return {
		entries: kinds === undefined || kinds.length === 0 ? ordered : ordered.filter((entry) => kinds.includes(entry.kind)),
		feedback: sortFeedback(feedback),
	};
}

function stripUndefined(entry: BoardTimelineEntry): BoardTimelineEntry {
	return Object.fromEntries(Object.entries(entry).filter(([, value]) => value !== undefined)) as BoardTimelineEntry;
}

const SETTLED = new Set(["done", "dropped"]);

function isSettled(task: BoardTask): boolean {
	return SETTLED.has(task.status);
}

function isArchivedAt(task: BoardTask, now: number): boolean {
	return task.settledAt !== null && isSettled(task) && Date.parse(task.settledAt) + ARCHIVE_AFTER_MS <= now;
}

/** Account for a status change in the task's in_progress clock, before the status is set. */
function clockStatus(state: BoardState, task: BoardTask | { id: string; status: null }, status: BoardTask["status"], now: string): void {
	if (task.status === status) return;
	const clocks = (state.inProgress ??= {});
	const clock = clocks[task.id] ?? { ms: 0, since: null };
	if (clock.since !== null && status !== "in_progress") {
		clock.ms += Math.max(0, Date.parse(now) - Date.parse(clock.since));
		clock.since = null;
	}
	if (status === "in_progress" && clock.since === null) clock.since = now;
	if (clock.ms > 0 || clock.since !== null) clocks[task.id] = clock;
}

/** Minutes a task spent in_progress so far, the current spell included; undefined when it never was. */
export function inProgressMinutes(state: Readonly<BoardState>, taskId: string, now: number): number | undefined {
	const clock = state.inProgress?.[taskId];
	if (clock === undefined) return undefined;
	const running = clock.since === null ? 0 : Math.max(0, now - Date.parse(clock.since));
	return Math.floor((clock.ms + running) / 60_000);
}

/** Persist the archive flag on every task whose 7 days passed. Returns whether anything changed. */
export function sweepArchive(state: BoardState, now: number): boolean {
	let changed = false;
	for (const task of state.tasks) {
		if (!task.archived && isArchivedAt(task, now)) {
			task.archived = true;
			changed = true;
		}
	}
	return changed;
}

/** The board as the protocol shows it: by order, archived tasks only when asked for, questions open first. */
export function boardView(state: Readonly<BoardState>, now: number, includeArchived: boolean): Board {
	const byOrder = (left: { order: number; id: string }, right: { order: number; id: string }): number =>
		left.order - right.order || compareIds(left.id, right.id);
	// Links are derived over every task, archived ones too: a link to a closed task stays.
	const ordered = [...state.tasks].sort(byOrder);
	const reverse = (pick: (task: BoardTask) => readonly string[]): Map<string, string[]> => {
		const map = new Map<string, string[]>();
		for (const task of ordered) for (const target of pick(task)) map.set(target, [...(map.get(target) ?? []), task.id]);
		return map;
	};
	const children = reverse((task) => (task.parent == null ? [] : [task.parent]));
	const found = reverse((task) => (task.foundWhile == null ? [] : [task.foundWhile]));
	const blocking = reverse((task) => task.blockedBy);
	const byId = new Map(state.tasks.map((task) => [task.id, task]));
	const all = state.tasks
		.map((task) => {
			const minutes = inProgressMinutes(state, task.id, now);
			const subtasks = children.get(task.id) ?? [];
			const counted = subtasks.map((id) => byId.get(id)).filter((child): child is BoardTask => child !== undefined && child.status !== "dropped");
			return {
				...task,
				report: task.report ?? emptyReport(),
				snapshots: task.snapshots ?? 0,
				refs: task.refs ?? [],
				parent: task.parent ?? null,
				foundWhile: task.foundWhile ?? null,
				related: task.related ?? [],
				subtasks,
				ledTo: found.get(task.id) ?? [],
				blocks: blocking.get(task.id) ?? [],
				...(subtasks.length === 0 ? {} : { subtaskCount: { total: counted.length, done: counted.filter((child) => child.status === "done").length } }),
				...(task.feedback === undefined ? {} : { feedback: { ...task.feedback } }),
				archived: task.archived || isArchivedAt(task, now),
				...(minutes === undefined ? {} : { inProgressMinutes: minutes }),
			};
		});
	const tasks = all.filter((task) => includeArchived || !task.archived).sort(byOrder);
	const shown = new Set(tasks.map((task) => task.id));
	const wanted = new Set<string>();
	for (const task of tasks) {
		for (const id of [task.parent, task.foundWhile, ...task.related, ...task.blockedBy, ...task.subtasks, ...task.ledTo, ...task.blocks]) {
			if (id != null && !shown.has(id)) wanted.add(id);
		}
	}
	const archivedLinks: BoardTaskBrief[] = all
		.filter((task) => wanted.has(task.id))
		.sort(byOrder)
		.map((task) => ({ id: task.id, title: task.title, status: task.status, archived: task.archived }));
	const open = state.questions.filter((question) => question.status === "open");
	const settled = state.questions
		.filter((question) => question.status !== "open")
		.sort((left, right) => (right.answeredAt ?? right.askedAt).localeCompare(left.answeredAt ?? left.askedAt))
		.slice(0, KEPT_SETTLED_QUESTIONS);
	return {
		tasks,
		...(archivedLinks.length === 0 ? {} : { archivedLinks }),
		questions: [...open.sort((left, right) => compareIds(left.id, right.id)), ...settled],
		decisions: [...state.decisions].reverse(),
		updatedAt: state.updatedAt,
	};
}

export function openQuestionCount(state: Readonly<BoardState> | undefined): number {
	return state === undefined ? 0 : state.questions.filter((question) => question.status === "open").length;
}

function compareIds(left: string, right: string): number {
	return Number(left.slice(1)) - Number(right.slice(1));
}

// --- mutators: each runs inside one commit and throws a ServerError to abort it ----------------------------------

export type TaskChange = {
	/** What a reader sees of the change, for the coordinator's `[board]` input. */
	before: BoardTask | null;
	after: BoardTask;
};

function unknownTask(id: string): ServerError {
	return new ServerError("unknown_task", `No task "${id}" on the board`, { taskId: id });
}

function conflict(kind: string, id: string, current: number, expected: number): ServerError {
	return new ServerError(
		"board_conflict",
		`${kind} ${id} changed since you read it: it is at revision ${current}, not ${expected}. Read it again before editing.`,
		{ id, revision: current },
	);
}

function checkBlockedBy(state: BoardState, taskId: string | null, blockedBy: readonly string[]): void {
	const ids = new Set(state.tasks.map((task) => task.id));
	for (const blocker of blockedBy) {
		if (!ids.has(blocker)) throw unknownTask(blocker);
		if (blocker === taskId) throw new ServerError("bad_request", `Task ${blocker} cannot wait for itself`);
	}
	if (taskId === null) return;
	// A cycle exists when a task reachable through the new edges is the task itself.
	const edges = new Map<string, readonly string[]>(state.tasks.map((task) => [task.id, task.blockedBy]));
	edges.set(taskId, blockedBy);
	const seen = new Set<string>();
	const stack = [...blockedBy];
	while (stack.length > 0) {
		const next = stack.pop() as string;
		if (next === taskId) throw new ServerError("bad_request", `Task ${taskId} would wait for itself through ${blockedBy.join(", ")}: dependencies cannot form a cycle`);
		if (seen.has(next)) continue;
		seen.add(next);
		stack.push(...(edges.get(next) ?? []));
	}
}

/** A copy outside the transaction's draft, which cannot leave the commit. */
function plain<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

function unique(values: readonly string[]): string[] {
	return [...new Set(values)];
}

/** Refs trimmed, without empties or repeats. */
function cleanRefs(refs: readonly string[]): string[] {
	return unique(refs.map((ref) => ref.trim()).filter((ref) => ref.length > 0));
}

/** Create a task (no `taskId`) or change one made on `expectedRevision`. */
export function saveTask(
	state: BoardState,
	input: {
		taskId?: string | undefined;
		expectedRevision?: number | undefined;
		task: BoardTaskInput;
		author: BoardAuthor;
		now: string;
	},
): TaskChange {
	const { task: fields, author, now } = input;
	const blockedBy = unique(fields.blockedBy);
	const previous = state.tasks.find((task) => task.id === input.taskId)?.waiting;
	const note = fields.waitingFor?.trim() ?? previous?.note ?? "";
	if (fields.status === "waiting" && note === "") throw new ServerError("bad_request", 'Waiting requires a "waiting for…" note (waitingFor).');
	if (fields.waitingFor !== undefined && (note === "" || note.length > 2000)) throw new ServerError("bad_request", "waitingFor must be 1–2000 characters.");
	if (fields.waitUntil !== undefined && (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(fields.waitUntil) || !Number.isFinite(Date.parse(fields.waitUntil)))) {
		throw new ServerError("bad_request", "waitUntil must be an ISO date or timestamp.");
	}
	const waiting = fields.status !== "waiting" ? undefined : {
		note, since: previous?.since ?? now,
		...(fields.waitUntil === undefined ? (fields.waitingFor === undefined && previous?.until !== undefined ? { until: previous.until } : {}) : { until: new Date(fields.waitUntil).toISOString() }),
		by: fields.waitingFor === undefined && fields.waitUntil === undefined && previous !== undefined ? previous.by : author === "user" ? "user" as const : "coordinator" as const,
	};
	if (input.taskId === undefined) {
		checkBlockedBy(state, null, blockedBy);
		checkLinks(state, null, fields);
		state.counters.task += 1;
		const id = `T${state.counters.task}`;
		clockStatus(state, { id, status: null }, fields.status, now);
		const created: BoardTask = {
			id,
			revision: 1,
			title: fields.title,
			description: fields.description,
			acceptance: fields.acceptance,
			refs: cleanRefs(fields.refs ?? []),
			status: fields.status,
			...(waiting === undefined ? {} : { waiting }),
			blockedBy,
			blockedReason: fields.blockedReason,
			parent: fields.parent ?? null,
			foundWhile: fields.foundWhile ?? null,
			related: [],
			writeScopes: unique(fields.writeScopes),
			workerIds: [],
			scheduleId: null,
			report: emptyReport(),
			snapshots: 0,
			order: Math.max(0, ...state.tasks.map((task) => task.order)) + 1,
			createdBy: author,
			updatedBy: author,
			createdAt: now,
			updatedAt: now,
			settledAt: SETTLED.has(fields.status) ? now : null,
			archived: false,
		};
		state.tasks.push(created);
		// Inside a commit the pushed task is the document's own copy, not `created`: change it through the board.
		const stored = state.tasks.find((task) => task.id === id) as BoardTask;
		setRelated(state, stored, fields.related ?? []);
		initializeTaskFreshness(state, stored);
		if (stored.status === "review" || stored.status === "done") noteTaskFact(state, stored.id, { actor: author, kind: "status", reason: `Results empty at ${stored.status}`, at: now });
		state.updatedAt = now;
		return { before: null, after: plain(stored) };
	}
	const existing = state.tasks.find((task) => task.id === input.taskId);
	if (existing === undefined) throw unknownTask(input.taskId);
	if (input.expectedRevision === undefined) {
		throw new ServerError("bad_request", `Changing task ${existing.id} needs the revision it was made on`);
	}
	if (existing.revision !== input.expectedRevision) {
		throw conflict("Task", existing.id, existing.revision, input.expectedRevision);
	}
	checkBlockedBy(state, existing.id, blockedBy);
	checkLinks(state, existing.id, fields);
	const before = plain(existing);
	if (waiting === undefined) delete existing.waiting;
	else existing.waiting = waiting;
	existing.title = fields.title;
	existing.description = fields.description;
	existing.acceptance = fields.acceptance;
	// Left out (an older app, the Android app) keeps them.
	existing.refs = fields.refs === undefined ? (existing.refs ?? []) : cleanRefs(fields.refs);
	existing.blockedBy = blockedBy;
	existing.blockedReason = fields.blockedReason;
	existing.writeScopes = unique(fields.writeScopes);
	// Left out keeps them; null clears the parent or the origin.
	if (fields.parent !== undefined) existing.parent = fields.parent;
	if (fields.foundWhile !== undefined) existing.foundWhile = fields.foundWhile;
	if (fields.related !== undefined) setRelated(state, existing, fields.related);
	if (fields.status !== existing.status) {
		clockStatus(state, existing, fields.status, now);
		existing.status = fields.status;
		existing.settledAt = SETTLED.has(fields.status) ? now : null;
		existing.archived = false;
	}
	existing.revision += 1;
	existing.updatedBy = author;
	existing.updatedAt = now;
	state.updatedAt = now;
	if (before.status !== existing.status) {
		noteTaskFact(state, existing.id, { actor: author, ...(SETTLED.has(before.status) ? { sections: [] } : {}), kind: "status", reason: `stage changed to ${existing.status}`, at: now });
		if (existing.status === "done") for (const dependent of state.tasks.filter((task) => task.blockedBy.includes(existing.id))) noteTaskFact(state, dependent.id, { actor: author, kind: "blocker_resolved", reason: `${existing.id} resolved`, ref: existing.id, at: now });
	}
	if (before.status === existing.status && JSON.stringify(before.waiting) !== JSON.stringify(existing.waiting)) noteTaskFact(state, existing.id, { actor: author, kind: "status", reason: "waiting stage changed", at: now });
	if (before.blockedBy.some((id) => !existing.blockedBy.includes(id)) || (before.blockedReason !== null && existing.blockedReason === null)) noteTaskFact(state, existing.id, { actor: author, kind: "blocker_resolved", reason: "blocker resolved", at: now });
	return { before, after: plain(existing) };
}

/** Put the named tasks first, in that order; the others keep their relative order after them. */
export function reorderTasks(state: BoardState, taskIds: readonly string[], now: string): string[] {
	const ids = unique(taskIds);
	for (const id of ids) if (!state.tasks.some((task) => task.id === id)) throw unknownTask(id);
	const named = new Set(ids);
	const rest = state.tasks
		.filter((task) => !named.has(task.id))
		.sort((left, right) => left.order - right.order || compareIds(left.id, right.id))
		.map((task) => task.id);
	const sequence = [...ids, ...rest];
	for (const task of state.tasks) task.order = sequence.indexOf(task.id) + 1;
	state.updatedAt = now;
	return ids;
}

export function askQuestion(
	state: BoardState,
	input: { text: string; options: readonly string[]; taskId: string | null; now: string; threadId?: string; kind?: "question" | "warning" },
): BoardQuestion {
	if (input.taskId !== null && !state.tasks.some((task) => task.id === input.taskId)) throw unknownTask(input.taskId);
	state.counters.question += 1;
	const warning = input.kind === "warning";
	const question: BoardQuestion = {
		id: `Q${state.counters.question}`,
		revision: 1,
		...(warning ? { kind: "warning" as const } : {}),
		text: input.text,
		options: warning ? [] : [...input.options],
		taskId: input.taskId,
		...(input.threadId === undefined ? {} : { threadId: input.threadId }),
		status: "open",
		answer: null,
		askedAt: input.now,
		answeredAt: null,
	};
	state.questions.push(question);
	if (input.taskId !== null) noteTaskFact(state, input.taskId, { actor: "coordinator", kind: "question_asked", reason: `${question.id} asked`, ref: question.id, at: input.now });
	state.updatedAt = input.now;
	return plain(question);
}

/** Answer an open question (the user's answer, or the coordinator's when the user answered in the chat), or withdraw it. */
export function settleQuestion(
	state: BoardState,
	input: { questionId: string; expectedRevision?: number | undefined; answer: string | null; now: string; actor?: TaskFact["actor"] },
): BoardQuestion {
	const question = state.questions.find((candidate) => candidate.id === input.questionId);
	if (question === undefined) throw new ServerError("unknown_task", `No question "${input.questionId}" on the board`, { questionId: input.questionId });
	if (input.expectedRevision !== undefined && question.revision !== input.expectedRevision) {
		throw conflict("Question", question.id, question.revision, input.expectedRevision);
	}
	if (question.status !== "open") {
		throw new ServerError("board_conflict", `Question ${question.id} is already ${question.status}`, {
			id: question.id,
			revision: question.revision,
		});
	}
	question.status = input.answer === null ? "withdrawn" : "answered";
	question.answer = input.answer;
	question.answeredAt = input.now;
	question.revision += 1;
	if (question.taskId !== null) noteTaskFact(state, question.taskId, { actor: input.actor ?? "user", kind: "question_settled", reason: `${question.id} ${question.status}`, ref: question.id, at: input.now });
	state.updatedAt = input.now;
	return plain(question);
}

export function addDecision(
	state: BoardState,
	input: { text: string; why: string | null; taskId: string | null; now: string; threadId?: string },
): BoardDecision {
	if (input.taskId !== null && !state.tasks.some((task) => task.id === input.taskId)) throw unknownTask(input.taskId);
	state.counters.decision += 1;
	const decision: BoardDecision = {
		id: `D${state.counters.decision}`,
		text: input.text,
		why: input.why,
		taskId: input.taskId,
		...(input.threadId === undefined ? {} : { threadId: input.threadId }),
		at: input.now,
	};
	state.decisions.push(decision);
	if (input.taskId !== null) noteTaskFact(state, input.taskId, { actor: "coordinator", kind: "decision", reason: `${decision.id} recorded`, ref: decision.id, at: input.now });
	state.updatedAt = input.now;
	return plain(decision);
}

/**
 * Who owns a task now and who may take it. Claiming is a compare-and-set on the task's revision: a task another thread
 * holds is refused, so two threads cannot work on the same task.
 *
 * - `claim`: an unowned task (or one the caller already holds) becomes the caller's.
 * - `release`: the owner (or main, which supervises every thread) gives it up.
 * - `handoff`: the owner (or main) passes it to another thread, which may be main.
 */
export type OwnershipChange =
	| { kind: "claim"; threadId: string }
	| { kind: "release"; threadId: string }
	| { kind: "handoff"; threadId: string; to: string };

export function changeOwner(
	state: BoardState,
	input: { taskId: string; expectedRevision: number; change: OwnershipChange; now: string },
): TaskChange {
	const task = state.tasks.find((candidate) => candidate.id === input.taskId);
	if (task === undefined) throw unknownTask(input.taskId);
	if (task.revision !== input.expectedRevision) throw conflict("Task", task.id, task.revision, input.expectedRevision);
	const owner = task.ownerThreadId ?? null;
	const { change } = input;
	const supervises = change.threadId === "main";
	if (change.kind === "claim") {
		if (owner !== null && owner !== change.threadId) {
			throw new ServerError(
				"board_conflict",
				`Task ${task.id} is claimed by thread "${owner}". Leave it to that thread, ask it with thread_send, or have it hand the task over.`,
				{ id: task.id, revision: task.revision, ownerThreadId: owner },
			);
		}
	} else if (owner !== change.threadId && !supervises) {
		throw new ServerError(
			"board_conflict",
			owner === null
				? `Task ${task.id} is not claimed by anyone; claim it first.`
				: `Task ${task.id} is claimed by thread "${owner}", not you; only its owner or main can ${change.kind === "release" ? "release" : "hand over"} it.`,
			{ id: task.id, revision: task.revision, ownerThreadId: owner },
		);
	}
	const before = plain(task);
	task.ownerThreadId = change.kind === "claim" ? change.threadId : change.kind === "release" ? null : change.to;
	if (owner !== task.ownerThreadId) noteTaskFact(state, task.id, { actor: "coordinator", kind: "thread_handoff", reason: "thread handoff", at: input.now });
	task.revision += 1;
	task.updatedBy = "coordinator";
	task.updatedAt = input.now;
	state.updatedAt = input.now;
	return { before, after: plain(task) };
}

// --- the harness's own changes -----------------------------------------------------------------------------------

/** Whether the change named `key` is new; records it when it is. */
function claimHarnessKey(state: BoardState, key: string): boolean {
	const keys = (state.harnessKeys ??= []);
	if (keys.includes(key)) return false;
	keys.push(key);
	if (keys.length > KEPT_HARNESS_KEYS) keys.splice(0, keys.length - KEPT_HARNESS_KEYS);
	return true;
}

function touchByHarness(state: BoardState, task: BoardTask, status: BoardTask["status"], now: string, actor: NonNullable<TaskFact["actor"]> = "harness"): void {
	if (status !== "waiting") delete task.waiting;
	if (status !== task.status) {
		clockStatus(state, task, status, now);
		task.status = status;
		noteTaskFact(state, task.id, { actor, kind: "status", reason: `stage changed to ${status}`, at: now });
		task.settledAt = SETTLED.has(status) ? now : null;
		task.archived = false;
	}
	task.revision += 1;
	task.updatedBy = "harness";
	task.updatedAt = now;
	state.updatedAt = now;
}

/** What became of a worker that runs a task. */
export type WorkerMove = { kind: "spawned"; workerId: string } | { kind: "failed"; workerId: string; reason: string };

/**
 * Move a task for its worker: a spawn takes it to `in_progress` (and records the worker), a failure to `blocked` with
 * the reason. A worker's report moves nothing: the coordinator checks the work and moves the task to `review` itself. A
 * failure leaves a task the coordinator or the user already settled alone. Applied once per `key`; undefined when
 * nothing changed.
 */
export function moveTaskForWorker(
	state: BoardState,
	input: { key: string; taskId: string; move: WorkerMove; now: string },
): TaskChange | undefined {
	const task = state.tasks.find((candidate) => candidate.id === input.taskId);
	if (task === undefined || !claimHarnessKey(state, input.key)) return undefined;
	const { move, now } = input;
	noteTaskFact(state, task.id, { actor: move.kind === "spawned" ? "coordinator" : "worker", kind: move.kind === "spawned" ? "worker_start" : "worker_fail", reason: move.kind === "spawned" ? "work advanced" : "worker failed", at: now });
	if (move.kind !== "spawned" && isSettled(task)) return undefined;
	const before = plain(task);
	if (move.kind === "spawned") {
		if (!task.workerIds.includes(move.workerId)) task.workerIds.push(move.workerId);
		task.blockedReason = null;
		touchByHarness(state, task, "in_progress", now, "coordinator");
	} else {
		task.blockedReason = move.reason;
		touchByHarness(state, task, "blocked", now);
	}
	return { before, after: plain(task) };
}

/**
 * A `record` clock run's worker reported and nobody will review it: put the run into the schedule's task the way the
 * coordinator would. `results` becomes this run (the time, the worker and the start of its report; the full report stays
 * on the worker), `now` is cleared, and a task still `in_progress` goes to `review` so it does not read as working until
 * the next run. A task the coordinator or the user already moved is not moved. Applied once per `key`; undefined when
 * it was already applied. An event run's task is not the schedule's, so it is left alone.
 */
export function recordScheduledReport(
	state: BoardState,
	input: { key: string; scheduleId: string; taskId: string; workerId: string; text: string; now: string },
): TaskChange | undefined {
	const task = state.tasks.find((candidate) => candidate.id === input.taskId);
	// Only the schedule's own collecting task: an event run's task (no `scheduleId`) is the coordinator's and the user's.
	if (task === undefined || task.scheduleId !== input.scheduleId || isSettled(task) || !claimHarnessKey(state, input.key)) return undefined;
	const before = plain(task);
	noteTaskFact(state, task.id, { actor: "worker", kind: "worker_report", reason: "worker reported; work advanced", at: input.now });
	// One line of plain words: the report's own headings (`## Report`) would read as stray hashes inside a bullet.
	const summary = input.text.replace(/(^|\s)#{1,6}\s+/g, "$1").replace(/\s+/g, " ").trim();
	const clipped = summary.length <= 300 ? summary : `${summary.slice(0, 299)}…`;
	writeReport(state, {
		taskId: task.id,
		sections: { now: "", results: `- ${input.now.slice(0, 16).replace("T", " ")} UTC, worker ${input.workerId} reported: ${clipped}` },
		by: HARNESS_WRITER,
		coveredEventSeq: task.eventSeq,
		now: input.now,
	});
	if (task.status === "in_progress") touchByHarness(state, task, "review", input.now);
	return { before, after: plain(task) };
}

/**
 * A background thread takes the task it was started for: it becomes the thread's and goes to `in_progress`. A task a
 * different background thread holds is refused; main's or an unclaimed one is the thread's now. Applied once per `key`;
 * undefined when it already was.
 */
export function claimTaskForThread(
	state: BoardState,
	input: { key: string; taskId: string; threadId: string; now: string },
): TaskChange | undefined {
	const task = state.tasks.find((candidate) => candidate.id === input.taskId);
	if (task === undefined) throw unknownTask(input.taskId);
	const owner = task.ownerThreadId ?? null;
	if (owner !== null && owner !== "main" && owner !== input.threadId) {
		throw new ServerError("board_conflict", `Task ${task.id} is claimed by thread "${owner}". Give the new thread another task.`, {
			id: task.id,
			revision: task.revision,
			ownerThreadId: owner,
		});
	}
	if (isSettled(task)) {
		throw new ServerError("bad_request", `Task ${task.id} is ${task.status}: only the user reopens a closed task. Start the thread on another task.`, {
			id: task.id,
		});
	}
	if (!claimHarnessKey(state, input.key)) return undefined;
	const before = plain(task);
	task.ownerThreadId = input.threadId;
	noteTaskFact(state, task.id, { actor: "coordinator", kind: "thread_handoff", reason: "thread started work", at: input.now });
	task.blockedReason = null;
	touchByHarness(state, task, "in_progress", input.now, "coordinator");
	return { before, after: plain(task) };
}

/** The title of a schedule's board task: what it is, so the board reads "Scheduled: Nightly check". */
export function scheduleTaskTitle(scheduleTitle: string): string {
	return `Scheduled: ${scheduleTitle.trim()}`.slice(0, 120);
}

function scheduleTaskDescription(scheduleId: string, title: string): string {
	return [
		`Collects every run of the schedule "${title.trim()}": each run's worker or thread is listed here, and the report shows the latest run.`,
		`Settings → Scheduled tasks (\`settings#schedule-${scheduleId}\`) edits or pauses the schedule.`,
		"Close this task to start a fresh one on the next run; the harness never closes it.",
	].join("\n\n");
}

function createScheduleTask(
	state: BoardState,
	input: { scheduleId: string; title: string; status: "todo" | "in_progress" | "blocked"; blockedReason: string | null; now: string },
): BoardTask {
	const change = saveTask(state, {
		task: {
			title: scheduleTaskTitle(input.title),
			description: scheduleTaskDescription(input.scheduleId, input.title),
			acceptance: null,
			status: input.status,
			blockedBy: [],
			blockedReason: input.blockedReason,
			writeScopes: [],
		},
		author: "harness",
		now: input.now,
	});
	const created = state.tasks.find((task) => task.id === change.after.id) as BoardTask;
	created.scheduleId = input.scheduleId;
	return created;
}

/**
 * The one board task of a clock schedule, for a run that is about to start a worker: the open one (todo, in_progress,
 * blocked or review; a run's problem task counts), else a new `todo` task. The worker's spawn then moves it to
 * `in_progress`, so the status change is the spawn's. A task the user closed (done, dropped) or deleted gives a new one.
 */
export function scheduleTaskForRun(state: BoardState, input: { scheduleId: string; title: string; now: string }): BoardTask {
	const open = state.tasks.find((task) => task.scheduleId === input.scheduleId && !isSettled(task));
	if (open !== undefined) return plain(open);
	return plain(createScheduleTask(state, { ...input, status: "todo", blockedReason: null }));
}

/**
 * The task a `thread` schedule's runs report on: the schedule's one task, the open one if there is, else a new one. Each
 * run puts it back to `in_progress` and unclaims it for the new thread.
 */
export function taskForSchedule(state: BoardState, input: { scheduleId: string; title: string; now: string }): TaskChange {
	const open = state.tasks.find((task) => task.scheduleId === input.scheduleId && !isSettled(task));
	if (open !== undefined) {
		const before = plain(open);
		open.blockedReason = null;
		open.ownerThreadId = null;
		touchByHarness(state, open, "in_progress", input.now);
		return { before, after: plain(open) };
	}
	return { before: null, after: plain(createScheduleTask(state, { ...input, status: "in_progress", blockedReason: null })) };
}

/**
 * A scheduled run failed or was skipped: open one `blocked` task for the schedule, or update the one still open (not
 * done or dropped) instead of adding another. Applied once per `key`; undefined when it was already applied.
 */
export function recordScheduleProblem(
	state: BoardState,
	input: { key: string; scheduleId: string; title: string; reason: string; now: string },
): TaskChange | undefined {
	if (!claimHarnessKey(state, input.key)) return undefined;
	const open = state.tasks.find((task) => task.scheduleId === input.scheduleId && !isSettled(task));
	if (open !== undefined) {
		const before = plain(open);
		open.blockedReason = input.reason;
		touchByHarness(state, open, "blocked", input.now);
		return { before, after: plain(open) };
	}
	return { before: null, after: plain(createScheduleTask(state, { ...input, status: "blocked", blockedReason: input.reason })) };
}

/**
 * The task of one event run (a GitHub review request): found by its marker line when this run was retried, else a new
 * `todo` task made by the harness with the pull request's URL in its refs. It has no `scheduleId`: that link belongs to
 * the one task per schedule that clock runs and failed runs share.
 */
export function taskForEvent(
	state: BoardState,
	input: { title: string; description: string; marker: string; ref: string; now: string },
): TaskChange {
	const existing = state.tasks.find(
		(task) => task.createdBy === "harness" && (task.refs ?? []).includes(input.ref) && task.description.split("\n").includes(input.marker),
	);
	if (existing !== undefined) return { before: plain(existing), after: plain(existing) };
	return saveTask(state, {
		task: {
			title: input.title,
			description: input.description,
			acceptance: null,
			refs: [input.ref],
			status: "todo",
			blockedBy: [],
			blockedReason: null,
			writeScopes: [],
		},
		author: "harness",
		now: input.now,
	});
}

/** The tasks a change to `done` left with every blocker done: the ones the coordinator can start now. */
export function unblockedBy(state: Readonly<BoardState>, change: TaskChange): BoardTask[] {
	if (change.after.status !== "done" || change.before?.status === "done") return [];
	const done = new Set(state.tasks.filter((task) => task.status === "done").map((task) => task.id));
	return state.tasks
		.filter((task) => !isSettled(task) && task.blockedBy.includes(change.after.id) && task.blockedBy.every((id) => done.has(id)))
		.map((task) => plain(task));
}

/** Whether two advisory write scopes can touch the same files: equal paths, or one inside the other. */
export function scopesOverlap(left: readonly string[], right: readonly string[]): boolean {
	const normalize = (scope: string): string => scope.trim().replace(/^\.\//, "").replace(/\/+$/, "");
	return left.some((a) =>
		right.some((b) => {
			const one = normalize(a);
			const other = normalize(b);
			if (one === "" || one === "." || other === "" || other === ".") return true;
			return one === other || one.startsWith(`${other}/`) || other.startsWith(`${one}/`);
		}),
	);
}

// --- text the coordinator reads ----------------------------------------------------------------------------------

function clip(text: string, limit: number): string {
	const line = text.replace(/\s+/g, " ").trim();
	return line.length <= limit ? line : `${line.slice(0, limit - 1)}…`;
}

export function describeTask(task: BoardTask): string {
	const parts = [`${task.id} r${task.revision} [${task.status}] ${task.title}${task.archived ? " (archived)" : ""}`];
	if ((task.refs ?? []).length > 0) parts.push(`refs ${task.refs.join(",")}`);
	if ((task.parent ?? null) !== null) parts.push(`↳${task.parent}`);
	if ((task.foundWhile ?? null) !== null) parts.push(`found while ${task.foundWhile}`);
	if ((task.ledTo ?? []).length > 0) parts.push(`led to ${(task.ledTo ?? []).join(",")}`);
	if (task.subtaskCount !== undefined && (task.subtasks ?? []).length > 0) {
		const total = (task.subtasks ?? []).length;
		parts.push(`${total} subtask${total === 1 ? "" : "s"} (${task.subtaskCount.done} done)`);
	}
	if ((task.related ?? []).length > 0) parts.push(`related ${(task.related ?? []).join(",")}`);
	if (task.blockedBy.length > 0) parts.push(`after ${task.blockedBy.join(",")}`);
	if ((task.blocks ?? []).length > 0) parts.push(`blocks ${(task.blocks ?? []).join(",")}`);
	const waiting = (task.feedback?.open ?? 0) + (task.feedback?.handling ?? 0);
	if (waiting > 0) parts.push(`${waiting} open feedback`);
	if (task.waiting !== undefined) parts.push(`waiting for: ${task.waiting.note}; since ${task.waiting.since}${task.waiting.until === undefined ? "" : `; until ${task.waiting.until}`}`);
	if (task.blockedReason !== null) parts.push(`blocked: ${clip(task.blockedReason, 120)}`);
	if (task.writeScopes.length > 0) parts.push(`writes ${task.writeScopes.join(",")}`);
	const time = taskTime(task);
	if (time !== undefined) parts.push(time);
	if (task.workerIds.length > 0) parts.push(`workers ${task.workerIds.join(",")}`);
	if (task.scheduleId !== null) parts.push(`schedule ${task.scheduleId}`);
	if ((task.ownerThreadId ?? null) !== null) parts.push(`owner ${task.ownerThreadId}`);
	const lines = [parts.join(" | ")];
	if (task.description.trim() !== "") lines.push(`  ${clip(task.description, LIST_DESCRIPTION_CHARS)}`);
	if (task.acceptance !== null) lines.push(`  done when: ${clip(task.acceptance, LIST_DESCRIPTION_CHARS)}`);
	return lines.join("\n");
}

/** "42m in progress", or undefined for a task that never was. */
export function taskTime(task: Pick<BoardTask, "inProgressMinutes">): string | undefined {
	return task.inProgressMinutes === undefined ? undefined : `${task.inProgressMinutes}m in progress`;
}

export function describeQuestion(question: BoardQuestion): string {
	const asker = question.threadId === undefined || question.threadId === "main" ? "" : ` from ${question.threadId}`;
	const label = question.kind === "warning" ? " warning" : "";
	const head = `${question.id} r${question.revision}${label} [${question.status}]${question.taskId === null ? "" : ` (${question.taskId})`}${asker} ${question.text}`;
	const tail =
		question.status === "open"
			? question.options.length > 0
				? ` options: ${question.options.join(" / ")}`
				: ""
			: question.answer === null
				? ""
				: ` -> ${clip(question.answer, 300)}`;
	return head + tail;
}

/** How many of a task's latest timeline entries `show_task` prints. */
const SHOWN_TIMELINE_ENTRIES = 15;

/** The task a link names, as a line: its ID, status and title, with "(archived)" when the board view leaves it out. */
function linkTarget(board: Board, id: string): string {
	const task = board.tasks.find((candidate) => candidate.id === id) ?? board.archivedLinks?.find((candidate) => candidate.id === id);
	return task === undefined ? id : `${id} [${task.status}] ${clip(task.title, 80)}${task.archived ? " (archived)" : ""}`;
}

/** A task's links grouped by kind, each target on its own line; empty when it has none. */
function describeLinks(task: BoardTask, board: Board): string[] {
	const groups: [string, readonly string[]][] = [
		["subtask of", task.parent == null ? [] : [task.parent]],
		["has subtasks", task.subtasks ?? []],
		["found while working on", task.foundWhile == null ? [] : [task.foundWhile]],
		["led to", task.ledTo ?? []],
		["blocked by", task.blockedBy],
		["blocks", task.blocks ?? []],
		["related to", task.related ?? []],
	];
	return groups.filter(([, ids]) => ids.length > 0).map(([label, ids]) => `  ${label}: ${ids.map((id) => linkTarget(board, id)).join("; ")}`);
}

function feedbackLine(entry: BoardFeedback): string {
	const images = entry.images === undefined ? "" : ` (+${entry.images} image${entry.images === 1 ? "" : "s"})`;
	const note = entry.note === null ? "" : ` -> ${clip(entry.note, 200)}`;
	return `${entry.id} [${entry.state}] ${entry.at}${entry.threadId === "main" ? "" : ` in ${entry.threadId}`}: ${clip(entry.text, 600)}${images}${note}`;
}

/** What `show_task` adds to a task: its feedback entries and its timeline. */
export type TaskExtras = { feedback: readonly BoardFeedback[]; timeline: readonly BoardTimelineEntry[] };

/** One task in full: its fields, links, report, feedback, the questions, warnings and decisions about it, its workers, snapshots and latest timeline. */
export function describeTaskInFull(task: BoardTask, board: Board, snapshots: readonly BoardTaskSnapshot[], extras?: TaskExtras): string {
	const lines = [describeTask(task).split("\n")[0] as string];
	const links = describeLinks(task, board);
	if (links.length > 0) lines.push(`Links:\n${links.join("\n")}`);
	if (task.description.trim() !== "") lines.push(`description: ${task.description.trim()}`);
	if (task.acceptance !== null) lines.push(`done when: ${task.acceptance.trim()}`);
	const report = task.report;
	lines.push(`Report (r${report.revision}${report.updatedAt === null ? ", never written" : `, updated ${report.updatedAt}`}):`);
	if (task.eventSeq !== undefined) lines.push(`eventSeq: ${task.eventSeq} (pass as coveredEventSeq after reading this task; only rewritten sections cover it)`);
	if (report.freshness !== undefined) for (const name of ["results", "next"] as const) lines.push(`${name} freshness: ${JSON.stringify(report.freshness[name])}`);
	lines.push(`now: ${report.now === "" ? "(empty)" : report.now}`);
	lines.push(`results: ${report.results === "" ? "(empty)" : report.results}`);
	lines.push(`next: ${report.next === "" ? "(empty)" : report.next}`);
	if (extras !== undefined) {
		const feedback = sortFeedback(extras.feedback);
		lines.push(
			feedback.length === 0
				? "Feedback: none"
				: `Feedback (open first; mark each with the board action feedback):\n${feedback.map(feedbackLine).join("\n")}`,
		);
	}
	const questions = board.questions.filter((question) => question.taskId === task.id);
	lines.push(questions.length === 0 ? "Questions and warnings: none" : `Questions and warnings:\n${questions.map(describeQuestion).join("\n")}`);
	const decisions = board.decisions.filter((decision) => decision.taskId === task.id);
	lines.push(decisions.length === 0 ? "Decisions: none" : `Decisions:\n${decisions.map(decisionLine).join("\n")}`);
	lines.push(`Workers: ${task.workerIds.length === 0 ? "none" : task.workerIds.join(", ")}`);
	lines.push(
		snapshots.length === 0
			? "Snapshots: none"
			: `Snapshots:\n${snapshots.map((snapshot) => `#${snapshot.seq} ${snapshot.at} ${snapshot.label}`).join("\n")}`,
	);
	if (extras !== undefined && extras.timeline.length > 0) {
		const shownEntries = extras.timeline.slice(-SHOWN_TIMELINE_ENTRIES);
		const earlier = extras.timeline.length - shownEntries.length;
		const entryLine = (entry: BoardTimelineEntry): string =>
			`${entry.at} [${entry.kind}] ${entry.label}${entry.detail === undefined ? "" : `: ${clip(entry.detail, 160)}`}`;
		lines.push(`Timeline (latest ${shownEntries.length}${earlier > 0 ? `, ${earlier} earlier not shown` : ""}):\n${shownEntries.map(entryLine).join("\n")}`);
	}
	return lines.join("\n");
}

export function describeBoard(board: Board): string {
	if (board.tasks.length + board.questions.length + board.decisions.length === 0) {
		return "The board is empty. Add tasks with add_task, ask the user with ask, record a decision with decide.";
	}
	const sections: string[] = [];
	sections.push(board.tasks.length === 0 ? "Tasks: none" : `Tasks:\n${board.tasks.map(describeTask).join("\n")}`);
	sections.push(
		board.questions.length === 0 ? "Questions: none" : `Questions:\n${board.questions.map(describeQuestion).join("\n")}`,
	);
	if (board.decisions.length > 0) {
		const lines = board.decisions
			.slice(0, 10)
			.map((decision) => `${decision.id}${decision.taskId === null ? "" : ` (${decision.taskId})`} ${decision.text}${decision.why === null ? "" : ` — ${clip(decision.why, 200)}`}`);
		const more = board.decisions.length > 10 ? `\n(+${board.decisions.length - 10} older)` : "";
		sections.push(`Decisions, newest first:\n${lines.join("\n")}${more}`);
	}
	return sections.join("\n\n");
}

function taskLine(task: BoardTask): string {
	return `${task.id} ${task.title}${task.blockedBy.length > 0 ? ` (after ${task.blockedBy.join(",")})` : ""}`;
}

function decisionLine(decision: BoardDecision): string {
	return `${decision.id}${decision.taskId === null ? "" : ` (${decision.taskId})`} ${decision.text}${decision.why === null ? "" : ` — ${clip(decision.why, 200)}`}`;
}

/**
 * The board as a compaction summary carries it, within about `budgetTokens`: active tasks (in progress, in review,
 * blocked) and open questions in full; todo tasks one line each, the newest 20 then "+N more"; the latest 10
 * decisions; tasks done since `since` (the last compaction) one line each; nothing archived. Each open task shown also
 * carries its report's `now`, clipped to a line. Over budget the `now` lines go first (the last tasks' first), then the
 * todo list shrinks, then the done list; active tasks and questions are never cut.
 */
export function summaryBoardView(
	state: Readonly<BoardState> | undefined,
	options: { now: number; since: number | null; budgetTokens?: number },
): string {
	const board = boardView(state ?? emptyBoardState(), options.now, false);
	const active = board.tasks.filter((task) => task.status === "in_progress" || task.status === "review" || task.status === "waiting" || task.status === "blocked");
	const questions = board.questions.filter((question) => question.status === "open");
	const todo = board.tasks
		.filter((task) => task.status === "todo")
		.sort((left, right) => right.createdAt.localeCompare(left.createdAt) || compareIds(right.id, left.id));
	const done = board.tasks
		.filter((task) => task.status === "done" && (options.since === null || (task.settledAt !== null && Date.parse(task.settledAt) >= options.since)))
		.sort((left, right) => (right.settledAt ?? "").localeCompare(left.settledAt ?? ""));
	const decisions = board.decisions.slice(0, SUMMARY_DECISIONS);
	// The open tasks shown with a report `now`, in the order they are rendered: active ones, then todo.
	const withNow = [...active, ...todo.slice(0, SUMMARY_TODO_TASKS)].filter((task) => task.report.now.trim() !== "");
	const closing = "This is a compact view. The full board, with every description and the archive, is always available through the `board` tool (action `list`).";
	const render = (todoShown: number, doneShown: number, nowShown: number): string => {
		const nowOf = new Set(withNow.slice(0, nowShown).map((task) => task.id));
		const withNowLine = (task: BoardTask, line: string): string =>
			nowOf.has(task.id) ? `${line}\n  now: ${clip(task.report.now.replace(/\s+/g, " ").trim(), SUMMARY_NOW_CHARS)}` : line;
		const sections: string[] = [];
		sections.push(
			active.length === 0 ? "Active tasks: none" : `Active tasks:\n${active.map((task) => withNowLine(task, describeTask(task))).join("\n")}`,
		);
		sections.push(questions.length === 0 ? "Open questions: none" : `Open questions:\n${questions.map(describeQuestion).join("\n")}`);
		if (todo.length > 0) {
			const more = todo.length - todoShown;
			const lines = todo.slice(0, todoShown).map((task) => withNowLine(task, taskLine(task)));
			if (more > 0) lines.push(`+${more} more`);
			sections.push(`To do, newest first:\n${lines.join("\n")}`);
		}
		if (decisions.length > 0) sections.push(`Decisions, newest first:\n${decisions.map(decisionLine).join("\n")}`);
		if (done.length > 0) {
			const more = done.length - doneShown;
			const lines = done.slice(0, doneShown).map(taskLine);
			if (more > 0) lines.push(`+${more} more`);
			sections.push(`Done since the last summary:\n${lines.join("\n")}`);
		}
		sections.push(closing);
		return sections.join("\n\n");
	};
	const budget = options.budgetTokens ?? SUMMARY_BOARD_TOKENS;
	let todoShown = Math.min(SUMMARY_TODO_TASKS, todo.length);
	let doneShown = done.length;
	let nowShown = withNow.length;
	let text = render(todoShown, doneShown, nowShown);
	while (estimateTextTokens(text) > budget && (nowShown > 0 || todoShown > 0 || doneShown > 0)) {
		if (nowShown > 0) nowShown -= 1;
		else if (todoShown > 0) todoShown -= 1;
		else doneShown -= 1;
		text = render(todoShown, doneShown, nowShown);
	}
	return text;
}

const TRACKED_FIELDS = ["title", "status", "description", "acceptance", "refs", "blockedBy", "blockedReason", "writeScopes", "parent", "foundWhile", "related", "waiting"] as const;

/** A task's `waiting` field: what it waits for, and when to check again. */
function isWaiting(value: unknown): value is { note: string; until?: string } {
	return typeof value === "object" && value !== null && typeof (value as { note?: unknown }).note === "string";
}

function shown(value: unknown): string {
	if (Array.isArray(value)) return `[${value.join(",")}]`;
	if (value === null) return "none";
	if (isWaiting(value)) return JSON.stringify(clip(`${value.note}${value.until === undefined ? "" : `, until ${value.until}`}`, 200));
	return typeof value === "string" ? JSON.stringify(clip(value, 120)) : String(value);
}

function describeChange(before: BoardTask | null, after: BoardTask): string | undefined {
	if (before === null) return `${after.id} added: ${JSON.stringify(after.title)} [${after.status}]`;
	const parts: string[] = [];
	for (const field of TRACKED_FIELDS) {
		const from = before[field] ?? null;
		const to = after[field] ?? null;
		if (JSON.stringify(from) === JSON.stringify(to)) continue;
		parts.push(field === "description" ? "description changed" : `${field} ${shown(from)} -> ${shown(to)}`);
	}
	return parts.length === 0 ? undefined : `${after.id} ${JSON.stringify(after.title)} (r${after.revision}): ${parts.join("; ")}`;
}

/** A user's edit as one `[board]` line: the change, then what they said about it ("the user says: ..."). */
function describeEdit(edit: PendingEdit): string | undefined {
	const change = describeChange(edit.before, edit.after);
	if (edit.notes.length === 0) return change;
	const said = `the user says: ${edit.notes.map((note) => JSON.stringify(clip(note, 1000))).join(", then ")}`;
	return change === undefined ? `${edit.after.id} ${JSON.stringify(edit.after.title)} (r${edit.after.revision}): ${said}` : `${change}; ${said}`;
}

// --- the service -------------------------------------------------------------------------------------------------

export type BoardServiceOptions = {
	project(): Project;
	harness: Harness;
	/** The coordinator conversation; its ID owns the board document. */
	coordinator: Conversation;
	/** Every coordinator thread of the project; each may use the board. Default: main only. */
	coordinators?: Coordinators;
	notifications?: Notifier;
	now(): number;
	/** Quiet period before the user's edits reach the coordinator. Default `BOARD_EDIT_DEBOUNCE_MS`. */
	editDebounceMs?: number;
	taskFreshness?: boolean;
	threadIsLive?: (threadId: string) => Promise<boolean>;
	reportTimings?: { trailingMs?: number; maxBurstMs?: number; ageMs?: number; sweepMs?: number; maxTokens?: number };
	/** Called after an input reached a background thread, so a finished or stopped one counts as working again. */
	wakeThread?: (threadId: string) => Promise<void>;
	log(message: string): void;
};

/** A task the user changed since the last `[board]` input: where it started, where it is now, and what they said about it. */
type PendingEdit = { before: BoardTask | null; after: BoardTask; notes: string[] };

export class BoardService {
	readonly #options: BoardServiceOptions;
	#extension: Extension | undefined;
	#pending = new Map<string, PendingEdit>();
	#pendingOrder: { ids: string[]; at: string } | undefined;
	#timer: ReturnType<typeof setTimeout> | undefined;
	#flushing: Promise<void> = Promise.resolve();
	#waitingTimer: ReturnType<typeof setTimeout> | undefined;
	#waitingRun: Promise<void> | undefined;
	#stopped = false;
	#reportTimer: ReturnType<typeof setTimeout> | undefined;
	#reportRun: Promise<void> | undefined;
	#reportWaiters = new Set<number>();
	#reportOwners = new Map<string, string>();

	constructor(options: BoardServiceOptions) {
		this.#options = options;
	}

	get coordinator(): Conversation {
		return this.#options.coordinator;
	}

	isCoordinator(conversationId: number): boolean {
		const coordinators = this.#options.coordinators;
		return coordinators === undefined ? conversationId === this.coordinator.id : coordinators.isCoordinator(conversationId);
	}

	/** The thread a coordinator conversation is; main when there are no background threads to tell apart. */
	threadIdOf(conversationId: number): string {
		return this.#options.coordinators?.threadIdOf(conversationId) ?? "main";
	}

	/** Whether `threadId` names a thread of this project. */
	knowsThread(threadId: string): boolean {
		if (threadId === "main") return true;
		return this.#options.coordinators?.placeOfThread(threadId) !== undefined;
	}

	/** After an input reached `threadId`: a background thread that had finished works again. */
	async #woke(threadId: string | null | undefined): Promise<void> {
		if (threadId === null || threadId === undefined || threadId === "main" || !this.knowsThread(threadId)) return;
		await this.#options.wakeThread?.(threadId);
	}

	/** A thread's conversation, falling back to main's when the thread is unknown (or main itself). */
	async #conversationOf(threadId: string | null | undefined): Promise<Conversation> {
		if (threadId === null || threadId === undefined || threadId === "main") return this.coordinator;
		const place = this.#options.coordinators?.placeOfThread(threadId);
		if (place === undefined) return this.coordinator;
		return (await this.#options.coordinators?.conversation(place.conversationId)) ?? this.coordinator;
	}

	get extension(): Extension {
		this.#extension ??= createBoardExtension(this);
		return this.#extension;
	}

	#iso(): string {
		return new Date(this.#options.now()).toISOString();
	}

	async state(context: Context = BACKGROUND_CONTEXT): Promise<BoardState> {
		const state = await this.#options.harness.snapshot(BoardDoc, this.coordinator.id, context);
		if (state === undefined) return emptyBoardState();
		const stored = state as BoardState;
		return normalizeBoard({
			...plain(stored),
			tasks: plain(stored.tasks).map((task) => ({
				...task,
				report: task.report ?? emptyReport(),
				snapshots: task.snapshots ?? 0,
				refs: task.refs ?? [],
				parent: task.parent ?? null,
				foundWhile: task.foundWhile ?? null,
				related: task.related ?? [],
			})),
		});
	}

	/** Refuse a task the board does not have, archived ones included, with `unknown_task`. */
	async requireTask(taskId: string): Promise<void> {
		if (!(await this.state()).tasks.some((task) => task.id === taskId)) throw unknownTask(taskId);
	}

	/** A task's snapshots, oldest first. */
	async history(taskId: string): Promise<BoardTaskSnapshot[]> {
		await this.requireTask(taskId);
		const history = await this.#options.harness.snapshot(TaskHistoryDoc, this.coordinator.id, taskId, BACKGROUND_CONTEXT);
		return history === undefined ? [] : plain((history as TaskHistoryState).snapshots);
	}

	/**
	 * A task's timeline, oldest first, and its feedback entries (open ones first). `kinds` keeps only those kinds of entry.
	 * `unknown_task` when the board has no such task.
	 */
	async timeline(taskId: string, kinds?: readonly BoardTimelineKind[]): Promise<{ entries: BoardTimelineEntry[]; feedback: BoardFeedback[] }> {
		const state = await this.state();
		if (!state.tasks.some((task) => task.id === taskId)) throw unknownTask(taskId);
		const history = await this.#options.harness.snapshot(TaskHistoryDoc, this.coordinator.id, taskId, BACKGROUND_CONTEXT);
		return plain(buildTimeline({ id: taskId }, state, history as TaskHistoryState | undefined, kinds));
	}

	/**
	 * Record a user's message about a task as an open feedback entry. `requestId` is the message's, so a re-sent message
	 * finds its entry. Returns the entry; the caller puts its ID in the message's task reference.
	 */
	async recordFeedback(input: { taskId: string; text: string; images: number; threadId: string; requestId: string }): Promise<BoardFeedback> {
		const now = this.#iso();
		return this.#options.harness.commit(async (tx) => {
			const state = await openBoard(tx, this.#mainId);
			const history = await openTaskHistory(tx, this.#mainId, input.taskId);
			return recordFeedback(state, history, {
				taskId: input.taskId,
				text: input.text,
				images: input.images,
				threadId: input.threadId,
				key: input.requestId,
				now,
			});
		}, BACKGROUND_CONTEXT);
	}

	/**
	 * The user dismisses, reopens or otherwise sets a feedback entry. The coordinator that holds the task hears of it
	 * (a `[board]` follow-up), since it may be acting on the entry.
	 */
	async setFeedback(input: { taskId: string; feedbackId: string; state: BoardFeedbackState; note?: string | undefined }): Promise<BoardFeedback> {
		const now = this.#iso();
		const { result, owner } = await this.#options.harness.commit(async (tx) => {
			const state = await openBoard(tx, this.#mainId);
			const history = await openTaskHistory(tx, this.#mainId, input.taskId);
			const result = setFeedbackState(state, history, {
				taskId: input.taskId,
				feedbackId: input.feedbackId,
				state: input.state,
				note: input.note ?? null,
				by: USER_WRITER,
				now,
			});
			return { result, owner: state.tasks.find((task) => task.id === input.taskId)?.ownerThreadId ?? null };
		}, BACKGROUND_CONTEXT);
		if (result.changed) await this.#noticeFeedback(input.taskId, result.feedback, result.before, owner);
		return result.feedback;
	}

	/** A coordinator sets a feedback entry inside its tool call's own commit. */
	async setFeedbackFor(
		commit: <R>(change: (tx: Tx) => Promise<R>) => Promise<R>,
		input: { taskId: string; feedbackId: string; state: BoardFeedbackState; note: string | null },
		by: BoardWriter,
	): Promise<BoardFeedback> {
		const now = this.#iso();
		return commit(async (tx) => {
			const state = await openBoard(tx, this.#mainId);
			const history = await openTaskHistory(tx, this.#mainId, input.taskId);
			return setFeedbackState(state, history, { ...input, by, now }).feedback;
		});
	}

	async #noticeFeedback(taskId: string, entry: BoardFeedback, before: BoardFeedbackState, owner: string | null): Promise<void> {
		const what =
			entry.state === "dismissed"
				? "dismissed it (not needed)"
				: entry.state === "open"
					? `reopened it (it was ${before})`
					: `set it to ${entry.state}`;
		const content = `${BOARD_PREFIX} The user ${what}: feedback ${entry.id} on ${taskId}, ${JSON.stringify(clip(entry.text, 200))}${entry.note === null ? "" : ` — they say: ${JSON.stringify(clip(entry.note, 300))}`}`;
		const target = owner !== null && this.knowsThread(owner) ? owner : "main";
		try {
			const conversation = await this.#conversationOf(target);
			await conversation.submit(
				{ type: "input", content, whenBusy: "followUp", requestId: `board-feedback:${entry.id}@${entry.changes.length}` },
				BACKGROUND_CONTEXT,
			);
			await this.#woke(target);
		} catch (error) {
			this.#options.log(`board: could not tell the coordinator about feedback ${entry.id}: ${errorMessage(error)}`);
		}
	}

	/** Create the document if this project never had one, so a change watch can attach to it. */
	async ensureDocument(): Promise<void> {
		await this.#options.harness.commit(async (tx) => {
			const state = await openBoard(tx, this.#mainId);
			state.taskFreshnessEnabled = this.#options.taskFreshness !== false;
			state.lastReportSweep ??= this.#options.now();
		}, BACKGROUND_CONTEXT);
		await this.checkWaiting();
		await this.checkReports();
	}

	/** The board; a task whose 7 days passed is archived in storage on the way. */
	async get(includeArchived = false): Promise<Board> {
		const state = await this.state();
		const now = this.#options.now();
		if (state.tasks.some((task) => !task.archived && isArchivedAt(task, now))) {
			await this.#commit(HARNESS_WRITER, (doc) => {
				sweepArchive(doc, now);
			});
		}
		return boardView(state, now, includeArchived);
	}

	get #mainId(): ConversationId {
		return this.coordinator.id as ConversationId;
	}

	async #commit<T>(by: BoardWriter, change: (state: BoardState) => T): Promise<T> {
		return this.#options.harness.commit((tx) => this.#change(tx, by, undefined, (state) => change(state)), BACKGROUND_CONTEXT);
	}

	/** Open the board in `tx`, run `change`, and snapshot each task whose status it changed. */
	async #change<T>(tx: Tx, by: BoardWriter, key: string | undefined, change: (state: BoardState, now: string) => T | Promise<T>): Promise<T> {
		const state = await openBoard(tx, this.#mainId);
		const before = statusesOf(state);
		const waitingBefore = new Map(state.tasks.map((task) => [task.id, JSON.stringify(task.waiting)]));
		const linksBefore = linksOfBoard(state);
		const now = this.#iso();
		const result = await change(state, now);
		sweepArchive(state, this.#options.now());
		await snapshotStatusChanges(tx, this.#mainId, state, before, { by, at: now, key });
		for (const task of state.tasks) {
			if (task.status !== "waiting" || before.get(task.id) !== "waiting" || waitingBefore.get(task.id) === JSON.stringify(task.waiting)) continue;
			addSnapshot(await openTaskHistory(tx, this.#mainId, task.id), task, { label: "Waiting updated", by, at: now, key: key === undefined ? undefined : `${key}:${task.id}:waiting` });
		}
		await logLinkChanges(tx, this.#mainId, state, linksBefore, { by, at: now });
		return result;
	}

	/** Run a coordinator change inside the tool call's own commit; `key` is the call's, so a rerun saves no snapshot twice. */
	async commitFor<T>(
		commit: <R>(change: (tx: Tx) => Promise<R>) => Promise<R>,
		change: (state: BoardState, now: string) => T,
		by: BoardWriter,
		key: string,
	): Promise<T> {
		return commit((tx) => this.#change(tx, by, key, change));
	}

	/**
	 * Rewrite sections of a task's report inside the tool call's own commit, naming a milestone to snapshot it. `key` is
	 * the call's, so a rerun after a restart saves the snapshot once.
	 */
	async writeReport(
		commit: <R>(change: (tx: Tx) => Promise<R>) => Promise<R>,
		input: Omit<ReportWrite, "now"> & { milestone?: string | undefined },
		key: string,
	): Promise<BoardTask> {
		return commit((tx) => writeReportIn(tx, this.#mainId, input, key, this.#iso()));
	}

	/** The task a `thread` schedule reports on: its one task, put back to in_progress for this run. */
	async taskForSchedule(input: { scheduleId: string; title: string }): Promise<BoardTask> {
		return this.#commit(HARNESS_WRITER, (state) => taskForSchedule(state, { ...input, now: this.#iso() }).after);
	}

	/** The task a clock schedule's worker run is given: its one open task, or a new one. The worker's spawn moves it. */
	async scheduleTaskForRun(input: { scheduleId: string; title: string }): Promise<BoardTask> {
		return this.#commit(HARNESS_WRITER, (state) => scheduleTaskForRun(state, { ...input, now: this.#iso() }));
	}

	/** The task of one event run, made once however often the run is retried. */
	async taskForEvent(input: { title: string; description: string; marker: string; ref: string }): Promise<BoardTask> {
		return this.#commit(HARNESS_WRITER, (state) => taskForEvent(state, { ...input, now: this.#iso() }).after);
	}

	/** Create or change a task. A user's `note` (why they moved it, in their words) reaches the coordinator with the change. */
	async saveTask(
		input: { taskId?: string | undefined; expectedRevision?: number | undefined; task: BoardTaskInput; note?: string | undefined },
		author: BoardAuthor,
	): Promise<BoardTask> {
		const now = this.#iso();
		const writer = author === "user" ? USER_WRITER : author === "harness" ? HARNESS_WRITER : coordinatorWriter("main");
		const { note, ...fields } = input;
		const { change, unblocked } = await this.#commit(writer, (state) => {
			const saved = saveTask(state, { ...fields, author, now });
			return { change: saved, unblocked: unblockedBy(state, saved) };
		});
		if (author === "user") this.#recordEdit(change.before, change.after, note);
		else this.noticeReview(change);
		await this.noticeUnblocked(change.after, unblocked);
		return change.after;
	}

	/**
	 * Tell the coordinator, once per change, which tasks `done` left with every blocker done. It decides what to start:
	 * the harness never spawns on its own. The request ID derives from the done task's revision.
	 */
	async noticeUnblocked(done: BoardTask, unblocked: readonly BoardTask[]): Promise<void> {
		if (unblocked.length === 0) return;
		// Each thread hears about the tasks it owns; unclaimed ones go to main, which plans for the project.
		const byOwner = new Map<string, BoardTask[]>();
		for (const task of unblocked) {
			const owner = task.ownerThreadId ?? "main";
			const target = this.knowsThread(owner) ? owner : "main";
			byOwner.set(target, [...(byOwner.get(target) ?? []), task]);
		}
		for (const [threadId, tasks] of byOwner) {
			const names = tasks.map((task) => `${task.id} ${JSON.stringify(task.title)}`).join(", ");
			const one = tasks.length === 1;
			const content = `${BOARD_PREFIX} ${done.id} ${JSON.stringify(done.title)} is done, so ${names} ${one ? "has all its" : "have all their"} blockers done and can start.`;
			const suffix = threadId === "main" ? "" : `:${threadId}`;
			try {
				const conversation = await this.#conversationOf(threadId);
				await conversation.submit(
					{ type: "input", content, whenBusy: "followUp", requestId: `board-unblocked:${done.id}@${done.revision}${suffix}` },
					BACKGROUND_CONTEXT,
				);
				await this.#woke(threadId);
			} catch (error) {
				this.#options.log(`board: could not tell the coordinator about unblocked tasks: ${errorMessage(error)}`);
			}
		}
	}

	/** Tell the thread a task was handed to; the request ID derives from the task's new revision. */
	async noticeHandoff(task: BoardTask, from: string): Promise<void> {
		const to = task.ownerThreadId ?? null;
		if (to === null || to === from) return;
		const content = `${BOARD_PREFIX} Thread "${from}" handed ${task.id} ${JSON.stringify(task.title)} (r${task.revision}) to you. It is yours now: read it with the board tool and carry it on.`;
		try {
			const conversation = await this.#conversationOf(to);
			await conversation.submit(
				{ type: "input", content, whenBusy: "followUp", requestId: `board-handoff:${task.id}@${task.revision}` },
				BACKGROUND_CONTEXT,
			);
			await this.#woke(to);
		} catch (error) {
			this.#options.log(`board: could not tell thread ${to} about ${task.id}: ${errorMessage(error)}`);
		}
	}

	/**
	 * A thread stopped or finished: the open tasks it still holds become unclaimed, so main (or another thread) can take
	 * them over. Settled tasks keep their owner as history. Returns the released task IDs.
	 */
	async releaseThread(threadId: string, key?: string, primaryTaskId?: string | null): Promise<string[]> {
		const now = this.#iso();
		return this.#commit(HARNESS_WRITER, (state) => {
			const released: string[] = [];
			if (key !== undefined && !claimHarnessKey(state, `report-release:${key}`)) return released;
			for (const task of state.tasks) {
				const owned = task.ownerThreadId === threadId;
				if (!owned && task.id !== primaryTaskId) continue;
				noteTaskFact(state, task.id, { actor: "harness", kind: "thread_finish", reason: "thread finished or stopped", at: now });
				if (!owned || isSettled(task)) continue;
				task.ownerThreadId = null;
				touchByHarness(state, task, task.status, now);
				released.push(task.id);
			}
			return released;
		});
	}

	async noteThreadOutcome(threadId: string, key: string, reason: string, taskId?: string | null): Promise<void> {
		await this.#commit(HARNESS_WRITER, (state) => {
			if (!claimHarnessKey(state, `report-thread:${key}`)) return;
			for (const task of state.tasks) if (task.ownerThreadId === threadId || task.id === taskId) noteTaskFact(state, task.id, { actor: "harness", kind: "thread_finish", reason, at: this.#iso() });
		});
	}

	/** A scheduled run failed or was skipped: open (or update) the schedule's blocked task. */
	async recordScheduleProblem(input: { scheduleId: string; title: string; runAt: string; reason: string }): Promise<void> {
		const now = this.#iso();
		await this.#commit(HARNESS_WRITER, (state) =>
			recordScheduleProblem(state, {
				key: `schedule-run:${input.scheduleId}@${input.runAt}`,
				scheduleId: input.scheduleId,
				title: input.title,
				reason: input.reason,
				now,
			}),
		);
	}

	async reorder(taskIds: readonly string[]): Promise<void> {
		const now = this.#iso();
		const moved = await this.#commit(USER_WRITER, (state) => reorderTasks(state, taskIds, now));
		this.#pendingOrder = { ids: moved, at: now };
		this.#armEditTimer();
	}

	async answer(input: { questionId: string; expectedRevision: number; answer: string }): Promise<BoardQuestion> {
		const now = this.#iso();
		const question = await this.#commit(USER_WRITER, (state) => settleQuestion(state, { ...input, now, actor: "user" }));
		const text = `${BOARD_PREFIX} The user answered ${question.id} (${JSON.stringify(clip(question.text, 200))}): ${input.answer}`;
		try {
			// The answer goes to the thread that asked; a question from before threads, or from a thread that is gone, to main.
			const asker = await this.#conversationOf(question.threadId);
			await asker.submit(
				{ type: "input", content: text, whenBusy: "steer", requestId: `board-answer:${question.id}@${question.revision}` },
				BACKGROUND_CONTEXT,
			);
			await this.#woke(question.threadId);
		} catch (error) {
			this.#options.log(`board: could not deliver the answer to ${question.id}: ${errorMessage(error)}`);
		}
		return question;
	}

	/** Tell the user's devices once about a question or warning a coordinator asked. */
	noticeQuestion(question: BoardQuestion): void {
		const project = this.#options.project();
		this.#options.notifications?.notify(
			boardQuestionNotification({
				projectId: project.id,
				projectName: project.name,
				questionId: question.id,
				text: question.text,
				threadId: question.threadId ?? "main",
				taskId: question.taskId,
				warning: question.kind === "warning",
			}),
		);
	}

	/** Tell the user's devices once that someone but the user moved a task to review. */
	noticeReview(change: TaskChange): void {
		if (change.after.status !== "review" || change.before?.status === "review") return;
		const project = this.#options.project();
		this.#options.notifications?.notify(
			taskReviewNotification({
				projectId: project.id,
				projectName: project.name,
				taskId: change.after.id,
				title: change.after.title,
				revision: change.after.revision,
				...(change.after.ownerThreadId === null || change.after.ownerThreadId === undefined ? {} : { threadId: change.after.ownerThreadId }),
			}),
		);
	}

	/** Push the board without archived tasks whenever the document changes. Resolves to a stop function. */
	async watch(onChange: (board: Board, openQuestions: number) => void): Promise<() => Promise<void>> {
		const watch = await this.#options.harness.watchDoc(BoardDoc, this.coordinator.id, BACKGROUND_CONTEXT);
		if (watch === undefined) return async () => undefined;
		let current = "";
		const publish = (value: BoardState | Readonly<BoardState> | null): void => {
			const state = (value ?? emptyBoardState()) as BoardState;
			const board = boardView(state, this.#options.now(), false);
			const encoded = JSON.stringify(board);
			if (encoded === current) return;
			current = encoded;
			onChange(board, openQuestionCount(state));
			this.#armWaiting(state);
			this.#armReports(state);
		};
		publish(watch.value);
		watch.start(async (call) => {
			if (call.kind === "failed") throw call.error;
			const value = call.value;
			publish(value);
		});
		return async () => {
			await watch.stop().catch(() => undefined);
		};
	}

	// --- the user's edits, as one input ---------------------------------------------------------------------------

	#recordEdit(before: BoardTask | null, after: BoardTask, note?: string): void {
		const existing = this.#pending.get(after.id);
		const said = note?.trim() ?? "";
		const notes = [...(existing?.notes ?? []), ...(said.length === 0 ? [] : [said])];
		this.#pending.set(after.id, { before: existing === undefined ? before : existing.before, after, notes });
		this.#armEditTimer();
	}

	#armEditTimer(): void {
		if (this.#timer !== undefined) clearTimeout(this.#timer);
		this.#timer = setTimeout(() => {
			this.#timer = undefined;
			void this.flushEdits();
		}, this.#options.editDebounceMs ?? BOARD_EDIT_DEBOUNCE_MS);
		this.#timer.unref?.();
	}

	/** Send the user's edits so far to the coordinator as one `[board]` follow-up. */
	flushEdits(): Promise<void> {
		if (this.#timer !== undefined) clearTimeout(this.#timer);
		this.#timer = undefined;
		const edits = [...this.#pending.values()];
		const order = this.#pendingOrder;
		this.#pending = new Map();
		this.#pendingOrder = undefined;
		const lines = edits.map((edit) => describeEdit(edit)).filter((line) => line !== undefined);
		if (order !== undefined) lines.push(`order: ${order.ids.join(", ")} first`);
		if (lines.length === 0) return this.#flushing;
		const key = createHash("sha256")
			.update(edits.map((edit) => `${edit.after.id}@${edit.after.revision}`).join(",") + (order === undefined ? "" : `|${order.ids.join(",")}@${order.at}`))
			.digest("hex")
			.slice(0, 16);
		const content = `${BOARD_PREFIX} The user changed the board:\n${lines.map((line) => `- ${line}`).join("\n")}`;
		this.#flushing = this.#flushing.then(async () => {
			try {
				await this.coordinator.submit(
					{ type: "input", content, whenBusy: "followUp", requestId: `board-edit:${key}` },
					BACKGROUND_CONTEXT,
				);
			} catch (error) {
				this.#options.log(`board: could not deliver the user's edits: ${errorMessage(error)}`);
			}
		});
		return this.#flushing;
	}

	/** Rebuild the timer from durable task dates, also run when a project opens after a restart. */
	#armWaiting(state: Readonly<BoardState>): void {
		if (this.#waitingTimer !== undefined) clearTimeout(this.#waitingTimer);
		if (this.#stopped) return;
		const due = state.tasks.flatMap((task) => task.status === "waiting" && task.waiting?.until !== undefined ? [Date.parse(task.waiting.until)] : []);
		if (due.length === 0 && (state.waitingReturns?.length ?? 0) === 0) return;
		const delay = (state.waitingReturns?.length ?? 0) > 0 ? 1000 : Math.max(0, Math.min(60_000, Math.min(...due) - this.#options.now()));
		this.#waitingTimer = setTimeout(() => {
			this.#waitingTimer = undefined;
			void this.checkWaiting().catch((error) => this.#options.log(`board: waiting return failed: ${errorMessage(error)}`));
		}, delay);
		this.#waitingTimer.unref?.();
	}

	/** Exposed for an injected clock; delivery is replayable after a crash between commit and submit. */
	checkWaiting(): Promise<void> {
		if (this.#waitingRun !== undefined) return this.#waitingRun;
		this.#waitingRun = this.#returnWaiting().finally(async () => {
			this.#waitingRun = undefined;
			this.#armWaiting(await this.state());
		});
		return this.#waitingRun;
	}

	async #returnWaiting(): Promise<void> {
		const state = await this.state();
		const now = this.#options.now();
		if (state.tasks.some((task) => task.status === "waiting" && task.waiting?.until !== undefined && Date.parse(task.waiting.until) <= now)) {
			await this.#commit(HARNESS_WRITER, (doc) => {
				for (const task of doc.tasks) {
					if (task.status !== "waiting" || task.waiting?.until === undefined || Date.parse(task.waiting.until) > now) continue;
					const note = task.waiting.note;
					touchByHarness(doc, task, "review", new Date(now).toISOString());
					doc.waitingReturns ??= [];
					doc.waitingReturns.push({ task: plain(task), note });
				}
			});
		}
		for (const returned of (await this.state()).waitingReturns ?? []) {
			const { task, note } = returned;
			const project = this.#options.project();
			await this.#options.notifications?.deliver({
				...taskReviewNotification({ projectId: project.id, projectName: project.name, taskId: task.id, title: task.title, revision: task.revision, ...(task.ownerThreadId == null ? {} : { threadId: task.ownerThreadId }) }),
				body: `${task.id} is back for review: waiting for ${note}`,
			});
			const target = task.ownerThreadId ?? "main";
			const conversation = await this.#conversationOf(target);
			await conversation.submit({ type: "input", content: `${BOARD_PREFIX} ${task.id} is back for review: waiting for ${note}. Its check-again date has passed; check the external dependency with the user.`, whenBusy: "followUp", requestId: `board-waiting:${task.id}@${task.revision}` }, BACKGROUND_CONTEXT);
			await this.#woke(target);
			await this.#commit(HARNESS_WRITER, (doc) => {
				doc.waitingReturns = (doc.waitingReturns ?? []).filter((entry) => entry.task.id !== task.id || entry.task.revision !== task.revision);
			});
		}
	}


 /** Future commit/deploy adapters use this entry point only after attribution is verified. */
 async noteTaskFact(taskId: string, fact: TaskFact): Promise<void> {
  await this.requireTask(taskId);
  await this.#commit(HARNESS_WRITER, (state) => noteTaskFact(state, taskId, fact));
 }

 async markReportStale(taskId: string, sections?: readonly ReportSection[], reason?: string): Promise<BoardTask> {
  await this.requireTask(taskId);
  return this.#commit(USER_WRITER, (state) => {
   markReportStale(state, taskId, sections, reason, this.#iso(), "user");
   return plain(state.tasks.find((task) => task.id === taskId)!);
  });
 }

 /** Preserve outgoing thread messages too, including tools called through code mode. Consume at the sender's turn end. */
 async recordReportChat(threadId: string, text: string, key: string): Promise<void> {
  if (this.#options.taskFreshness === false) return;
  await this.#commit(HARNESS_WRITER, (state) => {
   if (substantiveTaskMentions(text, new Set(state.tasks.map((task) => task.id))).length === 0) return;
   state.reportChatCandidates ??= {};
   const candidates = state.reportChatCandidates[threadId] ?? [];
   if (candidates.some((candidate) => candidate.key === key)) return;
   state.reportChatCandidates[threadId] = [...candidates, { text: text.slice(0, 4000), key }].slice(-20);
  });
 }

 /** Called once at run end; no chat text or report rewrite is added to the timeline. */
 async noteChat(content: string, written: ReadonlySet<string>, key: string, threadId = "main"): Promise<void> {
  if (this.#options.taskFreshness === false) return;
  await this.#commit(HARNESS_WRITER, (state) => {
   if (!claimHarnessKey(state, key)) return;
   const sources = [{ text: content, key }, ...(state.reportChatCandidates?.[threadId] ?? [])];
   if (state.reportChatCandidates !== undefined) delete state.reportChatCandidates[threadId];
   const valid = new Set(state.tasks.map((task) => task.id));
   const mentioned = new Set<string>();
   for (const source of sources) for (const id of substantiveTaskMentions(source.text, valid)) {
    if (written.has(id) || mentioned.has(id)) continue;
    mentioned.add(id);
    noteTaskFact(state, id, { actor: "harness", kind: "chat", reason: "discussed in chat", at: this.#iso() });
    const tracking = state.reportTracking?.[id];
    if (tracking !== undefined) tracking.chatEvidence = [...(tracking.chatEvidence ?? []), { snippet: source.text.replace(/\s+/g, " ").slice(0, 240), source: source.key }].slice(-2);
   }
  });
 }

 #armReports(state: Readonly<BoardState>): void {
  if (this.#reportTimer !== undefined) clearTimeout(this.#reportTimer);
  if (this.#stopped || state.taskFreshnessEnabled === false) return;
  const timings = this.#options.reportTimings;
  const due = Object.entries(state.reportTracking ?? {}).flatMap(([id, tracking]) => {
   const task = state.tasks.find((candidate) => candidate.id === id);
   const owner = this.#reportOwners.get(id) ?? task?.ownerThreadId ?? "main";
   return tracking.pending === undefined || state.reportInFlight?.[owner] !== undefined ? [] : [reportDueAt(tracking.pending, timings?.trailingMs, timings?.maxBurstMs)];
  });
  due.push((state.lastReportSweep ?? this.#options.now()) + (timings?.sweepMs ?? REPORT_SWEEP_MS));
  const delay = (state.reportOutbox?.length ?? 0) > 0 ? 10 : Math.max(10, Math.min(...due) - this.#options.now());
  this.#reportTimer = setTimeout(() => {
   this.#reportTimer = undefined;
   void this.checkReports().catch((error) => this.#options.log(`board: report nudge failed: ${errorMessage(error)}`));
  }, delay);
  this.#reportTimer.unref?.();
 }

 /** Injectable clock/timings; the outbox is frozen before submit, acknowledged afterwards. */
 checkReports(): Promise<void> {
  if (this.#reportRun !== undefined) return this.#reportRun;
  this.#reportRun = this.#deliverReports().finally(async () => {
   this.#reportRun = undefined;
   this.#armReports(await this.state());
  });
  return this.#reportRun;
 }

 async #deliverReports(): Promise<void> {
  if (this.#options.taskFreshness === false) return;
  const timings = this.#options.reportTimings;
  const state = await this.state();
  const live = new Set<string>(["main"]);
  for (const owner of new Set(state.tasks.map((task) => task.ownerThreadId ?? "main"))) {
   if (this.knowsThread(owner) && (this.#options.threadIsLive === undefined || await this.#options.threadIsLive(owner))) live.add(owner);
  }
  for (const task of state.tasks) this.#reportOwners.set(task.id, live.has(task.ownerThreadId ?? "main") ? task.ownerThreadId ?? "main" : "main");
  await this.#commit(HARNESS_WRITER, (state) => {
   sweepReportAge(state, this.#options.now(), timings?.ageMs, timings?.sweepMs);
   prepareReportNudges(state, this.#options.now(), (task) => {
    const owner = task.ownerThreadId ?? "main";
    return live.has(owner) ? owner : "main";
   }, timings);
  });
  for (const batch of (await this.state()).reportOutbox ?? []) {
   const conversation = await this.#conversationOf(batch.owner);
   const submission = await conversation.submit({ type: "input", content: batch.content, whenBusy: "followUp", requestId: batch.key }, BACKGROUND_CONTEXT);
   await this.#woke(batch.owner);
   await this.#commit(HARNESS_WRITER, (state) => acknowledgeReportNudge(state, batch.key, submission.id));
  }
  for (const [owner, id] of Object.entries((await this.state()).reportInFlight ?? {})) this.#waitForReport(owner, id);
 }

 #waitForReport(owner: string, id: number): void {
  if (this.#reportWaiters.has(id) || this.#stopped) return;
  this.#reportWaiters.add(id);
  void (async () => {
   const submission = await this.#options.harness.submission(id as Parameters<Harness["submission"]>[0], BACKGROUND_CONTEXT);
   await submission?.wait(BACKGROUND_CONTEXT);
   if (this.#stopped) return;
   await this.#commit(HARNESS_WRITER, (state) => {
    if (state.reportInFlight?.[owner] === id) delete state.reportInFlight[owner];
   });
   await this.#reportRun;
   if (!this.#stopped) await this.checkReports();
  })().catch((error) => { if (!this.#stopped) this.#options.log(`board: report receipt failed: ${errorMessage(error)}`); }).finally(() => this.#reportWaiters.delete(id));
 }

	/** Deliver edits still waiting, then stop the timer; called before the project closes. */
	async stop(): Promise<void> {
		this.#stopped = true;
		if (this.#waitingTimer !== undefined) clearTimeout(this.#waitingTimer);
		if (this.#reportTimer !== undefined) clearTimeout(this.#reportTimer);
		await this.#reportRun;
		await this.#waitingRun;
		await this.flushEdits();
	}
}

// --- the coordinator's tool --------------------------------------------------------------------------------------

function toolText(text: string, options: { isError?: boolean; details?: JsonObject } = {}): {
	output: { type: "text"; text: string }[];
	isError?: boolean;
	details?: JsonObject;
} {
	return {
		output: [{ type: "text", text }],
		...(options.isError === true ? { isError: true } : {}),
		...(options.details === undefined ? {} : { details: options.details }),
	};
}

const BoardToolParameters = Type.Object({
	action: Type.Union(
		[
			Type.Literal("list"),
			Type.Literal("add_task"),
			Type.Literal("update_task"),
			Type.Literal("drop_task"),
			Type.Literal("ask"),
			Type.Literal("resolve_question"),
			Type.Literal("decide"),
			Type.Literal("write_report"),
			Type.Literal("show_task"),
			Type.Literal("claim"),
			Type.Literal("release"),
			Type.Literal("handoff"),
			Type.Literal("link"),
			Type.Literal("unlink"),
			Type.Literal("feedback"),
		],
		{
			description:
				"list: the board. add_task: needs title. update_task: needs id and expectedRevision, changes only the fields you pass. drop_task: refused; only the user drops a task. write_report: needs id and at least one of now, results, next; replaces the sections you pass and nothing else, never conflicts; milestone saves a snapshot. show_task: needs id; the task in full with its report, questions, warnings, decisions, workers and snapshots. ask: needs text; the user sees it as a waiting question, or as a warning with kind \"warning\". resolve_question: needs id; with answer it records the answer you got in the chat, without it withdraws the question. decide: needs text. claim: needs id and expectedRevision; makes the task yours, refused when another thread holds it. release: needs id and expectedRevision; gives up a task you hold. handoff: needs id, expectedRevision and toThread; passes a task you hold to another thread (\"main\" for main), which is told. link: needs id, link and to; adds one link from task id to task to (no revision needed). unlink: needs id, link, and to (optional for parent and foundWhile); removes it. feedback: needs id (the task), feedbackId and state; sets what became of a user's feedback entry (see state, note).",
		},
	),
	waitingFor: Type.Optional(Type.String({ maxLength: 2000, description: "Required when setting waiting: the external review, release or reply the user named." })),
	waitUntil: Type.Optional(Type.String({ description: "Optional ISO check-again date or timestamp; returns to review automatically." })),
	id: Type.Optional(Type.String({ minLength: 1, description: "A task ID (T3) for update_task, write_report and show_task, a question ID (Q2) for resolve_question." })),
	expectedRevision: Type.Optional(
		Type.Integer({ minimum: 1, description: "The row's revision from the last list (the rN). A stale one is refused: list again." }),
	),
	includeArchived: Type.Optional(Type.Boolean({ description: "list: also show done and dropped tasks archived after 7 days." })),
	title: Type.Optional(
		Type.String({
			minLength: 1,
			description: 'A short, plain outcome the user reads at a glance, e.g. "Complete the example change". Tickets and pull requests go in refs, not here.',
		}),
	),
	description: Type.Optional(Type.String()),
	acceptance: Type.Optional(Type.Union([Type.String(), Type.Null()], { description: "Done when…; null clears it." })),
	refs: Type.Optional(
		Type.Array(Type.String(), {
			description:
				'add_task, update_task: what the task is about elsewhere, as full links, e.g. ["https://acme.atlassian.net/browse/EX-1234", "https://github.com/acme/app/pull/1234"]. When you only know a ticket key or PR number, look up its link (gh, acli) first. update_task replaces the whole list.',
		}),
	),
	status: Type.Optional(
		Type.Union(
			["todo", "in_progress", "blocked", "review", "waiting", "done", "dropped"].map((status) => Type.Literal(status)),
			{
				description:
					"Default todo. blocked: waiting or stopped (say why in blockedReason). review: ready for the user to check; say in the report's next what they should check. done and dropped are the user's alone: you cannot set them.",
			},
		),
	),
	blockedBy: Type.Optional(Type.Array(Type.String(), { description: "Task IDs this one waits for; they must exist and not form a cycle." })),
	blockedReason: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	writeScopes: Type.Optional(Type.Array(Type.String(), { description: "Paths the task will change; advisory." })),
	text: Type.Optional(Type.String({ minLength: 1, description: "The question or warning (ask) or the decision (decide)." })),
	kind: Type.Optional(
		Type.Union([Type.Literal("question"), Type.Literal("warning")], {
			description: 'ask: "question" (default) waits for the user\'s answer. "warning" is something they must not miss; it stays open until they acknowledge it, and has no options.',
		}),
	),
	options: Type.Optional(Type.Array(Type.String(), { description: "ask: suggested answers." })),
	coveredEventSeq: Type.Optional(Type.Integer({ minimum: 0, description: "write_report: optional eventSeq from when you read the task, so anything that happened since stays marked. If omitted, a changed section covers events up to this write." })),
	waitsOn: Type.Optional(Type.Array(Type.String(), { description: "write_report Next: explicit IDs of Q/task/change/deploy dependencies. Omitted means any task answer can invalidate Next." })),
	now: Type.Optional(Type.String({ description: "write_report: what is happening right now, rewritten whole; empty when nothing is." })),
	results: Type.Optional(Type.String({ description: "write_report: what came out of the task, as short bullets with evidence (commit, artifact, test run), rewritten whole." })),
	next: Type.Optional(Type.String({ description: "write_report: what comes next and who does it, rewritten whole." })),
	milestone: Type.Optional(
		Type.String({ minLength: 1, description: 'write_report: a few words naming something meaningful that just happened, e.g. "First version merged". Saves a snapshot of the task.' }),
	),
	taskId: Type.Optional(Type.String({ minLength: 1, description: "ask, decide: the task it concerns." })),
	why: Type.Optional(Type.String({ description: "decide: the reason." })),
	answer: Type.Optional(Type.String({ minLength: 1, description: "resolve_question: the answer." })),
	toThread: Type.Optional(Type.String({ minLength: 1, description: 'handoff: the thread that takes the task over ("main" for main).' })),
	parent: Type.Optional(
		Type.Union([Type.String({ minLength: 1 }), Type.Null()], {
			description:
				"add_task, update_task: the task this is a subtask of, for a planned piece of a bigger task. A loose link: the parent may go to review or close with subtasks open, and subtasks stay their own cards. At most one; no cycles. update_task: null removes it.",
		}),
	),
	foundWhile: Type.Optional(
		Type.Union([Type.String({ minLength: 1 }), Type.Null()], {
			description:
				"add_task, update_task: the task whose work led you to find this one (a bug, more to build, an analysis). Always set it for a task found while working on another. At most one. update_task: null removes it.",
		}),
	),
	related: Type.Optional(
		Type.Array(Type.String({ minLength: 1 }), {
			description: "add_task, update_task: tasks to see also (symmetric: each shows the other). update_task replaces the whole list; use link and unlink to add or remove one.",
		}),
	),
	link: Type.Optional(
		Type.Union([Type.Literal("parent"), Type.Literal("foundWhile"), Type.Literal("related"), Type.Literal("blockedBy")], {
			description: "link, unlink: the kind. parent: id is a subtask of to. foundWhile: id was found while working on to. related: see also, both ways. blockedBy: id waits for to.",
		}),
	),
	to: Type.Optional(Type.String({ minLength: 1, description: "link, unlink: the other task." })),
	feedbackId: Type.Optional(Type.String({ minLength: 1, description: 'feedback: the entry, e.g. "F3" (the message said "[task T12, feedback F3]").' })),
	state: Type.Optional(
		Type.Union([Type.Literal("open"), Type.Literal("handling"), Type.Literal("addressed")], {
			description: "feedback: handling when you act on it; addressed when done, with a note that says what addressed it. open puts it back. Only the user dismisses an entry.",
		}),
	),
	note: Type.Optional(Type.String({ description: 'feedback: what is being done, or for addressed what addressed it: a commit, a result, "answered in chat".' })),
});

type BoardToolArguments = Static<typeof BoardToolParameters>;

function onlyUserCloses(status: "done" | "dropped"): string {
	return `Only the user closes a task: you cannot set it ${status}. Move it to review (status review) instead, and write in its report's next what the user should check. The user marks it ${status} when they agree.`;
}

function createBoardExtension(service: BoardService): Extension {
	const boardTool = defineTool({
		name: "board",
		description:
			"Your working board for this project: tasks (with dependencies and the workers that ran them), questions waiting on the user, and decisions. " +
			"It is durable and always current; read it with action `list` instead of remembering it. Keep it in step with the work: add tasks as you plan, " +
			'each titled with a short, plain outcome the user reads at a glance ("Complete the example change"), with its tickets and pull requests in its refs as full links, not in the title; ' +
			"move a task to `review` when it is ready for the user (only the user sets `done` or `dropped`), keep each task's report current with `write_report`, " +
			"ask the user with `ask` when you need their call (they get a notification and answer in the app), warn them of what they must not miss with `ask` kind `warning`, and " +
			"record choices worth keeping with `decide`. The user edits it too; their edits arrive as `[board]` messages. " +
			"Every update names the row's revision from your last list, so you never overwrite a newer edit. The board is shared by every thread of the project: " +
			"claim a task before you work on it, so no other thread takes it too, and release or hand it over when you stop. " +
			"Tasks link to each other, each link shown from both sides: a subtask (`parent`, loose), the task a new one was found while working on (`foundWhile`), `related`, and `blockedBy`. " +
			"The user's messages about a task are feedback entries on it (F3): mark each `handling` when you act on it and `addressed`, with a note of what addressed it, when done.",
		parameters: BoardToolParameters,
		replay: "unsafe",
		execute: async (args, api, context) => {
			if (!service.isCoordinator(api.conversationId)) {
				return toolText("board answers only the project's coordinator conversation, never a worker.", { isError: true });
			}
			const input = args as BoardToolArguments;
			const threadId = service.threadIdOf(api.conversationId);
			const writer = coordinatorWriter(threadId);
			// Names this call in snapshot keys; call IDs are only unique within a conversation.
			const callKey = `call:${api.conversationId}:${api.callId}`;
			try {
				switch (input.action) {
					case "list": {
						return toolText(describeBoard(await service.get(input.includeArchived === true)));
					}
					case "add_task": {
						if (input.status === "done" || input.status === "dropped") return toolText(onlyUserCloses(input.status), { isError: true });
						const change = await service.commitFor(
							(change) => api.commit(change, context),
							(state, now) =>
								saveTask(state, {
									task: {
										title: need(input.title, input.action, "title"),
										description: input.description ?? "",
										acceptance: input.acceptance ?? null,
										refs: input.refs ?? [],
										...(input.waitingFor === undefined ? {} : { waitingFor: input.waitingFor }),
										...(input.waitUntil === undefined ? {} : { waitUntil: input.waitUntil }),
										status: input.status ?? "todo",
										blockedBy: input.blockedBy ?? [],
										blockedReason: input.blockedReason ?? null,
										writeScopes: input.writeScopes ?? [],
										...(input.parent === undefined ? {} : { parent: input.parent }),
										...(input.foundWhile === undefined ? {} : { foundWhile: input.foundWhile }),
										...(input.related === undefined ? {} : { related: input.related }),
									},
									author: "coordinator",
									now,
								}),
							writer,
							callKey,
						);
						const task = change.after;
						service.noticeReview(change);
						return toolText(`Added ${task.id} (r${task.revision}).`, { details: { taskId: task.id } });
					}
					case "update_task":
					case "drop_task": {
						if (input.action === "drop_task") return toolText(onlyUserCloses("dropped"), { isError: true });
						if (input.status === "done" || input.status === "dropped") return toolText(onlyUserCloses(input.status), { isError: true });
						if (input.status === "waiting" && !input.waitingFor?.trim()) return toolText("Waiting requires a waitingFor note: what external review, release or reply is this waiting for?", { isError: true });
						const id = need(input.id, input.action, "id");
						const expectedRevision = need(input.expectedRevision, input.action, "expectedRevision");
						const { change, unblocked } = await service.commitFor(
							(change) => api.commit(change, context),
							(state, now) => {
								const current = state.tasks.find((candidate) => candidate.id === id);
								if (current === undefined) throw unknownTask(id);
								const change = saveTask(state, {
									taskId: id,
									expectedRevision,
									task: {
										title: input.title ?? current.title,
										description: input.description ?? current.description,
										acceptance: input.acceptance === undefined ? current.acceptance : input.acceptance,
										refs: input.refs ?? current.refs ?? [],
										...(input.waitingFor === undefined ? {} : { waitingFor: input.waitingFor }),
										...(input.waitUntil === undefined ? {} : { waitUntil: input.waitUntil }),
										status: input.status ?? current.status,
										blockedBy: input.blockedBy ?? current.blockedBy,
										blockedReason: input.blockedReason === undefined ? current.blockedReason : input.blockedReason,
										writeScopes: input.writeScopes ?? current.writeScopes,
										...(input.parent === undefined ? {} : { parent: input.parent }),
										...(input.foundWhile === undefined ? {} : { foundWhile: input.foundWhile }),
										...(input.related === undefined ? {} : { related: input.related }),
									},
									author: "coordinator",
									now,
								});
								return { change, unblocked: unblockedBy(state, change) };
							},
							writer,
							callKey,
						);
						const task = change.after;
						service.noticeReview(change);
						await service.noticeUnblocked(task, unblocked);
						return toolText(`Updated ${task.id} (now r${task.revision}, ${task.status}).`, { details: { taskId: task.id } });
					}
					case "ask": {
						const question = await service.commitFor(
							(change) => api.commit(change, context),
							(state, now) =>
								askQuestion(state, {
									text: need(input.text, input.action, "text"),
									options: input.options ?? [],
									taskId: input.taskId ?? null,
									now,
									threadId,
									...(input.kind === undefined ? {} : { kind: input.kind }),
								}),
							writer,
							callKey,
						);
						service.noticeQuestion(question);
						if (question.kind === "warning") {
							return toolText(`Warned the user (${question.id}). It stays open until they acknowledge it; that arrives as a [board] message.`, {
								details: { questionId: question.id },
							});
						}
						return toolText(`Asked ${question.id}. The user's answer arrives as a [board] message.`, {
							details: { questionId: question.id },
						});
					}
					case "resolve_question": {
						const id = need(input.id, input.action, "id");
						const question = await service.commitFor(
							(change) => api.commit(change, context),
							(state, now) =>
								settleQuestion(state, { questionId: id, expectedRevision: input.expectedRevision, answer: input.answer ?? null, now, actor: input.answer == null ? "coordinator" : "user" }),
							writer,
							callKey,
						);
						return toolText(`${question.id} is ${question.status}.`, { details: { questionId: question.id } });
					}
					case "decide": {
						const decision = await service.commitFor(
							(change) => api.commit(change, context),
							(state, now) =>
								addDecision(state, {
									text: need(input.text, input.action, "text"),
									why: input.why ?? null,
									taskId: input.taskId ?? null,
									now,
									threadId,
								}),
							writer,
							callKey,
						);
						return toolText(`Recorded ${decision.id}.`, { details: { decisionId: decision.id } });
					}
					case "write_report": {
						const id = need(input.id, input.action, "id");
						const task = await service.writeReport(
							(change) => api.commit(change, context),
							{
								taskId: id,
								sections: { now: input.now, results: input.results, next: input.next },
								by: writer,
								milestone: input.milestone,
							coveredEventSeq: input.coveredEventSeq,
							waitsOn: input.waitsOn,
							},
							callKey,
						);
						const milestone = input.milestone === undefined ? "" : `; milestone "${input.milestone.trim()}" saved`;
						return toolText(`Rewrote the report of ${task.id} (report r${task.report.revision}${milestone}).`, {
							details: { taskId: task.id },
						});
					}
					case "show_task": {
						const id = need(input.id, input.action, "id");
						const board = await service.get(true);
						const task = board.tasks.find((candidate) => candidate.id === id);
						if (task === undefined) throw unknownTask(id);
						const { entries, feedback } = await service.timeline(id);
						return toolText(describeTaskInFull(task, board, await service.history(id), { feedback, timeline: entries }), {
							details: { taskId: task.id },
						});
					}
					case "link":
					case "unlink": {
						const id = need(input.id, input.action, "id");
						const link = need(input.link, input.action, "link");
						const remove = input.action === "unlink";
						const change = await service.commitFor(
							(commit) => api.commit(commit, context),
							(state, now) => changeLink(state, { taskId: id, link, to: input.to, remove, now }),
							writer,
							callKey,
						);
						const words = LINK_WORDS[link].out;
						const target = input.to ?? (link === "parent" || link === "foundWhile" ? change.before?.[link] : undefined) ?? "";
						return toolText(`${remove ? "Unlinked" : "Linked"}: ${id}${remove ? " was" : ""} ${words} ${target}.`, {
							details: { taskId: change.after.id },
						});
					}
					case "feedback": {
						const id = need(input.id, input.action, "id");
						const feedbackId = need(input.feedbackId, input.action, "feedbackId");
						const feedbackState = need(input.state, input.action, "state");
						if (!COORDINATOR_FEEDBACK_STATES.includes(feedbackState)) {
							return toolText("Only the user dismisses feedback. Set it to handling, addressed or open.", { isError: true });
						}
						const entry = await service.setFeedbackFor(
							(commit) => api.commit(commit, context),
							{ taskId: id, feedbackId, state: feedbackState, note: input.note ?? null },
							writer,
						);
						return toolText(`${entry.id} on ${id} is ${entry.state}.`, { details: { taskId: id, feedbackId: entry.id } });
					}
					case "claim":
					case "release":
					case "handoff": {
						const id = need(input.id, input.action, "id");
						const expectedRevision = need(input.expectedRevision, input.action, "expectedRevision");
						let change: OwnershipChange;
						if (input.action === "handoff") {
							const to = need(input.toThread, input.action, "toThread");
							if (!service.knowsThread(to)) {
								return toolText(`No thread "${to}" in this project (unknown_thread). thread_list shows them.`, {
									isError: true,
									details: { code: "unknown_thread", threadId: to },
								});
							}
							change = { kind: "handoff", threadId, to };
						} else {
							change = { kind: input.action, threadId };
						}
						const task = await service.commitFor(
							(commit) => api.commit(commit, context),
							(state, now) => changeOwner(state, { taskId: id, expectedRevision, change, now }).after,
							writer,
							callKey,
						);
						if (input.action === "handoff") await service.noticeHandoff(task, threadId);
						const owner = task.ownerThreadId ?? null;
						return toolText(
							`${task.id} (now r${task.revision}) is ${owner === null ? "unclaimed" : owner === threadId ? "yours" : `thread "${owner}"'s`}.`,
							{ details: { taskId: task.id, ownerThreadId: owner } },
						);
					}
					default:
						return toolText("Unknown action.", { isError: true });
				}
			} catch (error) {
				return toolText(errorMessage(error), { isError: true });
			}
		},
	});

	return defineExtension({ name: "board-tools", tools: [boardTool] as ToolRegistration[], hooks: [hook(GenerationTask, {
  afterRun: async (run, api, context) => {
   if (!service.isCoordinator(api.conversationId)) return undefined;
   const written = new Set<string>();
   let cursor;
   const texts: string[] = [];
   do {
    const page = await api.entries({ minEntryId: run.first, maxEntryId: run.last }, 200, cursor, context);
    for (const entry of page.items) for (const message of entry.model ?? []) {
     if (message.role === "toolResult" && message.toolName === "board" && !message.isError) {
      for (const block of message.content) if (block.type === "text") {
       const id = /^Rewrote the report of (T[1-9]\d*)\b/.exec(block.text)?.[1];
       if (id !== undefined) written.add(id);
      }
     }
     if (message.role !== "assistant") continue;
     for (const block of message.content) {
      if (block.type === "text") texts.push(block.text);
      if (block.type === "toolCall" && block.name === "thread_send" && typeof block.arguments.message === "string") texts.push(block.arguments.message);
     }
    }
    cursor = page.next;
   } while (cursor !== undefined);
   await service.noteChat(texts.join("\n"), written, `report-chat:${api.conversationId}:${run.first}:${run.last}`, service.threadIdOf(api.conversationId));
   return undefined;
  },
 })] });
}
