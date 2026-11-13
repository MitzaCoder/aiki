import { mcpRoleExtension } from "./mcp.ts";
import { recordTimelineRun } from "./task-timeline.ts";
import { activityTracking, endActivitySource } from "./task-activity.ts";
import { noteTaskFact } from "./task-freshness.ts";
import { stateKind } from "./state-identity.ts";
/**
 * Workers: background, restart-safe child conversations the project's coordinator delegates work to.
 *
 * This file builds on pi-durable's background subagent pattern (persistent children owned by a background anchor task,
 * answers delivered back to the parent by background reporter tasks). What differs is what the harness needs:
 *
 * - The worker is born from the coordinator's transcript: `worker_spawn` records the ID, task title, model, isolation
 *   and workspace in a durable document on the coordinator conversation, so a list survives restarts.
 * - A worker's tools run either in the project directory (`shared`) or in a `jj workspace` the server creates in the data
 *   directory (`workspace`), so its edits stay out of the project until the coordinator merges them.
 * - Only the worker's final answer (its report) enters the coordinator's context, never the worker's transcript.
 * - Request IDs derive from the tool call that started the message, so a rerun after a crash cannot send a message or
 *   post a report twice.
 *
 * Every coordinator thread of the project (main and its background threads, `threads.ts`) has its own workers: the list
 * lives on that thread's conversation and its reports go back to it, while the board and the worker model defaults stay
 * the project's, on main's conversation. A background thread's workers never run in the project checkout: `shared`
 * means the thread's own workspace, and `workspace` a jj workspace under the thread's directory.
 */
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Context } from "@earendil-works/chord/context";
import type { AssistantMessage, Models } from "@earendil-works/pi-ai";import {
 GenerationTask, hook,
	AssistantEntry,
	type Conversation,
	type ConversationId,
	configure,
	defineDoc,
	defineExtension,
	defineTask,
	defineTool,
	type EntryId,
	type EntryRecord,
	type Extension,
	type Harness,
	InboxDoc,
	type JsonObject,
	LiveDoc,
	type LiveState,
	section,
	type Task,
	type TaskId,
	type TaskRuntime,
	type ToolRegistration,
	type Tx,
} from "@earendil-works/pi-durable";
import {
	CHECK_IN_PREFIX,
	type ModelRef,
	type ScheduleOnReport,
	THINKING_LEVELS,
	type ThinkingLevel,
	type WorkerDefaults,
	type WorkerIsolation,
	type WorkerModel,
	type WorkerStatus,
	type WorkerSummary,
} from "@kemiri/protocol";
import { Type } from "typebox";
import { mkdir } from "node:fs/promises";
import {
	BoardDoc,
	type BoardState,
	HARNESS_WRITER,
	addTimelineEvent,
	boardView,
	describeTaskInFull,
	normalizeBoard,
	inProgressMinutes,
	moveTaskForWorker,
 inferCoordinatorTaskFocusIn,
	openBoard,
	openTaskHistory,
	recordScheduledReport,
	recordScheduleProblem,
	scopesOverlap,
	snapshotStatusChanges,
	statusesOf,
	taskTime,
	workerWriter,
	writeReportIn,
} from "./board.ts";
import { type CoordinatorPlace, Coordinators } from "./coordinators.ts";
import { ServerError, errorMessage } from "./errors.ts";
import { JjError, ensureJjWorkspace, jjRoot, removeJjWorkspace, workspacePath } from "./jj.ts";
import type { TaskChangeObserver } from "./task-changes.ts";
import {
	type Notifier,
	scheduleDoneNotification,
	scheduleFailureNotification,
	workerNotification,
} from "./notifications.ts";
import type { Project } from "./projects.ts";
import { formatRunStamp } from "./schedules.ts";

/** How many forgotten workers stay in the list as history. */
export const KEPT_DONE_WORKERS = 20;

/** An explicit passive answer to a queued request already covered by the previous report. */
export const NO_NEW_WORKER_REPORT = "Nothing new.";

export type WorkerRecord = {
 activityRunId?: string;
	id: string;
	title: string;
	conversationId: number;
	isolation: WorkerIsolation;
	workspacePath: string | null;
	model: ModelRef;
	thinkingLevel: ThinkingLevel | null;
	status: WorkerStatus;
	/** The schedule that started this worker, when the harness started it rather than the coordinator. */
	scheduleId?: string | null;
	/** The board task the worker runs, when the coordinator named one; absent on workers started before the board. */
	taskId?: string | null;
	/** Retitled/reused workspaces require explicit trailers rather than single-task fallback. */
	workspaceReused?: boolean;
	spawnedByCallId: string | null;
	createdAt: string;
	updatedAt: string;
	lastReport: string | null;
	failure: string | null;
	/** The background task that owns the worker's conversation, so its work outlives the coordinator's turns. */
	anchorTaskId: number;
};

/** Project-local actor identity survives name reuse and distinguishes resumed runs. */
export async function syncWorkerActivity(tx: Tx, service: WorkerService, worker: WorkerRecord, coordinatorId: number): Promise<void> {
 if (!worker.taskId) return;
 const board = await openBoard(tx, service.mainId as ConversationId);
 const tracking = activityTracking(board, worker.taskId);
 const threadId = service.coordinators.threadIdOf(coordinatorId) ?? "main";
 const previous = Object.values(tracking.sources).sort((a,b) => b.since.localeCompare(a.since)).find(s => s.actor.kind === "worker" && s.actor.threadId === threadId && s.actor.conversationId === worker.conversationId);
 if (worker.status === "running" && (!worker.activityRunId || (previous?.state !== "running" && previous?.actor.runId === worker.activityRunId))) worker.activityRunId = worker.updatedAt;
 const runId = worker.activityRunId ?? worker.createdAt;
 const id = `${threadId}:${worker.conversationId}:${runId}`;
 if (worker.status === "running") {
  for (const source of Object.values(tracking.sources)) if (source.actor.kind === "worker" && source.actor.threadId === threadId && source.actor.name === worker.id && source.actor.id !== id) {
   if (source.state === "failed" && source.actor.conversationId === worker.conversationId) source.state = "ended"; // Retry of this conversation, not reuse of a worker name.
   endActivitySource(tracking, source.actor.id, worker.updatedAt);
  }
  if (tracking.sources[id]?.state !== "running") tracking.sources[id] = { actor: { id, kind: "worker", name: worker.id, threadId, conversationId: worker.conversationId, runId }, state: "running", title: worker.title, since: worker.updatedAt };
 } else if (worker.status === "failed") {
  tracking.sources[id] = { actor: { id, kind: "worker", name: worker.id, threadId, conversationId: worker.conversationId, runId }, state: "failed", title: worker.title, since: worker.updatedAt, failure: worker.failure ?? "no reason given" };
  tracking.lastEndedAt = worker.updatedAt;
 } else endActivitySource(tracking, id, worker.updatedAt);
 const task = board.tasks.find(task => task.id === worker.taskId);
 if (task) {
  const history = await openTaskHistory(tx, service.mainId as ConversationId, task.id);
  const outcome = worker.status === "running" ? "running" : worker.status === "failed" ? "failed" : worker.status === "stopped" ? "stopped" : "reported";
  recordTimelineRun(history, task, { id, kind: "worker", name: worker.id, threadId, conversationId: worker.conversationId, runId }, outcome, worker.updatedAt,
   outcome === "failed" ? worker.failure ?? "no reason given" : outcome === "reported" ? reportGist(worker.lastReport ?? "") : worker.title);
 }
}

/** Read-only on subsequent requests in the same run; no transaction or document writes. */
export async function syncWorkerActivityRun(service: WorkerService, conversationId: number, runId: string, context: Context = BACKGROUND_CONTEXT): Promise<void> {
 const place = await service.workerOf(conversationId, context);
 const owner = place && service.coordinators.placeOfThread(place.threadId);
 if (!place?.record.taskId || !owner || place.record.activityRunId === runId) return;
 await service.harness.commit(async tx => {
  const doc = await tx.doc(WorkersDoc, owner.conversationId as ConversationId);
  const worker = doc.workers[place.record.id];
  if (!worker || worker.conversationId !== conversationId || worker.status === "stopped" || worker.status === "done" || worker.activityRunId === runId) return;
  worker.activityRunId = runId;
  worker.updatedAt = new Date().toISOString();
  await syncWorkerActivity(tx, service, { ...worker, status: "running" }, owner.conversationId);
 }, context);
}

export type WorkersState = {
	workers: Record<string, WorkerRecord>;
	/** The worker model the user last picked with a message; null until they pick one. */
	defaults: { model: ModelRef | null; thinkingLevel: ThinkingLevel | null };
	/** The live periodic check-in task, so two worker starts cannot create two timers. Null when none runs. */
	checkInTaskId: number | null;
};

/**
 * The project's workers, stored next to the coordinator conversation so they survive a restart and stay with it. Not a
 * system prompt section: it changes too often, and the coordinator reads it through `worker_list` instead.
 */
export const WorkersDoc = defineDoc<WorkersState>({
	kind: stateKind("workers"),
	version: 2,
	scope: "conversation",
	history: "latest",
	fork: "initial",
	checkpointWhen: () => false,
	initial: () => ({ workers: {}, defaults: { model: null, thinkingLevel: null }, checkInTaskId: null }),
	// Version 1 had no check-in task: give existing projects none, so the next worker start creates one.
	migrate: (value) => ({ ...(value as WorkersState), checkInTaskId: (value as WorkersState).checkInTaskId ?? null }),
});

export function emptyWorkersState(): WorkersState {
	return WorkersDoc.definition.initial() as WorkersState;
}

export function workerSummary(record: WorkerRecord, threadId?: string): WorkerSummary {
	return {
		...(threadId === undefined ? {} : { threadId }),
		id: record.id,
		title: record.title,
		status: record.status,
		model: record.model,
		thinkingLevel: record.thinkingLevel,
		isolation: record.isolation,
		workspacePath: record.workspacePath,
		conversationId: record.conversationId,
		scheduleId: record.scheduleId ?? null,
		taskId: record.taskId ?? null,
		spawnedByCallId: record.spawnedByCallId,
		createdAt: record.createdAt,
		updatedAt: record.updatedAt,
		lastReport: record.lastReport,
		failure: record.failure,
	};
}

function summariesOf(state: WorkersState | Readonly<WorkersState> | undefined, threadId?: string): WorkerSummary[] {
	if (state === undefined) return [];
	return Object.values(state.workers)
		.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
		.map((record) => workerSummary(record, threadId));
}

function defaultsOf(state: WorkersState | Readonly<WorkersState> | undefined): WorkerDefaults {
	return state?.defaults ?? { model: null, thinkingLevel: null };
}

// --- workers that answer back ------------------------------------------------------------------------------------

/**
 * The anchor owns one worker conversation and finishes at once, so a worker survives the coordinator's turns, its Esc
 * and its idle waits; only `conversation.abort({ background: true })` reaches it.
 */
const WorkerAnchor = defineTask<null, { phase: "done" }, null>({
	name: stateKind("worker-anchor"),
	version: 1,
	initial: () => ({ phase: "done" }),
	phases: {
		done: (_anchor, runtime, context) =>
			runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: null } }), context),
	},
	abort: (_anchor, runtime, context) =>
		runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context),
});

type ReporterInput = {
	workerId: string;
	/** The worker's conversation. */
	conversationId: number;
	/** The tool call that sent the message: request IDs derive from it, so a rerun cannot send it twice. */
	callId: string;
	message: string;
	/** Steer (false) or queue behind the current answer (true). */
	followUp: boolean;
	/**
	 * The scheduled run this message belongs to, when the harness started the worker instead of the coordinator. It
	 * decides what the report does to the coordinator (`record` never starts a turn) and that a `shared` run is
	 * forgotten once it reports.
	 */
	schedule?: { id: string; title?: string; onReport: ScheduleOnReport; isolation: WorkerIsolation };
};

type ReporterState =
	| { phase: "deliver" }
	| { phase: "report"; answerId?: EntryId; text: string | null; status: WorkerStatus; failure: string | null }
	// Older notify checkpoints already committed their board changes and recorded/notify decision.
	| { phase: "notify"; answerId?: EntryId; text: string | null; status: WorkerStatus; failure: string | null; recorded: boolean; notify: boolean; decisionPending?: boolean };

/**
 * Delivers one message to one worker and reports its answer back.
 *
 * The worker's answer is the only thing that reaches the coordinator: the reporter appends it as a follow-up input, so
 * the coordinator reads a report instead of a whole transcript. Inputs use the sending call's request ID; reports use
 * the final answer entry's ID, since several steered inputs can share it. Admission and board changes are atomic.
 */
function createWorkerReporter(service: WorkerService): Task<ReporterInput, ReporterState, null, object> {
	return defineTask<ReporterInput, ReporterState, null>({
		name: stateKind("worker-reporter"),
		version: 1,
		initial: () => ({ phase: "deliver" }),
		phases: {
			deliver: async (reporter, runtime, context) => {
				const { workerId, conversationId, callId, message, followUp } = reporter.input;
				const submission = await service.withReportAdmission(async () => {
					let forgotten = false;
					await runtime.commit(async (tx) => {
						const state = await tx.doc(WorkersDoc, runtime.conversationId);
						const worker = state.workers[workerId];
						forgotten = worker === undefined || worker.status === "done" || worker.conversationId !== conversationId;
						if (forgotten || worker === undefined) return;
						if (worker.status !== "running" && worker.taskId != null) {
							const board = await openBoard(tx, service.mainId as ConversationId);
							noteTaskFact(board, worker.taskId, { actor: "coordinator", kind: "worker_resume", reason: "worker resumed", at: new Date().toISOString() });
						}
						if (worker.status !== "running") worker.activityRunId = callId;
      worker.status = "running";
						worker.updatedAt = new Date().toISOString();
      await syncWorkerActivity(tx, service, worker, runtime.conversationId);
					}, context);
					if (forgotten) return null;
					const worker = await runtime.conversation(conversationId as ConversationId, context);
					return worker?.submit(
						{ type: "input", content: message, whenBusy: followUp ? "followUp" : "steer", requestId: `worker-message:${callId}` },
						context,
					);
				});
				if (submission === null) {
					await runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: null } }), context);
					return;
				}
				if (submission === undefined) {
					await runtime.commit(
						() => ({
							status: "running",
							checkpoint: {
								phase: "report",
								text: null,
								status: "failed",
								failure: "its conversation is gone",
							},
						}),
						context,
					);
					return;
				}
				const settled = await submission.wait(context);

				if (settled.status === "unanswered") {
					// A stop is the coordinator's own decision: it already knows, and nothing should be posted back.
					const stopped = settled.reason === "aborted";
					await runtime.commit(
						() => ({
							status: "running",
							checkpoint: {
								phase: "report",
								text: null,
								status: stopped ? "stopped" : "failed",
								failure: stopped ? null : settled.reason,
							},
						}),
						context,
					);
					return;
				}

				// The report is the answer's text; the rest of the worker's transcript stays in its conversation.
				const answered = settled.answer;
				await runtime.commit(
					async (tx) => {
						const answer = answered === undefined ? undefined : await tx.entry(AssistantEntry, answered);
						const text = answerText(answer?.model?.[0] as AssistantMessage | undefined);
						return {
							status: "running",
							checkpoint: { phase: "report", answerId: answered, text, status: "idle", failure: null },
						};
					},
					context,
				);
			},
			report: async (reporter, runtime, context) => {
				// Keep the old phase boundary so reporters persisted by earlier releases can resume.
				await runtime.commit(() => ({
					status: "running",
					checkpoint: { ...reporter.state.checkpoint, phase: "notify", recorded: false, notify: true, decisionPending: true },
				}), context);
			},
			notify: async (reporter, runtime, context) => service.withReportAdmission(async () => {
				const { workerId, callId, schedule, conversationId } = reporter.input;
				const { text, status, failure } = reporter.state.checkpoint;
				const owner = (await service.coordinators.conversation(runtime.conversationId)) ?? service.coordinator;
				const report = text === null ? failureReport(workerId, failure) : reportText(workerId, text);
				const scheduledRecord = schedule?.onReport === "record";
				const forget = schedule?.isolation === "shared";
				let notify = false;
				await runtime.commit(async (tx) => {
					// A steer can settle several submissions with one final answer. Their sending call IDs differ;
					// the answer entry does not. Recover it for checkpoints written before answerId was stored too.
					const sent = await tx.submissionByRequest(conversationId as ConversationId, `worker-message:${callId}`);
					const answerId = reporter.state.checkpoint.answerId ?? (sent?.status === "done" && "answer" in sent ? sent.answer : undefined);
					const requestId = answerId === undefined ? `worker-report:${callId}` : `worker-answer:${conversationId}:${answerId}`;
					const existing = await tx.submissionByRequest(runtime.conversationId, requestId);
					const legacy = await tx.submissionByRequest(runtime.conversationId, `worker-report:${callId}`);
					const terminal = { status: "terminal" as const, outcome: { status: "completed" as const, result: null } };
					if (existing !== undefined || legacy !== undefined) return terminal;
					const state = await tx.doc(WorkersDoc, runtime.conversationId);
					const worker = state.workers[workerId];
					// A legacy scheduled shared worker may already have been retired in the report phase.
					const decisionPending = reporter.state.checkpoint.decisionPending === true;
					const retiredBySchedule = !decisionPending && forget && reporter.state.checkpoint.notify;
					const forgotten = worker === undefined || worker.conversationId !== conversationId || (worker.status === "done" && !retiredBySchedule);
					const quiet = forgotten || (decisionPending
						? text !== null && (worker?.lastReport === text || text.trim() === NO_NEW_WORKER_REPORT)
						: !reporter.state.checkpoint.notify);
					const recorded = scheduledRecord || quiet || reporter.state.checkpoint.recorded;
					notify = !quiet && reporter.state.checkpoint.notify;
					if (decisionPending && !forgotten && worker !== undefined) {
						// Reads come before the first write. A failure moves the worker's task to blocked; a report moves nothing,
						// the coordinator moves the task to review once it checked the work. A failed scheduled run opens (or
						// updates) its schedule's task. A stop moves nothing: the coordinator chose it.
						const taskId = worker.taskId ?? null;
						const scheduleId = worker.scheduleId ?? null;
						const moves = worker.status !== "stopped" && status === "failed";
						// A `record` run of a schedule has no coordinator turn to move its task: the harness puts the run in it.
						const recordsRun = scheduledRecord && scheduleId !== null && worker.status !== "stopped" && status === "idle" && text !== null && taskId !== null;
						// The board is the project's, on main's conversation, whichever thread's worker this is.
						const board =
							taskId !== null || (moves && scheduleId !== null) || recordsRun
								? await openBoard(tx, service.mainId as ConversationId)
								: undefined;
						const history =
							board !== undefined && taskId !== null ? await openTaskHistory(tx, service.mainId as ConversationId, taskId) : undefined;
						const now = new Date().toISOString();
						if (board !== undefined) {
							const key = requestId;
							const reason = `worker ${workerId} failed: ${failure ?? "no reason given"}`;
							const before = statusesOf(board);
							if (recordsRun && scheduleId !== null && taskId !== null && text !== null) {
								recordScheduledReport(board, { key, scheduleId, taskId, workerId, text, now });
							} else if (moves && taskId !== null) {
								moveTaskForWorker(board, { key, taskId, move: { kind: "failed", workerId, reason }, now });
							} else if (moves && scheduleId !== null) {
								recordScheduleProblem(board, { key, scheduleId, title: schedule?.title ?? scheduleId, reason, now });
							}
							await snapshotStatusChanges(tx, service.mainId as ConversationId, board, before, { by: HARNESS_WRITER, at: now, key });
							// The timeline says what became of the worker: a report, or the failure and its reason.
							const task = board.tasks.find((candidate) => candidate.id === taskId);
							if (history !== undefined && task !== undefined && worker.status !== "stopped") {
								if (status === "failed") {
									addTimelineEvent(
										history,
										task,
										{ at: now, kind: "worker", label: `Worker ${workerId} failed`, detail: failure ?? "no reason given", ref: workerId, by: HARNESS_WRITER },
										key,
									);
								} else if (text !== null) {
									if (addTimelineEvent(
										history,
										task,
										{ at: now, kind: "worker", label: `Worker ${workerId} reported`, detail: reportGist(text), ref: workerId, by: HARNESS_WRITER },
										key,
									) && !recordsRun) noteTaskFact(board, task.id, { actor: "worker", kind: "worker_report", reason: "worker reported; work advanced", at: now });
								}
							}
						}
						// A stop that arrived while the answer was in flight wins over the answer.
						if (worker.status !== "stopped") worker.status = status;
						worker.updatedAt = now;
						worker.failure = failure;
						if (text !== null) worker.lastReport = text;
						if (forget) {
							worker.status = "done";
							worker.workspacePath = null;
							pruneDone(state);
						}
					}
					if (worker !== undefined && !forgotten) {
      const live = await tx.doc(LiveDoc, worker.conversationId as ConversationId);
      await syncWorkerActivity(tx, service, live.run && !live.run.afterRun && worker.status !== "stopped" && worker.status !== "done" ? { ...worker, status: "running", failure: null } : worker, runtime.conversationId);
     }
     // Admission, the timeline and task completion share one commit. A restart cannot replay one
					// without the others, and a second reporter for this answer finds the existing submission.
					if (report !== null) {
						await owner.submit(tx, recorded ? {
							type: "write", entry: { kind: "pi.user", model: [{ role: "user", content: report, timestamp: runtime.now() }] }, requestId,
						} : { type: "input", content: report, whenBusy: "followUp", requestId });
					}
					return terminal;
				}, context);
				if (notify) {
					const threadId = service.coordinators.threadIdOf(runtime.conversationId);
					service.notifyWorkerReport({ workerId, callId, text, status, failure, schedule,
						...(threadId === undefined ? {} : { threadId }),
					});
				}
			}),
		},
		abort: (_reporter, runtime, context) =>
			runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context),
	});
}

function answerText(message: AssistantMessage | undefined): string {
	return (message?.content ?? []).flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
}

/** What the coordinator reads when a worker answers: the report, clearly marked as coming from a worker. */
function reportText(workerId: string, text: string): string {
	const body = text.trim().length === 0 ? "(the worker answered with no text)" : text.trim();
	return `[worker ${workerId} reported]\n${body}`;
}

/** And when it could not: nothing for a stop, which the coordinator asked for. */
/** The start of a worker's report as a timeline line: its first sentences on one line, clipped. */
export function reportGist(text: string): string {
	const line = text.replace(/(^|\s)#{1,6}\s+/g, "$1").replace(/\s+/g, " ").trim();
	return line.length <= 200 ? line : `${line.slice(0, 199)}…`;
}

function failureReport(workerId: string, failure: string | null): string | null {
	if (failure === null) return null;
	return `[worker ${workerId} failed: ${failure}]`;
}

// --- model resolution --------------------------------------------------------------------------------------------

export type ResolvedWorkerModel = { model: ModelRef; thinkingLevel: ThinkingLevel | null };

export type ResolveWorkerModelResult =
	| { ok: true; value: ResolvedWorkerModel }
	| { ok: false; message: string };

/**
 * The thinking level a default worker model carries in the project's list, if the resolved model is in it. Missing and
 * `null` both mean the model's own default.
 */
function levelIn(projectModels: readonly WorkerModel[], ref: ModelRef): ThinkingLevel | null {
	const entry = projectModels.find((model) => model.provider === ref.provider && model.modelId === ref.modelId);
	return entry?.thinkingLevel ?? null;
}

/**
 * Which model a new worker runs on: the one the coordinator names, else the one the user last picked with a message,
 * else the project's default worker models. There are no built-in models, so with none of them a worker cannot start.
 *
 * Its thinking level, in order: the one the coordinator names for this worker, the one the user picked with the model
 * in the composer, the level the project's list stores for that model (a level the coordinator names without a model
 * counts as the first of these).
 */
export function resolveWorkerModel(options: {
	explicit?: ModelRef | undefined;
	explicitThinkingLevel?: ThinkingLevel | undefined;
	defaults: WorkerDefaults;
	projectModels: readonly WorkerModel[];
	models: Models;
}): ResolveWorkerModelResult {
	const available = (ref: ModelRef): boolean => options.models.getModel(ref.provider, ref.modelId) !== undefined;
	const resolve = (model: ModelRef): ResolvedWorkerModel => ({
		model: { provider: model.provider, modelId: model.modelId },
		thinkingLevel:
			options.explicitThinkingLevel ??
			options.defaults.thinkingLevel ??
			levelIn(options.projectModels, model),
	});

	if (options.explicit !== undefined) {
		if (!available(options.explicit)) {
			return {
				ok: false,
				message: `Unknown model ${options.explicit.provider}/${options.explicit.modelId}.`,
			};
		}
		return { ok: true, value: resolve(options.explicit) };
	}

	const fromUser = options.defaults.model;
	if (fromUser !== null && available(fromUser)) {
		return { ok: true, value: resolve(fromUser) };
	}

	const fromProject = options.projectModels.find((ref) => available(ref));
	if (fromProject !== undefined) {
		return { ok: true, value: resolve(fromProject) };
	}

	return {
		ok: false,
		message:
			"No worker model is set: name a model (in worker_spawn or on the schedule), pick a worker model in the app's composer, or set the project's worker models in settings.",
	};
}

// --- prompts -----------------------------------------------------------------------------------------------------

/** Prompt text on when a `codemode` script beats direct tool calls; shared by coordinator and worker, byte-stable. */
const CODEMODE_GUIDANCE = `A codemode script calls your tools as \`await tools.<name>(args)\` and only what it returns or prints reaches you. Write one to run independent calls together (\`Promise.allSettled\`), to keep only part of a large output (filter, count, extract), to repeat an operation over many items, or for a chain whose later steps follow mechanically from earlier ones. For a single call whose whole output you need, call the tool directly: a script that only wraps one call costs more and clutters the chat. Return only what you need, never raw dumps, e.g. \`const [a, b] = await Promise.allSettled([tools.read({ path: "a.ts" }), tools.bash({ command: "rg -c TODO src" })]); return { a: a.status, todos: b.value?.output };\`. \`tools.bash\` resolves with \`{ output, exitCode, ... }\` even on a non-zero exit, so check \`exitCode\` instead of expecting it to throw.`;

/** How to write, for every coordinator and worker; byte-stable. */
const WRITING_RULE = `Write for a busy reader: plain words, short sentences, no labels you coined. Say what was done and what was not.`;

/**
 * How a coordinator (main or a thread) keeps the task reports and moves tasks; byte-stable. The user reads the tasks,
 * so the rules are here and in the tool descriptions, not in code: nothing limits a report's length.
 */
const REPORT_RULES = `Each task has a short report the user reads instead of the chat. Now is written automatically. Holding a task alone is not activity. Keep \`results\` (what came out of it, with evidence: commit, artifact, test run) and \`next\` (what comes next, and who does it). Write it with the \`board\` action \`write_report\`. A write replaces the sections you name, so rewrite them in place and keep them short: never append, never repeat what is already there or what the board already shows. Terse plain English, nothing made up. Pass a \`milestone\` (a few words) only when something meaningful happened, such as a first version merged, a blocker found or a decision made. A question or a warning for the user is not report text: put it on the board with action \`ask\` (kind \`question\` or \`warning\`), so a rewrite cannot lose it.

A message starting with "[reports]" names task reports that went out of date. Read each task with show_task and rewrite only the stale Results or Next, with evidence. When you read a task earlier and write later, pass the eventSeq show_task gave you as coveredEventSeq, so anything that happened since stays marked.

Only the user closes a task. Move a task to \`review\` when it is ready for them and say in \`next\` what they should check; you cannot set \`done\` or \`dropped\`. When a task's work is done but it waits on something outside the user's control that the user named (a review, a release, a reply), move it to waiting with that waitingFor note instead of leaving it in review. A worker's report does not move its task: check the work, then move the task yourself. When you keep screenshots or videos for a task with artifact_save, pass its taskId and tag them by platform and state, for example \`web, phone, dark\` (a before/after pair differs only in \`before\` and \`after\`).`;

/**
 * The "Show UI changes" rule (`project.uiProof`), as the paragraph plus its blank line, or "" when the setting is off.
 * Byte-stable: it depends only on the setting. The coordinator also puts it in worker briefs and keeps the demo recipe;
 * a worker only follows it.
 */
export function uiProofParagraph(project: Project, role: "coordinator" | "worker"): string {
	if (project.uiProof === "off") return "";
	const videos = project.uiProof === "screenshots-and-videos";
	const coordinator = role === "coordinator";
	const proof = `Any change a user can see in a UI (a web page, an app screen) is proven before ${coordinator ? "it goes to review" : "you report"}. For a bug, show it before and after: reproduce it first, then show it fixed. Use before/after screenshots${videos ? ", plus a short screen recording of the interaction" : ""}. Drive the real UI headless (a browser, or an emulator or device for an app). Save the proof with artifact_save on the task, tagged by platform and state, and mention it in \`results\`. A change with nothing visible needs no proof, and backends and terminals are never recorded.`;
	return `${
		coordinator
			? `${proof} Put this rule in every worker brief. The first time the project needs a demo, work out the recipe (how to start the app, test data, how to drive the UI, where artifacts may live) and keep it in project memory, so later workers reuse it.`
			: `${proof} If your brief or the project's memory gives a demo recipe, use it.`
	}\n\n`;
}

/** The prompt's paragraph on check-ins, shared by main and the background threads. */
function checkInsParagraph(project: Project): string {
	return project.checkIns.enabled
		? `While at least one worker runs, the harness wakes you every ${project.checkIns.intervalMinutes} minute${
				project.checkIns.intervalMinutes === 1 ? "" : "s"
			} with a message starting with "${CHECK_IN_PREFIX}" that carries this digest for every running worker. Treat it as a prompt to judge: steer a worker that is stuck or on a wrong path with worker_send (interrupt: true), stop one that is wasting time with worker_stop, and say nothing when it is making progress.`
		: "Periodic check-ins are turned off in this project's settings; use worker_peek yourself if you want to look in on a worker.";
}

/** Shared by main and background coordinators. */
const WORKER_MESSAGE_RULES = "To add to a running worker's current task, use worker_send with interrupt: true so it lands in the same run and report. Queue only a separate next task. When a report repeats one already handled or adds nothing new, end the turn without a chat reply; do not acknowledge it, just as with uneventful check-ins.";

/** What the coordinator is told once, in its system prompt. */
export function coordinatorSection(project: Project): string {
	const checkIns = checkInsParagraph(project);
	return `You coordinate the project "${project.name}" at ${project.path}. You keep every tool, and you do the thinking: plan, delegate, review, merge. Write code only for small, local fixes; hand real work to workers.

Stay responsive: the user is waiting on the other end of every turn, so answer quickly and never block a turn on a wait or a poll — not a sleep, not a loop of status checks, nothing that keeps you "working" while nothing changes. Delegate anything long (a CI watch, a long build or test run, any kind of wait) to a worker with worker_spawn, or to a schedule with schedule_save when it should recur, then end your turn. You get the report when it arrives, including from the user's next message if you are already answering them, and you can act on it then instead of blocking on it now.

Work like this:
1. Plan the change and decide how much can run at once.
2. Delegate each independent piece with worker_spawn: a self-contained brief (goal, files, constraints, how to verify) and a title. Pick isolation per worker: "shared" for reading, searching and work that must touch the project checkout as it is; "workspace" when the worker needs its own jj workspace so its edits stay out of the project until you merge them. Workspace isolation needs a jj repository; if it fails, use "shared". Workers can do anything you can in a repository: commit, rebase, squash, rewrite history, push. Add an \`Kemiri-Task: T…\` trailer to commit descriptions. Give that work to a worker like any other and say in the brief what to commit, how to split it and where it goes; do not do it yourself because you assume a worker cannot.
3. Keep working or answer while workers run. Their reports arrive as messages starting with "[worker <id> reported]" or "[worker <id> failed: ...]". Only that report reaches you, never the worker's transcript.
4. Review a report, then inspect the result yourself (jj log, jj diff, reading files). Merge an isolated worker's change by committing nothing in your own checkout but rebasing or squashing the worker's commit into it, for example \`jj squash --from <change> --into @\` to fold it into the working copy or \`jj rebase -s <change> -d @\` to keep it separate. A conflict is not yours to fight through: spawn a new worker with a brief that names the conflicting files and change IDs, and let it resolve them in its workspace.
5. When a worker's work is merged and reported, release it with worker_forget (removes its workspace). Send more work to the same worker with worker_send while it lives: it remembers its earlier messages. When you hand it a new task, pass a new title too, so the worker list says what it does now. worker_stop aborts what it is doing and keeps it usable; worker_list shows every worker, its status, model, isolation and workspace.
6. worker_peek shows what a worker is doing right now without waiting for a report: its status, how long since it last produced anything, its running tool calls and results, and the tail of its text. Use it when the user asks how something is going, or before you decide a worker is stuck.

${WORKER_MESSAGE_RULES}

Every subject the user raises is a task on the project's board, kept with the \`board\` tool. Before you reply to a message, find its task or add one with add_task, and say in your reply which task it is filed under. Title a task with a short, plain outcome, such as "Complete the example change"; its tickets and pull requests go in its refs as full links (look up the link with gh or acli when you only know the key or number), never in the title. Your replies in the chat are a line or two that name the task; the detail goes in the task's report, because the user reads the tasks and uses the chat to talk. A message starting with "[task T12, feedback F3] " is feedback F3 on that task. Do not copy it into the description: mark it handling with the \`board\` action \`feedback\` when you act on it, and addressed, with a note of what addressed it (a commit, a result, "answered in chat"), when done. When a background thread holds the task, pass the message on with thread_send. A task you find while working on another (a bug, more to build, an analysis) always gets \`foundWhile\` set to that task; a planned piece of a bigger task gets \`parent\`; a see-also gets \`related\`. Add further tasks for the pieces when you plan, and pass the task's ID as taskId to worker_spawn: the harness moves it to in_progress when the worker starts and to blocked when it fails, and the harness writes Now automatically.

${REPORT_RULES}

Verification has diminishing returns: verify what a task's acceptance asks for, then stop. Do not re-check what is already shown. When a decision only the user can make blocks work, ask it with the \`board\` action \`ask\` and carry on with the rest. Messages starting with "[board]" bring the user's edits and answers, and the tasks whose blockers are all done. The user moves tasks on the board, and each move is an instruction: a task moved to in_progress means start it now; a task moved from review back to in_progress comes with what the user says still needs doing, so act on it; done and dropped are the user closing the task. The order of the todo tasks is the user's priority, highest first: start them in that order. When a background thread holds a task the user moved, pass the move on to it with thread_send.

${uiProofParagraph(project, "coordinator")}${checkIns}

${CODEMODE_GUIDANCE} Scripts cannot start, message, stop or forget a worker, or save, delete or run a schedule — only you can, directly.

${WRITING_RULE}

Every worker ends with a report: outcome, files changed, workspace and change ID, open issues, and things worth remembering. Treat that report as a claim to check, not as the truth.`;
}

/**
 * What a background thread is told in place of main's coordinator section: the same way of working, but in its own
 * workspace, without a user waiting on its turns, sharing the board with main and the other threads, and ending with
 * a summary. Its identity, workspace and brief come with its own instructions (`threads.ts`).
 */
export function threadCoordinatorSection(project: Project): string {
	const checkIns = checkInsParagraph(project);
	return `You are a background thread of the project "${project.name}": a coordinator like main (the thread the user talks to), working on one big piece of work on your own. Main started you with a brief. Nobody waits on your turns, so keep going until the work is done, then end with thread_finish.

Never block a turn on a wait or a poll — not a sleep, not a loop of status checks. Delegate anything long (a CI watch, a long build or test run, any kind of wait) to a worker with worker_spawn and end your turn: its report arrives as a message and wakes you.

You never work in the project checkout at ${project.path}: that is main's. You have your own workspace (your instructions name it), and your workers work there or in workspaces of their own.

Work like this:
1. You were started for one board task, which you hold and which your instructions name; the user reads that task, not this conversation. Put each piece of the work on the project's board with the \`board\` tool. The board is shared with main and the other threads: claim a task (action \`claim\`) before you or your workers work on it, never work on a task another thread holds, and release or hand over (\`handoff\`) what you stop working on.
2. Delegate each independent piece with worker_spawn: a self-contained brief (goal, files, constraints, how to verify), a title, and the task's ID as taskId. The harness writes Now automatically. Pick isolation per worker: "shared" runs it in your own workspace; "workspace" gives it a jj workspace of its own (needs a jj repository).
3. Reports arrive as messages starting with "[worker <id> reported]" or "[worker <id> failed: ...]". Only that report reaches you, never the worker's transcript.
4. Review a report, then inspect the result yourself. Verification has diminishing returns: verify what a task's acceptance asks for, then stop. Do not re-check what is already shown. Merge an isolated worker's change into your workspace, for example \`jj squash --from <change> --into @\` or \`jj rebase -s <change> -d @\`; hand a conflict to a new worker.
5. Release a worker whose work is merged with worker_forget; worker_send gives a live worker more work (pass a new title when it is a new task), worker_stop aborts what it does, worker_list and worker_peek show your workers.

${WORKER_MESSAGE_RULES}

Report on the task you were started for as you go.

${REPORT_RULES}

When only the user can decide something, ask it on the board (action \`ask\`) and carry on with the rest; never stop to wait for the answer, which arrives as a "[board]" message. Messages from main or another thread arrive as "[from <thread>] ..."; answer with thread_send (reply: true) when one asks you something, and keep messages to requests and hand-overs.

${uiProofParagraph(project, "coordinator")}${checkIns}

${CODEMODE_GUIDANCE} Scripts cannot start, message, stop or forget a worker — only you can, directly.

${WRITING_RULE}

When the work is done, or cannot go on, call thread_finish with a summary for main: the outcome, where the work is (workspace, change IDs, branches, pull requests), open issues and anything the user must decide. The summary is all main sees of your work, so make it complete.`;
}

/** What a worker is told when it is created; it replaces the coordinator's instructions. */
export function workerInstructions(options: {
	id: string;
	title: string;
	project: Project;
	cwd: string;
	isolation: WorkerIsolation;
	/** The background thread that started it; absent (or "main") for main's workers. */
	threadId?: string;
	/** The board task it was started for; it gets `task_progress` to keep that task's report current. */
	taskId?: string | null;
}): string {
	const { id, title, project, cwd, isolation } = options;
	const task =
		options.taskId === undefined || options.taskId === null
			? ""
			: `\n\nYou were started for the board task ${options.taskId}. The user reads that task, not this conversation. Keep its report current with task_progress: Now is written automatically. Use optional \`now\` only for a few-word phase when the phase really changes, not a running commentary; \`addResult\` adds one finished thing with its evidence (commit, artifact, test run); pass a \`milestone\` (a few words) only when something meaningful just happened. Terse plain English, nothing made up. A question or a warning for the user is not report text: put it in your final report and the coordinator puts it on the board.`;
	const thread = options.threadId === undefined || options.threadId === "main" ? undefined : options.threadId;
	const shared =
		thread === undefined
			? `You work directly in the project's checkout at ${cwd}, shared with the coordinator. Commit, rebase, squash or rewrite history whenever your brief asks for it, with the care you would take in your own checkout; when it does not, leave your changes in the working copy and say so in your report.`
			: `You work directly in the workspace of the background thread "${thread}" at ${cwd}, shared with that thread, which is your coordinator. Never edit the project's own checkout at ${project.path}. Commit, rebase, squash or rewrite history whenever your brief asks for it; when it does not, leave your changes in the working copy and say so in your report.`;
	const workspace =
		isolation === "workspace"
			? `You work in your own jj workspace at ${cwd}, a checkout of the same repository as ${project.path}. Your edits stay out of the project until the coordinator merges them. Commit your work before you answer: \`jj commit -m "<summary>"\`, then read the change ID with \`jj log --no-graph -r @- -T change_id\`.`
			: shared;
	return `You are the worker "${id}" of the project "${project.name}", working on: ${title}

${workspace}
Add an \`Kemiri-Task: T…\` trailer to commit descriptions.

The coordinator sent you one brief. Do it, then answer with a report. Verification has diminishing returns: check what the brief asks for, then stop and report. You cannot start workers and nobody is waiting on your intermediate steps; do not ask questions you can answer yourself. If you are blocked, say what is missing.${task}

Read files with the read tool, not a bash \`cat\` chain: a \`&&\` chain whose last command fails turns the whole call red even though the useful output already printed. When an AGENTS.md or CLAUDE.md names another path, resolve it against that file's own folder, not the project root. \`grep\`/\`rg\` exit 1 when nothing matches and 2 when a path is missing, so never end an inspection chain with a command that can fail, and never add \`|| true\` to quiet one.

${uiProofParagraph(project, "worker")}${CODEMODE_GUIDANCE}

${WRITING_RULE}

If a queued message asks for something you already did and have reported, and you have no new result, warning or question, answer with exactly one line: ${NO_NEW_WORKER_REPORT} Do not repeat the full report or do more checks. This line is recorded without waking the coordinator. Otherwise, end your answer with this report and nothing after it:

## Report
Outcome: done | blocked | needs a decision
Files changed: <paths, or "none">
Change: <jj change ID, or "working copy" for a shared checkout>
Open issues: <none, or what the coordinator must decide>
Worth remembering: <durable facts about this project, or "none">`;
}

// --- what a worker is doing right now --------------------------------------------------------------------------

/** How many transcript entries a peek shows by default, and how much of each line. */
export const PEEK_DEFAULT_ENTRIES = 8;
export const PEEK_LINE_CHARS = 140;
export const PEEK_MAX_CHARS = 2_400;
/** A check-in covers every running worker, so each gets less room than a deliberate peek, and the whole is capped. */
export const CHECK_IN_ENTRIES = 4;
export const CHECK_IN_LINE_CHARS = 110;
export const CHECK_IN_MAX_CHARS = 1_200;
export const CHECK_IN_TOTAL_CHARS = 4_000;

/** What closes every check-in: whether the rest of the work is still worth it, not only whether it progresses. */
export const CHECK_IN_WORTH_QUESTION =
	"Weigh what the remaining work would still add against what is already achieved. Stop or narrow a worker whose work is now mostly polishing or re-verifying. If you cannot judge whether going on is worth it, ask the user with a board question (action `ask`) instead of carrying on.";

/** A check-in: the header, the digests cut to fit `CHECK_IN_TOTAL_CHARS`, and the closing lines, never cut. */
function checkInText(header: readonly string[], body: string, closing: readonly string[]): string {
	const head = [...header, ""].join("\n");
	const tail = closing.length === 0 ? "" : `\n\n${closing.join("\n")}`;
	const room = Math.max(0, CHECK_IN_TOTAL_CHARS - head.length - tail.length);
	return `${head}${body.length <= room ? body : `${body.slice(0, Math.max(0, room - 1))}…`}${tail}`;
}

/** How long a worker's board task has been in progress, as a digest line; undefined without a task. */
export function workerTaskTime(board: BoardState, record: WorkerRecord, now: number): string | undefined {
	const taskId = record.taskId ?? null;
	const task = taskId === null ? undefined : board.tasks.find((candidate) => candidate.id === taskId);
	if (task === undefined) return undefined;
	const minutes = inProgressMinutes(board, task.id, now);
	return `task ${task.id}: ${taskTime(minutes === undefined ? {} : { inProgressMinutes: minutes }) ?? "no time recorded"}`;
}

/** Compact, whitespace-collapsed, cut at `limit` characters. */
export function excerpt(text: string, limit: number): string {
	const single = text.replace(/\s+/g, " ").trim();
	return single.length <= limit ? single : `${single.slice(0, limit - 1)}…`;
}

/** "45s", "6m 12s", "1h 4m". */
export function formatDuration(ms: number): string {
	const seconds = Math.max(0, Math.round(ms / 1000));
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
	const hours = Math.floor(minutes / 60);
	return `${hours}h ${minutes % 60}m`;
}

export function textOfContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((part) => {
			if (typeof part !== "object" || part === null) return "";
			const block = part as { type?: string; text?: string };
			return block.type === "text" ? (block.text ?? "") : "";
		})
		.join("");
}

/** One line per thing the worker did: its messages, its tool calls and their results. */
export function entryLines(entry: EntryRecord, limit: number): string[] {
	const lines: string[] = [];
	for (const message of entry.model ?? []) {
		const record = message as { role?: string; content?: unknown; toolName?: string; isError?: boolean };
		if (record.role === "assistant") {
			for (const part of Array.isArray(record.content) ? record.content : []) {
				const block = part as { type?: string; text?: string; thinking?: string; name?: string; arguments?: unknown };
				if (block.type === "text" && (block.text ?? "").trim().length > 0) {
					lines.push(`text: ${excerpt(block.text ?? "", limit)}`);
				} else if (block.type === "thinking" && (block.thinking ?? "").trim().length > 0) {
					lines.push(`thinking: ${excerpt(block.thinking ?? "", limit)}`);
				} else if (block.type === "toolCall") {
					const args = JSON.stringify(block.arguments ?? {});
					lines.push(`call ${block.name ?? "?"} ${excerpt(args, limit)}`);
				}
			}
		} else if (record.role === "toolResult") {
			const failed = record.isError === true ? " (error)" : "";
			const name = typeof record.toolName === "string" && record.toolName.length > 0 ? ` ${record.toolName}` : "";
			lines.push(`result${name}${failed}: ${excerpt(textOfContent(record.content), limit)}`);
		} else if (record.role === "user") {
			lines.push(`you: ${excerpt(textOfContent(record.content), limit)}`);
		}
	}
	return lines;
}

/** What the worker is producing right now: the partial answer and the tool calls still running. */
export function liveLines(live: LiveState | undefined, limit: number): string[] {
	if (live === undefined) return [];
	const lines: string[] = [];
	const partial = live.generation?.message as { content?: unknown } | undefined;
	if (partial !== undefined) {
		for (const part of Array.isArray(partial.content) ? partial.content : []) {
			const block = part as { type?: string; text?: string; thinking?: string; name?: string; arguments?: unknown };
			if (block.type === "text" && (block.text ?? "").trim().length > 0) {
				lines.push(`writing: ${excerpt(block.text ?? "", limit)}`);
			} else if (block.type === "thinking" && (block.thinking ?? "").trim().length > 0) {
				lines.push(`thinking: ${excerpt(block.thinking ?? "", limit)}`);
			} else if (block.type === "toolCall") {
				lines.push(`call ${block.name ?? "?"} ${excerpt(JSON.stringify(block.arguments ?? {}), limit)}`);
			}
		}
	}
	for (const slot of live.tools ?? []) {
		if (slot.status === "done") continue;
		const output = excerpt(slot.output ?? "", Math.floor(limit / 2));
		lines.push(`now ${slot.name} (${slot.status})${output.length === 0 ? "" : `: ${output}`}`);
	}
	for (const nested of live.nestedTools ?? []) {
		if (nested.status === "done") continue;
		lines.push(`now ${nested.name} (${nested.status})${nested.summary?.error === undefined ? "" : `: ${nested.summary.error}`}`);
	}
	return lines;
}

/** The newest timestamp the worker produced anything at, from its transcript. */
export function lastActivityAt(entries: readonly EntryRecord[], live: LiveState | undefined): number | undefined {
	let newest: number | undefined;
	const consider = (value: unknown): void => {
		if (typeof value === "number" && Number.isFinite(value)) newest = newest === undefined ? value : Math.max(newest, value);
	};
	for (const entry of entries) {
		for (const message of entry.model ?? []) consider((message as { timestamp?: number }).timestamp);
	}
	if (live?.generation?.message !== undefined) {
		consider((live.generation.message as { timestamp?: number }).timestamp);
	}
	return newest;
}

/**
 * A cheap description of one worker: status, how long since it last produced anything, and the tail of what it did.
 * Shared by `worker_peek` and the periodic check-ins, which only differ in how much they show.
 */
export function describeWorkerActivity(options: {
	record: WorkerRecord;
	entries: readonly EntryRecord[];
	live: LiveState | undefined;
	now: number;
	lines: number;
	lineChars: number;
	maxChars: number;
}): string {
	const { record, entries, live, now, lines, lineChars, maxChars } = options;
	const running = live?.run !== undefined;
	const activity = [...entries].reverse().flatMap((entry) => entryLines(entry, lineChars));
	const current = liveLines(live, lineChars);
	const recent = [...activity, ...current].slice(-lines);
	const last = lastActivityAt(entries, live);

	const header = `${record.id} — ${record.title}`;
	const state =
		record.status === "running"
			? running
				? "running, a run is in progress"
				: "running, no model request in flight yet"
			: describeStatus(record);
	const since = last === undefined ? "nothing yet" : `${formatDuration(now - last)} ago`;
	const model = `${record.model.provider}/${record.model.modelId}${record.thinkingLevel === null ? "" : ` (thinking ${record.thinkingLevel})`}`;
	const place = record.isolation === "workspace" ? `workspace ${record.workspacePath ?? "(removed)"}` : "shared checkout";

	const body = [
		header,
		`status: ${state}; last activity ${since}`,
		`model: ${model}; isolation: ${place}`,
	];
	if (recent.length > 0) {
		body.push("activity:");
		for (const line of recent) body.push(`  ${line}`);
	} else {
		body.push("activity: none yet");
	}
	if (!running && record.status !== "running" && record.lastReport !== null) {
		body.push(`last report: ${excerpt(record.lastReport, Math.min(240, lineChars * 2))}`);
	}

	let text = body.join("\n");
	if (text.length > maxChars) text = `${text.slice(0, maxChars - 1)}…`;
	return text;
}

// --- periodic check-ins -----------------------------------------------------------------------------------------

/** The live timer of one project: its state is the phase it waits in, and the check-in it is due to send. */
type CheckInState = { phase: "wait" } | { phase: "send"; due: number };

/**
 * Wakes the coordinator while a worker runs, so it can judge whether the worker is stuck or on a wrong path.
 *
 * The wait is a durable sleep (`sleepUntil`), not a process timer: it survives a restart, and a process that was off
 * when the deadline passed resumes it on open. The check-in is submitted with a request ID derived from this task and
 * the deadline, so a rerun after a crash finds the same input instead of sending a second one. The next deadline is
 * computed when the next wait starts, so a long pause cannot cause a burst of catch-up check-ins.
 */
function createCheckInTask(service: WorkerService): Task<null, CheckInState, null, object> {
	const retire = async (
		taskId: number,
		runtime: TaskRuntime<null, CheckInState, null, object>,
		context: Context,
	): Promise<void> => {
		await runtime.commit(async (tx) => {
			const doc = await tx.doc(WorkersDoc, runtime.conversationId);
			if (doc.checkInTaskId === taskId) doc.checkInTaskId = null;
			return { status: "terminal", outcome: { status: "completed", result: null } };
		}, context);
	};

	return defineTask<null, CheckInState, null>({
		name: stateKind("worker-checkin"),
		version: 1,
		initial: () => ({ phase: "wait" }),
		phases: {
			wait: async (task, runtime, context) => {
				const settings = service.project.checkIns;
				const running = await service.runningWorkers(context, runtime.conversationId);
				const threads = await service.runningThreads(runtime.conversationId, context);
				if (!settings.enabled || running.length + threads === 0) {
					await retire(task.id, runtime, context);
					return;
				}
				const due = runtime.now() + settings.intervalMinutes * 60_000;
				await runtime.sleepUntil(due, { phase: "send", due }, context);
			},
			send: async (task, runtime, context) => {
				const settings = service.project.checkIns;
				const running = await service.runningWorkers(context, runtime.conversationId);
				const threads = await service.runningThreads(runtime.conversationId, context);
				if (!settings.enabled || running.length + threads === 0) {
					await retire(task.id, runtime, context);
					return;
				}

				// One queued check-in is enough: a coordinator that is busy gets the next one at the next interval.
				const live = await runtime.snapshot(LiveDoc, runtime.conversationId, context);
				const inbox = await runtime.snapshot(InboxDoc, runtime.conversationId, context);
				const queued = (inbox?.items ?? []).some(
					(item) =>
						item.mode !== "write" &&
						textOfContent((item as { content?: unknown }).content).startsWith(CHECK_IN_PREFIX),
				);
				if (!(live?.run !== undefined && queued)) {
					const text = await service.checkInMessage(running, runtime.now(), context, runtime.conversationId);
					const coordinator = await runtime.conversation(runtime.conversationId, context);
					await coordinator?.submit(
						{
							type: "input",
							content: text,
							// Never interrupt a run: the check-in is handled at the next turn boundary instead.
							whenBusy: "followUp",
							requestId: `worker-checkin:${task.id}:${task.state.checkpoint.due}`,
						},
						context,
					);
				}
				await runtime.commit(() => ({ status: "running", checkpoint: { phase: "wait" } }), context);
			},
		},
		abort: async (task, runtime, context) => {
			await retire(task.id, runtime, context);
		},
	});
}

// --- the service -------------------------------------------------------------------------------------------------

export type WorkerServiceOptions = {
	/** Read at each use, so a reconfiguration of the project applies to the next worker. */
	project(): Project;
	harness: Harness;
	/** The projects' model catalog, for resolving a worker's model before its conversation exists. */
	models: Models;
	/** The coordinator conversation; its ID owns the workers document. */
	coordinator: Conversation;
	/**
	 * Every coordinator conversation of the project and where its workers work; default: main only, with
	 * `workspacesDir` for its workspaces.
	 */
	coordinators?: Coordinators;
	/** Directory for worker workspaces, inside the project's data directory and outside the repository. */
	workspacesDir: string;
	/** Records base/tip provenance before workspace cleanup. */
	taskChanges?: Pick<TaskChangeObserver, "rememberWorkspace" | "recordWorkspace" | "forgetWorkspace">;
	/**
	 * Extensions a worker removes besides the worker tools: the coordinator's memory, compaction, history and schedule
	 * tools, which workers never get. A function when one of them is built after this service (the schedule tools need
	 * it): it is read at each spawn.
	 */
	removedExtensions?: readonly Extension[] | (() => readonly Extension[]);
	/** Told when a worker reports or fails, so the user's devices hear about it. Never waited for, never thrown at. */
	notifications?: Notifier;
	log(message: string): void;
};

/** One scheduled run, as the harness starts it: the schedule's brief, model, thinking level and isolation. */
export type ScheduledRunInput = {
	scheduleId: string;
	title: string;
	brief: string;
	/** Null resolves like any worker: the composer's pick, then the project's worker models. */
	model: ModelRef | null;
	thinkingLevel: ThinkingLevel | null;
	isolation: WorkerIsolation;
	onReport: ScheduleOnReport;
	/** When the run is due. The worker ID and every request ID derive from it, so a retry cannot double-start it. */
	at: number;
	/** The backend's timezone, for the `<yyyy-mm-dd-hhmm>` in the worker's ID. */
	timezone: string;
	/**
	 * An event run (a schedule that fires on an event, not a clock): its own worker ID and request-ID key, derived from
	 * the schedule, the event and its time, and the board task it works on. Without it the ID comes from `at`.
	 */
	event?: { id: string; key: string; taskId: string };
	/** A clock run: the schedule's one board task, which the worker works on like one it was spawned for. */
	taskId?: string;
};

/** What main's check-ins say about its running background threads; attached by `ThreadService`. */
export type ThreadCheckIns = {
	/** How many background threads run now. */
	running(context: Context): Promise<number>;
	/** One digest per running background thread, each within `maxChars`. */
	digests(now: number, maxChars: number, context: Context): Promise<string[]>;
};

export type ScheduledRunResult =
	| { ok: true; workerId: string; conversationId: number }
	| { ok: false; message: string };

/** What a worker's creation commit needs, shared by the coordinator's `worker_spawn` and the schedule clock. */
type CreateWorkerInput = {
	id: string;
	title: string;
	task: string;
	model: ModelRef;
	thinkingLevel: ThinkingLevel | null;
	isolation: WorkerIsolation;
	workspace: string | null;
	scheduleId: string | null;
	/** The board task this worker runs: it moves to in_progress in the same commit. */
	taskId: string | null;
	spawnedByCallId: string | null;
	callId: string;
	followUp: boolean;
	/** Whether this start has to arm the check-in timer. */
	checkIn: boolean;
	schedule: { id: string; title?: string; onReport: ScheduleOnReport; isolation: WorkerIsolation } | undefined;
};

/**
 * One project's workers: the durable list, the model defaults, workspace bookkeeping and the tools the coordinator calls.
 */
export class WorkerService {
	readonly #options: WorkerServiceOptions;
	#reportAdmission: Promise<unknown> = Promise.resolve();

	readonly #coordinators: Coordinators;
	#extension: Extension | undefined;
	#taskExtension: Extension | undefined;
	#checkInTask: Task<null, CheckInState, null, object> | undefined;
	#reporterTask: Task<ReporterInput, ReporterState, null, object> | undefined;
	#threadCheckIns: ThreadCheckIns | undefined;

	constructor(options: WorkerServiceOptions) {
		this.#options = options;
		this.#coordinators =
			options.coordinators ??
			new Coordinators({
				harness: options.harness,
				main: options.coordinator,
				checkout: () => options.project().path,
				workspacesDir: options.workspacesDir,
			});
	}

	/** Serialize only admission and release, never a worker's answer or workspace cleanup. */
	withReportAdmission<T>(work: () => Promise<T>): Promise<T> {
		const result = this.#reportAdmission.then(work);
		this.#reportAdmission = result.catch(() => undefined);
		return result;
	}

	/** Main and its background threads: who may drive workers, and where each one's workers work. */
	get coordinators(): Coordinators {
		return this.#coordinators;
	}

	get mainId(): number {
		return this.#options.coordinator.id;
	}

	/** Let main's check-ins cover its background threads too. */
	attachThreadCheckIns(threads: ThreadCheckIns): void {
		this.#threadCheckIns = threads;
	}

	/** Background threads running now, which main's check-ins also cover; none for a background thread's own. */
	async runningThreads(conversationId: number, context: Context = BACKGROUND_CONTEXT): Promise<number> {
		if (!this.#coordinators.isMain(conversationId) || this.#threadCheckIns === undefined) return 0;
		return this.#threadCheckIns.running(context);
	}

	/** Where a coordinator's workers work; undefined for anything that is not a coordinator. */
	placeOf(conversationId: number): CoordinatorPlace | undefined {
		return this.#coordinators.placeOf(conversationId);
	}

	get harness(): Harness {
		return this.#options.harness;
	}

	get coordinator(): Conversation {
		return this.#options.coordinator;
	}

	get project(): Project {
		return this.#options.project();
	}

	/** Extensions a worker removes besides the worker tools; empty when the service was built without any. */
	get removedExtensions(): readonly Extension[] {
		const value = this.#options.removedExtensions;
		if (value === undefined) return [];
		return typeof value === "function" ? value() : value;
	}

	/** The extension the coordinator selects and workers remove: the tools, their tasks and the coordinator prompt. */
	get extension(): Extension {
		this.#extension ??= createWorkerExtension(this);
		return this.#extension;
	}

	/**
	 * The extension a worker spawned for a board task keeps: `task_progress`, to keep that task's report current. The
	 * coordinators and the workers without a task remove it.
	 */
	get taskExtension(): Extension {
		this.#taskExtension ??= createWorkerTaskExtension(this);
		return this.#taskExtension;
	}

	/** The worker a conversation is, with the thread whose worker it is; undefined for a coordinator. */
	async workerOf(conversationId: number, context: Context = BACKGROUND_CONTEXT): Promise<{ record: WorkerRecord; threadId: string } | undefined> {
		for (const place of this.#coordinators.places()) {
			const state = await this.state(context, place.conversationId);
			const record = Object.values(state.workers).find((candidate) => candidate.conversationId === conversationId);
			if (record !== undefined) return { record, threadId: place.threadId };
		}
		return undefined;
	}

	/** One definition per project, registered in its extension and created by `startCheckIn`. */
	get checkInTask(): Task<null, CheckInState, null, object> {
		this.#checkInTask ??= createCheckInTask(this);
		return this.#checkInTask;
	}

	/** One definition per project, registered in its extension and created for every message to a worker. */
	get reporterTask(): Task<ReporterInput, ReporterState, null, object> {
		this.#reporterTask ??= createWorkerReporter(this);
		return this.#reporterTask;
	}

	/** One coordinator's workers (main's by default); the model defaults are only ever read from main's. */
	async state(context: Context = BACKGROUND_CONTEXT, conversationId: number = this.coordinator.id): Promise<WorkersState> {
		const state = await this.harness.snapshot(WorkersDoc, conversationId as ConversationId, context);
		return state === undefined ? emptyWorkersState() : (state as WorkersState);
	}

	/** The project's worker model defaults, kept on main's list. */
	async defaults(context: Context = BACKGROUND_CONTEXT): Promise<WorkerDefaults> {
		return defaultsOf(await this.state(context));
	}

	/** Every thread's workers, each with its `threadId`, main's first; or one thread's when `threadId` is given. */
	async list(threadId?: string): Promise<{ workers: WorkerSummary[]; defaults: WorkerDefaults }> {
		const places = this.#coordinators.places().filter((place) => threadId === undefined || place.threadId === threadId);
		const workers: WorkerSummary[] = [];
		for (const place of places) {
			workers.push(...summariesOf(await this.state(BACKGROUND_CONTEXT, place.conversationId), place.threadId));
		}
		return { workers, defaults: await this.defaults() };
	}

	/** Create the document if this project never had one, so a change watch can attach to it. */
	async ensureDocument(): Promise<void> {
		await this.harness.commit((tx) => tx.doc(WorkersDoc, this.coordinator.id), BACKGROUND_CONTEXT);
	}

	/**
	 * Push every thread's workers (and main's defaults) whenever any thread's list changes, including the list of a
	 * thread started later. Resolves to a stop function.
	 */
	async watch(onChange: (workers: WorkerSummary[], defaults: WorkerDefaults) => void): Promise<() => Promise<void>> {
		const lists = new Map<string, WorkerSummary[]>();
		let defaults: WorkerDefaults = { model: null, thinkingLevel: null };
		const stops: (() => Promise<void>)[] = [];
		let stopped = false;
		let current = "";
		const publish = (): void => {
			const workers = this.#coordinators.places().flatMap((place) => lists.get(place.threadId) ?? []);
			const encoded = JSON.stringify({ workers, defaults });
			if (encoded === current) return;
			current = encoded;
			onChange(workers, defaults);
		};
		const follow = async (place: CoordinatorPlace): Promise<void> => {
			const main = this.#coordinators.isMain(place.conversationId);
			if (!main) {
				// A thread's list exists from its first worker on; create it so the watch can attach now.
				await this.harness.commit((tx) => tx.doc(WorkersDoc, place.conversationId as ConversationId), BACKGROUND_CONTEXT);
			}
			const watch = await this.harness.watchDoc(WorkersDoc, place.conversationId as ConversationId, BACKGROUND_CONTEXT);
			if (watch === undefined) return;
			if (stopped) {
				await watch.stop().catch(() => undefined);
				return;
			}
			stops.push(async () => {
				await watch.stop().catch(() => undefined);
			});
			const take = (state: WorkersState | Readonly<WorkersState> | null): void => {
				lists.set(place.threadId, summariesOf(state ?? undefined, place.threadId));
				if (main) defaults = defaultsOf(state ?? undefined);
				publish();
			};
			take(watch.value);
			watch.start(async (call) => {
				if (call.kind === "failed") throw call.error;
				const value = call.value;
				take(value);
			});
		};
		for (const place of this.#coordinators.places()) await follow(place);
		const unsubscribe = this.#coordinators.onAdded((place) => {
			void follow(place).catch((error: unknown) => {
				this.log(`worker watch for thread ${place.threadId} failed: ${errorMessage(error)}`);
			});
		});
		return async () => {
			stopped = true;
			unsubscribe();
			for (const stop of stops.splice(0)) await stop();
		};
	}

	/** Record the worker model the user picked with a message; the next worker starts with it. */
	async rememberDefaults(change: { model?: ModelRef | null; thinkingLevel?: ThinkingLevel | null }): Promise<void> {
		if (change.model === undefined && change.thinkingLevel === undefined) return;
		await this.harness.commit(async (tx) => {
			const state = await tx.doc(WorkersDoc, this.coordinator.id);
			if (change.model !== undefined) state.defaults.model = change.model;
			if (change.thinkingLevel !== undefined) state.defaults.thinkingLevel = change.thinkingLevel;
		}, BACKGROUND_CONTEXT);
	}

	/**
	 * Set the model the project's workers start from, as if the user had picked it with a message. Replaces both fields,
	 * so a null clears one; the worker-list watch pushes the new defaults to every connection.
	 */
	async setDefaults(defaults: WorkerDefaults): Promise<WorkerDefaults> {
		await this.harness.commit(async (tx) => {
			const state = await tx.doc(WorkersDoc, this.coordinator.id);
			state.defaults.model = defaults.model;
			state.defaults.thinkingLevel = defaults.thinkingLevel;
		}, BACKGROUND_CONTEXT);
		return (await this.list()).defaults;
	}

	/** A worker's conversation ID from the durable list of its thread (main's by default). */
	async conversationId(workerId: string, conversationId: number = this.coordinator.id): Promise<number | undefined> {
		const record = (await this.state(BACKGROUND_CONTEXT, conversationId)).workers[workerId];
		return record?.conversationId;
	}

	/** The worker's conversation, for read-only watch and page; undefined when it is unknown in that thread. */
	async conversation(workerId: string, conversationId: number = this.coordinator.id): Promise<Conversation | undefined> {
		const record = (await this.state(BACKGROUND_CONTEXT, conversationId)).workers[workerId];
		if (record === undefined) return undefined;
		return this.harness.conversation(record.conversationId as ConversationId, BACKGROUND_CONTEXT);
	}

	/** Whether a tool call comes from a conversation that may drive workers: main or one of its background threads. */
	isCoordinator(conversationId: number): boolean {
		return this.#coordinators.isCoordinator(conversationId);
	}

	/**
	 * Tell the devices what became of a worker: a report, a failure, or — for a run a schedule started — that the
	 * scheduled task finished or could not. A stop is the coordinator's own doing and notifies nobody.
	 */
	notifyWorkerReport(input: {
		workerId: string;
		callId: string;
		text: string | null;
		status: WorkerStatus;
		failure: string | null;
		schedule?: { id: string; title?: string };
		/** The thread that owns the worker; main's workers notify as before. */
		threadId?: string;
	}): void {
		const notifications = this.#options.notifications;
		if (notifications === undefined) return;
		const project = this.project;
		if (input.schedule !== undefined) {
			const scheduleTitle = input.schedule.title ?? input.schedule.id;
			if (input.text !== null) {
				notifications.notify(
					scheduleDoneNotification({
						projectId: project.id,
						projectName: project.name,
						scheduleId: input.schedule.id,
						scheduleTitle,
						workerId: input.workerId,
						callId: input.callId,
						text: input.text,
					}),
				);
			} else if (input.failure !== null) {
				notifications.notify(
					scheduleFailureNotification({
						projectId: project.id,
						projectName: project.name,
						scheduleId: input.schedule.id,
						scheduleTitle,
						workerId: input.workerId,
						callId: input.callId,
						failure: input.failure,
					}),
				);
			}
			return;
		}
		if (input.text !== null) {
			notifications.notify(
				workerNotification({
					projectId: project.id,
					projectName: project.name,
					workerId: input.workerId,
					callId: input.callId,
					kind: "worker_report",
					text: input.text,
					failure: null,
					...(input.threadId === undefined ? {} : { threadId: input.threadId }),
				}),
			);
			return;
		}
		if (input.failure !== null) {
			notifications.notify(
				workerNotification({
					projectId: project.id,
					projectName: project.name,
					workerId: input.workerId,
					callId: input.callId,
					kind: "worker_failed",
					text: null,
					failure: input.failure,
					...(input.threadId === undefined ? {} : { threadId: input.threadId }),
				}),
			);
		}
	}

	/** What a worker tool answers when it runs anywhere else, which only a deliberate misconfiguration reaches. */
	notCoordinatorMessage(tool: string): string {
		return `${tool} answers only the project's coordinator conversation, never a worker. A worker reports what it needs to the coordinator and lets it decide; it does not start, message, stop or forget workers.`;
	}

	/** Workers the list still counts as running: the check-ins only cover these. */
	async runningWorkers(
		context: Context = BACKGROUND_CONTEXT,
		conversationId: number = this.coordinator.id,
	): Promise<WorkerRecord[]> {
		const state = await this.state(context, conversationId);
		return Object.values(state.workers).filter((record) => record.status === "running");
	}

	/**
	 * What a worker is doing right now: its status, how long since it last produced anything, and the tail of its
	 * transcript. `worker_peek` and the check-ins share it; only the budget differs.
	 */
	async describe(
		record: WorkerRecord,
		now: number,
		budget: { lines: number; lineChars: number; maxChars: number; entries: number },
		context: Context = BACKGROUND_CONTEXT,
	): Promise<string> {
		const conversationId = record.conversationId as ConversationId;
		const live = await this.harness.snapshot(LiveDoc, conversationId, context);
		const conversation = await this.harness.conversation(conversationId, context);
		// Ask for more entries than the digest shows: one entry can hold a text, a thinking block and several calls.
		const page = await conversation?.entries(
			{ order: "descending" },
			Math.max(budget.entries * 3, 12),
			undefined,
			context,
		);
		return describeWorkerActivity({
			record,
			entries: page?.items ?? [],
			live,
			now,
			lines: budget.lines,
			lineChars: budget.lineChars,
			maxChars: budget.maxChars,
		});
	}

	/** A peek at one worker, or undefined when its ID is unknown. */
	async peek(
		workerId: string,
		now: number,
		entries: number = PEEK_DEFAULT_ENTRIES,
		context: Context = BACKGROUND_CONTEXT,
		conversationId: number = this.coordinator.id,
	): Promise<{ text: string; conversationId: number; running: boolean } | undefined> {
		const record = (await this.state(context, conversationId)).workers[workerId];
		if (record === undefined) return undefined;
		const text = await this.describe(
			record,
			now,
			{
				lines: Math.max(entries, 4),
				lineChars: PEEK_LINE_CHARS,
				maxChars: PEEK_MAX_CHARS,
				entries,
			},
			context,
		);
		return { text, conversationId: record.conversationId, running: record.status === "running" };
	}

	/** The input the coordinator is woken with while workers run. */
	async checkInMessage(
		running: readonly WorkerRecord[],
		now: number,
		context: Context = BACKGROUND_CONTEXT,
		conversationId: number = this.coordinator.id,
	): Promise<string> {
		const threads = await this.runningThreads(conversationId, context);
		// More workers running means less room each, so one check-in stays inexpensive.
		const covered = running.length + threads;
		const budget = Math.max(600, Math.min(CHECK_IN_MAX_CHARS, Math.floor(CHECK_IN_TOTAL_CHARS / Math.max(1, covered))));
		const threadDigests = threads > 0 ? ((await this.#threadCheckIns?.digests(now, budget, context)) ?? []) : [];
		if (threadDigests.length > 0) return this.#checkInWithThreads(running, threadDigests, now, budget, context);
		const { digests, question } = await this.#workerDigests(running, now, budget, context);
		const count = running.length === 1 ? "1 worker is" : `${running.length} workers are`;
		const header = [
			CHECK_IN_PREFIX,
			`${count} still running. Decide whether any is stuck or on a wrong path: steer it with worker_send (interrupt: true), stop it with worker_stop, or say nothing when it is making progress. Do not answer just to acknowledge.`,
		];
		return checkInText(header, digests.join("\n\n"), [question, ...this.#diskLines(conversationId)]);
	}

	/** Each running worker's digest, with how long its task has been in progress, and the question that closes the check-in. */
	async #workerDigests(
		running: readonly WorkerRecord[],
		now: number,
		budget: number,
		context: Context,
	): Promise<{ digests: string[]; question: string }> {
		const withTask = running.some((record) => (record.taskId ?? null) !== null);
		const board = withTask ? await this.harness.snapshot(BoardDoc, this.mainId as ConversationId, context) : undefined;
		const digests: string[] = [];
		for (const record of running) {
			const digest = await this.describe(
				record,
				now,
				{ lines: CHECK_IN_ENTRIES, lineChars: CHECK_IN_LINE_CHARS, maxChars: budget, entries: CHECK_IN_ENTRIES },
				context,
			);
			const time = board === undefined ? undefined : workerTaskTime(board, record, now);
			digests.push(time === undefined ? digest : `${digest}\n${time}`);
		}
		return { digests, question: CHECK_IN_WORTH_QUESTION };
	}

	/** Main's check-ins carry one line per low disk; set by the server. */
	diskWarnings: (() => string[]) | undefined;

	#diskLines(conversationId: number): string[] {
		return this.#coordinators.isMain(conversationId) ? (this.diskWarnings?.() ?? []) : [];
	}

	/** Main's check-in while background threads run too: their digests after the workers'. */
	async #checkInWithThreads(
		running: readonly WorkerRecord[],
		threadDigests: readonly string[],
		now: number,
		budget: number,
		context: Context,
	): Promise<string> {
		const { digests, question } = await this.#workerDigests(running, now, budget, context);
		const workers = running.length === 0 ? "" : running.length === 1 ? "1 worker and " : `${running.length} workers and `;
		const threads = threadDigests.length === 1 ? "1 background thread" : `${threadDigests.length} background threads`;
		const verb = running.length + threadDigests.length === 1 ? "is" : "are";
		const header = [
			CHECK_IN_PREFIX,
			`${workers}${threads} ${verb} still running. Decide whether any is stuck or on a wrong path: steer a worker with worker_send (interrupt: true) or stop it with worker_stop; steer a thread with thread_send or stop it with thread_stop; say nothing when it is making progress. Do not answer just to acknowledge.`,
		];
		const body = [...digests, ...threadDigests.map((digest) => `thread ${digest}`)].join("\n\n");
		return checkInText(header, body, [question, ...this.#diskLines(this.mainId)]);
	}

	/**
	 * Whether a worker start has to start the check-in timer: none recorded, or the recorded one is gone or terminal.
	 * Read outside the commit, because a transaction may not read tables after its first write.
	 */
	async checkInNeeded(context: Context = BACKGROUND_CONTEXT, conversationId: number = this.coordinator.id): Promise<boolean> {
		const id = (await this.state(context, conversationId)).checkInTaskId;
		if (id === null) return true;
		const task = await this.harness.getTask(id as TaskId, context);
		return task === undefined || task.state.status === "terminal";
	}

	/** Create the check-in timer in the spawn or send commit, unless a concurrent one already recorded itself. */
	async startCheckIn(tx: Tx, doc: WorkersState, conversationId: number, needed: boolean): Promise<void> {
		if (!needed || doc.checkInTaskId !== null) return;
		doc.checkInTaskId = await tx.createTask(this.checkInTask, null, {
			ownership: { kind: "conversation" },
			conversationId: conversationId as ConversationId,
			background: true,
		});
	}

	/**
	 * Create a worker in the caller's commit: its anchor task, conversation, agent settings, list entry and the reporter
	 * that delivers its first message and posts the report back. Shared by `worker_spawn` and a schedule firing.
	 */
	async createWorkerIn(tx: Tx, coordinatorId: ConversationId, input: CreateWorkerInput): Promise<number> {
		const project = this.project;
		const place = this.placeOf(coordinatorId);
		const checkout = place?.checkout ?? project.path;
		// A transaction may not read tables after its first write, so the document comes first. The board is main's.
		const doc = await tx.doc(WorkersDoc, coordinatorId);
		const board = input.taskId === null ? undefined : await openBoard(tx, this.mainId as ConversationId);
		if (board !== undefined && !board.tasks.some((task) => task.id === input.taskId)) {
			throw new ServerError("unknown_task", `No task "${input.taskId}" on the board`, { taskId: input.taskId });
		}
		// The spawn saves a snapshot when it changes the task's status and always adds a timeline entry: the task's history
		// opens before the first write.
		const history =
			board !== undefined && input.taskId !== null ? await openTaskHistory(tx, this.mainId as ConversationId, input.taskId) : undefined;
		const background = {
			ownership: { kind: "conversation" as const },
			conversationId: coordinatorId as ConversationId,
			background: true,
		};
		const anchor = await tx.createTask(WorkerAnchor, null, background);
		const conversation = await tx.createConversation({ ownership: { kind: "task", taskId: anchor } });
		await configure(tx, conversation.id, {
			model: input.model,
			thinkingLevel: input.thinkingLevel,
			cwd: input.workspace ?? checkout,
			extensions: { add: [mcpRoleExtension(input.scheduleId ? "coordinator" : "workers")], remove: [mcpRoleExtension(input.scheduleId ? "workers" : "coordinator"), mcpRoleExtension("background"), this.extension, ...this.removedExtensions, ...(input.taskId === null ? [this.taskExtension] : [])] },
			instructions: workerInstructions({
				id: input.id,
				title: input.title,
				project,
				cwd: input.workspace ?? checkout,
				isolation: input.isolation,
				taskId: input.taskId,
				...(place === undefined ? {} : { threadId: place.threadId }),
			}),
		});
		const now = new Date().toISOString();
		doc.workers[input.id] = {
			id: input.id,
			title: input.title,
			conversationId: conversation.id,
			isolation: input.isolation,
			workspacePath: input.workspace,
			model: input.model,
			thinkingLevel: input.thinkingLevel,
			status: "running",
			scheduleId: input.scheduleId,
			taskId: input.taskId,
			spawnedByCallId: input.spawnedByCallId,
   activityRunId: input.callId,
			createdAt: now,
			updatedAt: now,
			lastReport: null,
			failure: null,
			anchorTaskId: anchor,
		};
		await syncWorkerActivity(tx, this, doc.workers[input.id]!, coordinatorId);
  if (input.taskId) await inferCoordinatorTaskFocusIn(tx, this.mainId as ConversationId, coordinatorId, place?.threadId ?? "main", input.taskId, now);
  pruneDone(doc);
		if (board !== undefined && input.taskId !== null) {
			const before = statusesOf(board);
			const moved = moveTaskForWorker(board, {
				key: `worker-spawn:${input.callId}`,
				taskId: input.taskId,
				move: { kind: "spawned", workerId: input.id },
				now,
			});
			if (history !== undefined) {
				await snapshotStatusChanges(tx, this.mainId as ConversationId, board, before, {
					by: HARNESS_WRITER,
					at: now,
					key: `worker-spawn:${input.callId}`,
				});
				const task = board.tasks.find((candidate) => candidate.id === input.taskId);
				if (moved !== undefined && task !== undefined) {
					addTimelineEvent(history, task, {
						at: now,
						kind: "worker",
						label: `Worker ${input.id} started`,
						detail: input.title,
						ref: input.id,
						by: HARNESS_WRITER,
					});
				}
			}
		}
		await tx.createTask(
			this.reporterTask,
			{
				workerId: input.id,
				conversationId: conversation.id,
				callId: input.callId,
				message: input.task,
				followUp: input.followUp,
				...(input.schedule === undefined ? {} : { schedule: input.schedule }),
			},
			background,
		);
		await this.startCheckIn(tx, doc, coordinatorId, input.checkIn);
		return conversation.id as number;
	}

	/**
	 * Start a worker for a scheduled run: the harness's own spawn, with the schedule's brief, model, thinking level and
	 * isolation. The worker ID is `<scheduleId>-<yyyy-mm-dd-hhmm>` in the backend's timezone, so a retried due slot
	 * finds the worker it already started instead of starting a second one.
	 */
	async startScheduledRun(run: ScheduledRunInput): Promise<ScheduledRunResult> {
		const state = await this.state();
		const base = run.event?.id ?? scheduledWorkerId(run.scheduleId, run.at, run.timezone);
		let workerId: string | undefined;
		for (let attempt = 1; attempt <= 5; attempt += 1) {
			const candidate = attempt === 1 ? base : `${base.slice(0, 48 - String(attempt).length - 1)}-${attempt}`;
			const existing = state.workers[candidate];
			if (existing === undefined) {
				workerId = candidate;
				break;
			}
			// The same schedule at the same due time: this run already started before a crash or the next process.
			if ((existing.scheduleId ?? null) === run.scheduleId) {
				return { ok: true, workerId: candidate, conversationId: existing.conversationId };
			}
		}
		if (workerId === undefined) {
			return { ok: false, message: `No free worker ID near "${base}": five runs of this schedule share its minute.` };
		}

		const resolved = resolveWorkerModel({
			explicit: run.model ?? undefined,
			explicitThinkingLevel: run.thinkingLevel ?? undefined,
			defaults: defaultsOf(state),
			projectModels: this.project.workerModels,
			models: this.#options.models,
		});
		if (!resolved.ok) return { ok: false, message: resolved.message };
		const { model, thinkingLevel } = resolved.value;

		let workspace: string | null = null;
		if (run.isolation === "workspace") {
			try {
				workspace = await this.createWorkspace(workerId);
			} catch (error) {
				return {
					ok: false,
					message:
						error instanceof WorkerError ? error.message : `Could not create a workspace: ${errorMessage(error)}`,
				};
			}
		}
		// A `record` run must not wake the coordinator, and a check-in would.
		const checkIn = run.onReport === "review" ? await this.checkInNeeded() : false;
		const conversationId = await this.harness.commit(
			(tx) =>
				this.createWorkerIn(tx, this.coordinator.id, {
					id: workerId,
					title: run.title.slice(0, 120),
					task: run.brief,
					model,
					thinkingLevel,
					isolation: run.isolation,
					workspace,
					scheduleId: run.scheduleId,
					taskId: run.event?.taskId ?? run.taskId ?? null,
					spawnedByCallId: null,
					// Derived from the schedule and the due time (or the event): a rerun after a crash submits under the same request IDs.
					callId: `schedule:${run.scheduleId}:${run.event?.key ?? new Date(run.at).toISOString()}`,
					followUp: false,
					checkIn,
					schedule: { id: run.scheduleId, title: run.title.slice(0, 120), onReport: run.onReport, isolation: run.isolation },
				}),
			BACKGROUND_CONTEXT,
		);
		// The reporter is a background task created outside any run, so nothing would pick it up without this.
		this.harness.resume();
		return { ok: true, workerId, conversationId };
	}

	/** The repository a workspace isolation uses, or a clear error for the coordinator to fall back from. */
	async repository(): Promise<string> {
		const project = this.project;
		const root = await jjRoot(project.path);
		if (root === undefined) {
			throw new WorkerError(
				`Workspace isolation needs a jj repository, but ${project.path} is not one. Spawn the worker with isolation "shared" instead.`,
			);
		}
		return root;
	}

	/** Create the worker's jj workspace in its thread's directory (main's by default) and return its path. Idempotent. */
	async createWorkspace(workerId: string, place: CoordinatorPlace = this.#mainPlace()): Promise<string> {
		const repo = await this.repository();
		const path = workspacePath(place.workspacesDir, workerId);
		// jj creates the destination but not the directory above it, and the data directory is ours to make.
		await mkdir(place.workspacesDir, { recursive: true, mode: 0o700 });
		try {
			await ensureJjWorkspace({ repo, name: this.workspaceName(workerId, place), path });
			await this.#options.taskChanges?.rememberWorkspace(path);
		} catch (error) {
			if (error instanceof JjError) throw new WorkerError(error.message);
			throw error;
		}
		return path;
	}

	async recordWorkspaceChanges(path: string, record: WorkerRecord, threadId: string): Promise<void> {
		if (record.isolation !== "workspace") return;
		await this.#options.taskChanges?.recordWorkspace(path, record.taskId && !record.workspaceReused ? [record.taskId] : [], {
			threadId, conversationId: record.conversationId, ...(record.spawnedByCallId ? { runId: record.spawnedByCallId } : {}),
		});
	}

	async workspaceRemoved(path: string): Promise<void> {
		await this.#options.taskChanges?.forgetWorkspace(path);
	}

	async removeWorkspace(workerId: string, path: string, place: CoordinatorPlace = this.#mainPlace()): Promise<void> {
		const repo = await jjRoot(this.project.path);
		if (repo === undefined) throw new WorkerError(`Not a jj repository anymore: ${this.project.path}`);
		try {
			await removeJjWorkspace({ repo, name: this.workspaceName(workerId, place), path });
			await this.workspaceRemoved(path);
		} catch (error) {
			if (error instanceof JjError) throw new WorkerError(error.message);
			throw error;
		}
	}

	workspaceName(workerId: string, place: CoordinatorPlace = this.#mainPlace()): string {
		return `${place.workspacePrefix}${workerId}`;
	}

	#mainPlace(): CoordinatorPlace {
		return this.#coordinators.placeOf(this.mainId) as CoordinatorPlace;
	}

	/** Whether the project's checkout is a jj repository, so a workspace can be created. */
	async hasRepository(): Promise<boolean> {
		return (await jjRoot(this.project.path)) !== undefined;
	}

	log(message: string): void {
		this.#options.log(message);
	}
}

/** A tool-level failure with a message meant for the model. */
export class WorkerError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "WorkerError";
	}
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

function describeStatus(record: WorkerRecord): string {
	switch (record.status) {
		case "running":
			return "running";
		case "idle":
			return "idle, waiting for the next message";
		case "failed":
			return `failed${record.failure === null ? "" : `: ${record.failure}`}`;
		case "stopped":
			return "stopped";
		case "done":
			return "done, forgotten";
	}
}

export function describeWorkerRecord(record: WorkerRecord): string {
	const place =
		record.isolation === "workspace" ? `workspace ${record.workspacePath ?? "(removed)"}` : "shared checkout";
	const thinking = record.thinkingLevel === null ? "" : ` (thinking ${record.thinkingLevel})`;
	return [
		`${record.id} — ${record.title}`,
		`  status: ${describeStatus(record)}`,
		`  model: ${record.model.provider}/${record.model.modelId}${thinking}`,
		`  isolation: ${record.isolation}, ${place}`,
		`  conversation: ${record.conversationId}`,
	].join("\n");
}

/** Keep the newest forgotten workers as history; earlier ones are dropped from the list. */
function pruneDone(state: WorkersState): void {
	const done = Object.values(state.workers)
		.filter((record) => record.status === "done")
		.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
	for (const record of done.slice(KEPT_DONE_WORKERS)) delete state.workers[record.id];
}

/** `<scheduleId>-<yyyy-mm-dd-hhmm>`, the ID a scheduled run's worker gets, within the worker ID length limit. */
function scheduledWorkerId(scheduleId: string, at: number, timezone: string): string {
	const safe = scheduleId.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 32);
	return `${safe}-${formatRunStamp(at, timezone)}`.slice(0, 48);
}

const WORKER_ID_PATTERN = "^[A-Za-z0-9][A-Za-z0-9._-]*$";

const modelRefSchema = Type.Object({
	provider: Type.String({ minLength: 1, description: 'For example "anthropic".' }),
	modelId: Type.String({ minLength: 1 }),
});

const thinkingLevelSchema = Type.Union(THINKING_LEVELS.map((level) => Type.Literal(level)));

/**
 * The running `shared` workers whose tasks' write scopes overlap `scopes`, as text for the spawn's warning. Workspace
 * workers are left out: their edits stay in their own workspace until the coordinator merges them.
 */
function scopeOverlaps(state: WorkersState, board: BoardState, workerId: string, scopes: readonly string[]): string[] {
	if (scopes.length === 0) return [];
	const overlaps: string[] = [];
	for (const record of Object.values(state.workers)) {
		if (record.id === workerId || record.status !== "running" || record.isolation !== "shared" || (record.taskId ?? null) === null) continue;
		const other = board.tasks.find((task) => task.id === record.taskId);
		if (other === undefined || !scopesOverlap(scopes, other.writeScopes)) continue;
		overlaps.push(`${other.id}'s (${other.writeScopes.join(", ")}), which shared worker "${record.id}" is running`);
	}
	return overlaps;
}

function createWorkerExtension(service: WorkerService): Extension {
	const spawnTool = defineTool({
		name: "worker_spawn",
		// Starts a worker; a script may only read them (worker_list, worker_peek), never start, message, stop or forget one.
		callers: ["model"],
		description:
			"Start a background worker on a self-contained task and get its report back as a message when it answers. " +
			"The worker keeps its own conversation, remembers the messages you send it, and survives restarts. Only its " +
			"final report enters your context. Pick `isolation: \"workspace\"` when its edits must stay out of the project " +
			"checkout until you merge them (needs a jj repository); `shared` runs in the project directory.",
		parameters: Type.Object({
			id: Type.String({
				minLength: 1,
				maxLength: 48,
				pattern: WORKER_ID_PATTERN,
				description: "Short name for the worker, unique among the project's live workers.",
			}),
			task: Type.String({
				minLength: 1,
				description: "The brief: goal, files, constraints, how to verify, and what you need in the report.",
			}),
			title: Type.Optional(Type.String({ description: "One line for the worker list: what it is doing." })),
			isolation: Type.Optional(
				Type.Union([Type.Literal("shared"), Type.Literal("workspace")], {
					description: 'Default "shared". "workspace" gives it its own jj workspace in the data directory.',
				}),
			),
			model: Type.Optional(modelRefSchema),
			thinkingLevel: Type.Optional(thinkingLevelSchema),
			taskId: Type.Optional(
				Type.String({
					minLength: 1,
					description: "The board task (T3) this worker runs. It moves to in_progress now and to blocked if the worker fails. The worker keeps the task's report current; its final report does not move the task, you move it to review once you checked the work.",
				}),
			),
		}),
		replay: "safe",
		execute: async (args, api, context) => {
			// A worker never gets these tools, and one selected into a worker conversation still cannot use them.
			const place = service.placeOf(api.conversationId);
			if (place === undefined) {
				return toolText(service.notCoordinatorMessage("worker_spawn"), { isError: true });
			}
			const board = args.taskId === undefined ? undefined : ((await api.snapshot(BoardDoc, service.mainId as ConversationId, context)) as BoardState | undefined);
			const task = args.taskId === undefined ? undefined : board?.tasks.find((candidate) => candidate.id === args.taskId);
			if (args.taskId !== undefined && task === undefined) {
				return toolText(`No task "${args.taskId}" on the board (unknown_task). List the board, or spawn without taskId.`, {
					isError: true,
					details: { code: "unknown_task", taskId: args.taskId },
				});
			}
			const owner = task?.ownerThreadId ?? null;
			if (task !== undefined && owner !== null && owner !== place.threadId) {
				return toolText(
					`${task.id} is claimed by thread "${owner}", so another thread works on it. Leave it to that thread, or ask it to hand the task over.`,
					{ isError: true, details: { code: "board_conflict", taskId: task.id, ownerThreadId: owner } },
				);
			}
			const state = (await api.snapshot(WorkersDoc, api.conversationId, context)) ?? emptyWorkersState();
			const defaults = service.coordinators.isMain(api.conversationId)
				? defaultsOf(state)
				: defaultsOf(await api.snapshot(WorkersDoc, service.mainId as ConversationId, context));
			const existing = state.workers[args.id];
			if (existing !== undefined && existing.status !== "done") {
				if (existing.spawnedByCallId === api.callId) {
					return toolText(`Worker "${args.id}" is already started (${describeStatus(existing)}).`, {
						details: { workerId: existing.id, conversationId: existing.conversationId },
					});
				}
				return toolText(
					`A worker named "${args.id}" already exists (${describeStatus(existing)}). Send it a message with worker_send, or pick another name.`,
					{ isError: true },
				);
			}

			const resolved = resolveWorkerModel({
				explicit: args.model,
				explicitThinkingLevel: args.thinkingLevel,
				defaults,
				projectModels: service.project.workerModels,
				models: api.models,
			});
			if (!resolved.ok) return toolText(resolved.message, { isError: true });
			const { model, thinkingLevel } = resolved.value;

			const isolation: WorkerIsolation = args.isolation ?? "shared";
			let workspace: string | null = null;
			if (isolation === "workspace") {
				try {
					workspace = await service.createWorkspace(args.id, place);
				} catch (error) {
					return toolText(
						error instanceof WorkerError ? error.message : `Could not create a workspace: ${errorMessage(error)}`,
						{ isError: true },
					);
				}
			}

			const title = args.title ?? args.task.split("\n")[0]?.slice(0, 120) ?? args.task.slice(0, 120);
			const checkIn = await service.checkInNeeded(context, api.conversationId);
			const created = await api.commit(async (tx) => ({
				conversationId: await service.createWorkerIn(tx, api.conversationId, {
					id: args.id,
					title,
					task: args.task,
					model,
					thinkingLevel,
					isolation,
					workspace,
					scheduleId: null,
					taskId: task?.id ?? null,
					spawnedByCallId: api.callId,
					callId: api.callId,
					followUp: false,
					checkIn,
					schedule: undefined,
				}),
			}), context);

			await api.details({ workerId: args.id, conversationId: created.conversationId }, context);
			const where =
				workspace !== null ? workspace : service.coordinators.isMain(api.conversationId) ? "the project checkout" : `your workspace ${place.checkout}`;
			const overlaps = isolation === "shared" && task !== undefined && board !== undefined ? scopeOverlaps(state, board, args.id, task.writeScopes) : [];
			const warning =
				overlaps.length === 0
					? ""
					: `\nWarning: ${task?.id}'s write scopes (${task?.writeScopes.join(", ")}) overlap ${overlaps.join("; ")}. Both work in the same checkout, so their edits can collide: tell them apart in the briefs, or give one a workspace.`;
			return toolText(
				`Started worker "${args.id}" on ${model.provider}/${model.modelId}, working in ${where}${task === undefined ? "" : ` on ${task.id}`}. Its report arrives as a message when it answers; keep going meanwhile.${warning}`,
				{ details: { workerId: args.id, conversationId: created.conversationId } },
			);
		},
	});

	const sendTool = defineTool({
		name: "worker_send",
		// Messages a worker; a script may only read them (worker_list, worker_peek), never start, message, stop or forget one.
		callers: ["model"],
		description:
			"Send another message to a worker you started. By default it is queued behind the worker's current answer; " +
			"Use `interrupt: true` for additions to its current task so they land in the same run and report. " +
			"Queue only a separate next task. New reports arrive as messages; unchanged reports are only recorded.",
		parameters: Type.Object({
			id: Type.String({ minLength: 1, description: "The worker's ID." }),
			message: Type.String({ minLength: 1 }),
			interrupt: Type.Optional(
				Type.Boolean({ description: "Steer the running answer instead of queueing after it. Default false." }),
			),
			title: Type.Optional(
				Type.String({ minLength: 1, description: "A new title for the worker list, when this message gives it a new task." }),
			),
		}),
		replay: "safe",
		execute: async (args, api, context) => {
			// A worker never gets these tools, and one selected into a worker conversation still cannot use them.
			if (!service.isCoordinator(api.conversationId)) {
				return toolText(service.notCoordinatorMessage("worker_send"), { isError: true });
			}
			const state = (await api.snapshot(WorkersDoc, api.conversationId, context)) ?? emptyWorkersState();
			const record = state.workers[args.id];
			if (record === undefined) {
				return toolText(`No worker named "${args.id}". worker_list shows the ones that exist.`, { isError: true });
			}
			if (record.status === "done") {
				return toolText(
					`Worker "${args.id}" was forgotten after its work was merged. Spawn a new worker with worker_spawn.`,
					{ isError: true },
				);
			}
			const checkIn = await service.checkInNeeded(context, api.conversationId);
			await api.commit(async (tx) => {
				const doc = await tx.doc(WorkersDoc, api.conversationId);
				const worker = doc.workers[args.id];
				if (worker !== undefined) {
					if (worker.status !== "running" && worker.taskId != null) {
						const board = await openBoard(tx, service.mainId as ConversationId);
						noteTaskFact(board, worker.taskId, { actor: "coordinator", kind: "worker_resume", reason: "worker resumed", at: new Date().toISOString() });
					}
					if (worker.status !== "running") worker.activityRunId = api.callId;
     worker.status = "running";
					if (args.title !== undefined) {
						if (worker.title !== args.title.slice(0, 120)) worker.workspaceReused = true;
						worker.title = args.title.slice(0, 120);
					}
					worker.updatedAt = new Date().toISOString();
     await syncWorkerActivity(tx, service, worker, api.conversationId);
				}
    if (worker?.taskId) await inferCoordinatorTaskFocusIn(tx, service.mainId as ConversationId, api.conversationId, service.coordinators.threadIdOf(api.conversationId) ?? "main", worker.taskId, new Date().toISOString());
				await tx.createTask(
					service.reporterTask,
					{
						workerId: args.id,
						conversationId: record.conversationId,
						callId: api.callId,
						message: args.message,
						followUp: args.interrupt !== true,
					},
					{
						ownership: { kind: "conversation" as const },
						conversationId: api.conversationId,
						background: true,
					},
				);
				await service.startCheckIn(tx, doc, api.conversationId, checkIn);
			}, context);
			await api.details({ workerId: args.id, conversationId: record.conversationId }, context);
			return toolText(`Sent to worker "${args.id}". Its report arrives as a message.`, {
				details: { workerId: args.id, conversationId: record.conversationId },
			});
		},
	});

	const stopTool = defineTool({
		name: "worker_stop",
		// Stops a worker; a script may only read them (worker_list, worker_peek), never start, message, stop or forget one.
		callers: ["model"],
		description:
			"Stop what a worker is doing: its running answer and tools are aborted and its queued messages withdrawn. " +
			"The worker stays usable with worker_send.",
		parameters: Type.Object({
			id: Type.String({ minLength: 1, description: "The worker's ID." }),
		}),
		// Repeating a stop after a crash could stop newer work, so an interrupted call is not rerun.
		replay: "unsafe",
		execute: async (args, api, context) => {
			// A worker never gets these tools, and one selected into a worker conversation still cannot use them.
			if (!service.isCoordinator(api.conversationId)) {
				return toolText(service.notCoordinatorMessage("worker_stop"), { isError: true });
			}
			const state = (await api.snapshot(WorkersDoc, api.conversationId, context)) ?? emptyWorkersState();
			const record = state.workers[args.id];
			if (record === undefined) {
				return toolText(`No worker named "${args.id}".`, { isError: true });
			}
			if (record.status === "done") return toolText(`Worker "${args.id}" is already forgotten.`);
			const worker = await api.conversation(record.conversationId as ConversationId, context);
			await worker?.abort(context);
			await api.commit(async (tx) => {
				const doc = await tx.doc(WorkersDoc, api.conversationId);
				const current = doc.workers[args.id];
				if (current === undefined) return;
				if (current.status !== "stopped" && current.taskId != null) {
					const board = await openBoard(tx, service.mainId as ConversationId);
					noteTaskFact(board, current.taskId, { actor: "worker", kind: "worker_stop", reason: "worker stopped", at: new Date().toISOString() });
				}
				current.status = "stopped";
				current.updatedAt = new Date().toISOString();
    await syncWorkerActivity(tx, service, current, api.conversationId);
			}, context);
			await api.details({ workerId: args.id, conversationId: record.conversationId }, context);
			return toolText(`Stopped worker "${args.id}". It keeps its conversation; worker_send wakes it up again.`, {
				details: { workerId: args.id, conversationId: record.conversationId },
			});
		},
	});

	const peekTool = defineTool({
		name: "worker_peek",
		description:
			"Look at what a worker is doing right now, without waiting for its report: its status, how long since it last " +
			"produced anything, the tool calls and results it is running, and the tail of its text. Cheap; use it before " +
			"answering the user about a worker, or after a check-in.",
		parameters: Type.Object({
			id: Type.String({ minLength: 1, description: "The worker's ID." }),
			entries: Type.Optional(
				Type.Integer({
					minimum: 1,
					maximum: 20,
					description: `How many recent transcript entries to summarize. Default ${PEEK_DEFAULT_ENTRIES}.`,
				}),
			),
		}),
		replay: "safe",
		execute: async (args, api, context) => {
			// A worker never gets these tools, and one selected into a worker conversation still cannot use them.
			if (!service.isCoordinator(api.conversationId)) {
				return toolText(service.notCoordinatorMessage("worker_peek"), { isError: true });
			}
			const peek = await service.peek(args.id, api.now(), args.entries, context, api.conversationId);
			if (peek === undefined) {
				return toolText(`No worker named "${args.id}". worker_list shows the ones that exist.`, { isError: true });
			}
			return toolText(peek.text, {
				details: { workerId: args.id, conversationId: peek.conversationId },
			});
		},
	});

	const listTool = defineTool({
		name: "worker_list",
		description:
			"List the project's workers: ID, title, status, model, isolation, workspace and conversation. Use it to see " +
			"what is still running and what is available for more work.",
		parameters: Type.Object({}),
		replay: "safe",
		execute: async (_args, api, context) => {
			// A worker never gets these tools, and one selected into a worker conversation still cannot use them.
			if (!service.isCoordinator(api.conversationId)) {
				return toolText(service.notCoordinatorMessage("worker_list"), { isError: true });
			}
			const state = (await api.snapshot(WorkersDoc, api.conversationId, context)) ?? emptyWorkersState();
			const records = Object.values(state.workers).sort(
				(left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
			);
			const defaults = service.coordinators.isMain(api.conversationId)
				? defaultsOf(state)
				: defaultsOf(await api.snapshot(WorkersDoc, service.mainId as ConversationId, context));
			const chosen =
				defaults.model === null
					? "none picked yet"
					: `${defaults.model.provider}/${defaults.model.modelId}${
							defaults.thinkingLevel === null ? "" : ` (thinking ${defaults.thinkingLevel})`
						}`;
			const header = `Worker model from your messages: ${chosen}. Project default: ${
				service.project.workerModels.map((ref) => `${ref.provider}/${ref.modelId}`).join(", ") || "none"
			}.`;
			if (records.length === 0) return toolText(`${header}\nNo workers yet. Start one with worker_spawn.`);
			return toolText(`${header}\n\n${records.map(describeWorkerRecord).join("\n\n")}`);
		},
	});

	const forgetTool = defineTool({
		name: "worker_forget",
		// Releases a worker; a script may only read them (worker_list, worker_peek), never start, message, stop or forget one.
		callers: ["model"],
		description:
			"Release a worker once its work is merged: removes its jj workspace (unless `removeWorkspace: false`) and " +
			"drops it from the active list and withdraws queued messages without aborting running work. " +
			"Late output is recorded without waking you. Its conversation stays for history.",
		parameters: Type.Object({
			id: Type.String({ minLength: 1, description: "The worker's ID." }),
			removeWorkspace: Type.Optional(
				Type.Boolean({ description: "Default true. False keeps the workspace directory and its registration." }),
			),
		}),
		// Repeating a forget after a crash could remove a workspace a newer worker reuses; not rerun.
		replay: "unsafe",
		execute: async (args, api, context) => {
			// A worker never gets these tools, and one selected into a worker conversation still cannot use them.
			if (!service.isCoordinator(api.conversationId)) {
				return toolText(service.notCoordinatorMessage("worker_forget"), { isError: true });
			}
			const state = (await api.snapshot(WorkersDoc, api.conversationId, context)) ?? emptyWorkersState();
			const record = state.workers[args.id];
			if (record === undefined) return toolText(`No worker named "${args.id}".`, { isError: true });
			if (record.status === "done") return toolText(`Worker "${args.id}" is already forgotten.`);

			const remove = args.removeWorkspace !== false;
			const path = record.workspacePath;
			if (path !== null) await service.recordWorkspaceChanges(path, record, service.coordinators.placeOf(api.conversationId)?.threadId ?? "main");
			await service.withReportAdmission(() => api.commit(async (tx) => {
				const doc = await tx.doc(WorkersDoc, api.conversationId);
				const inbox = await tx.doc(InboxDoc, record.conversationId as ConversationId);
				const current = doc.workers[args.id];
				if (current === undefined) return;
				current.status = "done";
				current.updatedAt = new Date().toISOString();
    await syncWorkerActivity(tx, service, current, api.conversationId);
				if (remove && current.isolation === "workspace") current.workspacePath = null;
				// Withdraw only waiting inputs. Running answers/tools and passive writes are untouched.
				for (const item of inbox.items) {
					if (item.mode !== "write") tx.settleSubmission(item.id, { status: "unanswered", reason: "aborted" });
				}
				inbox.items = inbox.items.filter((item) => item.mode === "write");
				pruneDone(doc);
			}, context));
			let cleanup = "";
			if (remove && record.isolation === "workspace" && path !== null) {
				try {
					await service.removeWorkspace(args.id, path, service.placeOf(api.conversationId));
					cleanup = ` Its workspace ${path} is removed.`;
				} catch (error) {
					cleanup = ` Its workspace ${path} could not be removed: ${
						error instanceof WorkerError ? error.message : errorMessage(error)
					}`;
					service.log(`worker ${args.id}: workspace cleanup failed: ${cleanup}`);
				}
			}
			await api.details({ workerId: args.id, conversationId: record.conversationId }, context);
			return toolText(`Forgot worker "${args.id}".${cleanup}`, {
				details: { workerId: args.id, conversationId: record.conversationId },
			});
		},
	});

	return defineExtension({
		name: "worker-tools",
		tasks: [WorkerAnchor, service.reporterTask, service.checkInTask],
		tools: [spawnTool, sendTool, stopTool, peekTool, listTool, forgetTool] as ToolRegistration[],
		// Main's section is unchanged; a background thread gets its own variant, and a worker that kept this extension none.
		sections: [
			section("coordinator", (input) => {
				if (service.coordinators.isMain(input.conversationId)) return coordinatorSection(service.project);
				if (service.coordinators.isBackground(input.conversationId)) return threadCoordinatorSection(service.project);
				return undefined;
			}),
		],
	});
}

/** `task_progress`: optional run phase and evidenced Results; Now is automatic. */
function createWorkerTaskExtension(service: WorkerService): Extension {
	const progressTool = defineTool({
		name: "task_progress",
		description:
			"Keep the report of the board task you were started for current; the user reads it instead of your conversation. " +
			"Now is written automatically. Optional `now` is a few-word phase, only when it really changes; `addResult` adds one finished thing to Results, " +
			"`milestone` saves a snapshot of the task. Questions and warnings go in your final report, not here. " +
			"With no report fields, reads the task and its eventSeq. You can pass that as coveredEventSeq when writing later, so anything that happened since stays marked.",
		parameters: Type.Object({
			now: Type.Optional(
				Type.String({ description: "Optional few-word phase, only when it really changes. Expires with this run. Now is automatic; empty clears the phase." }),
			),
			addResult: Type.Optional(
				Type.String({ minLength: 1, description: "One finished thing with its evidence (commit, artifact, test run), added as a bullet." }),
			),
			coveredEventSeq: Type.Optional(Type.Integer({ minimum: 0, description: "Optional: the eventSeq from when you read the task, so anything that happened since stays marked. If omitted, a changed section covers events up to this write." })),
			milestone: Type.Optional(
				Type.String({ minLength: 1, description: 'A few words naming something meaningful that just happened, e.g. "Tests pass". Saves a snapshot.' }),
			),
		}),
		execute: async (args, api, context) => {
			const place = await service.workerOf(api.conversationId, context);
			const taskId = place?.record.taskId ?? null;
			if (place === undefined || taskId === null) {
				return toolText("You were not started for a board task, so there is no report to update. Say it in your final report.", {
					isError: true,
				});
			}
			if (args.now === undefined && args.addResult === undefined) {
				const stored = await service.harness.snapshot(BoardDoc, service.mainId as ConversationId, context);
				if (stored === undefined) return toolText("The task no longer exists.", { isError: true });
				const state = normalizeBoard(JSON.parse(JSON.stringify(stored)) as BoardState);
				const board = boardView(state, Date.now(), true);
				const task = board.tasks.find((candidate) => candidate.id === taskId);
				return task === undefined ? toolText("The task no longer exists.", { isError: true }) : toolText(describeTaskInFull(task, board, []), { details: { taskId } });
			}
			try {
				const at = new Date().toISOString();
				const task = await api.commit(
					(tx) =>
						writeReportIn(
							tx,
							service.mainId as ConversationId,
							{
								taskId,
								sections: { now: args.now },
								addResult: args.addResult,
								coveredEventSeq: args.coveredEventSeq,
								by: workerWriter(place.threadId, place.record.id),
								milestone: args.milestone,
							},
							`call:${api.conversationId}:${api.callId}`,
							at,
						),
					context,
				);
				const milestone = args.milestone === undefined ? "" : `; milestone "${args.milestone.trim()}" saved`;
				return toolText(`Updated the report of ${task.id} (report r${task.report.revision}${milestone}).`, { details: { taskId: task.id } });
			} catch (error) {
				return toolText(errorMessage(error), { isError: true });
			}
		},
	});

	return defineExtension({ name: "worker-task-tools", tools: [progressTool] as ToolRegistration[], hooks: [hook(GenerationTask, {
  beforeRequest: async (_request, api, context) => {
   const live = await service.harness.snapshot(LiveDoc, api.conversationId, context);
   if (live?.run && !live.run.afterRun) await syncWorkerActivityRun(service, api.conversationId, String(live.run.first ?? live.run.taskId), context);
   return undefined;
  },
  afterRun: async (run, api, context) => {
   const place = await service.workerOf(api.conversationId, context);
   if (!place?.record.taskId) return undefined;
   await service.harness.commit(async tx => {
    const state = await openBoard(tx, service.mainId as ConversationId);
    const tracking = activityTracking(state, place.record.taskId!);
    const id = `${place.threadId}:${api.conversationId}:${run.first}`;
    endActivitySource(tracking, id, new Date().toISOString());
   }, context);
   return undefined;
  },
 })] });
}
