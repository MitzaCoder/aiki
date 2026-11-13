/**
 * Schedules: briefs that run as workers of the project's coordinator on a clock (or on demand).
 *
 * When a schedule fires the harness itself starts a worker with the schedule's brief, model, thinking level and
 * isolation, exactly as `worker_spawn` would; the report then goes to the coordinator like any other worker's (`review`
 * wakes it, `record` writes it into the transcript for the next turn without starting one).
 *
 * Where the clock lives, and why it is two pieces:
 *
 * - `ScheduleStore` persists every project's schedules in `projects/<id>/schedules.json`, next to `project.json`. It
 *   reads and writes without opening a project's Harness, so listing, editing and reading due times cost one small
 *   JSON file per project.
 * - `ScheduleScheduler` is one server-level loop over the persisted `nextRunAt` of every project. It arms a single
 *   timer for the soonest one and, when it is due, opens that project's Harness and lets `SchedulesService` start the
 *   worker. Nothing opens a project at boot just to schedule it: a project whose schedule is due today opens when it
 *   fires, and one whose schedules are all in the future stays closed until then.
 *
 * Durability without a durable timer: the Harness is opened for a due run, so there is no portable place to keep a
 * pi-durable sleeping task for a project nobody opened. Instead the persisted `nextRunAt` *is* the alarm. A process
 * that starts (or wakes) later sees it in the past, runs the schedule once with trigger `catch-up`, and moves
 * `nextRunAt` past now, so several missed slots cost one run and a restart cannot make a burst. A due run is written to
 * the schedule's history before the worker is started, so a crash in the middle leaves evidence; and the worker ID is
 * `<scheduleId>-<yyyy-mm-dd-hhmm>` and the request IDs derive from `<scheduleId>:<due time>`, so a retried run finds
 * the worker and the messages it already started instead of duplicating them.
 *
 * Overlap: while the previous run of a schedule is still running (its worker's durable status is `running`), the next
 * one is recorded `skipped` with "previous run still running". A `shared` run is forgotten as soon as it reports; a
 * `workspace` run stays until the coordinator merges its work and calls `worker_forget`.
 *
 * A schedule of kind `thread` starts a background thread instead (`threads.ts`): the brief is its first message, the
 * schedule's model and thinking level are the thread's, `onReport` is its `onFinish`, and the thread ID derives from
 * the due time the same way. Its previous thread still at work (running or idle) makes the next run `skipped`.
 */
import type { Extension, JsonObject, SetTimer, ToolRegistration } from "@earendil-works/pi-durable";
import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import {
	isEventSpec,
	normalizeGithubRepo,
	type ModelRef,
	ModelRefSchema,
	type Schedule,
	type ScheduleInput,
	type ScheduleOnReport,
	type ScheduleRun,
	type ScheduleSpec,
	ScheduleSpecSchema,
	ScheduleSchema,
	type ThinkingLevel,
	ThinkingLevelSchema,
	type WorkerIsolation,
} from "@kemiri/protocol";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { ServerError, errorMessage } from "./errors.ts";
import { readJsonFile, writeJsonFile } from "./fs-json.ts";
import { serverSettings } from "./server-settings.ts";
import { type Notifier, scheduleProblemNotification } from "./notifications.ts";
import type { ProjectStore } from "./projects.ts";
import {
	type FireEventOptions,
	type ReviewRequest,
	eventBrief,
	eventRunIdentity,
	eventTaskDescription,
	eventTaskMarker,
	eventTaskTitle,
} from "./schedule-events.ts";
import type { BoardService } from "./board.ts";
import type { ThreadService } from "./threads.ts";
import type { WorkerService } from "./workers.ts";

/** The file, next to `project.json`, holding one project's schedules. */
export const SCHEDULES_FILE = "schedules.json";
/** How many runs of one schedule are kept, newest first. */
export const KEPT_SCHEDULE_RUNS = 20;
/** Overrides the backend's timezone, for a host whose clock setting is not what the user wants. */
export const TIMEZONE_ENV = "AIKI_TIMEZONE";
/** How far ahead a cron expression is searched for its next slot before giving up on it. */
const CRON_LOOKAHEAD_DAYS = 366 * 5;
/** The longest gap a single timer covers; a longer wait is re-armed when it expires. */
const MAX_TIMER_DELAY_MS = 6 * 60 * 60 * 1000;

// --- time in a timezone ------------------------------------------------------------------------------------------

type ZonedParts = {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
	second: number;
	/** 0 is Sunday. */
	weekday: number;
};

const formatters = new Map<string, Intl.DateTimeFormat>();
const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function formatterFor(timezone: string): Intl.DateTimeFormat {
	let formatter = formatters.get(timezone);
	if (formatter === undefined) {
		formatter = new Intl.DateTimeFormat("en-US", {
			timeZone: timezone,
			hourCycle: "h23",
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			weekday: "short",
		});
		formatters.set(timezone, formatter);
	}
	return formatter;
}

/** Whether `Intl` knows this zone. */
export function isValidTimezone(timezone: string): boolean {
	try {
		formatterFor(timezone);
		return true;
	} catch {
		return false;
	}
}

/**
 * The backend's timezone: `AIKI_TIMEZONE` when it names a zone, else what this host's clock is set to, else
 * UTC. Every schedule is read and written in it, and `schedules.list` reports it so the app can say which clock runs.
 */
export function resolveTimezone(): string {
	const configured = serverSettings[TIMEZONE_ENV]?.trim();
	if (configured !== undefined && configured.length > 0 && isValidTimezone(configured)) return configured;
	const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
	if (typeof detected === "string" && detected.length > 0 && isValidTimezone(detected)) return detected;
	return "UTC";
}

/** The wall clock of one instant in a timezone. */
export function zonedParts(at: number, timezone: string): ZonedParts {
	const parts = formatterFor(timezone).formatToParts(new Date(at));
	const value = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? "0");
	const weekdayName = parts.find((part) => part.type === "weekday")?.value ?? "Sun";
	return {
		year: value("year"),
		month: value("month"),
		day: value("day"),
		hour: value("hour"),
		minute: value("minute"),
		second: value("second"),
		weekday: WEEKDAY_INDEX[weekdayName] ?? 0,
	};
}

/** How far the zone is from UTC at this instant, in milliseconds (positive east of Greenwich). */
function offsetAt(at: number, timezone: string): number {
	const parts = zonedParts(at, timezone);
	const wall = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
	const whole = at - (((at % 1000) + 1000) % 1000);
	return wall - whole;
}

/**
 * The instant a wall-clock time names in a timezone. `Date.UTC` guesses, then the zone's offset at the guess corrects
 * it; a second pass settles the offset when the guess fell on the other side of a DST switch. A time that does not
 * exist (inside a spring-forward gap) resolves to the moment the clock jumps over it.
 */
export function instantOf(
	wall: { year: number; month: number; day: number; hour: number; minute: number },
	timezone: string,
): number {
	const utc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
	let instant = utc - offsetAt(utc, timezone);
	for (let pass = 0; pass < 3; pass += 1) {
		const corrected = utc - offsetAt(instant, timezone);
		if (corrected === instant) break;
		instant = corrected;
	}
	return instant;
}

/** `2026-11-05 09:00`, in the backend's timezone. */
export function formatLocalTime(at: number, timezone: string): string {
	const parts = zonedParts(at, timezone);
	const two = (value: number): string => String(value).padStart(2, "0");
	return `${parts.year}-${two(parts.month)}-${two(parts.day)} ${two(parts.hour)}:${two(parts.minute)}`;
}

/** `2026-11-05-0900`: the stamp a run's worker ID carries. */
export function formatRunStamp(at: number, timezone: string): string {
	const parts = zonedParts(at, timezone);
	const two = (value: number): string => String(value).padStart(2, "0");
	return `${parts.year}-${two(parts.month)}-${two(parts.day)}-${two(parts.hour)}${two(parts.minute)}`;
}

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// --- cron ---------------------------------------------------------------------------------------------------------

/** A parsed five-field cron expression: which minutes, hours and days it matches. */
export type CronFields = {
	minutes: readonly number[];
	hours: readonly number[];
	daysOfMonth: readonly number[];
	months: readonly number[];
	daysOfWeek: readonly number[];
	dayOfMonthRestricted: boolean;
	dayOfWeekRestricted: boolean;
};

/** One field: `*`, a number, a range, a step, or a comma-separated list of them. */
function parseCronField(text: string, name: string, min: number, max: number): { values: number[]; restricted: boolean } {
	const values = new Set<number>();
	const restricted = text !== "*";
	for (const part of text.split(",")) {
		const [range, stepText] = part.split("/");
		if (range === undefined || range.length === 0) throw new Error(`Empty ${name} field in "${text}"`);
		const step = stepText === undefined ? 1 : Number(stepText);
		if (!Number.isInteger(step) || step < 1) throw new Error(`Bad step "${stepText}" in the ${name} field`);
		let from: number;
		let to: number;
		if (range === "*") {
			from = min;
			to = max;
		} else if (range.includes("-")) {
			const [startText, endText] = range.split("-");
			from = Number(startText);
			to = Number(endText);
		} else {
			from = Number(range);
			// "5/15" means 5, 20, 35, … up to the field's end; "5" alone is just 5.
			to = stepText === undefined ? from : max;
		}
		if (!Number.isInteger(from) || !Number.isInteger(to) || from < min || to > max || from > to) {
			throw new Error(`"${part}" is not a ${name} value between ${min} and ${max}`);
		}
		for (let value = from; value <= to; value += step) values.add(value);
	}
	return { values: [...values].sort((left, right) => left - right), restricted };
}

/**
 * Parse a five-field cron expression: minutes, hours, day of month, month, day of week (0 and 7 are Sunday). Numbers,
 * `*`, ranges (`1-5`), steps (`*`/15`, `1-5/2`) and lists (`1,15,30`) are understood; month and weekday names are not,
 * so what it does is the same on every host.
 */
export function parseCron(expression: string): CronFields {
	const fields = expression.trim().split(/\s+/);
	if (fields.length !== 5) {
		throw new Error(`A cron expression has five fields (minute hour day-of-month month day-of-week), got ${fields.length}`);
	}
	const minutes = parseCronField(fields[0]!, "minute", 0, 59);
	const hours = parseCronField(fields[1]!, "hour", 0, 23);
	const daysOfMonth = parseCronField(fields[2]!, "day-of-month", 1, 31);
	const months = parseCronField(fields[3]!, "month", 1, 12);
	const daysOfWeek = parseCronField(fields[4]!, "day-of-week", 0, 7);
	return {
		minutes: minutes.values,
		hours: hours.values,
		daysOfMonth: daysOfMonth.values,
		months: months.values,
		// 7 is another way to say Sunday.
		daysOfWeek: [...new Set(daysOfWeek.values.map((value) => value % 7))].sort((left, right) => left - right),
		dayOfMonthRestricted: daysOfMonth.restricted,
		dayOfWeekRestricted: daysOfWeek.restricted,
	};
}

/** Cron's rule: a day matches when both day fields are restricted only if either matches. */
function dayMatches(cron: CronFields, dayOfMonth: number, weekday: number): boolean {
	const byMonthDay = cron.daysOfMonth.includes(dayOfMonth);
	const byWeekday = cron.daysOfWeek.includes(weekday);
	if (cron.dayOfMonthRestricted && cron.dayOfWeekRestricted) return byMonthDay || byWeekday;
	if (cron.dayOfMonthRestricted) return byMonthDay;
	if (cron.dayOfWeekRestricted) return byWeekday;
	return true;
}

/**
 * The first instant after `after` that the cron fields name in `timezone`. Days are walked in wall-clock time, so DST
 * switches move the instants but not the times the schedule writes down.
 */
export function nextCronAfter(cron: CronFields, after: number, timezone: string): number | undefined {
	const start = zonedParts(after, timezone);
	const firstDay = Date.UTC(start.year, start.month - 1, start.day);
	for (let offset = 0; offset <= CRON_LOOKAHEAD_DAYS; offset += 1) {
		const date = new Date(firstDay + offset * 86_400_000);
		const year = date.getUTCFullYear();
		const month = date.getUTCMonth() + 1;
		const day = date.getUTCDate();
		if (!cron.months.includes(month)) continue;
		if (!dayMatches(cron, day, date.getUTCDay())) continue;
		for (const hour of cron.hours) {
			if (offset === 0 && hour < start.hour) continue;
			for (const minute of cron.minutes) {
				if (offset === 0 && hour === start.hour && minute <= start.minute) continue;
				const instant = instantOf({ year, month, day, hour, minute }, timezone);
				if (instant > after) return instant;
			}
		}
	}
	return undefined;
}

/** The wall-clock times a schedule names, as cron fields, so daily, weekly and cron share one search. */
function cronOf(spec: ScheduleSpec): CronFields {
	const allDays = parseCron("* * * * *");
	const time = (value: string): { hour: number; minute: number } => {
		const [hour, minute] = value.split(":");
		return { hour: Number(hour), minute: Number(minute) };
	};
	switch (spec.kind) {
		case "daily": {
			const { hour, minute } = time(spec.time);
			return { ...allDays, hours: [hour], minutes: [minute] };
		}
		case "weekly": {
			const { hour, minute } = time(spec.time);
			return {
				...allDays,
				hours: [hour],
				minutes: [minute],
				daysOfWeek: [...new Set(spec.days)].sort((left, right) => left - right),
				dayOfWeekRestricted: true,
			};
		}
		case "cron":
			return parseCron(spec.expression);
		case "interval":
		case "github-review-requested":
			// These have no wall-clock fields; `nextRunAfter` handles them before this is called.
			return allDays;
	}
}

/** An interval is anchored to the schedule's creation, so it does not drift with every save or restart. */
export function nextIntervalAfter(everyMinutes: number, after: number, anchor: number): number {
	const period = everyMinutes * 60_000;
	if (after < anchor) return anchor;
	const steps = Math.floor((after - anchor) / period) + 1;
	return anchor + steps * period;
}

/**
 * When a schedule runs next, strictly after `after`. `anchor` is the schedule's creation time, which an interval counts
 * from; daily, weekly and cron runs are wall-clock times in `timezone`.
 */
export function nextRunAfter(
	spec: ScheduleSpec,
	after: number,
	timezone: string,
	anchor = after,
): number | undefined {
	// An event rule has no next time: it fires when the event happens.
	if (isEventSpec(spec)) return undefined;
	if (spec.kind === "interval") return nextIntervalAfter(spec.everyMinutes, after, anchor);
	return nextCronAfter(cronOf(spec), after, timezone);
}

/** What is wrong with a spec, for the user or the coordinator; undefined when it is usable. */
export function validateSpec(spec: ScheduleSpec, timezone: string): string | undefined {
	try {
		if (isEventSpec(spec)) {
			const bad = (spec.repos ?? []).find((repo) => normalizeGithubRepo(repo) === undefined);
			return bad === undefined ? undefined : `"${bad}" is not a GitHub repository; write it as owner/name.`;
		}
		if (spec.kind === "cron") parseCron(spec.expression);
		const next = nextRunAfter(spec, Date.now(), timezone);
		if (next === undefined) return "This schedule never runs: no matching time was found in the next five years.";
		return undefined;
	} catch (error) {
		return errorMessage(error);
	}
}

/** One line for lists and tool answers: "every 30 minutes", "daily at 09:00", "weekly on Mon, Thu at 09:00". */
export function describeSpec(spec: ScheduleSpec): string {
	switch (spec.kind) {
		case "interval":
			return spec.everyMinutes % 60 === 0 && spec.everyMinutes >= 60
				? `every ${spec.everyMinutes / 60} hour${spec.everyMinutes === 60 ? "" : "s"}`
				: `every ${spec.everyMinutes} minute${spec.everyMinutes === 1 ? "" : "s"}`;
		case "daily":
			return `daily at ${spec.time}`;
		case "weekly":
			return `weekly on ${[...new Set(spec.days)].sort((left, right) => left - right).map((day) => WEEKDAY_NAMES[day] ?? "?").join(", ")} at ${spec.time}`;
		case "cron":
			return `cron "${spec.expression}"`;
		case "github-review-requested":
			return spec.repos === undefined || spec.repos.length === 0
				? "when a GitHub review is requested from you (in the project's repositories)"
				: `when a GitHub review is requested from you in ${spec.repos.join(", ")}`;
	}
}

// --- one project's schedules on disk -----------------------------------------------------------------------------

type SchedulesFile = {
	version: 1;
	timezone: string;
	schedules: Schedule[];
};

function emptyFile(timezone: string): SchedulesFile {
	return { version: 1, timezone, schedules: [] };
}

/** The anchor an interval counts from: when the schedule was created. */
function anchorOf(schedule: Schedule): number {
	const created = Date.parse(schedule.createdAt);
	return Number.isFinite(created) ? created : 0;
}

function slug(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 24);
}

function newScheduleId(existing: readonly Schedule[], title: string): string {
	const base = slug(title).length === 0 ? "schedule" : slug(title);
	for (let attempt = 0; attempt < 20; attempt += 1) {
		const candidate = `${base}-${randomBytes(3).toString("hex")}`;
		if (!existing.some((schedule) => schedule.id === candidate)) return candidate;
	}
	return `${base}-${randomBytes(6).toString("hex")}`;
}

/** An event rule's repositories as "owner/name", once each; every other rule as it is. */
function normalizedSpec(spec: ScheduleSpec): ScheduleSpec {
	if (!isEventSpec(spec) || spec.repos === undefined) return spec;
	const repos = [...new Set(spec.repos.map((repo) => normalizeGithubRepo(repo) ?? repo))];
	return { kind: spec.kind, ...(repos.length === 0 ? {} : { repos }) };
}

export type ScheduleStoreOptions = {
	projects: ProjectStore;
	/** Default: `resolveTimezone()`. */
	timezone?: string;
	/** The clock, for tests. Default: `Date.now`. */
	now?: () => number;
	/** Called after every write, with the project whose file changed. Set by the server once connections exist. */
	onChange?: (projectId: string) => void;
	log?: (message: string) => void;
};

/**
 * Every project's schedules, persisted one JSON file per project. Reading never touches a project's Harness, and writes
 * are serialized so two changes cannot lose each other. Schedules outlive restarts and stay with their project.
 */
export class ScheduleStore {
	readonly timezone: string;
	/** Set by the server: pushes `schedules.state` and re-arms the scheduler. */
	onChange: ((projectId: string) => void) | undefined;
	/** Set by the server: pushes `schedules.state` only, after a check of GitHub was noted. */
	onEventStateChange: ((projectId: string) => void) | undefined;
	readonly #projects: ProjectStore;
	readonly #now: () => number;
	readonly #log: (message: string) => void;
	readonly #cache = new Map<string, Schedule[]>();
	#queue: Promise<unknown> = Promise.resolve();

	constructor(options: ScheduleStoreOptions) {
		this.#projects = options.projects;
		this.timezone = options.timezone ?? resolveTimezone();
		this.#now = options.now ?? Date.now;
		this.onChange = options.onChange;
		this.#log = options.log ?? ((message) => console.log(message));
	}

	fileOf(projectId: string): string {
		return join(this.#projects.projectDir(projectId), SCHEDULES_FILE);
	}

	/** One project's schedules, oldest first. Never mutated by callers. */
	async list(projectId: string): Promise<Schedule[]> {
		const cached = this.#cache.get(projectId);
		if (cached !== undefined) return cached;
		const schedules = await this.#load(projectId);
		this.#cache.set(projectId, schedules);
		return schedules;
	}

	async find(projectId: string, scheduleId: string): Promise<Schedule | undefined> {
		return (await this.list(projectId)).find((schedule) => schedule.id === scheduleId);
	}

	/** Every project's schedules with their next run already past `now`, soonest first. */
	async due(now: number): Promise<{ projectId: string; schedule: Schedule }[]> {
		const out: { projectId: string; schedule: Schedule }[] = [];
		for (const project of await this.#projects.list()) {
			if (project.archived === true) continue;
			for (const schedule of await this.list(project.id)) {
				const at = schedule.nextRunAt === null ? Number.NaN : Date.parse(schedule.nextRunAt);
				if (schedule.enabled && Number.isFinite(at) && at <= now) out.push({ projectId: project.id, schedule });
			}
		}
		out.sort((left, right) => Date.parse(left.schedule.nextRunAt ?? "") - Date.parse(right.schedule.nextRunAt ?? ""));
		return out;
	}

	/** The soonest `nextRunAt` of any enabled schedule, for arming the timer. */
	async nextDue(): Promise<number | undefined> {
		let soonest: number | undefined;
		for (const project of await this.#projects.list()) {
			if (project.archived === true) continue;
			for (const schedule of await this.list(project.id)) {
				if (!schedule.enabled || schedule.nextRunAt === null) continue;
				const at = Date.parse(schedule.nextRunAt);
				if (!Number.isFinite(at)) continue;
				if (soonest === undefined || at < soonest) soonest = at;
			}
		}
		return soonest;
	}

	/**
	 * A project came back from the archive: a clock schedule whose next run fell in the past meanwhile moves to its next
	 * slot after now, so the missed slots do not run as one catch-up. Schedules whose next run is still ahead, paused
	 * ones and event rules are left as they were.
	 */
	async resume(projectId: string): Promise<void> {
		await this.#enqueue(async () => {
			const now = this.#now();
			const list = await this.list(projectId);
			let changed = false;
			const next = list.map((schedule) => {
				if (!schedule.enabled || isEventSpec(schedule.spec) || schedule.nextRunAt === null) return schedule;
				if (Date.parse(schedule.nextRunAt) > now) return schedule;
				const at = nextRunAfter(schedule.spec, now, this.timezone, anchorOf(schedule));
				changed = true;
				return { ...schedule, nextRunAt: at === undefined ? null : new Date(at).toISOString() };
			});
			if (changed) await this.#persist(projectId, next);
		});
	}

	/**
	 * Create a schedule, or replace the one `scheduleId` names. The next run is recomputed from now, so an edit takes
	 * effect immediately; `runs` and the creation facts are kept.
	 */
	async save(
		projectId: string,
		input: ScheduleInput,
		options: { createdBy: "user" | "coordinator"; scheduleId?: string },
	): Promise<Schedule> {
		await this.#projects.require(projectId);
		const problem = validateSpec(input.spec, this.timezone);
		if (problem !== undefined) throw new ServerError("bad_request", problem);
		const spec = normalizedSpec(input.spec);
		return this.#enqueue(async () => {
			const list = await this.list(projectId);
			const existing =
				options.scheduleId === undefined
					? undefined
					: list.find((schedule) => schedule.id === options.scheduleId);
			if (options.scheduleId !== undefined && existing === undefined) {
				throw new ServerError(
					"unknown_schedule",
					`No schedule "${options.scheduleId}" in this project`,
					{ scheduleId: options.scheduleId },
				);
			}
			const now = this.#now();
			const at = new Date(now).toISOString();
			const createdAt = existing?.createdAt ?? at;
			const next = input.enabled
				? nextRunAfter(spec, now, this.timezone, Date.parse(createdAt) || now)
				: undefined;
			if (input.enabled && next === undefined && !isEventSpec(spec)) {
				throw new ServerError("bad_request", "This schedule never runs: no matching time was found");
			}
			const record: Schedule = {
				...input,
				spec,
				id: existing?.id ?? newScheduleId(list, input.title),
				createdBy: existing?.createdBy ?? options.createdBy,
				createdAt,
				updatedAt: at,
				nextRunAt: next === undefined ? null : new Date(next).toISOString(),
				runs: existing?.runs ?? [],
				// The harness's pointer to the schedule's board task: an edit keeps it, an event rule has none.
				...(!isEventSpec(spec) && existing?.taskId != null ? { taskId: existing.taskId } : {}),
				...(isEventSpec(spec) && existing?.eventState !== undefined ? { eventState: existing.eventState } : {}),
			};
			const schedules =
				existing === undefined
					? [...list, record]
					: list.map((schedule) => (schedule.id === record.id ? record : schedule));
			await this.#persist(projectId, schedules);
			return record;
		});
	}

	async delete(projectId: string, scheduleId: string): Promise<void> {
		await this.#projects.require(projectId);
		await this.#enqueue(async () => {
			const list = await this.list(projectId);
			if (!list.some((schedule) => schedule.id === scheduleId)) {
				throw new ServerError("unknown_schedule", `No schedule "${scheduleId}" in this project`, { scheduleId });
			}
			await this.#persist(
				projectId,
				list.filter((schedule) => schedule.id !== scheduleId),
			);
		});
	}

	/**
	 * Add or replace one run in a schedule's history, newest first, and optionally move its next run. With `sameSlot`,
	 * a run recorded for the same due time is replaced instead of added, so retrying one slot after a crash (or writing
	 * its intent before its outcome) leaves one entry; a manual run is a slot of its own and is always added.
	 */
	async recordRun(
		projectId: string,
		scheduleId: string,
		run: ScheduleRun,
		options: { nextRunAt?: string | null; sameSlot?: boolean; scheduleTaskId?: string } = {},
	): Promise<Schedule> {
		return this.#enqueue(async () => {
			const list = await this.list(projectId);
			const schedule = list.find((entry) => entry.id === scheduleId);
			if (schedule === undefined) {
				throw new ServerError("unknown_schedule", `No schedule "${scheduleId}" in this project`, { scheduleId });
			}
			const sameRun = (entry: ScheduleRun): boolean => entry.at === run.at && (entry.ref ?? null) === (run.ref ?? null);
			const kept = options.sameSlot === false ? schedule.runs : schedule.runs.filter((entry) => !sameRun(entry));
			const record: Schedule = {
				...schedule,
				runs: [run, ...kept].slice(0, KEPT_SCHEDULE_RUNS),
				...(options.nextRunAt === undefined ? {} : { nextRunAt: options.nextRunAt }),
				...(options.scheduleTaskId === undefined ? {} : { taskId: options.scheduleTaskId }),
			};
			await this.#persist(
				projectId,
				list.map((entry) => (entry.id === record.id ? record : entry)),
			);
			return record;
		});
	}

	/**
	 * Note how the last check of GitHub went, for the app. Pushed to the app but not to the clocks: a check that fails
	 * must not make the poller look again at once.
	 */
	async recordEventState(
		projectId: string,
		scheduleId: string,
		state: { checkedAt: string; error: string | null },
	): Promise<void> {
		await this.#enqueue(async () => {
			const list = await this.list(projectId);
			const schedule = list.find((entry) => entry.id === scheduleId);
			if (schedule === undefined) return;
			const same = schedule.eventState?.checkedAt === state.checkedAt && schedule.eventState?.error === state.error;
			if (same) return;
			const record: Schedule = { ...schedule, eventState: state };
			await this.#persist(
				projectId,
				list.map((entry) => (entry.id === record.id ? record : entry)),
				{ quiet: true },
			);
		});
	}

	#enqueue<T>(work: () => Promise<T>): Promise<T> {
		const run = this.#queue.then(work);
		this.#queue = run.catch((error: unknown) => {
			this.#log(`schedules: write failed: ${errorMessage(error)}`);
		});
		return run;
	}

	async #load(projectId: string): Promise<Schedule[]> {
		await this.#projects.require(projectId);
		let value: unknown;
		try {
			value = await readJsonFile(this.fileOf(projectId));
		} catch (error) {
			this.#log(`project ${projectId}: schedules are unreadable, starting empty: ${errorMessage(error)}`);
			return [];
		}
		if (value === undefined) return [];
		const file = value as Partial<SchedulesFile>;
		if (typeof value !== "object" || value === null || !Array.isArray(file.schedules)) {
			this.#log(`project ${projectId}: schedules.json has an unexpected shape, starting empty`);
			return [];
		}
		// A file written in another timezone, or by a version with no next run, is repaired here: a schedule keeps its
		// persisted next run when it is still meaningful, and gets a fresh one otherwise.
		const sameZone = file.timezone === this.timezone;
		const now = this.#now();
		const schedules: Schedule[] = [];
		for (const entry of file.schedules) {
			if (!Value.Check(ScheduleSchema, entry)) {
				this.#log(`project ${projectId}: dropping a schedule that does not match the protocol`);
				continue;
			}
			const record = entry as Schedule;
			const anchor = anchorOf(record);
			const stored = record.nextRunAt === null ? Number.NaN : Date.parse(record.nextRunAt);
			const keepStored = sameZone && Number.isFinite(stored);
			const next = !record.enabled || isEventSpec(record.spec) ? null : keepStored ? stored : (nextRunAfter(record.spec, now, this.timezone, anchor) ?? now);
			const nextRunAt = next === null ? null : new Date(next).toISOString();
			if (record.enabled && !isEventSpec(record.spec) ? next !== stored : record.nextRunAt !== null) {
				this.#log(
					`project ${projectId}: schedule ${record.id} was re-timed to ${nextRunAt ?? "paused"} in ${this.timezone}`,
				);
			}
			schedules.push({ ...record, nextRunAt });
		}
		return schedules;
	}

	async #persist(projectId: string, schedules: Schedule[], options: { quiet?: boolean } = {}): Promise<void> {
		const file: SchedulesFile = { version: 1, timezone: this.timezone, schedules };
		await writeJsonFile(this.fileOf(projectId), file, 0o600);
		this.#cache.set(projectId, schedules);
		try {
			if (options.quiet === true) this.onEventStateChange?.(projectId);
			else this.onChange?.(projectId);
		} catch (error) {
			this.#log(`project ${projectId}: schedule listener failed: ${errorMessage(error)}`);
		}
	}
}

// --- the clock ----------------------------------------------------------------------------------------------------

export type ScheduleSchedulerOptions = {
	store: ScheduleStore;
	/** Run one due schedule: open its project and start the worker there. */
	fire: (projectId: string, scheduleId: string, trigger: "schedule" | "catch-up") => Promise<void>;
	/** Default: `Date.now`. */
	now?: () => number;
	/** Default: `setTimeout`. */
	setTimer?: SetTimer;
	log?: (message: string) => void;
};

/**
 * The backend's one clock: it reads every project's persisted next run, arms one timer for the soonest, and fires the
 * ones that are due. Starting it also catches up, once, on whatever was missed while the process was off.
 */
export class ScheduleScheduler {
	readonly #options: ScheduleSchedulerOptions;
	readonly #now: () => number;
	readonly #setTimer: SetTimer;
	readonly #log: (message: string) => void;
	#disarm: (() => void) | undefined;
	#chain: Promise<void> = Promise.resolve();
	#stopped = true;

	constructor(options: ScheduleSchedulerOptions) {
		this.#options = options;
		this.#now = options.now ?? Date.now;
		this.#setTimer =
			options.setTimer ??
			((callback, delayMs) => {
				const timer = setTimeout(callback, delayMs);
				timer.unref?.();
				return () => clearTimeout(timer);
			});
		this.#log = options.log ?? ((message) => console.log(message));
	}

	/** Catch up on missed runs, then start the timer. */
	async start(): Promise<void> {
		this.#stopped = false;
		await this.#queue(async () => {
			await this.#fireDue("catch-up");
			await this.#arm();
		});
	}

	/**
	 * Look again now: after a schedule was saved, deleted or ran, or when a test moves the clock. Due runs fire with
	 * trigger `schedule`; the catch-up pass only happens in `start()`.
	 */
	async wake(): Promise<void> {
		await this.#queue(async () => {
			if (this.#stopped) return;
			await this.#fireDue("schedule");
			await this.#arm();
		});
	}

	stop(): void {
		this.#stopped = true;
		this.#disarm?.();
		this.#disarm = undefined;
	}

	async #queue(work: () => Promise<void>): Promise<void> {
		const run = this.#chain.then(work);
		this.#chain = run.catch((error: unknown) => {
			this.#log(`schedules: ${errorMessage(error)}`);
		});
		return run.catch(() => undefined);
	}

	async #fireDue(trigger: "schedule" | "catch-up"): Promise<void> {
		for (const { projectId, schedule } of await this.#options.store.due(this.#now())) {
			if (this.#stopped) return;
			try {
				await this.#options.fire(projectId, schedule.id, trigger);
			} catch (error) {
				this.#log(`project ${projectId}: schedule ${schedule.id} did not run: ${errorMessage(error)}`);
			}
		}
	}

	async #arm(): Promise<void> {
		this.#disarm?.();
		this.#disarm = undefined;
		if (this.#stopped) return;
		const next = await this.#options.store.nextDue();
		if (next === undefined) return;
		const delay = Math.min(Math.max(0, next - this.#now()), MAX_TIMER_DELAY_MS);
		const armed = this.#setTimer(
			() => {
				this.#disarm = undefined;
				void this.wake();
			},
			delay,
			{ background: false },
		);
		this.#disarm = armed;
		if (armed === undefined) {
			// A host that declines timers still gets a pass when something else wakes the scheduler; say so once.
			this.#log("schedules: the host declined the timer; due runs wait for the next change or start");
		}
	}
}

// --- one project's schedules, as the coordinator sees them ------------------------------------------------------

export type SchedulesServiceOptions = {
	/** Read at each use, so a renamed project or a changed list applies at once. */
	project(): { id: string; name?: string };
	store: ScheduleStore;
	workers: WorkerService;
	/** Starts the background thread of a `thread` schedule; without it such a run fails. */
	threads?: ThreadService;
	/** Where a failed or skipped run opens (or updates) the schedule's blocked task. */
	board?: BoardService;
	/** Told when a run failed or was skipped, so the user's devices hear about it. Never waited for. */
	notifications?: Notifier;
	/** Run now for an event rule: checks GitHub and starts the runs. Set by the server, which owns the poller. */
	runEventNow?: (projectId: string, scheduleId: string) => Promise<ScheduleRun>;
	/** The harness clock, for tests. Default: `Date.now`. */
	now?: () => number;
	log(message: string): void;
};

/**
 * One project's schedules: the coordinator's tools, `Run now`, and the firing itself. Everything durable lives in the
 * store; this class is the part that needs the project's Harness and its workers.
 */
export class SchedulesService {
	readonly #options: SchedulesServiceOptions;
	readonly #now: () => number;
	#extension: Extension | undefined;

	constructor(options: SchedulesServiceOptions) {
		this.#options = options;
		this.#now = options.now ?? Date.now;
	}

	get timezone(): string {
		return this.#options.store.timezone;
	}

	/** The extension the coordinator selects and workers remove: the `schedule_*` tools. */
	get extension(): Extension {
		this.#extension ??= createScheduleExtension(this);
		return this.#extension;
	}

	async list(): Promise<Schedule[]> {
		return this.#options.store.list(this.#options.project().id);
	}

	async save(
		input: ScheduleInput,
		options: { createdBy: "user" | "coordinator"; scheduleId?: string },
	): Promise<Schedule> {
		return this.#options.store.save(this.#options.project().id, input, options);
	}

	async delete(scheduleId: string): Promise<void> {
		await this.#options.store.delete(this.#options.project().id, scheduleId);
	}

	/** Run a schedule now, enabled or not; it counts as a run like any other. */
	async runNow(scheduleId: string): Promise<ScheduleRun> {
		const schedule = await this.#options.store.find(this.#options.project().id, scheduleId);
		if (schedule === undefined) {
			throw new ServerError("unknown_schedule", `No schedule "${scheduleId}" in this project`, { scheduleId });
		}
		if (isEventSpec(schedule.spec)) {
			if (this.#options.runEventNow === undefined) {
				throw new ServerError("bad_request", "This backend cannot check GitHub for events.");
			}
			return this.#options.runEventNow(this.#options.project().id, schedule.id);
		}
		return this.#run(schedule, "manual", this.#now());
	}

	/**
	 * One event run: its own board task (the pull request's URL in its refs), then a worker or a thread that works on
	 * it with the user's brief plus the event. Nothing is skipped because another run is going: different pull requests
	 * run at once, and the same request finds what it already started.
	 */
	async fireEvent(schedule: Schedule, request: ReviewRequest, options: FireEventOptions): Promise<ScheduleRun> {
		const projectId = this.#options.project().id;
		const manual = options.trigger === "manual";
		const at = manual ? new Date(this.#now()).toISOString() : request.requestedAt;
		const base = { at, trigger: options.trigger, ref: request.url } as const;
		const kind = options.rerunAt === undefined ? {} : { rerunAt: options.rerunAt };
		const identity = eventRunIdentity(schedule.id, request, kind);
		// Written before anything starts: a crash from here on leaves the run in the history, and the retry finds the same
		// task, worker or thread. A run by hand has no slot to retry, so it is written once, when it is over.
		if (!manual) {
			await this.#options.store.recordRun(projectId, schedule.id, {
				...base,
				outcome: "started",
				workerId: null,
				threadId: null,
				taskId: null,
				message: null,
			});
		}
		let run: ScheduleRun;
		try {
			const board = this.#options.board;
			if (board === undefined) throw new Error("this backend has no board to put the task on");
			const task = await board.taskForEvent({
				title: eventTaskTitle(request),
				description: eventTaskDescription(request, eventTaskMarker(request, kind)),
				marker: eventTaskMarker(request, kind),
				ref: request.url,
			});
			const brief = eventBrief(schedule.brief, request);
			const event = { id: identity.id, key: identity.key, taskId: task.id };
			if (schedule.kind === "thread") {
				const threads = this.#options.threads;
				const started =
					threads === undefined
						? ({ ok: false, message: "this backend cannot start background threads" } as const)
						: await threads.startScheduled({
								scheduleId: schedule.id,
								title: task.title,
								brief,
								model: schedule.model,
								thinkingLevel: schedule.thinkingLevel,
								onFinish: schedule.onReport,
								at: Date.parse(request.requestedAt),
								timezone: this.timezone,
								event,
							});
				run = started.ok
					? { ...base, outcome: "started", workerId: null, threadId: started.record.id, taskId: task.id, message: null }
					: { ...base, outcome: "failed", workerId: null, threadId: null, taskId: task.id, message: started.message };
			} else {
				const started = await this.#options.workers.startScheduledRun({
					scheduleId: schedule.id,
					title: task.title,
					brief,
					model: schedule.model,
					thinkingLevel: schedule.thinkingLevel,
					isolation: schedule.isolation,
					onReport: schedule.onReport,
					at: Date.parse(request.requestedAt),
					timezone: this.timezone,
					event,
				});
				run = started.ok
					? { ...base, outcome: "started", workerId: started.workerId, threadId: null, taskId: task.id, message: null }
					: { ...base, outcome: "failed", workerId: null, threadId: null, taskId: task.id, message: started.message };
			}
		} catch (error) {
			run = { ...base, outcome: "failed", workerId: null, threadId: null, taskId: null, message: errorMessage(error) };
		}
		if (run.outcome === "failed") {
			this.#options.log(`schedule ${schedule.id}: the run for ${request.url} failed: ${run.message ?? "unknown reason"}`);
		}
		await this.#finish(projectId, schedule, run, options.trigger);
		return run;
	}

	/** One due run: record it, start the worker, move the next run on. `at` is when it was due. */
	async fire(schedule: Schedule, trigger: "schedule" | "catch-up", at: number): Promise<ScheduleRun> {
		return this.#run(schedule, trigger, at);
	}

	/** When this schedule runs next, counted from now; null when it has no next run at all. */
	nextRunAt(schedule: Schedule): string | null {
		const next = nextRunAfter(schedule.spec, this.#now(), this.timezone, anchorOf(schedule));
		return next === undefined ? null : new Date(next).toISOString();
	}

	async #run(schedule: Schedule, trigger: ScheduleRun["trigger"], at: number): Promise<ScheduleRun> {
		if (schedule.kind === "thread") return this.#runThread(schedule, trigger, at);
		const projectId = this.#options.project().id;
		const runAt = new Date(at).toISOString();
		const state = await this.#options.workers.state();
		const previous = schedule.runs.find((run) => run.outcome === "started" && run.workerId !== null);
		const previousWorker = previous?.workerId === null || previous === undefined ? undefined : state.workers[previous.workerId];
		if (previousWorker !== undefined && previousWorker.status === "running") {
			const run: ScheduleRun = {
				at: runAt,
				trigger,
				outcome: "skipped",
				workerId: null,
				message: "previous run still running",
			};
			await this.#finish(projectId, schedule, run, trigger);
			return run;
		}

		// Written before the worker exists: a crash from here on leaves the run in the history, and retrying the same due
		// slot finds the same worker ID instead of starting a second worker. A manual run has no slot to retry, so it is
		// written once, when it is over.
		if (trigger !== "manual") {
			await this.#options.store.recordRun(projectId, schedule.id, {
				at: runAt,
				trigger,
				outcome: "started",
				workerId: null,
				message: null,
			});
		}
		// The schedule's one board task (its open one, else a new one) goes to the worker, whose spawn moves it to
		// in_progress. A board that cannot be written costs the run its task, never the run.
		const taskId = await this.#scheduleTaskId(schedule);
		const started = await this.#options.workers.startScheduledRun({
			scheduleId: schedule.id,
			title: schedule.title,
			brief: schedule.brief,
			model: schedule.model,
			thinkingLevel: schedule.thinkingLevel,
			isolation: schedule.isolation,
			onReport: schedule.onReport,
			at,
			timezone: this.timezone,
			...(taskId === undefined ? {} : { taskId }),
		});
		const withTask = taskId === undefined ? {} : { taskId };
		const run: ScheduleRun = started.ok
			? { at: runAt, trigger, outcome: "started", workerId: started.workerId, message: null, ...withTask }
			: { at: runAt, trigger, outcome: "failed", workerId: null, message: started.message, ...withTask };
		if (!started.ok) this.#options.log(`schedule ${schedule.id}: the run due ${runAt} failed: ${started.message}`);
		await this.#finish(projectId, schedule, run, trigger, taskId);
		return run;
	}

	/** A `thread` schedule's run: a background thread with the brief as its prompt, skipped while the last one works. */
	async #runThread(schedule: Schedule, trigger: ScheduleRun["trigger"], at: number): Promise<ScheduleRun> {
		const projectId = this.#options.project().id;
		const runAt = new Date(at).toISOString();
		const threads = this.#options.threads;
		const previous = schedule.runs.find((run) => run.outcome === "started" && (run.threadId ?? null) !== null);
		const previousThread =
			threads === undefined || previous?.threadId === undefined || previous.threadId === null
				? undefined
				: await threads.record(previous.threadId);
		if (previousThread !== undefined && (previousThread.status === "running" || previousThread.status === "idle")) {
			const run: ScheduleRun = {
				at: runAt,
				trigger,
				outcome: "skipped",
				workerId: null,
				threadId: null,
				message: `previous thread ${previousThread.id} is not done`,
			};
			await this.#finish(projectId, schedule, run, trigger);
			return run;
		}
		if (trigger !== "manual") {
			await this.#options.store.recordRun(projectId, schedule.id, {
				at: runAt,
				trigger,
				outcome: "started",
				workerId: null,
				threadId: null,
				message: null,
			});
		}
		const started =
			threads === undefined
				? ({ ok: false, message: "this backend cannot start background threads" } as const)
				: await threads.startScheduled({
						scheduleId: schedule.id,
						title: schedule.title,
						brief: schedule.brief,
						model: schedule.model,
						thinkingLevel: schedule.thinkingLevel,
						onFinish: schedule.onReport,
						at,
						timezone: this.timezone,
					});
		// The thread took the schedule's one board task when it started (`taskForSchedule`, in its own commit).
		const taskId = started.ok ? started.record.taskId : undefined;
		const run: ScheduleRun = started.ok
			? {
					at: runAt,
					trigger,
					outcome: "started",
					workerId: null,
					threadId: started.record.id,
					message: null,
					...(taskId === null || taskId === undefined ? {} : { taskId }),
				}
			: { at: runAt, trigger, outcome: "failed", workerId: null, threadId: null, message: started.message };
		if (!started.ok) this.#options.log(`schedule ${schedule.id}: the run due ${runAt} failed: ${started.message}`);
		await this.#finish(projectId, schedule, run, trigger, taskId ?? undefined);
		return run;
	}

	/** The board task a clock schedule's worker run is given; undefined (and logged) when the board cannot give one. */
	async #scheduleTaskId(schedule: Schedule): Promise<string | undefined> {
		const board = this.#options.board;
		if (board === undefined) return undefined;
		try {
			return (await board.scheduleTaskForRun({ scheduleId: schedule.id, title: schedule.title })).id;
		} catch (error) {
			this.#options.log(`schedule ${schedule.id}: could not get its board task: ${errorMessage(error)}`);
			return undefined;
		}
	}

	/**
	 * Record what happened and, for a due run, move the schedule past now so nothing bursts. `scheduleTaskId` is the
	 * clock schedule's board task the run was given, kept on the schedule for the app's link.
	 */
	async #finish(
		projectId: string,
		schedule: Schedule,
		run: ScheduleRun,
		trigger: ScheduleRun["trigger"],
		scheduleTaskId?: string,
	): Promise<void> {
		// A manual run changes no schedule; an event run has no next time to move.
		const clock = trigger === "schedule" || trigger === "catch-up";
		const nextRunAt = clock ? this.nextRunAt(schedule) : undefined;
		await this.#options.store.recordRun(projectId, schedule.id, run, {
			...(nextRunAt === undefined ? {} : { nextRunAt }),
			...(trigger === "manual" ? { sameSlot: false } : {}),
			...(scheduleTaskId === undefined || schedule.taskId === scheduleTaskId ? {} : { scheduleTaskId }),
		});
		// A run that started is not a problem, and its end is reported when its worker reports.
		if (run.outcome !== "started") {
			await this.#options.board
				?.recordScheduleProblem({
					scheduleId: schedule.id,
					title: schedule.title,
					runAt: run.ref === undefined || run.ref === null ? run.at : `${run.at} ${run.ref}`,
					reason: `${run.at} ${run.trigger} run${run.ref === undefined || run.ref === null ? "" : ` for ${run.ref}`} ${run.outcome}: ${run.message ?? "no reason recorded"}`,
				})
				.catch((error: unknown) => this.#options.log(`schedule ${schedule.id}: could not put the problem on the board: ${errorMessage(error)}`));
		}
		const event = scheduleProblemNotification({
			projectId,
			projectName: this.#options.project().name ?? projectId,
			scheduleId: schedule.id,
			scheduleTitle: schedule.title,
			run,
		});
		if (event !== undefined) this.#options.notifications?.notify(event);
	}

	/** What the coordinator is told when a schedule tool runs anywhere but its own conversation. */
	notCoordinatorMessage(tool: string): string {
		return `${tool} answers only the project's coordinator conversation, never a worker. A worker reports what it needs to the coordinator and lets it decide; it does not schedule work.`;
	}

	/** Schedules are main's: a background thread never gets these tools, and one that kept them is refused. */
	isCoordinator(conversationId: number): boolean {
		return this.#options.workers.coordinators.isMain(conversationId);
	}
}

// --- the coordinator's tools --------------------------------------------------------------------------------------

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

const scheduleInputSchema = Type.Object({
	id: Type.Optional(
		Type.String({ minLength: 1, description: "The schedule to edit; omit to create a new one." }),
	),
	title: Type.String({ minLength: 1, description: "One line naming the schedule." }),
	brief: Type.String({
		minLength: 1,
		description: 'The worker\'s task, self-contained, as for worker_spawn; for kind "thread", the thread\'s prompt.',
	}),
	kind: Type.Optional(
		Type.Union([Type.Literal("worker"), Type.Literal("thread")], {
			description:
				'"worker" (default): each run is one worker of yours. "thread": each run starts a background thread with the brief as its prompt, for big recurring work; its summary reaches you per onReport, and isolation is ignored.',
		}),
	),
	// The protocol's own spec schema, so a tool argument is validated exactly like one the app sends.
	spec: ScheduleSpecSchema,
	model: Type.Optional(
		Type.Union([ModelRefSchema, Type.Null()], {
			description:
				"Null (the default) resolves like any worker: the model the user picked, then the project's worker models.",
		}),
	),
	thinkingLevel: Type.Optional(Type.Union([ThinkingLevelSchema, Type.Null()])),
	isolation: Type.Optional(
		Type.Union([Type.Literal("shared"), Type.Literal("workspace")], {
			description: 'Default "shared".',
		}),
	),
	onReport: Type.Optional(
		Type.Union([Type.Literal("review"), Type.Literal("record")], {
			description:
				'"review" (default) posts the report to you and wakes you; "record" keeps it in the transcript for your next turn without waking you.',
		}),
	),
	enabled: Type.Optional(Type.Boolean({ description: "Default true." })),
});

/** The tool's arguments with the defaults a new schedule starts from, as the store and the protocol expect them. */
type ScheduleToolArgs = {
	title: string;
	brief: string;
	kind?: "worker" | "thread";
	spec: ScheduleSpec;
	model?: ModelRef | null;
	thinkingLevel?: ThinkingLevel | null;
	isolation?: WorkerIsolation;
	onReport?: ScheduleOnReport;
	enabled?: boolean;
};

function scheduleInputOf(args: ScheduleToolArgs): ScheduleInput {
	return {
		title: args.title.trim(),
		brief: args.brief,
		spec: args.spec,
		model: args.model ?? null,
		thinkingLevel: args.thinkingLevel ?? null,
		isolation: args.isolation ?? "shared",
		onReport: args.onReport ?? "review",
		enabled: args.enabled ?? true,
		...(args.kind === undefined ? {} : { kind: args.kind }),
	};
}

/** The schedule as the coordinator reads it in a tool answer, with when it runs next in local time. */
export function describeSchedule(schedule: Schedule, timezone: string): string {
	const next = isEventSpec(schedule.spec)
		? schedule.enabled
			? `no clock: GitHub is checked every 2 minutes${schedule.eventState?.checkedAt == null ? "" : `, last at ${schedule.eventState.checkedAt}`}${schedule.eventState?.error == null ? "" : ` (last check failed: ${schedule.eventState.error})`}`
			: "paused (disabled)"
		: schedule.nextRunAt === null
			? "paused (disabled)"
			: `${formatLocalTime(Date.parse(schedule.nextRunAt), timezone)} (${schedule.nextRunAt})`;
	const model = schedule.model === null ? "the project's worker model" : `${schedule.model.provider}/${schedule.model.modelId}`;
	const thinking = schedule.thinkingLevel === null ? "" : `, thinking ${schedule.thinkingLevel}`;
	const report =
		schedule.onReport === "review" ? "its reports wake you" : "its reports are kept for your next turn";
	const runs =
		schedule.kind === "thread"
			? `  background thread: ${schedule.model === null ? "the project's coordinator model" : model}${thinking}; ${report.replace("reports", "summaries")}`
			: `  worker: ${model}${thinking}, isolation ${schedule.isolation}; ${report}`;
	return [
		`${schedule.id} — ${schedule.title}`,
		`  when: ${describeSpec(schedule.spec)}${schedule.enabled ? "" : ", disabled"}`,
		`  next: ${next}`,
		runs,
		`  created by ${schedule.createdBy} at ${schedule.createdAt}`,
	].join("\n");
}

function describeRun(run: ScheduleRun, timezone: string): string {
	const when = formatLocalTime(Date.parse(run.at), timezone);
	const about = run.ref === undefined || run.ref === null ? "" : ` for ${run.ref}`;
	switch (run.outcome) {
		case "started":
			return (run.threadId ?? null) !== null
				? `${when} ${run.trigger}${about}: started thread ${run.threadId}`
				: `${when} ${run.trigger}${about}: started worker ${run.workerId ?? "(unknown)"}`;
		case "skipped":
			return `${when} ${run.trigger}${about}: skipped (${run.message ?? "no reason recorded"})`;
		case "failed":
			return `${when} ${run.trigger}${about}: failed (${run.message ?? "no reason recorded"})`;
	}
}

function createScheduleExtension(service: SchedulesService): Extension {
	const listTool = defineTool({
		name: "schedule_list",
		description:
			"List this project's schedules: what each runs, when it runs next in the backend's timezone, its worker model " +
			"and isolation, whether its reports wake you, and its last runs. Schedules run as workers of yours on the " +
			"project's clock, even while no conversation is open.",
		parameters: Type.Object({}),
		replay: "safe",
		execute: async (_args, api) => {
			if (!service.isCoordinator(api.conversationId)) {
				return toolText(service.notCoordinatorMessage("schedule_list"), { isError: true });
			}
			const schedules = await service.list();
			const header = `Schedules run in ${service.timezone}.`;
			if (schedules.length === 0) {
				return toolText(`${header}\nNo schedules yet. Create one with schedule_save.`);
			}
			const body = schedules
				.map((schedule) => {
					const lines = [describeSchedule(schedule, service.timezone)];
					if (schedule.runs.length > 0) {
						lines.push("  last runs:");
						for (const run of schedule.runs.slice(0, 5)) lines.push(`    ${describeRun(run, service.timezone)}`);
					}
					return lines.join("\n");
				})
				.join("\n\n");
			return toolText(`${header}\n\n${body}`);
		},
	});

	const saveTool = defineTool({
		name: "schedule_save",
		// Creates or edits a schedule; a script may only read them through schedule_list.
		callers: ["model"],
		description:
			"Create a schedule (omit `id`) or edit one (pass its `id`): a self-contained brief that runs as one of your " +
			"workers at the times you name, in the backend's timezone. Saving recomputes the next run from now. Use it " +
			"for recurring work: dependency updates, nightly checks, a weekly review. The rule can also be an event " +
			'(spec kind "github-review-requested"): one run for each new GitHub review request to the user, with its own ' +
			"board task. Ask the user before creating one that writes to the project on its own.",
		parameters: scheduleInputSchema,
		replay: "safe",
		execute: async (args, api) => {
			if (!service.isCoordinator(api.conversationId)) {
				return toolText(service.notCoordinatorMessage("schedule_save"), { isError: true });
			}
			const problem = validateSpec(args.spec, service.timezone);
			if (problem !== undefined) return toolText(problem, { isError: true });
			try {
				const schedule = await service.save(scheduleInputOf(args), {
					createdBy: "coordinator",
					...(args.id === undefined ? {} : { scheduleId: args.id }),
				});
				return toolText(
					`Saved the schedule.\n\n${describeSchedule(schedule, service.timezone)}`,
					{ details: { scheduleId: schedule.id } },
				);
			} catch (error) {
				return toolText(errorMessage(error), { isError: true });
			}
		},
	});

	const deleteTool = defineTool({
		name: "schedule_delete",
		// Deletes a schedule; a script may only read them through schedule_list.
		callers: ["model"],
		description: "Delete a schedule. A run already started keeps running; only future runs stop.",
		parameters: Type.Object({ id: Type.String({ minLength: 1, description: "The schedule's ID." }) }),
		replay: "unsafe",
		execute: async (args, api) => {
			if (!service.isCoordinator(api.conversationId)) {
				return toolText(service.notCoordinatorMessage("schedule_delete"), { isError: true });
			}
			try {
				await service.delete(args.id);
				return toolText(`Deleted schedule "${args.id}".`, { details: { scheduleId: args.id } });
			} catch (error) {
				return toolText(errorMessage(error), { isError: true });
			}
		},
	});

	const runTool = defineTool({
		name: "schedule_run",
		// Starts a run; a script may only read schedules through schedule_list.
		callers: ["model"],
		description:
			"Run a schedule now, whether it is enabled or not. It starts a worker with the schedule's brief and model, " +
			"exactly as if the clock had fired, and does not change when it runs next. Skipped while its previous run is " +
			"still running. For an event rule it checks GitHub at once and runs the requests not handled yet.",
		parameters: Type.Object({ id: Type.String({ minLength: 1, description: "The schedule's ID." }) }),
		// Repeating a start could run the brief twice; the worker-history record already exists by then.
		replay: "unsafe",
		execute: async (args, api) => {
			if (!service.isCoordinator(api.conversationId)) {
				return toolText(service.notCoordinatorMessage("schedule_run"), { isError: true });
			}
			try {
				const run = await service.runNow(args.id);
				const label =
					run.outcome === "started"
						? (run.threadId ?? null) !== null
							? `Started background thread "${run.threadId}". Its summary arrives according to the schedule's onReport.`
							: `Started worker "${run.workerId}". Its report arrives according to the schedule's onReport.`
						: run.outcome === "skipped"
							? `Skipped: ${run.message ?? "it is still running"}.`
							: `It could not run: ${run.message ?? "unknown reason"}.`;
				return toolText(label, {
					...(run.outcome === "failed" ? { isError: true } : {}),
					details: { scheduleId: args.id, outcome: run.outcome },
				});
			} catch (error) {
				return toolText(errorMessage(error), { isError: true });
			}
		},
	});

	return defineExtension({
		name: "schedule-tools",
		tools: [listTool, saveTool, deleteTool, runTool] as ToolRegistration[],
	});
}
