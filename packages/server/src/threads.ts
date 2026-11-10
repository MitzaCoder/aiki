/**
 * Background threads: full coordinators of a project, started by main (or a schedule) for big, long work. The contract
 * is `packages/protocol/src/threads.ts`; the design is DESIGN.md "Threads".
 *
 * A background thread is a child conversation of main's, built like a worker: a background anchor task owns it, so it
 * outlives main's turns and only `conversation.abort({ background: true })` on it (or `thread_stop`) reaches it, and a
 * kickoff task delivers the brief once, under a request ID derived from the call that started it. What differs from a
 * worker is what it may do: it keeps the coordinator's extensions (workers, board, memory, code mode, history,
 * compaction, the tool call cap) minus the tools that start threads and the schedule tools, so it runs its own workers
 * and one level is all there is. It works in its own workspace under the data directory (a jj workspace when the
 * project is jj, else a plain directory it can make git worktrees in), never in the project checkout.
 *
 * The list is a durable document on main's conversation (`aiki.threads`). Statuses `done` and `stopped` are written by
 * the tools; `running`, `idle` and `failed` follow a watch on each thread's transcript (a run in progress, its running
 * workers, a run that ended in an error), so a restart recomputes them instead of trusting a stale value.
 *
 * Everything a thread posts elsewhere is marked: its summary reaches main as `[thread <id> finished]`, a failure as
 * `[thread <id> failed: <reason>]`, both reviewed (an input) or recorded (a write that starts no turn) per `onFinish`;
 * `thread_send` delivers `[from <thread>] <message>`, and a reply never wakes an idle receiver. Every request ID derives
 * from the tool call or the failing entry, so a rerun after a crash posts nothing twice.
 */
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Context } from "@earendil-works/chord/context";
import type { Models } from "@earendil-works/pi-ai";
import {
	type Conversation,
	type ConversationId,
	configure,
	defineDoc,
	defineExtension,
	defineTask,
	defineTool,
	type EntryRecord,
	type Extension,
	type Harness,
	type JsonObject,
	LiveDoc,
	type LiveState,
	section,
	type Task,
	type ToolRegistration,
	type Tx,
} from "@earendil-works/pi-durable";
import {
	MAIN_THREAD_ID,
	THINKING_LEVELS,
	type Board,
	type ModelRef,
	type ProjectActivity,
	type ThinkingLevel,
	type ThreadStartedBy,
	type ThreadStatus,
	type ThreadSummary,
	type WorkerSummary,
} from "@aiki/protocol";
import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { Type } from "typebox";
import { DEFAULT_ACTIVITY, ProjectActivityService } from "./activity.ts";
import {
	type BoardService,
	HARNESS_WRITER,
	claimTaskForThread,
	openBoard,
	snapshotStatusChanges,
	statusesOf,
	taskForSchedule,
	taskTime,
} from "./board.ts";
import type { CoordinatorPlace, Coordinators } from "./coordinators.ts";
import { ServerError, errorMessage } from "./errors.ts";
import { JjError, ensureJjWorkspace, jjRoot } from "./jj.ts";
import { type Notifier, threadFailedNotification, threadFinishedNotification } from "./notifications.ts";
import type { Project } from "./projects.ts";
import { formatRunStamp } from "./schedules.ts";
import {
	type WorkerService,
	WorkersDoc,
	entryLines,
	excerpt,
	formatDuration,
	lastActivityAt,
	liveLines,
} from "./workers.ts";

/** Threads a schedule started are archived this long after they finish. */
export const THREAD_ARCHIVE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
/** How many messages one thread may send with `thread_send` in any hour. */
export const THREAD_MESSAGES_PER_HOUR = 10;
const HOUR_MS = 60 * 60 * 1000;

/** How much a `thread_peek` shows; a check-in shows less of each thread. */
export const THREAD_PEEK_ENTRIES = 8;
export const THREAD_PEEK_LINE_CHARS = 140;
export const THREAD_PEEK_MAX_CHARS = 2_400;
const THREAD_CHECK_IN_ENTRIES = 4;
const THREAD_CHECK_IN_LINE_CHARS = 110;

export type ThreadRecord = {
	id: string;
	title: string;
	brief: string;
	conversationId: number;
	/** The background task that owns the thread's conversation. */
	anchorTaskId: number;
	startedBy: ThreadStartedBy;
	scheduleId: string | null;
	/** The board task it was started for and reports on; absent on threads started before tasks were required. */
	taskId?: string | null;
	/** The tool call (main's `thread_start`) or schedule slot that started it, so a rerun finds this thread. */
	startedByKey: string;
	model: ModelRef;
	thinkingLevel: ThinkingLevel | null;
	onFinish: "review" | "record";
	status: ThreadStatus;
	summary: string | null;
	failure: string | null;
	createdAt: string;
	updatedAt: string;
	finishedAt: string | null;
	archived: boolean;
	/** Whether it archives itself 7 days after finishing: schedule-started ones until the user brings one back. */
	autoArchive: boolean;
	/** Its workspace: where its tools and its `shared` workers run. */
	checkout: string;
	checkoutKind: "jj" | "directory";
};

export type ThreadsState = {
	threads: Record<string, ThreadRecord>;
	/** Each sender's `thread_send` calls of the last hour, for the hourly cap; keyed by call so a rerun counts once. */
	sent: Record<string, { at: number; callId: string }[]>;
	/** When the list was created: main's `createdAt` in the protocol. */
	createdAt: string | null;
};

export const ThreadsDoc = defineDoc<ThreadsState>({
	kind: "aiki.threads",
	version: 1,
	scope: "conversation",
	history: "latest",
	fork: "initial",
	checkpointWhen: () => false,
	initial: () => ({ threads: {}, sent: {}, createdAt: null }),
});

function emptyThreadsState(): ThreadsState {
	return { threads: {}, sent: {}, createdAt: null };
}

/** Whether a thread counts as archived at `now`: by hand, or 7 days after a schedule-started one finished. */
export function isThreadArchived(record: ThreadRecord, now: number): boolean {
	if (record.archived) return true;
	if (!record.autoArchive || record.status !== "done" || record.finishedAt === null) return false;
	return Date.parse(record.finishedAt) + THREAD_ARCHIVE_AFTER_MS <= now;
}

/** Persist the archive flag of every thread whose 7 days passed. */
function sweepArchive(state: ThreadsState, now: number): void {
	for (const record of Object.values(state.threads)) {
		if (!record.archived && isThreadArchived(record, now)) record.archived = true;
	}
}

/** Whether a thread is still at work or waiting to be: not finished, stopped or failed. */
function isLive(status: ThreadStatus): boolean {
	return status === "running" || status === "idle";
}

// --- tasks -------------------------------------------------------------------------------------------------------

/** Owns one thread's conversation and finishes at once, like a worker's anchor. */
const ThreadAnchor = defineTask<null, { phase: "done" }, null>({
	name: "aiki.thread-anchor",
	version: 1,
	initial: () => ({ phase: "done" }),
	phases: {
		done: (_anchor, runtime, context) =>
			runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: null } }), context),
	},
	abort: (_anchor, runtime, context) =>
		runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context),
});

type KickoffInput = { conversationId: number; content: string; requestId: string };

/** Delivers a thread's brief once, under a request ID derived from what started it; never waits for the answer. */
const ThreadKickoff = defineTask<KickoffInput, { phase: "deliver" }, null>({
	name: "aiki.thread-kickoff",
	version: 1,
	initial: () => ({ phase: "deliver" }),
	phases: {
		deliver: async (task, runtime, context) => {
			const { conversationId, content, requestId } = task.input;
			const conversation = await runtime.conversation(conversationId as ConversationId, context);
			await conversation?.submit({ type: "input", content, whenBusy: "followUp", requestId }, context);
			await runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: null } }), context);
		},
	},
	abort: (_task, runtime, context) =>
		runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context),
});

// --- prompts -----------------------------------------------------------------------------------------------------

/**
 * Main's paragraph on threads, in its system prompt. Static text, so the prompt stays byte-stable from turn to turn.
 */
export const MAIN_THREADS_SECTION = `Background threads are for big, long work that needs coordinating itself: a change across many repositories, a long investigation, a run over every open ticket. Start one with thread_start for a task on the board, which it claims and reports on: a full coordinator with its own workers, the shared board and memory, working in its own workspace, never in your checkout. Use a worker for one self-contained task; start a thread when the work needs its own plan and several workers, or would keep you busy for hours. Brief a thread completely, like a worker: it never sees this conversation.

You relay between the user and the threads; the user talks only to you. When they ask how something is going, look with thread_peek or thread_list and answer; when they want to change its course, pass that on with thread_send; when they want the work back, stop it with thread_stop and take over its tasks on the board. A thread's summary arrives as "[thread <id> finished] ..." and a failure as "[thread <id> failed: ...]": review it like a worker's report and tell the user what came of it. A thread's messages to you arrive as "[from <thread>] ..."; answer with thread_send (reply: true). Threads ask the user their own questions on the board, and the answers go back to them. Archive a thread with thread_archive once its work is merged or no longer needed.`;

/** What a background thread is told about itself; its brief arrives as its first message. */
export function threadInstructions(options: {
	id: string;
	title: string;
	project: Project;
	checkout: string;
	checkoutKind: "jj" | "directory";
	startedBy: ThreadStartedBy;
	/** The board task it was started for. */
	taskId?: string | null;
}): string {
	const { id, title, project, checkout, checkoutKind, startedBy } = options;
	const task =
		options.taskId === undefined || options.taskId === null
			? ""
			: `\n\nYou were started for the board task ${options.taskId} and hold it. The user reads that task, not this conversation: keep its report current with the \`board\` action \`write_report\`, and move it to review when it is ready for them.`;
	const workspace =
		checkoutKind === "jj"
			? `Your workspace is ${checkout}, a jj workspace of the project's repository, started from main's working copy. Do your work and merge your workers' changes there, and commit it; name the change IDs in your summary.`
			: `Your workspace is ${checkout}, a directory of your own. The project at ${project.path} is not a jj repository, so make your checkouts here: a git worktree (\`git -C ${project.path} worktree add ${checkout}/<name> -b <branch>\`) or a clone. Workers with isolation "workspace" need jj and are not available; spawn "shared" workers and name the worktree they work in.`;
	const starter =
		startedBy === "schedule"
			? "A schedule started you with the user's prompt, your first message."
			: "Main started you; your brief is your first message.";
	return `You are the background thread "${id}" of the project "${project.name}", working on: ${title}

${workspace} Never edit the project checkout at ${project.path}: it is main's.

${starter} Only your summary (thread_finish) reaches main, so put everything main needs in it.

Ending a turn does not end the thread. To wait for a worker's report, an answer to a board question or a message, end your turn: you resume when it arrives. Call thread_finish once, when the work is done or cannot go on.${task}`;
}

// --- what a thread is doing right now ----------------------------------------------------------------------------

function threadStatusLine(record: ThreadRecord): string {
	switch (record.status) {
		case "running":
			return "running";
		case "idle":
			return "idle, waiting for workers, a message or the user";
		case "failed":
			return `failed${record.failure === null ? "" : `: ${record.failure}`}`;
		case "stopped":
			return "stopped";
		case "done":
			return "done";
	}
}

/** One line on what a thread does now, as `ThreadSummary.current` carries it. */
export function currentLine(
	status: ThreadStatus,
	activity: ProjectActivity | undefined,
	runningWorkers: number,
	now: number,
): string | null {
	if (status === "done" || status === "stopped" || status === "failed") return null;
	if (activity?.coordinator === "working") {
		const tool = activity.runningTool ?? null;
		if (tool !== null) return `Running ${tool.name} · ${formatDuration(now - Date.parse(tool.startedAt))}`;
		return "Thinking";
	}
	if (runningWorkers > 0) return `Waiting for ${runningWorkers} worker${runningWorkers === 1 ? "" : "s"}`;
	return "Waiting for a message";
}

/** A bounded digest of one thread, shared by `thread_peek` and main's check-ins. */
export function describeThreadActivity(options: {
	record: ThreadRecord;
	entries: readonly EntryRecord[];
	live: LiveState | undefined;
	workers: readonly WorkerSummary[];
	ownedTasks: readonly string[];
	openQuestions: number;
	current: string | null;
	now: number;
	lines: number;
	lineChars: number;
	maxChars: number;
}): string {
	const { record, entries, live, workers, now, lineChars } = options;
	const activity = [...entries].reverse().flatMap((entry) => entryLines(entry, lineChars));
	const recent = [...activity, ...liveLines(live, lineChars)].slice(-options.lines);
	const last = lastActivityAt(entries, live);
	const running = workers.filter((worker) => worker.status === "running");
	const model = `${record.model.provider}/${record.model.modelId}${record.thinkingLevel === null ? "" : ` (thinking ${record.thinkingLevel})`}`;
	const body = [
		`${record.id} — ${record.title}`,
		`status: ${threadStatusLine(record)}${options.current === null ? "" : `; ${options.current}`}; last activity ${last === undefined ? "nothing yet" : `${formatDuration(now - last)} ago`}`,
		`model: ${model}; workspace: ${record.checkout}`,
		`workers: ${running.length === 0 ? "none running" : `${running.length} running (${running.map((worker) => worker.id).join(", ")})`}${workers.length > running.length ? `, ${workers.length - running.length} other` : ""}`,
		`tasks: ${options.ownedTasks.length === 0 ? "none claimed" : options.ownedTasks.join(", ")}; open questions: ${options.openQuestions}`,
	];
	if (recent.length > 0) {
		body.push("activity:");
		for (const line of recent) body.push(`  ${line}`);
	} else {
		body.push("activity: none yet");
	}
	if (record.summary !== null) body.push(`summary: ${excerpt(record.summary, Math.min(400, lineChars * 3))}`);
	const text = body.join("\n");
	return text.length <= options.maxChars ? text : `${text.slice(0, options.maxChars - 1)}…`;
}

// --- the service -------------------------------------------------------------------------------------------------

export type ThreadServiceOptions = {
	/** Read at each use, so a reconfigured project applies to the next thread. */
	project(): Project;
	harness: Harness;
	models: Models;
	/** Main and its background threads; this service registers each thread there. */
	coordinators: Coordinators;
	workers: WorkerService;
	board: BoardService;
	/** `<data>/projects/<id>/threads`: each thread's workspace and its workers' workspaces live below it. */
	threadsDir: string;
	/**
	 * Extensions a background thread removes besides the thread-start tools: the schedule tools, which stay main's. A
	 * function, since some are built after this service; read at each start.
	 */
	removedExtensions: () => readonly Extension[];
	/** Main's activity: its status in the list. */
	mainActivity: () => ProjectActivity;
	notifications?: Notifier;
	now(): number;
	/** Called whenever the list (without archived threads) may have changed; the caller compares and pushes. */
	onChange?: () => void;
	log(message: string): void;
};

/** What starts a thread: main's `thread_start`, or a schedule. */
export type ThreadStartInput = {
	title: string;
	brief: string;
	model: ModelRef | null;
	thinkingLevel: ThinkingLevel | null;
	onFinish: "review" | "record";
	startedBy: ThreadStartedBy;
	scheduleId: string | null;
	/**
	 * The board task the thread claims and reports on. Null only for a schedule's run, which takes its schedule's one task
	 * (made on the first run) and puts it back to in_progress.
	 */
	taskId: string | null;
	/** The tool call or schedule slot: the thread's request IDs derive from it, so a rerun starts nothing twice. */
	key: string;
	/** A fixed ID (a schedule's `<scheduleId>-<stamp>`); otherwise one is made from the title. */
	id?: string;
};

export type ThreadStartResult = { ok: true; record: ThreadRecord; existed: boolean } | { ok: false; message: string };

export type ScheduledThreadInput = {
	scheduleId: string;
	title: string;
	brief: string;
	model: ModelRef | null;
	thinkingLevel: ThinkingLevel | null;
	onFinish: "review" | "record";
	at: number;
	timezone: string;
	/** An event run: its own thread ID and key (from the schedule, the event and its time) and the task it claims. */
	event?: { id: string; key: string; taskId: string };
};

const THREAD_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

function slugify(title: string): string {
	const slug = title
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 32)
		.replace(/-+$/g, "");
	return slug.length === 0 || slug === MAIN_THREAD_ID ? "thread" : slug;
}

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

export class ThreadService {
	readonly #options: ThreadServiceOptions;
	#startExtension: Extension | undefined;
	#extension: Extension | undefined;
	#finishExtension: Extension | undefined;
	/** Each background thread's live activity, from a watch on its transcript. */
	readonly #watches = new Map<string, ProjectActivityService>();
	readonly #activities = new Map<string, ProjectActivity>();
	/** Every thread's workers, from the worker watch. */
	#workers: WorkerSummary[] = [];
	#board: Board | undefined;
	#storage: { removeThread(threadId: string): Promise<void> } | undefined;
	/** Status changes are serialized, so two watch callbacks never race on one thread. */
	#queue: Promise<void> = Promise.resolve();
	#stopped = false;

	constructor(options: ThreadServiceOptions) {
		this.#options = options;
	}

	get project(): Project {
		return this.#options.project();
	}

	get coordinators(): Coordinators {
		return this.#options.coordinators;
	}

	get #mainId(): ConversationId {
		return this.#options.coordinators.mainId as ConversationId;
	}

	/** Main's tools that start and end threads, its section on threads and the tasks; background threads remove it. */
	get startExtension(): Extension {
		this.#startExtension ??= createThreadStartExtension(this);
		return this.#startExtension;
	}

	/** `thread_list`, `thread_peek` and `thread_send`, for every coordinator thread; workers remove it. */
	get extension(): Extension {
		this.#extension ??= createThreadExtension(this);
		return this.#extension;
	}

	/** `thread_finish`, for background threads only: main and workers remove it. */
	get finishExtension(): Extension {
		this.#finishExtension ??= createThreadFinishExtension(this);
		return this.#finishExtension;
	}

	async state(context: Context = BACKGROUND_CONTEXT): Promise<ThreadsState> {
		const state = await this.#options.harness.snapshot(ThreadsDoc, this.#mainId, context);
		return state === undefined ? emptyThreadsState() : (state as ThreadsState);
	}

	async record(threadId: string, context: Context = BACKGROUND_CONTEXT): Promise<ThreadRecord | undefined> {
		return (await this.state(context)).threads[threadId];
	}

	/**
	 * Create the list if this project never had one, register every thread as a coordinator and persist archives that
	 * came due. Called on open, before anything resumes, so a resumed thread's tools know it.
	 */
	async open(): Promise<void> {
		const now = this.#options.now();
		await this.#options.harness.commit(async (tx) => {
			const doc = await tx.doc(ThreadsDoc, this.#mainId);
			doc.createdAt ??= new Date(now).toISOString();
			sweepArchive(doc, now);
		}, BACKGROUND_CONTEXT);
		for (const record of Object.values((await this.state()).threads)) {
			this.#options.coordinators.add(this.placeFor(record));
		}
	}

	/** Watch every thread's transcript; called once the project's Harness is set up. */
	async startWatches(): Promise<void> {
		for (const record of Object.values((await this.state()).threads)) {
			if (record.archived) continue;
			await this.#watch(record);
		}
	}

	async stop(): Promise<void> {
		this.#stopped = true;
		const watches = [...this.#watches.values()];
		this.#watches.clear();
		for (const watch of watches) await watch.stop().catch(() => undefined);
		await this.#queue.catch(() => undefined);
	}

	placeFor(record: Pick<ThreadRecord, "id" | "conversationId" | "checkout">): CoordinatorPlace {
		return {
			threadId: record.id,
			conversationId: record.conversationId,
			checkout: record.checkout,
			workspacesDir: join(this.#options.threadsDir, record.id, "workers"),
			workspacePrefix: `harness-${record.id}-`,
		};
	}

	/** The thread a coordinator conversation is, or undefined for a worker. */
	threadIdOf(conversationId: number): string | undefined {
		return this.#options.coordinators.threadIdOf(conversationId);
	}

	/** A thread's conversation (main's for "main"), or `unknown_thread`. */
	async conversation(threadId: string): Promise<Conversation> {
		if (threadId === MAIN_THREAD_ID) return this.#options.coordinators.main;
		const record = await this.record(threadId);
		const conversation =
			record === undefined
				? undefined
				: await this.#options.harness.conversation(record.conversationId as ConversationId, BACKGROUND_CONTEXT);
		if (conversation === undefined) {
			throw new ServerError("unknown_thread", `No thread "${threadId}" in this project`, { threadId });
		}
		return conversation;
	}

	// --- the list as the protocol shows it ------------------------------------------------------------------------

	/** Every thread, main first, then by creation; archived ones only when asked for. */
	async list(includeArchived = false): Promise<ThreadSummary[]> {
		const state = await this.state();
		const now = this.#options.now();
		const records = Object.values(state.threads)
			.filter((record) => includeArchived || !isThreadArchived(record, now))
			.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
		return [this.#mainSummary(state, now), ...records.map((record) => this.summaryOf(record, now))];
	}

	/** Background threads still at work or waiting (not done, stopped, failed or archived). */
	async backgroundCount(): Promise<number> {
		const now = this.#options.now();
		return Object.values((await this.state()).threads).filter(
			(record) => isLive(record.status) && !isThreadArchived(record, now),
		).length;
	}

	summaryOf(record: ThreadRecord, now: number = this.#options.now()): ThreadSummary {
		const workers = this.#workersOf(record.id);
		const running = workers.filter((worker) => worker.status === "running").length;
		return {
			id: record.id,
			title: record.title,
			status: record.status,
			main: false,
			startedBy: record.startedBy,
			scheduleId: record.scheduleId,
			taskId: record.taskId ?? null,
			conversationId: record.conversationId,
			model: record.model,
			thinkingLevel: record.thinkingLevel,
			onFinish: record.onFinish,
			runningWorkers: running,
			ownedTasks: this.#ownedTasks(record.id),
			openQuestions: this.#openQuestions(record.id),
			current: currentLine(record.status, this.#activities.get(record.id), running, now),
			summary: record.summary,
			failure: record.failure,
			createdAt: record.createdAt,
			updatedAt: record.updatedAt,
			finishedAt: record.finishedAt,
			archived: isThreadArchived(record, now),
		};
	}

	#mainSummary(state: ThreadsState, now: number): ThreadSummary {
		const project = this.project;
		const activity = this.#options.mainActivity();
		const running = this.#workersOf(MAIN_THREAD_ID).filter((worker) => worker.status === "running").length;
		const status: ThreadStatus =
			activity.coordinator === "working" ? "running" : activity.coordinator === "failed" ? "failed" : running > 0 ? "running" : "idle";
		const createdAt = state.createdAt ?? new Date(0).toISOString();
		return {
			id: MAIN_THREAD_ID,
			title: project.name,
			status,
			main: true,
			startedBy: null,
			scheduleId: null,
			conversationId: this.#mainId as number,
			model: project.coordinator.model,
			thinkingLevel: project.coordinator.thinkingLevel,
			onFinish: "review",
			runningWorkers: running,
			ownedTasks: this.#ownedTasks(MAIN_THREAD_ID),
			openQuestions: this.#openQuestions(MAIN_THREAD_ID),
			current: currentLine(status, activity, running, now),
			summary: null,
			failure: null,
			createdAt,
			updatedAt: activity.lastReplyAt ?? createdAt,
			finishedAt: null,
			archived: false,
		};
	}

	#workersOf(threadId: string): WorkerSummary[] {
		return this.#workers.filter((worker) => (worker.threadId ?? MAIN_THREAD_ID) === threadId && worker.status !== "done");
	}

	#ownedTasks(threadId: string): string[] {
		return (this.#board?.tasks ?? [])
			.filter((task) => (task.ownerThreadId ?? null) === threadId && !task.archived)
			.map((task) => task.id);
	}

	/** The board questions a thread asked that are still open, read from the board itself. */
	async openQuestionIds(threadId: string): Promise<string[]> {
		return (await this.#options.board.state()).questions
			.filter((question) => question.status === "open" && (question.threadId ?? MAIN_THREAD_ID) === threadId)
			.map((question) => question.id);
	}

	#openQuestions(threadId: string): number {
		return (this.#board?.questions ?? []).filter(
			(question) => question.status === "open" && (question.threadId ?? MAIN_THREAD_ID) === threadId,
		).length;
	}

	/** The worker watch saw a change: running workers decide whether an idle thread is running. */
	workersChanged(workers: readonly WorkerSummary[]): void {
		this.#workers = [...workers];
		void this.#enqueue(async () => {
			for (const record of Object.values((await this.state()).threads)) {
				if (isLive(record.status)) await this.#settleStatus(record.id);
			}
		});
		this.#changed();
	}

	/** The board changed: owned tasks and open questions are part of every summary. */
	boardChanged(board: Board): void {
		this.#board = board;
		this.#changed();
	}

	/** Main's activity changed: it is main's status in the list. */
	mainChanged(): void {
		this.#changed();
	}

	#changed(): void {
		if (this.#stopped) return;
		try {
			this.#options.onChange?.();
		} catch (error) {
			this.#options.log(`threads: change listener failed: ${errorMessage(error)}`);
		}
	}

	#enqueue(work: () => Promise<void>): Promise<void> {
		const next = this.#queue.then(work).catch((error: unknown) => {
			this.#options.log(`threads: ${errorMessage(error)}`);
		});
		this.#queue = next;
		return next;
	}

	// --- live status --------------------------------------------------------------------------------------------

	async #watch(record: ThreadRecord): Promise<void> {
		if (this.#stopped || this.#watches.has(record.id)) return;
		const conversation = await this.#options.harness.conversation(
			record.conversationId as ConversationId,
			BACKGROUND_CONTEXT,
		);
		if (conversation === undefined) return;
		const activity = new ProjectActivityService({
			conversation,
			initial: DEFAULT_ACTIVITY,
			now: this.#options.now,
			onChange: (value) => {
				this.#activities.set(record.id, value);
				void this.#enqueue(() => this.#settleStatus(record.id));
				this.#changed();
			},
			log: (message) => this.#options.log(`thread ${record.id}: ${message}`),
		});
		this.#watches.set(record.id, activity);
		await activity.start();
	}

	/**
	 * Bring a live thread's stored status in line with its transcript: a run in progress or running workers is
	 * `running`, a run that ended in an error is `failed` (posted to main once), anything else `idle`. A finished or
	 * stopped thread keeps its status: only a new message brings it back (`revive`).
	 */
	async #settleStatus(threadId: string): Promise<void> {
		const record = await this.record(threadId);
		const activity = this.#activities.get(threadId);
		if (record === undefined || activity === undefined) return;
		if (record.status === "done" || record.status === "stopped") return;
		const running = this.#workersOf(threadId).some((worker) => worker.status === "running");
		const next: ThreadStatus =
			activity.coordinator === "working" ? "running" : activity.coordinator === "failed" ? "failed" : running ? "running" : "idle";
		if (next === "failed") {
			await this.#reportFailure(record);
			return;
		}
		if (next === record.status) return;
		await this.#update(threadId, (current) => {
			if (current.status === "done" || current.status === "stopped") return;
			current.status = next;
			current.failure = null;
		});
	}

	/** A turn of the thread ended in an error: record it and post `[thread <id> failed: …]` to main once. */
	async #reportFailure(record: ThreadRecord): Promise<void> {
		const conversation = await this.#options.harness.conversation(
			record.conversationId as ConversationId,
			BACKGROUND_CONTEXT,
		);
		const page = await conversation?.entries({ order: "descending" }, 10, undefined, BACKGROUND_CONTEXT);
		let reason = "its last turn failed";
		let entryId: number | undefined;
		for (const entry of page?.items ?? []) {
			const message = entry.model?.[0] as { role?: string; stopReason?: string; errorMessage?: string } | undefined;
			if (message?.role !== "assistant") continue;
			if (message.stopReason === "error") {
				reason = excerpt(message.errorMessage ?? reason, 300);
				entryId = entry.id;
			}
			break;
		}
		const key = `${record.id}:${entryId ?? "unknown"}`;
		if (record.status === "failed" && record.failure === reason) return;
		await this.#update(record.id, (current) => {
			if (current.status === "done" || current.status === "stopped") return;
			current.status = "failed";
			current.failure = reason;
		});
		await this.#post(record, `[thread ${record.id} failed: ${reason}]`, `thread-failed:${key}`);
		const project = this.project;
		this.#options.notifications?.notify(
			threadFailedNotification({
				projectId: project.id,
				projectName: project.name,
				threadId: record.id,
				title: record.title,
				failure: reason,
				key,
				scheduleId: record.scheduleId,
			}),
		);
	}

	/** Post a thread's finish or failure to main: an input it reviews, or a write it reads at its next turn. */
	async #post(record: ThreadRecord, content: string, requestId: string): Promise<void> {
		const main = this.#options.coordinators.main;
		try {
			if (record.onFinish === "record") {
				await main.submit(
					{
						type: "write",
						entry: { kind: "pi.user", model: [{ role: "user", content, timestamp: this.#options.now() }] },
						requestId,
					},
					BACKGROUND_CONTEXT,
				);
			} else {
				await main.submit({ type: "input", content, whenBusy: "followUp", requestId }, BACKGROUND_CONTEXT);
			}
		} catch (error) {
			this.#options.log(`thread ${record.id}: could not post to main: ${errorMessage(error)}`);
		}
	}

	async #update(threadId: string, change: (record: ThreadRecord) => void): Promise<void> {
		const now = this.#options.now();
		await this.#options.harness.commit(async (tx) => {
			const doc = await tx.doc(ThreadsDoc, this.#mainId);
			const record = doc.threads[threadId];
			if (record === undefined) return;
			const before = JSON.stringify(record);
			change(record);
			if (JSON.stringify(record) !== before) record.updatedAt = new Date(now).toISOString();
			sweepArchive(doc, now);
		}, BACKGROUND_CONTEXT);
		this.#changed();
	}

	// --- starting ------------------------------------------------------------------------------------------------

	/** A free ID made from the title: `jira-run`, then `jira-run-2`, … */
	#freeId(state: ThreadsState, title: string): string {
		const base = slugify(title);
		if (state.threads[base] === undefined) return base;
		for (let attempt = 2; ; attempt += 1) {
			const candidate = `${base.slice(0, 40)}-${attempt}`;
			if (state.threads[candidate] === undefined) return candidate;
		}
	}

	/** A thread whose checkout was cleaned up gets it back before it works again. */
	async #ensureCheckout(threadId: string): Promise<void> {
		const record = await this.record(threadId);
		if (record === undefined || record.checkout === this.project.path) return;
		const present = await stat(record.checkout).then((info) => info.isDirectory()).catch(() => false);
		if (!present) await this.#prepareCheckout(threadId);
	}

	/** The thread's own workspace: a jj workspace of the project's repository, or a plain directory. Idempotent. */
	async #prepareCheckout(threadId: string): Promise<{ checkout: string; kind: "jj" | "directory" }> {
		const base = join(this.#options.threadsDir, threadId);
		const checkout = join(base, "checkout");
		await mkdir(base, { recursive: true, mode: 0o700 });
		const repo = await jjRoot(this.project.path);
		if (repo === undefined) {
			await mkdir(checkout, { recursive: true, mode: 0o700 });
			return { checkout, kind: "directory" };
		}
		try {
			await ensureJjWorkspace({ repo, name: `harness-thread-${threadId}`, path: checkout });
		} catch (error) {
			if (error instanceof JjError) throw new ServerError("internal", `Could not create the thread's workspace: ${error.message}`);
			throw error;
		}
		return { checkout, kind: "jj" };
	}

	/**
	 * Start a background thread: its workspace, then in one commit its anchor, conversation, agent settings, list entry,
	 * the kickoff that delivers the brief, and main's check-in timer. `commit` is the tool call's own when main starts
	 * it, the Harness's for a schedule.
	 */
	async start(
		input: ThreadStartInput,
		commit: <T>(change: (tx: Tx) => Promise<T>) => Promise<T> = (change) =>
			this.#options.harness.commit(change, BACKGROUND_CONTEXT),
	): Promise<ThreadStartResult> {
		const project = this.project;
		const state = await this.state();
		const existing = Object.values(state.threads).find((record) => record.startedByKey === input.key);
		if (existing !== undefined) return { ok: true, record: existing, existed: true };

		const model = input.model ?? project.coordinator.model;
		if (model === null) {
			return { ok: false, message: "No model for the thread: name one, or set the project's coordinator model." };
		}
		if (this.#options.models.getModel(model.provider, model.modelId) === undefined) {
			return { ok: false, message: `Unknown model ${model.provider}/${model.modelId}.` };
		}
		const thinkingLevel = input.thinkingLevel ?? (input.model === null ? project.coordinator.thinkingLevel : null);
		const id = input.id ?? this.#freeId(state, input.title);
		if (state.threads[id] !== undefined || id === MAIN_THREAD_ID || !THREAD_ID_PATTERN.test(id)) {
			return { ok: false, message: `The thread ID "${id}" is taken or not valid.` };
		}

		// The task is checked before the workspace is made; the commit claims it, and refuses a race the same way.
		if (input.taskId !== null) {
			const task = (await this.#options.board.state()).tasks.find((candidate) => candidate.id === input.taskId);
			if (task === undefined) return { ok: false, message: `No task "${input.taskId}" on the board (unknown_task). Add it with the board tool first.` };
			const owner = task.ownerThreadId ?? null;
			if (owner !== null && owner !== MAIN_THREAD_ID) {
				return { ok: false, message: `Task ${task.id} is held by thread "${owner}". Start the thread on another task.` };
			}
			if (task.status === "done" || task.status === "dropped") {
				return { ok: false, message: `Task ${task.id} is ${task.status}: only the user reopens a closed task. Start the thread on another task.` };
			}
		} else if (input.scheduleId === null) {
			return { ok: false, message: "A thread needs the board task it works on (taskId)." };
		}

		let place: { checkout: string; kind: "jj" | "directory" };
		try {
			place = await this.#prepareCheckout(id);
		} catch (error) {
			return { ok: false, message: errorMessage(error) };
		}
		const checkIn = input.onFinish === "review" ? await this.#options.workers.checkInNeeded() : false;
		const title = input.title.trim().slice(0, 120) || id;
		const record = await commit(async (tx) => {
			// Reads before the first write: a transaction may not read tables after it.
			const doc = await tx.doc(ThreadsDoc, this.#mainId);
			const workers = await tx.doc(WorkersDoc, this.#mainId);
			// The thread claims its task (a schedule's run its schedule's one task) and the status change is snapshotted,
			// all before the first table write.
			const now = new Date(this.#options.now()).toISOString();
			const board = await openBoard(tx, this.#mainId);
			const before = statusesOf(board);
			const taskId =
				input.taskId ?? taskForSchedule(board, { scheduleId: input.scheduleId as string, title, now }).after.id;
			claimTaskForThread(board, { key: `thread-start:${input.key}`, taskId, threadId: id, now });
			await snapshotStatusChanges(tx, this.#mainId, board, before, { by: HARNESS_WRITER, at: now, key: `thread-start:${input.key}` });
			const background = { ownership: { kind: "conversation" as const }, conversationId: this.#mainId, background: true };
			const anchor = await tx.createTask(ThreadAnchor, null, background);
			const conversation = await tx.createConversation({ ownership: { kind: "task", taskId: anchor } });
			await configure(tx, conversation.id, {
				model,
				thinkingLevel,
				cwd: place.checkout,
				extensions: { remove: [this.startExtension, ...this.#options.removedExtensions()] },
				instructions: threadInstructions({
					id,
					title,
					project,
					checkout: place.checkout,
					checkoutKind: place.kind,
					startedBy: input.startedBy,
					taskId,
				}),
			});
			const created: ThreadRecord = {
				id,
				title,
				brief: input.brief,
				conversationId: conversation.id,
				anchorTaskId: anchor,
				startedBy: input.startedBy,
				scheduleId: input.scheduleId,
				taskId,
				startedByKey: input.key,
				model: { provider: model.provider, modelId: model.modelId },
				thinkingLevel,
				onFinish: input.onFinish,
				status: "running",
				summary: null,
				failure: null,
				createdAt: now,
				updatedAt: now,
				finishedAt: null,
				archived: false,
				autoArchive: input.startedBy === "schedule",
				checkout: place.checkout,
				checkoutKind: place.kind,
			};
			doc.threads[id] = created;
			doc.createdAt ??= now;
			// Registered inside the commit: the thread's first turn cannot run before its tools know it.
			this.#options.coordinators.add(this.placeFor(created));
			await tx.createTask(
				ThreadKickoff,
				{ conversationId: conversation.id, content: input.brief, requestId: `thread-brief:${input.key}` },
				background,
			);
			await this.#options.workers.startCheckIn(tx, workers, this.#mainId, checkIn);
			return JSON.parse(JSON.stringify(created)) as ThreadRecord;
		});
		// The kickoff is a background task; outside a run nothing would pick it up without this.
		this.#options.harness.resume();
		await this.#watch(record);
		this.#changed();
		return { ok: true, record, existed: false };
	}

	/**
	 * Start the thread of a scheduled run: ID `<scheduleId>-<yyyy-mm-dd-hhmm>` in the backend's timezone, so a retried
	 * slot finds the thread it already started.
	 */
	async startScheduled(run: ScheduledThreadInput): Promise<ThreadStartResult> {
		const safe = run.scheduleId.toLowerCase().replace(/[^a-z0-9._-]/g, "-").slice(0, 32);
		return this.start({
			title: run.title,
			brief: run.brief,
			model: run.model,
			thinkingLevel: run.thinkingLevel,
			onFinish: run.onFinish,
			startedBy: "schedule",
			scheduleId: run.scheduleId,
			taskId: run.event?.taskId ?? null,
			key: `schedule:${run.scheduleId}:${run.event?.key ?? new Date(run.at).toISOString()}`,
			id: run.event?.id ?? `${safe}-${formatRunStamp(run.at, run.timezone)}`.slice(0, 48),
		});
	}

	// --- stopping, archiving, reviving ---------------------------------------------------------------------------

	/** Stop a background thread: its running workers and its turn are aborted, its open tasks released. */
	async stopThread(threadId: string): Promise<ThreadSummary> {
		const record = await this.#requireBackground(threadId);
		if (record.status !== "done" && record.status !== "stopped") {
			const workers = await this.#options.workers.runningWorkers(BACKGROUND_CONTEXT, record.conversationId);
			for (const worker of workers) {
				const conversation = await this.#options.harness.conversation(
					worker.conversationId as ConversationId,
					BACKGROUND_CONTEXT,
				);
				await conversation?.abort(BACKGROUND_CONTEXT).catch(() => undefined);
			}
			if (workers.length > 0) {
				await this.#options.harness.commit(async (tx) => {
					const doc = await tx.doc(WorkersDoc, record.conversationId as ConversationId);
					for (const worker of workers) {
						const current = doc.workers[worker.id];
						if (current === undefined || current.status !== "running") continue;
						current.status = "stopped";
						current.updatedAt = new Date(this.#options.now()).toISOString();
					}
				}, BACKGROUND_CONTEXT);
			}
			const conversation = await this.conversation(threadId);
			await this.#update(threadId, (current) => {
				current.status = "stopped";
			});
			await conversation.abort(BACKGROUND_CONTEXT, { background: true }).catch((error: unknown) => {
				this.#options.log(`thread ${threadId}: abort failed: ${errorMessage(error)}`);
			});
			await this.#options.board.releaseThread(threadId);
		}
		return this.summaryOf((await this.record(threadId)) as ThreadRecord);
	}

	/** Removes an archived thread's checkout and its workers' workspaces; attached by the runtime. */
	attachStorage(storage: { removeThread(threadId: string): Promise<void> }): void {
		this.#storage = storage;
	}

	/**
	 * Archive a thread that no longer works, or bring one back (which also stops it archiving itself). Archiving removes
	 * its checkout and its idle workers' workspaces in the background; its commits stay in the repository.
	 */
	async archive(threadId: string, archived: boolean): Promise<ThreadSummary> {
		const record = await this.#requireBackground(threadId);
		if (archived && isLive(record.status)) {
			throw new ServerError("bad_request", `Thread "${threadId}" is still ${record.status}; stop it before archiving it.`, {
				threadId,
			});
		}
		await this.#update(threadId, (current) => {
			current.archived = archived;
			if (!archived) current.autoArchive = false;
		});
		const watch = this.#watches.get(threadId);
		if (archived && watch !== undefined) {
			this.#watches.delete(threadId);
			await watch.stop().catch(() => undefined);
		} else if (!archived) {
			await this.#ensureCheckout(threadId);
			await this.#watch((await this.record(threadId)) as ThreadRecord);
		}
		if (archived) {
			void this.#storage?.removeThread(threadId).catch((error: unknown) => {
				this.#options.log(`thread ${threadId}: could not remove its workspaces: ${errorMessage(error)}`);
			});
		}
		return this.summaryOf((await this.record(threadId)) as ThreadRecord);
	}

	/**
	 * Someone wrote to a finished or stopped thread (the user from the app, or a thread's message): it works again, so
	 * its status follows its transcript from now on. An archived thread comes back to the list.
	 */
	async revive(threadId: string): Promise<void> {
		if (threadId === MAIN_THREAD_ID) return;
		const record = await this.record(threadId);
		if (record === undefined || (isLive(record.status) && !record.archived)) return;
		await this.#ensureCheckout(threadId);
		await this.#update(threadId, (current) => {
			if (current.status === "done" || current.status === "stopped" || current.status === "failed") current.status = "running";
			current.archived = false;
			current.failure = null;
		});
		await this.#watch((await this.record(threadId)) as ThreadRecord);
	}

	async #requireBackground(threadId: string): Promise<ThreadRecord> {
		if (threadId === MAIN_THREAD_ID) {
			throw new ServerError("bad_request", "Main is the thread the user talks to; it cannot be stopped or archived.", {
				threadId,
			});
		}
		const record = await this.record(threadId);
		if (record === undefined) {
			throw new ServerError("unknown_thread", `No thread "${threadId}" in this project`, { threadId });
		}
		return record;
	}

	// --- finishing and messages ----------------------------------------------------------------------------------

	/** `thread_finish`: record the summary and post it to main, once per call. */
	async finish(record: ThreadRecord, summary: string, callId: string): Promise<void> {
		const now = new Date(this.#options.now()).toISOString();
		await this.#update(record.id, (current) => {
			current.status = "done";
			current.summary = summary;
			current.failure = null;
			current.finishedAt = now;
		});
		await this.#post(record, `[thread ${record.id} finished]\n${summary}`, `thread-finished:${record.id}:${callId}`);
		await this.#options.board.releaseThread(record.id);
		const project = this.project;
		this.#options.notifications?.notify(
			threadFinishedNotification({
				projectId: project.id,
				projectName: project.name,
				threadId: record.id,
				title: record.title,
				summary,
				callId,
				scheduleId: record.scheduleId,
			}),
		);
	}

	/**
	 * Count one `thread_send` against the sender's hourly cap; a rerun of the same call is counted once. Returns false
	 * when the cap is reached.
	 */
	async countSend(sender: string, callId: string, commit: <T>(change: (tx: Tx) => Promise<T>) => Promise<T>): Promise<boolean> {
		const now = this.#options.now();
		return commit(async (tx) => {
			const doc = await tx.doc(ThreadsDoc, this.#mainId);
			const recent = (doc.sent[sender] ?? []).filter((send) => send.at > now - HOUR_MS);
			if (recent.some((send) => send.callId === callId)) {
				doc.sent[sender] = recent;
				return true;
			}
			if (recent.length >= THREAD_MESSAGES_PER_HOUR) {
				doc.sent[sender] = recent;
				return false;
			}
			doc.sent[sender] = [...recent, { at: now, callId }];
			return true;
		});
	}

	/**
	 * Deliver `[from <sender>] <message>` at the receiver's next step. A request wakes an idle receiver; a reply only
	 * steers a busy one and is written without a turn into an idle one.
	 */
	async deliver(input: { sender: string; receiver: string; message: string; reply: boolean; callId: string }): Promise<"steered" | "written"> {
		const conversation = await this.conversation(input.receiver);
		const content = `[from ${input.sender}] ${input.message}`;
		const requestId = `thread-message:${input.callId}`;
		const live = await this.#options.harness.snapshot(LiveDoc, conversation.id, BACKGROUND_CONTEXT);
		if (input.reply && live?.run === undefined) {
			await conversation.submit(
				{
					type: "write",
					entry: { kind: "pi.user", model: [{ role: "user", content, timestamp: this.#options.now() }] },
					requestId,
				},
				BACKGROUND_CONTEXT,
			);
			return "written";
		}
		if (!input.reply) await this.revive(input.receiver);
		await conversation.submit({ type: "input", content, whenBusy: "steer", requestId }, BACKGROUND_CONTEXT);
		return "steered";
	}

	/** A bounded digest of one thread (or main), for `thread_peek`. */
	async peek(threadId: string, entries: number, now: number, maxChars: number = THREAD_PEEK_MAX_CHARS): Promise<string> {
		const record = threadId === MAIN_THREAD_ID ? this.#mainRecord() : await this.record(threadId);
		if (record === undefined) throw new ServerError("unknown_thread", `No thread "${threadId}" in this project`, { threadId });
		return this.#describe(record, { entries, lines: Math.max(entries, 4), lineChars: THREAD_PEEK_LINE_CHARS, maxChars }, now);
	}

	/** Main as a record, so `thread_peek main` reads like any other thread. */
	#mainRecord(): ThreadRecord {
		const project = this.project;
		const summary = this.#mainSummary(emptyThreadsState(), this.#options.now());
		return {
			id: MAIN_THREAD_ID,
			title: project.name,
			brief: "",
			conversationId: this.#mainId as number,
			anchorTaskId: 0,
			startedBy: "user",
			scheduleId: null,
			startedByKey: "",
			model: project.coordinator.model ?? { provider: "none", modelId: "none" },
			thinkingLevel: project.coordinator.thinkingLevel,
			onFinish: "review",
			status: summary.status,
			summary: null,
			failure: null,
			createdAt: summary.createdAt,
			updatedAt: summary.updatedAt,
			finishedAt: null,
			archived: false,
			autoArchive: false,
			checkout: project.path,
			checkoutKind: "directory",
		};
	}

	async #describe(
		record: ThreadRecord,
		budget: { entries: number; lines: number; lineChars: number; maxChars: number },
		now: number,
	): Promise<string> {
		const conversationId = record.conversationId as ConversationId;
		const live = await this.#options.harness.snapshot(LiveDoc, conversationId, BACKGROUND_CONTEXT);
		const conversation = await this.#options.harness.conversation(conversationId, BACKGROUND_CONTEXT);
		const page = await conversation?.entries(
			{ order: "descending" },
			Math.max(budget.entries * 3, 12),
			undefined,
			BACKGROUND_CONTEXT,
		);
		const workers = this.#workersOf(record.id);
		const activity = record.id === MAIN_THREAD_ID ? this.#options.mainActivity() : this.#activities.get(record.id);
		const running = workers.filter((worker) => worker.status === "running").length;
		// Read fresh rather than from the last pushed board: the time in progress grows between board changes.
		const board = await this.#options.board.get();
		return describeThreadActivity({
			record,
			entries: page?.items ?? [],
			live,
			workers,
			ownedTasks: board.tasks
				.filter((task) => (task.ownerThreadId ?? null) === record.id && !task.archived)
				.map((task) => {
					const time = task.status === "in_progress" ? taskTime(task) : undefined;
					return time === undefined ? task.id : `${task.id} (${time})`;
				}),
			openQuestions: this.#openQuestions(record.id),
			current: currentLine(record.status, activity, running, now),
			now,
			lines: budget.lines,
			lineChars: budget.lineChars,
			maxChars: budget.maxChars,
		});
	}

	/** What main's check-ins cover: running threads whose summary main reviews (a `record` one must not wake it). */
	async #checkInThreads(): Promise<ThreadRecord[]> {
		const now = this.#options.now();
		return Object.values((await this.state()).threads).filter(
			(record) => record.status === "running" && record.onFinish === "review" && !isThreadArchived(record, now),
		);
	}

	/** Main's check-ins: how many threads run, and a short digest of each. Attached to the worker service. */
	get checkIns(): { running(context: Context): Promise<number>; digests(now: number, maxChars: number, context: Context): Promise<string[]> } {
		return {
			running: async () => (await this.#checkInThreads()).length,
			digests: async (now, maxChars) => {
				const digests: string[] = [];
				for (const record of await this.#checkInThreads()) {
					digests.push(
						await this.#describe(
							record,
							{
								entries: THREAD_CHECK_IN_ENTRIES,
								lines: THREAD_CHECK_IN_ENTRIES,
								lineChars: THREAD_CHECK_IN_LINE_CHARS,
								maxChars,
							},
							now,
						),
					);
				}
				return digests;
			},
		};
	}

	/** Running workers of one thread, from the worker watch. */
	runningWorkersOf(threadId: string): WorkerSummary[] {
		return this.#workersOf(threadId).filter((worker) => worker.status === "running");
	}

	log(message: string): void {
		this.#options.log(message);
	}

	now(): number {
		return this.#options.now();
	}
}

// --- the tools ---------------------------------------------------------------------------------------------------

const modelRefSchema = Type.Object({
	provider: Type.String({ minLength: 1, description: 'For example "anthropic".' }),
	modelId: Type.String({ minLength: 1 }),
});

const thinkingLevelSchema = Type.Union(THINKING_LEVELS.map((level) => Type.Literal(level)));

function describeRecordLine(summary: ThreadSummary): string {
	const parts = [`${summary.id} — ${summary.title}`, `  status: ${summary.status}${summary.current === null ? "" : `; ${summary.current}`}`];
	if (!summary.main) {
		parts.push(
			`  started by ${summary.startedBy ?? "main"}${summary.scheduleId === null ? "" : ` (schedule ${summary.scheduleId})`}; summary is ${summary.onFinish === "review" ? "reviewed" : "recorded"}`,
		);
	}
	parts.push(
		`  workers running: ${summary.runningWorkers}; tasks: ${summary.ownedTasks.length === 0 ? "none" : summary.ownedTasks.join(", ")}; open questions: ${summary.openQuestions}`,
	);
	if (summary.failure !== null) parts.push(`  failure: ${excerpt(summary.failure, 200)}`);
	if (summary.summary !== null) parts.push(`  summary: ${excerpt(summary.summary, 240)}`);
	if (summary.archived) parts.push("  archived");
	return parts.join("\n");
}

function createThreadStartExtension(service: ThreadService): Extension {
	const onlyMain = (tool: string): string =>
		`${tool} is main's: only the thread the user talks to starts, stops and archives background threads. A background thread cannot start threads (one level only); use workers, or ask main with thread_send.`;

	const startTool = defineTool({
		name: "thread_start",
		callers: ["model"],
		description:
			"Start a background thread: a full coordinator (its own workers, the shared board, memory) for big, long work, " +
			"working in its own workspace, never in your checkout. It gets the brief as its first message and works on its " +
			'own; its summary arrives as a message starting with "[thread <id> finished]". Use a worker for one self-contained task.',
		parameters: Type.Object({
			title: Type.String({ minLength: 1, maxLength: 120, description: "One line naming the work; the thread's ID is made from it." }),
			brief: Type.String({
				minLength: 1,
				description: "The complete brief: goal, scope, constraints, how to verify, what the summary must say. The thread never sees this conversation.",
			}),
			model: Type.Optional(modelRefSchema),
			thinkingLevel: Type.Optional(thinkingLevelSchema),
			onFinish: Type.Optional(
				Type.Union([Type.Literal("review"), Type.Literal("record")], {
					description: '"review" (default): its summary wakes you to review it. "record": the summary is kept for your next turn without waking you.',
				}),
			),
			taskId: Type.String({
				minLength: 1,
				description: "The board task (T3) the thread works on: it claims the task, moves it to in_progress and keeps its report. Add the task first.",
			}),
		}),
		replay: "safe",
		execute: async (args, api, context) => {
			if (!service.coordinators.isMain(api.conversationId)) {
				return toolText(onlyMain("thread_start"), { isError: true });
			}
			const started = await service.start(
				{
					title: args.title,
					brief: args.brief,
					model: args.model ?? null,
					thinkingLevel: args.thinkingLevel ?? null,
					onFinish: args.onFinish ?? "review",
					startedBy: "main",
					scheduleId: null,
					taskId: args.taskId,
					key: api.callId,
				},
				(change) => api.commit(change, context),
			);
			if (!started.ok) return toolText(started.message, { isError: true });
			const { record } = started;
			const details = { threadId: record.id, conversationId: record.conversationId };
			await api.details(details, context);
			if (started.existed) return toolText(`Background thread "${record.id}" is already started (${record.status}).`, { details });
			return toolText(
				`Started background thread "${record.id}" on ${record.model.provider}/${record.model.modelId}, working in ${record.checkout}. ` +
					`It works on its own: its summary arrives as "[thread ${record.id} finished]" (or "[thread ${record.id} failed: ...]"). ` +
					"Look in with thread_peek, steer it with thread_send, stop it with thread_stop; keep going meanwhile.",
				{ details },
			);
		},
	});

	const stopTool = defineTool({
		name: "thread_stop",
		callers: ["model"],
		description:
			"Stop a background thread: its running turn and workers are aborted and the board tasks it held are released, " +
			"so you can take the work over. A message with thread_send wakes it again.",
		parameters: Type.Object({ id: Type.String({ minLength: 1, description: "The thread's ID." }) }),
		replay: "unsafe",
		execute: async (args, api, context) => {
			if (!service.coordinators.isMain(api.conversationId)) {
				return toolText(onlyMain("thread_stop"), { isError: true });
			}
			try {
				const summary = await service.stopThread(args.id);
				const details = { threadId: summary.id, conversationId: summary.conversationId };
				await api.details(details, context);
				return toolText(`Thread "${summary.id}" is ${summary.status}. Its open tasks are released; claim them to take them over.`, {
					details,
				});
			} catch (error) {
				return toolText(errorMessage(error), { isError: true });
			}
		},
	});

	const archiveTool = defineTool({
		name: "thread_archive",
		callers: ["model"],
		description:
			"Archive a background thread that is done, stopped or failed, so it leaves the list (its transcript stays). " +
			"`archived: false` brings one back.",
		parameters: Type.Object({
			id: Type.String({ minLength: 1, description: "The thread's ID." }),
			archived: Type.Optional(Type.Boolean({ description: "Default true." })),
		}),
		replay: "safe",
		execute: async (args, api, context) => {
			if (!service.coordinators.isMain(api.conversationId)) {
				return toolText(onlyMain("thread_archive"), { isError: true });
			}
			try {
				const summary = await service.archive(args.id, args.archived !== false);
				const details = { threadId: summary.id, conversationId: summary.conversationId };
				await api.details(details, context);
				return toolText(`Thread "${summary.id}" is ${summary.archived ? "archived" : "back in the list"}.`, { details });
			} catch (error) {
				return toolText(errorMessage(error), { isError: true });
			}
		},
	});

	return defineExtension({
		name: "thread-start-tools",
		tasks: [ThreadAnchor, ThreadKickoff] as Task<unknown, { phase: string }, unknown, object>[],
		tools: [startTool, stopTool, archiveTool] as ToolRegistration[],
		sections: [
			section("threads", (input) => (service.coordinators.isMain(input.conversationId) ? MAIN_THREADS_SECTION : undefined)),
		],
	});
}

function createThreadExtension(service: ThreadService): Extension {
	const notCoordinator = (tool: string): string =>
		`${tool} answers only the project's coordinator threads, never a worker. A worker reports to the coordinator that started it.`;

	const listTool = defineTool({
		name: "thread_list",
		description:
			"List the project's threads: main and the background threads, each with its status, what it does now, its " +
			"running workers, the board tasks it holds, its open questions and, once done, its summary.",
		parameters: Type.Object({
			includeArchived: Type.Optional(Type.Boolean({ description: "Also list archived threads." })),
		}),
		replay: "safe",
		execute: async (args, api) => {
			if (!service.coordinators.isCoordinator(api.conversationId)) {
				return toolText(notCoordinator("thread_list"), { isError: true });
			}
			const threads = await service.list(args.includeArchived === true);
			const self = service.threadIdOf(api.conversationId);
			const background = threads.length - 1;
			const header = `You are ${self === MAIN_THREAD_ID ? "main" : `the background thread "${self}"`}. ${
				background === 0 ? "No background threads." : `${background} background thread${background === 1 ? "" : "s"}.`
			}`;
			return toolText(`${header}\n\n${threads.map(describeRecordLine).join("\n\n")}`);
		},
	});

	const peekTool = defineTool({
		name: "thread_peek",
		description:
			"Look at what a thread is doing right now without waiting for its summary: status, what it runs, its workers, " +
			"the tasks it holds and the tail of its transcript, in a few hundred tokens. \"main\" peeks main.",
		parameters: Type.Object({
			id: Type.String({ minLength: 1, description: 'The thread\'s ID; "main" for main.' }),
			entries: Type.Optional(
				Type.Integer({ minimum: 1, maximum: 20, description: `How many recent entries to summarize. Default ${THREAD_PEEK_ENTRIES}.` }),
			),
		}),
		replay: "safe",
		execute: async (args, api, context) => {
			if (!service.coordinators.isCoordinator(api.conversationId)) {
				return toolText(notCoordinator("thread_peek"), { isError: true });
			}
			try {
				const text = await service.peek(args.id, args.entries ?? THREAD_PEEK_ENTRIES, api.now());
				const place = service.coordinators.placeOfThread(args.id);
				const details: JsonObject =
					place === undefined ? { threadId: args.id } : { threadId: args.id, conversationId: place.conversationId };
				await api.details(details, context);
				return toolText(text, { details });
			} catch (error) {
				return toolText(errorMessage(error), { isError: true });
			}
		},
	});

	const sendTool = defineTool({
		name: "thread_send",
		callers: ["model"],
		description:
			'Send a message to another thread ("main" for main); it arrives as "[from <you>] ..." at its next step and wakes ' +
			"it if it is idle. Mark an answer to a message you got with `reply: true`: a reply never wakes an idle thread, it " +
			`is read at its next turn. Requests and hand-overs only, at most ${THREAD_MESSAGES_PER_HOUR} an hour.`,
		parameters: Type.Object({
			id: Type.String({ minLength: 1, description: 'The receiving thread; "main" for main.' }),
			message: Type.String({ minLength: 1 }),
			reply: Type.Optional(Type.Boolean({ description: "This answers a message you got. Default false." })),
		}),
		replay: "safe",
		execute: async (args, api, context) => {
			const sender = service.threadIdOf(api.conversationId);
			if (sender === undefined) return toolText(notCoordinator("thread_send"), { isError: true });
			if (args.id === sender) return toolText("That is you; send to another thread.", { isError: true });
			if (args.id !== MAIN_THREAD_ID) {
				const record = await service.record(args.id);
				if (record === undefined) {
					return toolText(`No thread "${args.id}" (unknown_thread). thread_list shows them.`, {
						isError: true,
						details: { code: "unknown_thread", threadId: args.id },
					});
				}
				if (record.archived) {
					return toolText(`Thread "${args.id}" is archived. Start a new one, or ask main to bring it back.`, { isError: true });
				}
			}
			const allowed = await service.countSend(sender, api.callId, (change) => api.commit(change, context));
			if (!allowed) {
				return toolText(
					`You sent ${THREAD_MESSAGES_PER_HOUR} messages in the last hour, the most a thread may. Put what is left on the board, or in your summary, instead.`,
					{ isError: true, details: { code: "thread_message_cap" } },
				);
			}
			try {
				const how = await service.deliver({
					sender,
					receiver: args.id,
					message: args.message,
					reply: args.reply === true,
					callId: api.callId,
				});
				const details = { threadId: args.id };
				await api.details(details, context);
				return toolText(
					how === "written"
						? `Delivered to "${args.id}" without waking it; it reads it at its next turn.`
						: `Delivered to "${args.id}"; it reads it at its next step.`,
					{ details },
				);
			} catch (error) {
				return toolText(errorMessage(error), { isError: true });
			}
		},
	});

	return defineExtension({
		name: "thread-tools",
		tools: [listTool, peekTool, sendTool] as ToolRegistration[],
	});
}

function createThreadFinishExtension(service: ThreadService): Extension {
	const finishTool = defineTool({
		name: "thread_finish",
		callers: ["model"],
		description:
			"End this background thread with a summary for main: outcome, where the work is (workspace, change IDs, branches, " +
			'pull requests), open issues and anything the user must decide. It reaches main as "[thread <id> finished]"; ' +
			"nothing you write afterwards does. Call it when the work is done, not to wait: to wait for a report, an answer or a " +
			"message, end your turn instead. Your running workers must have reported or been stopped first.",
		parameters: Type.Object({
			summary: Type.String({ minLength: 1, description: "Everything main needs: it sees nothing else of your work." }),
		}),
		replay: "safe",
		execute: async (args, api, context) => {
			const threadId = service.threadIdOf(api.conversationId);
			if (threadId === undefined || threadId === MAIN_THREAD_ID) {
				return toolText(
					"thread_finish ends a background thread; main does not finish, and a worker ends with its report instead.",
					{ isError: true },
				);
			}
			const record = await service.record(threadId);
			if (record === undefined) return toolText(`Thread "${threadId}" is not in the list.`, { isError: true });
			const running = Object.values(
				((await api.snapshot(WorkersDoc, api.conversationId, context)) ?? { workers: {} }).workers,
			).filter((worker) => worker.status === "running");
			if (running.length > 0 && record.status !== "done") {
				return toolText(
					`${running.length} of your workers still run (${running.map((worker) => worker.id).join(", ")}). Wait for their reports, or stop them with worker_stop, then finish.`,
					{ isError: true },
				);
			}
			// A weaker model reads "wait for the answer" as "finish"; the answer would then wake a thread that said it was done.
			const asked = record.status === "done" ? [] : await service.openQuestionIds(threadId);
			if (asked.length > 0) {
				return toolText(
					`Your question ${asked.join(", ")} is still open. To wait for the answer, end your turn: it arrives as a message and you go on from there. If you no longer need it, withdraw it with the board tool (resolve_question without an answer), then finish.`,
					{ isError: true },
				);
			}
			await service.finish(record, args.summary.trim(), api.callId);
			const details = { threadId };
			await api.details(details, context);
			return toolText("Finished: main has your summary. End your turn now, without another message.", { details });
		},
	});

	return defineExtension({ name: "thread-finish-tools", tools: [finishTool] as ToolRegistration[] });
}
