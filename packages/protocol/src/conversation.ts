/** The coordinator conversation: watch views, page the transcript, submit input, abort. */
import { type Static, Type } from "typebox";
import {
	type ChordOp,
	ChordOpSchema,
	CursorSchema,
	EntryIdSchema,
	InputContentSchema,
	ModelRefSchema,
	ProjectIdSchema,
	RequestIdSchema,
	ScanOrderSchema,
	ThinkingLevelSchema,
	WatchIdSchema,
	WhenBusySchema,
} from "./common.ts";

/**
 * One committed entry. `model` carries the pi-ai messages the model saw (user, assistant, tool result), `data` the
 * application payload of the entry kind. Entry kinds are pi-durable's built-ins: `pi.user`, `pi.assistant`,
 * `pi.system`, `pi.tool-result`, `pi.reset`, `pi.compaction`.
 */
export const EntryRecordSchema = Type.Object({
	id: EntryIdSchema,
	conversationId: Type.Integer({ minimum: 1 }),
	kind: Type.String(),
	model: Type.Optional(
		Type.Array(Type.Unknown(), {
			description: "pi-ai Message objects (role, content blocks, usage, stop reason). Type them client-side from pi-ai.",
		}),
	),
	data: Type.Optional(Type.Unknown({ description: "Entry-kind payload; `pi.tool-result` carries `diagnostics`." })),
	head: Type.Optional(
		Type.Integer({
			minimum: 1,
			description: "For a head marker (reset, compaction): the first entry of the new active context.",
		}),
	),
	edits: Type.Optional(Type.Array(Type.Unknown(), { description: "pi-durable ContextEdit objects." })),
	byTaskId: Type.Optional(Type.Integer({ minimum: 1 })),
	submissionId: Type.Optional(
		Type.Integer({
			minimum: 1,
			description:
				"Feature `queued-inputs`: on a `pi.user` entry a watch saw placed from the queue, the submission it came from (a `QueuedInput.id`), so a client turns its waiting message into this entry by ID. Set on views a watch pushes; entries paged in later or in a window that started after the placement have none.",
		}),
	),
});
export type EntryRecord = Static<typeof EntryRecordSchema>;

/**
 * An input waiting in the conversation's queue (pi-durable's `pi.inbox`): admitted while a run was busy, not yet placed
 * in the transcript. The run takes a steer at its next tool boundary and a follow-up when it ends; either becomes a
 * `pi.user` entry then (carrying this `id` as its `submissionId`). Every sender queues here: the user's typed messages
 * and the harness's own (a worker's report, a check-in, a thread's note), told apart by their text.
 */
export const QueuedInputSchema = Type.Object({
	id: Type.Integer({ minimum: 1, description: "The submission ID `conversation.submit` answered with." }),
	requestId: Type.Optional(Type.String({ description: "The `requestId` the sender submitted it with." })),
	mode: Type.Union([Type.Literal("steer"), Type.Literal("followUp")]),
	text: Type.String({ description: "The message's text without the `[task <id>] ` prefix; empty for an input of only images." }),
	taskId: Type.Optional(Type.String({ description: "The board task the text named with `[task <id>] `." })),
	images: Type.Optional(Type.Integer({ minimum: 1, description: "How many images the input carries." })),
	at: Type.Optional(
		Type.Number({
			description:
				"When the server first saw it, in milliseconds since the epoch. Kept in memory: absent after a server restart.",
		}),
	),
});
export type QueuedInput = Static<typeof QueuedInputSchema>;

export const ConversationRecordSchema = Type.Object({
	id: Type.Integer({ minimum: 1 }),
	parent: Type.Optional(Type.Object({ conversationId: Type.Integer({ minimum: 1 }), at: EntryIdSchema })),
	owner: Type.Optional(Type.Object({ conversationId: Type.Integer({ minimum: 1 }), taskId: Type.Integer({ minimum: 1 }) })),
});
export type ConversationRecord = Static<typeof ConversationRecordSchema>;

/**
 * A windowed view of one conversation.
 *
 * `entries` is a bounded window (see `conversation.watch`), not necessarily the start of the transcript: `before` names
 * the entry just before the window, so a client can page back with `conversation.page`.
 *
 * `docs` holds pi-durable's built-in conversation documents keyed by kind: `pi.live` (the running generation, streamed
 * partial answer, tool calls and their output, compactions, and `runFailure`), `pi.inbox`, `pi.agent`, `pi.usage` and
 * `pi.provider`. Their shapes are pi-durable's `LiveState`, `InboxState`, `AgentState`, `UsageState` and
 * `ProviderState`; they are left untyped here so this package needs no pi-durable dependency.
 */
export const CacheWarmStretchSchema = Type.Object({
    id: Type.String(), anchorEntryId: Type.Integer(), startedAt: Type.Number(), lastAt: Type.Number(),
    lastReadAt: Type.Optional(Type.Number()),
    refreshes: Type.Integer(), attempts: Type.Integer(), cachedTokens: Type.Number(), cost: Type.Number(),
    stopped: Type.Optional(Type.String()),
});
export type CacheWarmStretch = Static<typeof CacheWarmStretchSchema>;

export const ConversationViewSchema = Type.Object({
	keepWarm: Type.Optional(Type.Array(CacheWarmStretchSchema)),
	conversation: ConversationRecordSchema,
	entries: Type.Array(EntryRecordSchema),
	before: Type.Optional(
		Type.Union([EntryIdSchema, Type.Null()], {
			description: "Entry just before the window, or null when the window starts the transcript.",
		}),
	),
	docs: Type.Record(Type.String(), Type.Unknown()),
	queued: Type.Optional(
		Type.Array(QueuedInputSchema, {
			description:
				"Feature `queued-inputs`: the inputs waiting in the queue, oldest first. Absent when nothing waits (empty values are never sent) and on servers without the feature.",
		}),
	),
});
export type ConversationView = Static<typeof ConversationViewSchema>;

export const WatchEndReasonSchema = Type.Union([
	Type.Literal("stopped"),
	Type.Literal("cancelled"),
	Type.Literal("session_closed"),
	Type.Literal("session_failed"),
	Type.Literal("listener_error"),
]);
export type WatchEndReason = Static<typeof WatchEndReasonSchema>;

// --- requests ----------------------------------------------------------------------------------------------------

/**
 * Attach to the coordinator's view. The response carries the initial `view`; every later commit that touches it is sent
 * as a `conversation.view` event holding only Chord ops to apply to the previous value.
 *
 * `from` resumes after a reconnect: the first view starts at that entry ID when at most `max` entries are at or after
 * it, otherwise at the newest `min`. Every entry committed after the watch attached is appended regardless.
 *
 * With `workerId`, it attaches to that worker's conversation instead, read-only: a worker takes no submit and no abort.
 */
export const ConversationWatchRequestSchema = Type.Object({
	type: Type.Literal("conversation.watch"),
	id: RequestIdSchema,
	projectId: ProjectIdSchema,
	threadId: Type.Optional(
		Type.String({ minLength: 1, description: "This thread's conversation instead of main's; a worker's (workerId) is looked up in that thread." }),
	),
	workerId: Type.Optional(
		Type.String({
			minLength: 1,
			description: "Watch this worker's conversation instead of the coordinator's. Read-only.",
		}),
	),
	from: Type.Optional(EntryIdSchema),
	min: Type.Optional(Type.Integer({ minimum: 1, description: "Default 50." })),
	max: Type.Optional(Type.Integer({ minimum: 1, description: "Default 2 * min; must be at least min." })),
});
export type ConversationWatchRequest = Static<typeof ConversationWatchRequestSchema>;

export const ConversationUnwatchRequestSchema = Type.Object({
	type: Type.Literal("conversation.unwatch"),
	id: RequestIdSchema,
	watchId: WatchIdSchema,
});
export type ConversationUnwatchRequest = Static<typeof ConversationUnwatchRequestSchema>;

/**
 * Page the conversation's whole fork-aware history, oldest→newest or newest→oldest. `before` is a convenience for the
 * common "load earlier" case; `cursor` continues a page (pass the previous response's `next` unchanged). With
 * `workerId`, it pages that worker's conversation instead of the coordinator's.
 */
export const ConversationPageRequestSchema = Type.Object({
	type: Type.Literal("conversation.page"),
	id: RequestIdSchema,
	projectId: ProjectIdSchema,
	threadId: Type.Optional(
		Type.String({ minLength: 1, description: "This thread's conversation instead of main's; a worker's (workerId) is looked up in that thread." }),
	),
	workerId: Type.Optional(Type.String({ minLength: 1, description: "Page this worker's conversation instead." })),
	limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500, description: "Default 50." })),
	order: Type.Optional(ScanOrderSchema),
	minEntryId: Type.Optional(EntryIdSchema),
	maxEntryId: Type.Optional(EntryIdSchema),
	before: Type.Optional(
		Type.Integer({
			minimum: 1,
			description: "Convenience for maxEntryId = before - 1, newest first. Ignored when cursor is set.",
		}),
	),
	cursor: Type.Optional(CursorSchema),
});
export type ConversationPageRequest = Static<typeof ConversationPageRequestSchema>;

/**
 * Submit user input. Admission is durable when the response arrives; the answer streams through the watch as
 * `pi.live` and lands as a `pi.assistant` entry. Reusing a `requestId` after a reconnect finds the original
 * submission instead of admitting it twice.
 *
 * `workerModel` and `workerThinkingLevel` record the worker model the user picked with this message: workers the
 * coordinator delegates from now on start with it, until the next message picks another. They are stored with the
 * project's coordinator conversation, so they survive a restart.
 */
export const ConversationSubmitRequestSchema = Type.Object({
	type: Type.Literal("conversation.submit"),
	id: RequestIdSchema,
	projectId: ProjectIdSchema,
	threadId: Type.Optional(
		Type.String({ minLength: 1, description: "This thread's conversation instead of main's; a worker's (workerId) is looked up in that thread." }),
	),
	requestId: Type.String({ minLength: 1, description: "Client-chosen deduplication key, scoped to the conversation." }),
	content: InputContentSchema,
	/** Uploaded via POST /attachments/<projectId>?threadId=…&name=…; scoped to this conversation. */
	fileIds: Type.Optional(Type.Array(Type.String({ pattern: "^[a-f0-9]{32}$" }), { maxItems: 8 })),
	whenBusy: Type.Optional(WhenBusySchema),
	workerModel: Type.Optional(
		Type.Union([ModelRefSchema, Type.Null()], {
			description: "Worker model for the workers this message starts. Null clears the user's choice.",
		}),
	),
	workerThinkingLevel: Type.Optional(Type.Union([ThinkingLevelSchema, Type.Null()])),
	taskId: Type.Optional(
		Type.String({
			minLength: 1,
			description: "The board task this message is about. The input's text then starts with `[task <id>] ` (board.ts); an unknown task is refused with `unknown_task`.",
		}),
	),
	keepDraft: Type.Optional(
		Type.Boolean({
			description:
				"With `chat-drafts` the server clears the chat's draft once it accepts a message. True when what is sent is not what the composer holds now (a retry of a failed send), so a draft typed since stays.",
		}),
	),
});
export type ConversationSubmitRequest = Static<typeof ConversationSubmitRequestSchema>;

/**
 * Withdraw one input that is still waiting in the queue (feature `queued-inputs`): it never reaches the model and
 * leaves `queued`. An input already placed in the transcript cannot be taken back; the answer says so.
 */
export const ConversationWithdrawRequestSchema = Type.Object({
	type: Type.Literal("conversation.withdraw"),
	id: RequestIdSchema,
	projectId: ProjectIdSchema,
	threadId: Type.Optional(
		Type.String({ minLength: 1, description: "This thread's conversation instead of main's." }),
	),
	submissionId: Type.Integer({ minimum: 1, description: "A `QueuedInput.id`." }),
});
export type ConversationWithdrawRequest = Static<typeof ConversationWithdrawRequestSchema>;

/** Abort the current run: queued inputs are withdrawn and running work is signalled. */
export const ConversationAbortRequestSchema = Type.Object({
	type: Type.Literal("conversation.abort"),
	id: RequestIdSchema,
	projectId: ProjectIdSchema,
	threadId: Type.Optional(
		Type.String({ minLength: 1, description: "This thread's conversation instead of main's; a worker's (workerId) is looked up in that thread." }),
	),
	background: Type.Optional(Type.Boolean({ description: "Also abort work behind a background boundary." })),
});
export type ConversationAbortRequest = Static<typeof ConversationAbortRequestSchema>;

/**
 * Compact the coordinator's conversation now, with optional instructions for the summary. Answers once the compaction
 * is admitted; it runs in the background and the summary lands as a `pi.compaction` entry through the watch.
 */
export const ConversationCompactRequestSchema = Type.Object({
	type: Type.Literal("conversation.compact"),
	id: RequestIdSchema,
	projectId: ProjectIdSchema,
	threadId: Type.Optional(
		Type.String({ minLength: 1, description: "This thread's conversation instead of main's; a worker's (workerId) is looked up in that thread." }),
	),
	instructions: Type.Optional(Type.String({ description: "What the summary should keep, in the user's words." })),
});
export type ConversationCompactRequest = Static<typeof ConversationCompactRequestSchema>;

// --- responses ---------------------------------------------------------------------------------------------------

export const ConversationWatchResponseSchema = Type.Object({
	type: Type.Literal("conversation.watch"),
	id: RequestIdSchema,
	watchId: WatchIdSchema,
	conversationId: Type.Integer({ minimum: 1 }),
	view: ConversationViewSchema,
});
export type ConversationWatchResponse = Static<typeof ConversationWatchResponseSchema>;

export const ConversationUnwatchResponseSchema = Type.Object({
	type: Type.Literal("conversation.unwatch"),
	id: RequestIdSchema,
	watchId: WatchIdSchema,
});
export type ConversationUnwatchResponse = Static<typeof ConversationUnwatchResponseSchema>;

export const ConversationPageResponseSchema = Type.Object({
	type: Type.Literal("conversation.page"),
	id: RequestIdSchema,
	keepWarm: Type.Optional(Type.Array(CacheWarmStretchSchema)),
	entries: Type.Array(EntryRecordSchema),
	next: Type.Optional(CursorSchema),
});
export type ConversationPageResponse = Static<typeof ConversationPageResponseSchema>;

export const ConversationSubmitResponseSchema = Type.Object({
	type: Type.Literal("conversation.submit"),
	id: RequestIdSchema,
	submissionId: Type.Integer({ minimum: 1 }),
	status: Type.Optional(
		Type.Union([Type.Literal("queued"), Type.Literal("placed")], {
			description:
				"Feature `queued-inputs`: `queued` when the run was busy and the input waits in `queued`, `placed` when it is already in the transcript.",
		}),
	),
});
export type ConversationSubmitResponse = Static<typeof ConversationSubmitResponseSchema>;

export const ConversationAbortResponseSchema = Type.Object({
	type: Type.Literal("conversation.abort"),
	id: RequestIdSchema,
});
export type ConversationAbortResponse = Static<typeof ConversationAbortResponseSchema>;

export const ConversationWithdrawResponseSchema = Type.Object({
	type: Type.Literal("conversation.withdraw"),
	id: RequestIdSchema,
	outcome: Type.Union([Type.Literal("withdrawn"), Type.Literal("already_placed"), Type.Literal("gone")], {
		description:
			"`withdrawn`: it will not run. `already_placed`: the run took it first (it is in the transcript, or its turn is over). `gone`: no such input in this conversation, or it was withdrawn before.",
	}),
});
export type ConversationWithdrawResponse = Static<typeof ConversationWithdrawResponseSchema>;

export const ConversationCompactResponseSchema = Type.Object({
	type: Type.Literal("conversation.compact"),
	id: RequestIdSchema,
});
export type ConversationCompactResponse = Static<typeof ConversationCompactResponseSchema>;

// --- server events -----------------------------------------------------------------------------------------------

/** `ops` apply to the value the previous event (or the watch response) carried; empty values are never sent. */
export const ConversationViewEventSchema = Type.Object({
	type: Type.Literal("conversation.view"),
	watchId: WatchIdSchema,
	ops: Type.Array(ChordOpSchema),
});
export type ConversationViewEvent = Static<typeof ConversationViewEventSchema>;

export const ConversationWatchEndedEventSchema = Type.Object({
	type: Type.Literal("conversation.watchEnded"),
	watchId: WatchIdSchema,
	reason: WatchEndReasonSchema,
	message: Type.Optional(Type.String()),
});
export type ConversationWatchEndedEvent = Static<typeof ConversationWatchEndedEventSchema>;

export type ConversationOpEvent = {
	type: "conversation.view";
	watchId: string;
	ops: ChordOp[];
};
