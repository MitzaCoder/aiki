/**
 * Scheduled tasks: briefs that run as workers of the project's coordinator on a schedule.
 *
 * When a schedule fires, the harness itself starts a worker with the schedule's brief, model, thinking level and
 * isolation; the worker's report goes to the coordinator like any other worker's. The user edits schedules in the app;
 * the coordinator can create and edit them with its tools. Times are in the backend's timezone.
 */
import { type Static, Type } from "typebox";
import { ModelRefSchema, ProjectIdSchema, RequestIdSchema, ThinkingLevelSchema } from "./common.ts";
import { WorkerIsolationSchema } from "./workers.ts";

const TimeOfDay = Type.String({ pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$", description: '"HH:MM", 24-hour.' });

export const ScheduleSpecSchema = Type.Union([
	Type.Object({ kind: Type.Literal("interval"), everyMinutes: Type.Integer({ minimum: 5, maximum: 10080 }) }),
	Type.Object({ kind: Type.Literal("daily"), time: TimeOfDay }),
	Type.Object({
		kind: Type.Literal("weekly"),
		days: Type.Array(Type.Integer({ minimum: 0, maximum: 6 }), { minItems: 1, description: "0 is Sunday." }),
		time: TimeOfDay,
	}),
	Type.Object({ kind: Type.Literal("cron"), expression: Type.String({ minLength: 1, description: "Five fields." }) }),
	Type.Object(
		{
			kind: Type.Literal("github-review-requested"),
			repos: Type.Optional(
				Type.Array(Type.String({ minLength: 1 }), {
					description:
						'"owner/name" repositories to listen in. Left out or empty: the project\'s own GitHub repositories, and when it has none, every repository.',
				}),
			),
		},
		{
			description:
				"An event instead of a clock: fires once for each new GitHub pull request review request from the account the backend's `gh` is logged in as (direct or through a team). Needs the `schedule-events` feature.",
		},
	),
]);
export type ScheduleSpec = Static<typeof ScheduleSpecSchema>;

/** The rules that fire on an event, not a clock: they have no `nextRunAt`, and each event is its own run. */
export function isEventSpec(spec: ScheduleSpec): spec is Extract<ScheduleSpec, { kind: "github-review-requested" }> {
	return spec.kind === "github-review-requested";
}

/**
 * What a report from a scheduled run does. `review`: it is posted to the coordinator, which wakes up to review it (a
 * coordinator turn per run). `record`: it is kept for the coordinator without waking it; the coordinator gets it with
 * the user's next message.
 */
export const ScheduleOnReportSchema = Type.Union([Type.Literal("review"), Type.Literal("record")]);
export type ScheduleOnReport = Static<typeof ScheduleOnReportSchema>;

export const ScheduleRunSchema = Type.Object({
	at: Type.String({
		description: "ISO 8601, when the run was due or started by hand; for an `event` run, when the event happened.",
	}),
	trigger: Type.Union([Type.Literal("schedule"), Type.Literal("catch-up"), Type.Literal("manual"), Type.Literal("event")], {
		description: '"event" needs the `schedule-events` feature; an older app shows it as the raw word.',
	}),
	outcome: Type.Union([Type.Literal("started"), Type.Literal("skipped"), Type.Literal("failed")]),
	workerId: Type.Union([Type.String(), Type.Null()]),
	threadId: Type.Optional(Type.Union([Type.String(), Type.Null()], { description: "The thread a `thread` run started." })),
	message: Type.Union([Type.String(), Type.Null()], {
		description: 'Why it was skipped or failed, e.g. "previous run still running".',
	}),
	ref: Type.Optional(
		Type.Union([Type.String(), Type.Null()], { description: "What an `event` run is about: the pull request's URL." }),
	),
	taskId: Type.Optional(
		Type.Union([Type.String(), Type.Null()], {
			description: "The board task the run was given: its own for an `event` run, the schedule's one task for a clock run.",
		}),
	),
});
export type ScheduleRun = Static<typeof ScheduleRunSchema>;

/** What the user or the coordinator sets. */
export const ScheduleInputSchema = Type.Object({
	title: Type.String({ minLength: 1 }),
	brief: Type.String({ minLength: 1, description: "The worker's task, self-contained." }),
	spec: ScheduleSpecSchema,
	model: Type.Union([ModelRefSchema, Type.Null()], {
		description: "Null resolves like any worker: the composer's pick, then the project's worker models.",
	}),
	thinkingLevel: Type.Union([ThinkingLevelSchema, Type.Null()]),
	isolation: WorkerIsolationSchema,
	onReport: ScheduleOnReportSchema,
	enabled: Type.Boolean(),
	kind: Type.Optional(
		Type.Union([Type.Literal("worker"), Type.Literal("thread")], {
			description:
				'"worker" (default): the brief runs as one worker of main. "thread": the brief is the prompt of a new background thread (a coordinator with its own workers), whose summary reaches main per onReport; model and thinkingLevel are that thread\'s, and isolation is ignored.',
		}),
	),
});
export type ScheduleInput = Static<typeof ScheduleInputSchema>;

export const ScheduleSchema = Type.Object({
	...ScheduleInputSchema.properties,
	id: Type.String({ minLength: 1 }),
	createdBy: Type.Union([Type.Literal("user"), Type.Literal("coordinator")]),
	createdAt: Type.String(),
	updatedAt: Type.String(),
	nextRunAt: Type.Union([Type.String(), Type.Null()], { description: "Null when disabled, and always for an event rule." }),
	eventState: Type.Optional(
		Type.Union(
			[
				Type.Object({
					checkedAt: Type.Union([Type.String(), Type.Null()], {
						description: "ISO 8601, when the backend last read GitHub for this schedule; null before the first check.",
					}),
					error: Type.Union([Type.String(), Type.Null()], {
						description: "Why the last check failed; null when it worked. A failed check fires nothing and is tried again.",
					}),
				}),
				Type.Null(),
			],
			{ description: "How the backend's checking is going, for an event rule; null or absent for a clock rule." },
		),
	),
	taskId: Type.Optional(
		Type.Union([Type.String(), Type.Null()], {
			description:
				"The board task that collects this clock schedule's runs, as of its latest run; absent before the first run and for an event rule. The harness sets it, never the user.",
		}),
	),
	runs: Type.Array(ScheduleRunSchema, { description: "Newest first, the last 20." }),
});
export type Schedule = Static<typeof ScheduleSchema>;

// --- requests ----------------------------------------------------------------------------------------------------

export const SchedulesListRequestSchema = Type.Object({
	type: Type.Literal("schedules.list"),
	id: RequestIdSchema,
	projectId: ProjectIdSchema,
});
export type SchedulesListRequest = Static<typeof SchedulesListRequestSchema>;

/** Create (no `scheduleId`) or replace a schedule. */
export const SchedulesSaveRequestSchema = Type.Object({
	type: Type.Literal("schedules.save"),
	id: RequestIdSchema,
	projectId: ProjectIdSchema,
	scheduleId: Type.Optional(Type.String({ minLength: 1 })),
	schedule: ScheduleInputSchema,
});
export type SchedulesSaveRequest = Static<typeof SchedulesSaveRequestSchema>;

export const SchedulesDeleteRequestSchema = Type.Object({
	type: Type.Literal("schedules.delete"),
	id: RequestIdSchema,
	projectId: ProjectIdSchema,
	scheduleId: Type.String({ minLength: 1 }),
});
export type SchedulesDeleteRequest = Static<typeof SchedulesDeleteRequestSchema>;

/**
 * Run a schedule now, enabled or not; skipped like any run while its previous run is still running. For an event rule
 * it checks GitHub at once and runs the requests not handled yet (else the newest open one); the answer carries the
 * newest run, and every one is in the history.
 */
export const SchedulesRunRequestSchema = Type.Object({
	type: Type.Literal("schedules.run"),
	id: RequestIdSchema,
	projectId: ProjectIdSchema,
	scheduleId: Type.String({ minLength: 1 }),
});
export type SchedulesRunRequest = Static<typeof SchedulesRunRequestSchema>;

// --- responses ---------------------------------------------------------------------------------------------------

export const SchedulesListResponseSchema = Type.Object({
	type: Type.Literal("schedules.list"),
	id: RequestIdSchema,
	schedules: Type.Array(ScheduleSchema),
	timezone: Type.String({ description: 'The backend\'s IANA timezone, e.g. "Europe/Bucharest".' }),
});
export type SchedulesListResponse = Static<typeof SchedulesListResponseSchema>;

export const SchedulesSaveResponseSchema = Type.Object({
	type: Type.Literal("schedules.save"),
	id: RequestIdSchema,
	schedule: ScheduleSchema,
});
export type SchedulesSaveResponse = Static<typeof SchedulesSaveResponseSchema>;

export const SchedulesDeleteResponseSchema = Type.Object({
	type: Type.Literal("schedules.delete"),
	id: RequestIdSchema,
});
export type SchedulesDeleteResponse = Static<typeof SchedulesDeleteResponseSchema>;

export const SchedulesRunResponseSchema = Type.Object({
	type: Type.Literal("schedules.run"),
	id: RequestIdSchema,
	run: ScheduleRunSchema,
});
export type SchedulesRunResponse = Static<typeof SchedulesRunResponseSchema>;

// --- server events -----------------------------------------------------------------------------------------------

/** The project's whole schedule list, pushed to every connection whenever a schedule or its runs change. */
export const SchedulesStateEventSchema = Type.Object({
	type: Type.Literal("schedules.state"),
	projectId: ProjectIdSchema,
	schedules: Type.Array(ScheduleSchema),
	timezone: Type.String(),
});
export type SchedulesStateEvent = Static<typeof SchedulesStateEventSchema>;
