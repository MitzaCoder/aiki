/**
 * Threads: background coordinators of a project.
 *
 * Every project has one main thread: the coordinator the user talks to, where the app opens. Main can start background
 * threads for big, long work, and a schedule of kind `thread` starts one with the user's prompt. A background thread is
 * a full coordinator (workers, board, memory, code mode, history) that cannot start threads itself: one level only, and
 * workers still start nothing. It works in its own workspaces, never in the project checkout, and ends by calling
 * `thread_finish` with a summary, which reaches the thread that started it (main for schedules) as a
 * `[thread <id> finished]` input, reviewed or just recorded like a worker's report.
 *
 * Threads talk through the project's shared board (tasks carry `ownerThreadId`; a thread claims a task before working
 * on it), shared memory, and messages: `thread_send` delivers `[from <thread>] …` at the receiver's next step. A reply
 * (`reply: true`) never wakes an idle receiver, and each thread may send a bounded number of messages per hour, so two
 * threads cannot keep each other busy.
 *
 * The user talks to main. Main relays status and steering, everything a thread does shows in main as cards, and
 * questions any thread asks on the board appear above main's composer. A thread can still be opened and typed into.
 * Threads started by a schedule archive themselves 7 days after they finish; others stay until archived.
 */
import { type Static, Type } from "typebox";
import { ModelRefSchema, ProjectIdSchema, RequestIdSchema, ThinkingLevelSchema } from "./common.ts";

/** The main thread's ID, in every place a thread ID goes. */
export const MAIN_THREAD_ID = "main";

/** How the harness marks what threads post into another thread's transcript. */
export const THREAD_FINISHED_PREFIX = "[thread ";
export const THREAD_MESSAGE_PREFIX = "[from ";

/**
 * - `running`: a turn is in progress, or its workers are running.
 * - `idle`: waiting (for workers, a message, the user) without having finished.
 * - `failed`: its last turn failed; nothing runs.
 * - `stopped`: stopped by main or the user.
 * - `done`: finished with a summary.
 */
export const ThreadStatusSchema = Type.Union([
	Type.Literal("running"),
	Type.Literal("idle"),
	Type.Literal("failed"),
	Type.Literal("stopped"),
	Type.Literal("done"),
]);
export type ThreadStatus = Static<typeof ThreadStatusSchema>;

export const ThreadStartedBySchema = Type.Union([Type.Literal("main"), Type.Literal("schedule"), Type.Literal("user")]);
export type ThreadStartedBy = Static<typeof ThreadStartedBySchema>;

export const ThreadSummarySchema = Type.Object({
	id: Type.String({ minLength: 1, description: 'Unique in the project; "main" is the main thread.' }),
	title: Type.String(),
	status: ThreadStatusSchema,
	main: Type.Boolean(),
	startedBy: Type.Union([ThreadStartedBySchema, Type.Null()], { description: "Null for main." }),
	scheduleId: Type.Union([Type.String(), Type.Null()]),
	conversationId: Type.Integer({ minimum: 1 }),
	model: Type.Union([ModelRefSchema, Type.Null()]),
	thinkingLevel: Type.Union([ThinkingLevelSchema, Type.Null()]),
	onFinish: Type.Union([Type.Literal("review"), Type.Literal("record")], {
		description: "What its summary does in main: wake it to review, or just record it.",
	}),
	runningWorkers: Type.Integer({ minimum: 0 }),
	taskId: Type.Optional(
		Type.Union([Type.String(), Type.Null()], {
			description: "The board task it was started for; it reports there. Null for main and for threads from older servers.",
		}),
	),
	ownedTasks: Type.Array(Type.String(), { description: "Board task IDs this thread owns." }),
	openQuestions: Type.Integer({ minimum: 0, description: "Board questions this thread asked that wait on the user." }),
	current: Type.Union([Type.String(), Type.Null()], {
		description: 'One line on what it is doing now, e.g. "Running bash · 3m" or "Waiting for 2 workers".',
	}),
	summary: Type.Union([Type.String(), Type.Null()], { description: "Its finish summary, when done." }),
	failure: Type.Union([Type.String(), Type.Null()]),
	createdAt: Type.String(),
	updatedAt: Type.String(),
	finishedAt: Type.Union([Type.String(), Type.Null()]),
	archived: Type.Boolean(),
});
export type ThreadSummary = Static<typeof ThreadSummarySchema>;

// --- requests ----------------------------------------------------------------------------------------------------

/** Every thread of the project, main first. Archived ones only when asked for. */
export const ThreadsListRequestSchema = Type.Object({
	type: Type.Literal("threads.list"),
	id: RequestIdSchema,
	projectId: ProjectIdSchema,
	includeArchived: Type.Optional(Type.Boolean()),
});
export type ThreadsListRequest = Static<typeof ThreadsListRequestSchema>;

/** Stop a background thread: its running turn and workers are aborted. Main cannot be stopped this way. */
export const ThreadsStopRequestSchema = Type.Object({
	type: Type.Literal("threads.stop"),
	id: RequestIdSchema,
	projectId: ProjectIdSchema,
	threadId: Type.String({ minLength: 1 }),
});
export type ThreadsStopRequest = Static<typeof ThreadsStopRequestSchema>;

export const ThreadsArchiveRequestSchema = Type.Object({
	type: Type.Literal("threads.archive"),
	id: RequestIdSchema,
	projectId: ProjectIdSchema,
	threadId: Type.String({ minLength: 1 }),
	archived: Type.Boolean({ description: "False brings it back." }),
});
export type ThreadsArchiveRequest = Static<typeof ThreadsArchiveRequestSchema>;

// --- responses ---------------------------------------------------------------------------------------------------

export const ThreadsListResponseSchema = Type.Object({
	type: Type.Literal("threads.list"),
	id: RequestIdSchema,
	threads: Type.Array(ThreadSummarySchema),
});
export type ThreadsListResponse = Static<typeof ThreadsListResponseSchema>;

export const ThreadsStopResponseSchema = Type.Object({
	type: Type.Literal("threads.stop"),
	id: RequestIdSchema,
	thread: ThreadSummarySchema,
});
export type ThreadsStopResponse = Static<typeof ThreadsStopResponseSchema>;

export const ThreadsArchiveResponseSchema = Type.Object({
	type: Type.Literal("threads.archive"),
	id: RequestIdSchema,
	thread: ThreadSummarySchema,
});
export type ThreadsArchiveResponse = Static<typeof ThreadsArchiveResponseSchema>;

// --- server events -----------------------------------------------------------------------------------------------

/** The project's threads without archived ones, pushed to every connection whenever any changes. */
export const ThreadsStateEventSchema = Type.Object({
	type: Type.Literal("threads.state"),
	projectId: ProjectIdSchema,
	threads: Type.Array(ThreadSummarySchema),
});
export type ThreadsStateEvent = Static<typeof ThreadsStateEventSchema>;
