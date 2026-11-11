/**
 * The board: the coordinator's working state for a project.
 *
 * Tasks (with dependencies, advisory write scopes and the workers that ran them), questions waiting on the user, and
 * decisions. It is a durable document on the coordinator's conversation. The coordinator changes it with its `board`
 * tool; the harness changes it when a worker for a task starts, reports or fails, and when a scheduled run fails or is
 * skipped; the user changes it from the app. Every row carries a `revision`: a change names the revision it was made
 * on and is refused with `board_conflict` when the row moved on since, so nobody overwrites a newer edit.
 *
 * The board is shared by every thread of the project (see threads.ts): a task's `ownerThreadId` says which thread
 * claimed it, and claiming uses the same revision check, so two threads cannot take the same task.
 *
 * The user's changes reach the coordinator as `[board]` inputs; an answered question reaches it like a message.
 * `done` and `dropped` tasks are archived 7 days after they settle: out of the coordinator's view, still listed with
 * `includeArchived`.
 *
 * Every subject the user raises is a task, and each task carries a short `report` the agents keep current by rewriting
 * it in place: what is happening now, what came out of it, what comes next. The user reads tasks instead of the chat.
 * A report change that names a milestone, and every status change, saves a snapshot of the task, listed by
 * `board.task.history`. Only the user closes a task (`done` or `dropped`); the agents move it to `review` when it is
 * ready for the user to look at.
 *
 * Tasks link to each other (parent, origin, related, blockedBy; each shown from both sides), and the user's messages
 * about a task become feedback entries on it with a state of their own. `board.task.timeline` lists everything that
 * happened to a task in time order. See DESIGN.md, "Task links and feedback".
 */
import { type Static, Type } from "typebox";
import { ProjectIdSchema, RequestIdSchema } from "./common.ts";

/** How the harness marks the board changes it posts to the coordinator: `[board]` followed by what changed. */
export const BOARD_PREFIX = "[board]";

/**
 * How a user message names the task it is about: the input text starts with `[task T12] `, or `[task T12, feedback F3] `
 * on a server that records the message as feedback on the task. The server writes it when a `conversation.submit` carries
 * `taskId`; the app shows it as a chip on the message. A reader takes the task ID up to the first comma.
 */
export const TASK_REFERENCE_PREFIX = "[task ";

export const BoardTaskStatusSchema = Type.Union(
	[
		Type.Literal("todo"),
		Type.Literal("in_progress"),
		Type.Literal("blocked"),
		Type.Literal("review"),
		Type.Literal("waiting"),
		Type.Literal("done"),
		Type.Literal("dropped"),
	],
	{
		description:
			"todo: not started. in_progress: being worked on. blocked: waiting on a dependency or stopped by a failure (see blockedReason). review: ready for the user to review. done: the user closed it. dropped: the user decided it will not be done. Only the user sets done and dropped.",
	},
);
export type BoardTaskStatus = Static<typeof BoardTaskStatusSchema>;

export const BoardAuthorSchema = Type.Union([
	Type.Literal("user"),
	Type.Literal("coordinator"),
	Type.Literal("harness"),
]);
export type BoardAuthor = Static<typeof BoardAuthorSchema>;

const Revision = Type.Integer({ minimum: 1, description: "Bumped on every change to this row." });

/** Who wrote a report or a snapshot: a coordinator (main or a background thread), one of its workers, the user or the harness. */
export const BoardWriterSchema = Type.Object({
	author: Type.Union([BoardAuthorSchema, Type.Literal("worker")]),
	threadId: Type.Union([Type.String(), Type.Null()], { description: 'The coordinator thread, "main" for main; null for the user and the harness.' }),
	workerId: Type.Union([Type.String(), Type.Null()], { description: "Set when a worker wrote it." }),
});
export type BoardWriter = Static<typeof BoardWriterSchema>;

/**
 * A task's report: short Markdown the agents rewrite in place, never append to. Each section is replaced whole by the
 * write that names it. Questions and warnings are not part of it; they are board questions linked to the task, so a
 * rewrite cannot drop them.
 */
/** Section-local age and coverage; optional container means an older backend. No timeline row is created. */
export const BoardReportSectionSchema = Type.Object({
	writtenAt: Type.Union([Type.String(), Type.Null()], { description: "ISO date, null when never written. Show written 2 h ago; prefix approximate dates with about." }),
	writtenBy: Type.Union([BoardWriterSchema, Type.Null()]),
	version: Type.Integer({ minimum: 0, description: "Changes only for a substantive rewrite of this section; no-op writes do not rearm nudges." }),
	coveredEventSeq: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()], { description: "Highest task event sequence covered by the rewrite. Omitted agent coverage defaults to the sequence at write time; null is unknown legacy coverage." }),
	approximate: Type.Boolean({ description: "Legacy date inferred from the shared report timestamp, not a known section write." }),
	stale: Type.Boolean({ description: "Preserve the prose but show needs update. Empty Results at review/done: No results yet · work finished." }),
	eventsSince: Type.Integer({ minimum: 0, description: "Uncovered meaningful facts, not timeline rows. Show 6 events since; counts keep updating after the one nudge." }),
	reasons: Type.Array(Type.String(), { description: "Short deterministic causes, e.g. Q121 answered; work advanced. Empty when current." }),
	waitsOn: Type.Optional(Type.Array(Type.String(), { description: "Next only: explicit Q/task/change/deploy IDs. Without it any answered/withdrawn task question invalidates nonempty Next." })),
});
export type BoardReportSection = Static<typeof BoardReportSectionSchema>;

export const BoardTaskReportSchema = Type.Object({
	freshness: Type.Optional(Type.Object({ results: BoardReportSectionSchema, next: BoardReportSectionSchema }, { description: "task-freshness capability: section metadata, independent of Now and the shared report timestamp." })),

	now: Type.String({ description: "What is happening right now, in a few lines. Empty when nothing is." }),
	results: Type.String({
		description: "What the task produced so far, as short bullets with evidence (commit, artifact, test run).",
	}),
	next: Type.String({ description: "What comes next, and who does it." }),
	revision: Type.Integer({
		minimum: 0,
		description: "Bumped on every report write; 0 for a report never written. Separate from the task's revision, so report writes do not make the user's task edits conflict.",
	}),
	updatedAt: Type.Union([Type.String(), Type.Null()]),
	updatedBy: Type.Union([BoardWriterSchema, Type.Null()]),
});
export type BoardTaskReport = Static<typeof BoardTaskReportSchema>;

export const BoardFeedbackStateSchema = Type.Union(
	[Type.Literal("open"), Type.Literal("handling"), Type.Literal("addressed"), Type.Literal("dismissed")],
	{
		description:
			"open: the user said it, nobody acted yet. handling: a coordinator is acting on it. addressed: done; the note says what addressed it (a commit, a result, answered in chat). dismissed: the user says it is not needed.",
	},
);
export type BoardFeedbackState = Static<typeof BoardFeedbackStateSchema>;

/** One change of a feedback entry's state. */
export const BoardFeedbackChangeSchema = Type.Object({
	state: BoardFeedbackStateSchema,
	at: Type.String(),
	by: BoardWriterSchema,
	note: Type.Union([Type.String(), Type.Null()]),
});
export type BoardFeedbackChange = Static<typeof BoardFeedbackChangeSchema>;

/**
 * What the user said about a task: each message sent with `conversation.submit`'s `taskId` becomes one entry, so a
 * task's feedback stays apart from its description. The coordinator marks it `handling` when it acts and `addressed`
 * with evidence when done; the user may dismiss or reopen it.
 */
export const BoardFeedbackSchema = Type.Object({
	id: Type.String({ minLength: 1, description: 'Short and unique on the board, e.g. "F3".' }),
	text: Type.String({ description: "The user's words, without the `[task ...]` prefix." }),
	images: Type.Optional(Type.Integer({ minimum: 1, description: "How many images the message carried." })),
	threadId: Type.String({ description: 'The chat it was sent in: "main" or a background thread.' }),
	at: Type.String(),
	state: BoardFeedbackStateSchema,
	note: Type.Union([Type.String(), Type.Null()], { description: "What the last change said, e.g. what addressed it." }),
	updatedAt: Type.String(),
	changes: Type.Array(BoardFeedbackChangeSchema, { description: "Every state change, oldest first." }),
});
export type BoardFeedback = Static<typeof BoardFeedbackSchema>;

/** How many of a task's feedback entries are in each state. */
export const BoardFeedbackCountsSchema = Type.Object({
	open: Type.Integer({ minimum: 0 }),
	handling: Type.Integer({ minimum: 0 }),
	addressed: Type.Integer({ minimum: 0 }),
	dismissed: Type.Integer({ minimum: 0 }),
});
export type BoardFeedbackCounts = Static<typeof BoardFeedbackCountsSchema>;

/** The kinds of link one task stores, named as the board tool's `link` and `unlink` actions name them. */
export const BoardLinkKindSchema = Type.Union(
	[Type.Literal("parent"), Type.Literal("foundWhile"), Type.Literal("related"), Type.Literal("blockedBy")],
	{
		description:
			"parent: this task is a subtask of another (at most one; no cycles; loose: nothing follows automatically). foundWhile: it was discovered while working on another (at most one). related: a symmetric see-also. blockedBy: it waits for another.",
	},
);
export type BoardLinkKind = Static<typeof BoardLinkKindSchema>;

/** Progress of a task's subtasks: `total` leaves out dropped ones, which will not be done. */
export const BoardSubtaskCountSchema = Type.Object({ total: Type.Integer({ minimum: 0 }), done: Type.Integer({ minimum: 0 }) });
export type BoardSubtaskCount = Static<typeof BoardSubtaskCountSchema>;

/** External dependency after the work is finished. Optional for boards and clients predating task-waiting. */
export const BoardTaskWaitingSchema = Type.Object({
	note: Type.String({ minLength: 1, maxLength: 2000 }),
	since: Type.String(),
	until: Type.Optional(Type.String()),
	by: Type.Union([Type.Literal("user"), Type.Literal("coordinator")]),
});
export type BoardTaskWaiting = Static<typeof BoardTaskWaitingSchema>;

export const BoardTaskSchema = Type.Object({
	eventSeq: Type.Optional(Type.Integer({ minimum: 0, description: "Persisted per-task sequence of meaningful facts. Pass the value read by show_task as coveredEventSeq when rewriting; never use a newer unread value." })),

	id: Type.String({ minLength: 1, description: 'Short and stable, e.g. "T12".' }),
	revision: Revision,
	title: Type.String({ minLength: 1, description: 'A short, plain outcome, e.g. "Complete the example change".' }),
	description: Type.String(),
	acceptance: Type.Union([Type.String(), Type.Null()], { description: "Done when\u2026" }),
	refs: Type.Array(Type.String(), {
		description:
			'What the task is about elsewhere: links to its tickets and pull requests, or their keys and numbers ("EX-1234", "#1234"), which the project\'s link settings resolve. Empty on tasks saved before refs.',
	}),
	inProgressMinutes: Type.Optional(
		Type.Integer({ minimum: 0, description: "Minutes spent in_progress so far, across every time it was in_progress." }),
	),
	status: BoardTaskStatusSchema,
	waiting: Type.Optional(BoardTaskWaitingSchema),
	blockedBy: Type.Array(Type.String(), { description: "Task IDs this one waits for; acyclic." }),
	blockedReason: Type.Union([Type.String(), Type.Null()], { description: "Why it is blocked, besides its dependencies." }),
	parent: Type.Optional(
		Type.Union([Type.String(), Type.Null()], {
			description: "The task this is a subtask of (a loose link), nothing follows from it. At most one; never a cycle. Absent on tasks saved before links.",
		}),
	),
	foundWhile: Type.Optional(
		Type.Union([Type.String(), Type.Null()], {
			description: "The task whose work led to finding this one (its origin). At most one.",
		}),
	),
	related: Type.Optional(Type.Array(Type.String(), { description: "Tasks to see also; symmetric (each lists the other)." })),
	subtasks: Type.Optional(Type.Array(Type.String(), { description: "Derived: the tasks whose `parent` is this one, by order." })),
	ledTo: Type.Optional(Type.Array(Type.String(), { description: "Derived: the tasks whose `foundWhile` is this one." })),
	blocks: Type.Optional(Type.Array(Type.String(), { description: "Derived: the tasks that list this one in `blockedBy`." })),
	subtaskCount: Type.Optional(BoardSubtaskCountSchema),
	feedback: Type.Optional(BoardFeedbackCountsSchema),
	timelineRevision: Type.Optional(
		Type.Integer({ minimum: 0, description: "Bumped whenever the task's timeline gains an entry the board itself does not carry, so a reader knows to read it again." }),
	),
	writeScopes: Type.Array(Type.String(), {
		description: "Paths (relative to the project) the task will change. Overlaps between running shared workers warn.",
	}),
	workerIds: Type.Array(Type.String(), { description: "Workers that ran this task, oldest first." }),
	scheduleId: Type.Union([Type.String(), Type.Null()], { description: "The schedule whose failed run opened it." }),
	ownerThreadId: Type.Optional(
		Type.Union([Type.String(), Type.Null()], {
			description: 'The thread that claimed it ("main" for main); null when unclaimed. A thread claims a task before working on it.',
		}),
	),
	report: BoardTaskReportSchema,
	snapshots: Type.Integer({ minimum: 0, description: "How many snapshots board.task.history lists for it." }),
	order: Type.Number({ description: "Position among the tasks; lower first." }),
	createdBy: BoardAuthorSchema,
	updatedBy: BoardAuthorSchema,
	createdAt: Type.String(),
	updatedAt: Type.String(),
	settledAt: Type.Union([Type.String(), Type.Null()], { description: "When it became done or dropped." }),
	archived: Type.Boolean(),
});
export type BoardTask = Static<typeof BoardTaskSchema>;

export const BoardQuestionSchema = Type.Object({
	id: Type.String({ minLength: 1, description: 'e.g. "Q3".' }),
	revision: Revision,
	kind: Type.Optional(
		Type.Union([Type.Literal("question"), Type.Literal("warning")], {
			description:
				'Default "question". A warning is something the user must not miss; it stays open until the user acknowledges it (answers it, with any text) and has no options.',
		}),
	),
	text: Type.String({ minLength: 1 }),
	options: Type.Array(Type.String(), { description: "Suggested answers; the user may answer anything." }),
	taskId: Type.Union([Type.String(), Type.Null()]),
	threadId: Type.Optional(Type.String({ description: 'The thread that asked; "main" for main.' })),
	status: Type.Union([Type.Literal("open"), Type.Literal("answered"), Type.Literal("withdrawn")]),
	answer: Type.Union([Type.String(), Type.Null()]),
	askedAt: Type.String(),
	answeredAt: Type.Union([Type.String(), Type.Null()]),
});
export type BoardQuestion = Static<typeof BoardQuestionSchema>;

/** A task as it was at one point: saved when a report write names a milestone and on every status change. */
export const BoardTaskSnapshotSchema = Type.Object({
	seq: Type.Integer({ minimum: 1, description: "1 for the task's first snapshot, then increasing." }),
	at: Type.String(),
	label: Type.String({ description: 'The milestone, e.g. "First version merged", or the status change, e.g. "in_progress → review".' }),
	by: BoardWriterSchema,
	title: Type.String(),
	status: BoardTaskStatusSchema,
	waiting: Type.Optional(BoardTaskWaitingSchema),
	report: Type.Object({ now: Type.String(), results: Type.String(), next: Type.String() }),
});
export type BoardTaskSnapshot = Static<typeof BoardTaskSnapshotSchema>;

export const BoardDecisionSchema = Type.Object({
	id: Type.String({ minLength: 1, description: 'e.g. "D5".' }),
	text: Type.String({ minLength: 1 }),
	why: Type.Union([Type.String(), Type.Null()]),
	taskId: Type.Union([Type.String(), Type.Null()]),
	threadId: Type.Optional(Type.String({ description: 'The thread that decided; "main" for main.' })),
	at: Type.String(),
});
export type BoardDecision = Static<typeof BoardDecisionSchema>;

/** What a link to a task the board view leaves out (an archived one) still shows. */
export const BoardTaskBriefSchema = Type.Object({
	id: Type.String(),
	title: Type.String(),
	status: BoardTaskStatusSchema,
	archived: Type.Boolean(),
});
export type BoardTaskBrief = Static<typeof BoardTaskBriefSchema>;

export const BoardSchema = Type.Object({
	tasks: Type.Array(BoardTaskSchema, { description: "By order. Archived ones only when asked for." }),
	archivedLinks: Type.Optional(
		Type.Array(BoardTaskBriefSchema, { description: "Archived tasks that a task in `tasks` links to (and that `tasks` leaves out), so the link can still show them." }),
	),
	questions: Type.Array(BoardQuestionSchema, { description: "Open ones first, then the newest answered." }),
	decisions: Type.Array(BoardDecisionSchema, { description: "Newest first." }),
	updatedAt: Type.Union([Type.String(), Type.Null()]),
});
export type Board = Static<typeof BoardSchema>;

/** What the user may set on a task; the harness owns workerIds, scheduleId and the timestamps. */
export const BoardTaskInputSchema = Type.Object({
	title: Type.String({ minLength: 1 }),
	description: Type.String(),
	acceptance: Type.Union([Type.String(), Type.Null()]),
	refs: Type.Optional(Type.Array(Type.String(), { description: "Replaces the task's refs; left out, they stay as they are (none on a new task)." })),
	status: BoardTaskStatusSchema,
	waitingFor: Type.Optional(Type.String({ maxLength: 2000 })),
	waitUntil: Type.Optional(Type.String({ description: "ISO date or timestamp; absent means no automatic return." })),
	blockedBy: Type.Array(Type.String()),
	blockedReason: Type.Union([Type.String(), Type.Null()]),
	writeScopes: Type.Array(Type.String()),
	parent: Type.Optional(Type.Union([Type.String(), Type.Null()], { description: "Sets the parent (null clears it); left out, it stays as it is." })),
	foundWhile: Type.Optional(Type.Union([Type.String(), Type.Null()], { description: "Sets the origin (null clears it); left out, it stays as it is." })),
	related: Type.Optional(Type.Array(Type.String(), { description: "Replaces the related tasks; left out, they stay as they are." })),
});
export type BoardTaskInput = Static<typeof BoardTaskInputSchema>;

/** The kinds of entry a task's timeline holds. */
export const BoardTimelineKindSchema = Type.Union([
	Type.Literal("feedback"),
	Type.Literal("status"),
	Type.Literal("worker"),
	Type.Literal("question"),
	Type.Literal("decision"),
	Type.Literal("milestone"),
	Type.Literal("link"),
]);
export type BoardTimelineKind = Static<typeof BoardTimelineKindSchema>;

/**
 * One thing that happened to a task. `label` reads on its own ("F3 → addressed", "in_progress → review", "worker w1
 * started", "Q2 asked", "Subtask of T8"); `detail` carries the text behind it (the feedback, the question, the note);
 * `ref` is what the entry is about: a feedback ID, a question ID, a decision ID, a worker ID or a task ID (link).
 */
export const BoardTimelineEntrySchema = Type.Object({
	at: Type.String(),
	kind: BoardTimelineKindSchema,
	label: Type.String(),
	detail: Type.Optional(Type.String()),
	ref: Type.Optional(Type.String()),
	state: Type.Optional(BoardFeedbackStateSchema),
	by: Type.Optional(BoardWriterSchema),
});
export type BoardTimelineEntry = Static<typeof BoardTimelineEntrySchema>;

// --- requests ----------------------------------------------------------------------------------------------------

export const BoardGetRequestSchema = Type.Object({
	type: Type.Literal("board.get"),
	id: RequestIdSchema,
	projectId: ProjectIdSchema,
	includeArchived: Type.Optional(Type.Boolean({ description: "Default false." })),
});
export type BoardGetRequest = Static<typeof BoardGetRequestSchema>;

/** Create a task (no `taskId`), or change one made on `expectedRevision`. */
export const BoardTaskSaveRequestSchema = Type.Object({
	type: Type.Literal("board.task.save"),
	id: RequestIdSchema,
	projectId: ProjectIdSchema,
	taskId: Type.Optional(Type.String({ minLength: 1 })),
	expectedRevision: Type.Optional(Revision),
	task: BoardTaskInputSchema,
	note: Type.Optional(
		Type.String({
			maxLength: 2000,
			description:
				'Why the user made this change, in their words (e.g. why a task goes back from review to in_progress). It reaches the coordinator with the change. Needs the "board-moves" feature; older servers ignore it.',
		}),
	),
});
export type BoardTaskSaveRequest = Static<typeof BoardTaskSaveRequestSchema>;

/** Put tasks in this order; tasks not named keep their place after them. */
export const BoardTasksReorderRequestSchema = Type.Object({
	type: Type.Literal("board.tasks.reorder"),
	id: RequestIdSchema,
	projectId: ProjectIdSchema,
	taskIds: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
});
export type BoardTasksReorderRequest = Static<typeof BoardTasksReorderRequestSchema>;

export const BoardQuestionAnswerRequestSchema = Type.Object({
	type: Type.Literal("board.question.answer"),
	id: RequestIdSchema,
	projectId: ProjectIdSchema,
	questionId: Type.String({ minLength: 1 }),
	expectedRevision: Revision,
	answer: Type.String({ minLength: 1 }),
});
export type BoardQuestionAnswerRequest = Static<typeof BoardQuestionAnswerRequestSchema>;

/** A task's snapshots, oldest first. */
export const BoardTaskHistoryRequestSchema = Type.Object({
	type: Type.Literal("board.task.history"),
	id: RequestIdSchema,
	projectId: ProjectIdSchema,
	taskId: Type.String({ minLength: 1 }),
});
export type BoardTaskHistoryRequest = Static<typeof BoardTaskHistoryRequestSchema>;

/**
 * A task's timeline, oldest first: feedback and its state changes, status moves, workers started and reported or
 * failed, questions asked and answered, decisions, report milestones and link changes. `kinds` keeps only those kinds.
 * The answer also carries the task's feedback entries (open first), which the timeline shows only as events.
 */
export const BoardTaskTimelineRequestSchema = Type.Object({
	type: Type.Literal("board.task.timeline"),
	id: RequestIdSchema,
	projectId: ProjectIdSchema,
	taskId: Type.String({ minLength: 1 }),
	kinds: Type.Optional(Type.Array(BoardTimelineKindSchema)),
});
export type BoardTaskTimelineRequest = Static<typeof BoardTaskTimelineRequestSchema>;

/** Set the state of a feedback entry (the user dismisses or reopens one). Answers the entry as stored. */
export const BoardFeedbackSetRequestSchema = Type.Object({
	type: Type.Literal("board.feedback.set"),
	id: RequestIdSchema,
	projectId: ProjectIdSchema,
	taskId: Type.String({ minLength: 1 }),
	feedbackId: Type.String({ minLength: 1 }),
	state: BoardFeedbackStateSchema,
	note: Type.Optional(Type.String({ maxLength: 2000 })),
});
export type BoardFeedbackSetRequest = Static<typeof BoardFeedbackSetRequestSchema>;

/** Feature task-freshness. Marks prose stale, queues one rewrite nudge, never changes status. */
export const BoardReportStaleRequestSchema = Type.Object({
	type: Type.Literal("board.report.stale"),
	id: RequestIdSchema,
	projectId: ProjectIdSchema,
	taskId: Type.String({ minLength: 1 }),
	sections: Type.Optional(Type.Array(Type.Union([Type.Literal("results"), Type.Literal("next")]), { minItems: 1, uniqueItems: true, description: "Omitted means both sections." })),
	reason: Type.Optional(Type.String({ minLength: 1, maxLength: 160, description: "Optional short explanation; plain text, never an instruction." })),
});
export type BoardReportStaleRequest = Static<typeof BoardReportStaleRequestSchema>;
export const BoardReportStaleResponseSchema = Type.Object({
	type: Type.Literal("board.report.stale"),
	id: RequestIdSchema,
	task: BoardTaskSchema,
});
export type BoardReportStaleResponse = Static<typeof BoardReportStaleResponseSchema>;

// --- responses ---------------------------------------------------------------------------------------------------

export const BoardGetResponseSchema = Type.Object({
	type: Type.Literal("board.get"),
	id: RequestIdSchema,
	board: BoardSchema,
});
export type BoardGetResponse = Static<typeof BoardGetResponseSchema>;

export const BoardTaskSaveResponseSchema = Type.Object({
	type: Type.Literal("board.task.save"),
	id: RequestIdSchema,
	task: BoardTaskSchema,
});
export type BoardTaskSaveResponse = Static<typeof BoardTaskSaveResponseSchema>;

export const BoardTasksReorderResponseSchema = Type.Object({
	type: Type.Literal("board.tasks.reorder"),
	id: RequestIdSchema,
});
export type BoardTasksReorderResponse = Static<typeof BoardTasksReorderResponseSchema>;

export const BoardQuestionAnswerResponseSchema = Type.Object({
	type: Type.Literal("board.question.answer"),
	id: RequestIdSchema,
	question: BoardQuestionSchema,
});
export type BoardQuestionAnswerResponse = Static<typeof BoardQuestionAnswerResponseSchema>;

export const BoardTaskHistoryResponseSchema = Type.Object({
	type: Type.Literal("board.task.history"),
	id: RequestIdSchema,
	taskId: Type.String(),
	snapshots: Type.Array(BoardTaskSnapshotSchema),
});
export type BoardTaskHistoryResponse = Static<typeof BoardTaskHistoryResponseSchema>;

export const BoardTaskTimelineResponseSchema = Type.Object({
	type: Type.Literal("board.task.timeline"),
	id: RequestIdSchema,
	taskId: Type.String(),
	entries: Type.Array(BoardTimelineEntrySchema),
	feedback: Type.Array(BoardFeedbackSchema, { description: "Open and handling ones first (oldest first), then the rest, newest first." }),
});
export type BoardTaskTimelineResponse = Static<typeof BoardTaskTimelineResponseSchema>;

export const BoardFeedbackSetResponseSchema = Type.Object({
	type: Type.Literal("board.feedback.set"),
	id: RequestIdSchema,
	feedback: BoardFeedbackSchema,
});
export type BoardFeedbackSetResponse = Static<typeof BoardFeedbackSetResponseSchema>;

// --- server events -----------------------------------------------------------------------------------------------

/** The project's board without archived tasks, pushed to every connection whenever it changes. */
export const BoardStateEventSchema = Type.Object({
	type: Type.Literal("board.state"),
	projectId: ProjectIdSchema,
	board: BoardSchema,
});
export type BoardStateEvent = Static<typeof BoardStateEventSchema>;
