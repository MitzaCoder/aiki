/**
 * Workers: background conversations the project's coordinator delegates work to.
 *
 * A worker is a child conversation of the coordinator that outlives the coordinator's turns. Its transcript never enters
 * the coordinator's context: when it answers, only the report is posted back to the coordinator as a message. Clients
 * list a project's workers and may watch or page a worker's conversation read-only, exactly like the coordinator's
 * (`conversation.watch` and `conversation.page` take a `workerId` for that).
 */
import { type Static, Type } from "typebox";
import { ModelRefSchema, ProjectIdSchema, RequestIdSchema, ThinkingLevelSchema } from "./common.ts";

/**
 * Where a worker's tools run. `shared`: the project directory, the same checkout the coordinator works in. `workspace`:
 * a fresh `jj workspace` the server creates in the data directory, so the worker's edits stay out of the project until
 * the coordinator merges them.
 */
export const WorkerIsolationSchema = Type.Union([Type.Literal("shared"), Type.Literal("workspace")], {
	description: '"shared" runs in the project directory; "workspace" in the worker\'s own jj workspace.',
});
export type WorkerIsolation = Static<typeof WorkerIsolationSchema>;

/**
 * A worker's live state.
 *
 * - `running`: a message is being processed.
 * - `idle`: it answered and waits for the next message.
 * - `failed`: its last message failed; nothing is running.
 * - `stopped`: the coordinator stopped it; nothing is running.
 * - `done`: forgotten after its work was merged; its workspace is removed and it takes no more messages.
 */
export const WorkerStatusSchema = Type.Union([
	Type.Literal("running"),
	Type.Literal("idle"),
	Type.Literal("failed"),
	Type.Literal("stopped"),
	Type.Literal("done"),
]);
export type WorkerStatus = Static<typeof WorkerStatusSchema>;

/**
 * How the harness marks the inputs it writes into the coordinator's transcript itself, so a client can render them
 * differently from the user's messages and from each other.
 */
/** A worker's report: `[worker <id> reported]` followed by the report's text. */
export const WORKER_REPORT_PREFIX = "[worker ";
/** The periodic check-in on running workers: `[check-in]` followed by their digest and what to do about it. */
export const CHECK_IN_PREFIX = "[check-in]";

/** The worker model a project starts from: what the user last picked with a message, or null when they never picked. */
export const WorkerDefaultsSchema = Type.Object({
	model: Type.Union([ModelRefSchema, Type.Null()]),
	thinkingLevel: Type.Union([ThinkingLevelSchema, Type.Null()], {
		description: "Null follows whatever the model resolves to (pi-durable's default).",
	}),
});
export type WorkerDefaults = Static<typeof WorkerDefaultsSchema>;

export const WorkerSummarySchema = Type.Object({
	id: Type.String({
		minLength: 1,
		description:
			"The worker's ID, unique among the project's live workers: the coordinator picks it when it delegates.",
	}),
	title: Type.String({ description: "One-line description of the task, for lists and headers." }),
	status: WorkerStatusSchema,
	model: ModelRefSchema,
	thinkingLevel: Type.Union([ThinkingLevelSchema, Type.Null()]),
	isolation: WorkerIsolationSchema,
	workspacePath: Type.Union([Type.String(), Type.Null()], {
		description: "Absolute path of the worker's jj workspace; null when isolation is shared.",
	}),
	conversationId: Type.Integer({
		minimum: 1,
		description: "Its conversation; watch it with `conversation.watch` and this worker's `id` as `workerId`.",
	}),
	scheduleId: Type.Optional(
		Type.Union([Type.String(), Type.Null()], { description: "The schedule that started this worker, if any." }),
	),
	threadId: Type.Optional(
		Type.String({ minLength: 1, description: 'The thread that started it; "main" for main. Absent on older servers.' }),
	),
	taskId: Type.Optional(
		Type.Union([Type.String(), Type.Null()], { description: "The board task it works on, if any." }),
	),
	spawnedByCallId: Type.Union([Type.String(), Type.Null()], {
		description:
			"`toolCall.id` of the assistant tool call that spawned the worker, so a client can link the transcript's call to it.",
	}),
	createdAt: Type.String({ description: "ISO 8601." }),
	updatedAt: Type.String({ description: "ISO 8601; the last status, message or report." }),
	lastReport: Type.Union([Type.String(), Type.Null()], {
		description: "Text of the last report posted to the coordinator; the worker's transcript has the whole exchange.",
	}),
	failure: Type.Union([Type.String(), Type.Null()], {
		description: "Why the last message failed, when status is failed.",
	}),
});
export type WorkerSummary = Static<typeof WorkerSummarySchema>;

// --- requests ----------------------------------------------------------------------------------------------------

/** Every worker of the project, with its live status, and the worker model the project starts from. */
export const WorkersListRequestSchema = Type.Object({
	type: Type.Literal("workers.list"),
	id: RequestIdSchema,
	projectId: ProjectIdSchema,
	threadId: Type.Optional(
		Type.String({ minLength: 1, description: "Only this thread's workers. Absent: every thread's." }),
	),
});
export type WorkersListRequest = Static<typeof WorkersListRequestSchema>;

/**
 * Set the worker model the project starts from, as if it had been picked with a message: what the composer's worker
 * picker sends as soon as the user picks. Every connection gets the new defaults through `workers.state`.
 */
export const WorkersDefaultsSetRequestSchema = Type.Object({
	type: Type.Literal("workers.defaults.set"),
	id: RequestIdSchema,
	projectId: ProjectIdSchema,
	defaults: WorkerDefaultsSchema,
});
export type WorkersDefaultsSetRequest = Static<typeof WorkersDefaultsSetRequestSchema>;

// --- responses ---------------------------------------------------------------------------------------------------

export const WorkersListResponseSchema = Type.Object({
	type: Type.Literal("workers.list"),
	id: RequestIdSchema,
	workers: Type.Array(WorkerSummarySchema, {
		description: "Oldest first. `done` workers stay in the list for history until they are pruned.",
	}),
	defaults: WorkerDefaultsSchema,
});
export type WorkersListResponse = Static<typeof WorkersListResponseSchema>;

export const WorkersDefaultsSetResponseSchema = Type.Object({
	type: Type.Literal("workers.defaults.set"),
	id: RequestIdSchema,
	defaults: WorkerDefaultsSchema,
});
export type WorkersDefaultsSetResponse = Static<typeof WorkersDefaultsSetResponseSchema>;

// --- server events -----------------------------------------------------------------------------------------------

/**
 * The project's whole worker list, pushed whenever it changes: a spawn, a status change, a report, a stop, or a new
 * worker model picked with a message. The list is small, so replacing it beats diffing it like a transcript.
 */
export const WorkersStateEventSchema = Type.Object({
	type: Type.Literal("workers.state"),
	projectId: ProjectIdSchema,
	workers: Type.Array(WorkerSummarySchema),
	defaults: WorkerDefaultsSchema,
});
export type WorkersStateEvent = Static<typeof WorkersStateEventSchema>;
