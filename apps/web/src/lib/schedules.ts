/**
 * How a scheduled task reads in the app: the schedule in plain words, when it next runs in the backend's timezone,
 * what its last run did, and what the editor accepts. Pure functions, so they are tested without a component.
 *
 * A schedule's times are in the backend's timezone, never the browser's: the harness fires them on the server, so the
 * app shows both a relative phrase and the absolute time with the timezone named.
 */
import { latestScheduleRun } from "@aiki/client";
import { isEventSpec, normalizeGithubRepo } from "@aiki/protocol";
import type {
	ModelRef,
	Schedule,
	ScheduleInput,
	ScheduleOnReport,
	ScheduleRun,
	ScheduleSpec,
	ThinkingLevel,
	WorkerIsolation,
} from "@aiki/protocol";
import { relativeTime } from "./relative-time.ts";

/** Sunday first, as the protocol numbers days. */
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** The day names the editor's day picker and a weekly description use, Sunday first. */
export const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS = [1, 2, 3, 4, 5];
const WEEKEND = [0, 6];
const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;
/** How often the backend checks GitHub for an event rule; the backend's own interval, told to the user. */
export const EVENT_POLL_MINUTES = 2;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** The shortest and longest interval a schedule may repeat on, in minutes: the protocol's own bounds. */
export const MIN_INTERVAL_MINUTES = 5;
export const MAX_INTERVAL_MINUTES = 10_080;

/** `HH:MM`, 24-hour, the protocol's time-of-day format. */
export function isTimeOfDay(value: string): boolean {
	return /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(value);
}

function plural(count: number, unit: string): string {
	return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

/** "Every hour", "Every 2 hours", "Every 5 minutes": a count of one drops the number. */
function everyPhrase(count: number, unit: string): string {
	return count === 1 ? `Every ${unit}` : `Every ${plural(count, unit)}`;
}

function dayList(days: readonly number[]): string {
	const names = [...new Set(days)]
		.filter((day) => day >= 0 && day <= 6)
		.sort((left, right) => left - right)
		.map((day) => DAY_SHORT[day] ?? "");
	const last = names[names.length - 1];
	if (names.length === 1) return last ?? "";
	return `${names.slice(0, -1).join(", ")} and ${last}`;
}

function sameDays(days: readonly number[], expected: readonly number[]): boolean {
	const actual = [...new Set(days)].sort((left, right) => left - right);
	return actual.length === expected.length && actual.every((day, index) => day === expected[index]);
}

/**
 * A schedule in plain words: "Every 30 minutes", "Every 2 hours", "Weekdays at 09:00", "Mon, Wed and Fri at 18:30",
 * the raw expression for a cron schedule, which has no short English form, or the event an event rule waits for.
 */
export function describeSchedule(spec: ScheduleSpec): string {
	switch (spec.kind) {
		case "github-review-requested":
			return spec.repos === undefined || spec.repos.length === 0
				? "When a review is requested from you on GitHub"
				: `When a review is requested from you on GitHub in ${spec.repos.join(", ")}`;
		case "interval": {
			const minutes = spec.everyMinutes;
			if (minutes % MINUTES_PER_DAY === 0) return everyPhrase(minutes / MINUTES_PER_DAY, "day");
			if (minutes % MINUTES_PER_HOUR === 0) return everyPhrase(minutes / MINUTES_PER_HOUR, "hour");
			return everyPhrase(minutes, "minute");
		}
		case "daily":
			return `Every day at ${spec.time}`;
		case "weekly": {
			const days = [...new Set(spec.days)].sort((left, right) => left - right);
			// A single day reads better as "Every Monday" than as a list of one.
			if (sameDays(days, WEEKDAYS)) return `Weekdays at ${spec.time}`;
			if (sameDays(days, WEEKEND)) return `Weekends at ${spec.time}`;
			if (days.length === 7) return `Every day at ${spec.time}`;
			if (days.length === 1) return `Every ${DAY_NAMES[days[0] ?? 0] ?? "day"} at ${spec.time}`;
			return `${dayList(days)} at ${spec.time}`;
		}
		case "cron":
			return `Cron: ${spec.expression}`;
	}
}

/** "in less than a minute", "in 25 min", "in 3 h", "in 2 d". A time already past says so instead of going negative. */
export function untilPhrase(deltaMs: number): string {
	if (deltaMs < HOUR_MS) {
		if (deltaMs < 60_000) return "in less than a minute";
		return `in ${Math.max(1, Math.round(deltaMs / 60_000))} min`;
	}
	if (deltaMs < DAY_MS) return `in ${Math.round(deltaMs / HOUR_MS)} h`;
	const days = Math.round(deltaMs / DAY_MS);
	if (days < 30) return `in ${plural(days, "day")}`;
	return `in ${plural(Math.round(days / 30), "month")}`;
}

/**
 * A time as the backend's clock reads it, with the timezone named: "Sat, 7 Nov 2026, 09:00 (Europe/Bucharest)". A
 * timezone the browser does not know falls back to the browser's own time instead of throwing.
 */
export function absoluteTime(at: string, timezone: string): string {
	const ms = Date.parse(at);
	if (!Number.isFinite(ms)) return at;
	try {
		const date = new Intl.DateTimeFormat("en-GB", {
			timeZone: timezone,
			weekday: "short",
			day: "numeric",
			month: "short",
			year: "numeric",
		}).format(ms);
		const time = new Intl.DateTimeFormat("en-GB", {
			timeZone: timezone,
			hour: "2-digit",
			minute: "2-digit",
			hourCycle: "h23",
		}).format(ms);
		return `${date}, ${time} (${timezone})`;
	} catch {
		return new Date(ms).toLocaleString();
	}
}

/** When a schedule next runs: relative and absolute, or that it does not, because it is paused. */
export function nextRunText(nextRunAt: string | null, timezone: string, now: number): string {
	if (nextRunAt === null) return "Paused";
	const ms = Date.parse(nextRunAt);
	if (!Number.isFinite(ms)) return "Next run at an unknown time";
	return `Next ${untilPhrase(ms - now)} · ${absoluteTime(nextRunAt, timezone)}`;
}

/**
 * What a schedule says about when it runs: the next run's time for a clock rule; for an event rule how GitHub is
 * checked and how the last check went, since there is no next time.
 */
export function whenText(
	schedule: Pick<Schedule, "spec" | "enabled" | "nextRunAt" | "eventState">,
	timezone: string,
	now: number,
): string {
	if (!isEventSpec(schedule.spec)) return nextRunText(schedule.nextRunAt, timezone, now);
	if (!schedule.enabled) return "Paused";
	const state = schedule.eventState;
	const every = `Checks GitHub every ${EVENT_POLL_MINUTES} min`;
	if (state === undefined || state === null || state.checkedAt === null) return `${every} · not checked yet`;
	const error = state.error?.trim();
	const last = relativeTime(state.checkedAt, now);
	return error === undefined || error.length === 0
		? `${every} · last checked ${last}`
		: `${every} · last check failed ${last}: ${error}`;
}

/** The pull request a run was about as a chip says it ("platform#1205"), or undefined for a clock run. */
export function runRefLabel(run: Pick<ScheduleRun, "ref">): string | undefined {
	if (run.ref === undefined || run.ref === null) return undefined;
	const match = /github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/.exec(run.ref);
	return match === null ? run.ref : `${match[1]}#${match[2]}`;
}

/** What started a run. */
export function runTriggerLabel(trigger: ScheduleRun["trigger"]): string {
	switch (trigger) {
		case "schedule":
			return "Scheduled";
		case "catch-up":
			return "Catch-up";
		case "manual":
			return "Run by hand";
		case "event":
			return "Review requested";
	}
}

/** What a run did. */
export function runOutcomeLabel(outcome: ScheduleRun["outcome"]): string {
	switch (outcome) {
		case "started":
			return "Started";
		case "skipped":
			return "Skipped";
		case "failed":
			return "Failed";
	}
}

/** Why a run did nothing, when it did nothing; a started run says nothing here. */
export function runReason(run: ScheduleRun): string | undefined {
	const message = run.message?.trim();
	return message === undefined || message.length === 0 ? undefined : message;
}

/**
 * The last run of a schedule as one line: when it ran and what happened. A skip or a failure carries its reason, since
 * that is the part the user acts on; "Never ran" covers a schedule that has not fired yet.
 */
export function lastRunText(schedule: Pick<Schedule, "runs">, now: number): string {
	const run = latestScheduleRun(schedule);
	if (run === undefined) return "Never ran";
	const when = relativeTime(run.at, now);
	switch (run.outcome) {
		case "started":
			return `Last run started ${when}`;
		case "skipped":
			return `Skipped ${when} — ${runReason(run) ?? "not started"}`;
		case "failed":
			return `Failed ${when} — ${runReason(run) ?? "unknown reason"}`;
	}
}

/**
 * The badge on a worker a schedule started: the schedule's title, or "Scheduled task" while the list is loading or
 * after the schedule was deleted. Undefined for a worker the coordinator started itself.
 */
export function workerScheduleLabel(
	scheduleId: string | null | undefined,
	title: string | undefined,
): string | undefined {
	if (scheduleId === null || scheduleId === undefined || scheduleId.length === 0) return undefined;
	return title !== undefined && title.length > 0 ? title : "Scheduled task";
}

/** What a schedule runs: one worker of main on the brief, or a background thread started with the prompt. */
export type ScheduleRunsAs = NonNullable<ScheduleInput["kind"]>;

/** What a stored schedule runs; a schedule from before threads has no kind and runs a worker. */
export function scheduleRunsAs(schedule: Pick<ScheduleInput, "kind">): ScheduleRunsAs {
	return schedule.kind ?? "worker";
}

/** The editor's choice, in the user's words. */
export function runsAsLabel(runsAs: ScheduleRunsAs): string {
	return runsAs === "thread" ? "Start a background thread" : "Run one worker";
}

/** The text field's label: a worker gets a brief, a thread starts from the user's own prompt. */
export function briefLabel(runsAs: ScheduleRunsAs): string {
	return runsAs === "thread" ? "Prompt" : "Brief";
}

/** The newest run's thread, for a link from the run history; undefined for a worker run or a run that did not start. */
export function runHasThread(run: ScheduleRun): run is ScheduleRun & { threadId: string } {
	return run.outcome === "started" && typeof run.threadId === "string" && run.threadId.length > 0;
}

/** Everything the editor holds while a schedule is being written. Numbers stay text until they validate. */
export type ScheduleDraft = {
	title: string;
	brief: string;
	runsAs: ScheduleRunsAs;
	kind: ScheduleSpec["kind"];
	/** The interval as typed, in the unit beside it. */
	every: string;
	everyUnit: "minutes" | "hours";
	/** `HH:MM`. */
	time: string;
	days: number[];
	cron: string;
	/** The repositories an event rule listens in, as typed: "owner/name" separated by commas, spaces or lines. */
	repos: string;
	/** `null` is "Worker default": the composer's pick, then the project's worker models. */
	model: ModelRef | null;
	thinkingLevel: ThinkingLevel | null;
	isolation: WorkerIsolation;
	onReport: ScheduleOnReport;
	enabled: boolean;
};

/** A new schedule's starting point: every weekday at 09:00, reviewed by the coordinator. */
export function emptyScheduleDraft(): ScheduleDraft {
	return {
		title: "",
		brief: "",
		runsAs: "worker",
		kind: "weekly",
		every: "30",
		everyUnit: "minutes",
		time: "09:00",
		days: [...WEEKDAYS],
		cron: "0 9 * * 1-5",
		repos: "",
		model: null,
		thinkingLevel: null,
		isolation: "shared",
		onReport: "review",
		enabled: true,
	};
}

/** The editor's fields for an existing schedule, so an edit starts from what is stored. */
export function draftFromSchedule(schedule: Schedule): ScheduleDraft {
	const spec = schedule.spec;
	const draft = emptyScheduleDraft();
	draft.title = schedule.title;
	draft.brief = schedule.brief;
	draft.runsAs = scheduleRunsAs(schedule);
	draft.kind = spec.kind;
	draft.model = schedule.model;
	draft.thinkingLevel = schedule.thinkingLevel;
	draft.isolation = schedule.isolation;
	draft.onReport = schedule.onReport;
	draft.enabled = schedule.enabled;
	if (spec.kind === "interval") {
		const hours = spec.everyMinutes >= MINUTES_PER_HOUR && spec.everyMinutes % MINUTES_PER_HOUR === 0;
		draft.everyUnit = hours ? "hours" : "minutes";
		draft.every = String(hours ? spec.everyMinutes / MINUTES_PER_HOUR : spec.everyMinutes);
	} else if (spec.kind === "daily") {
		draft.time = spec.time;
	} else if (spec.kind === "weekly") {
		draft.time = spec.time;
		draft.days = [...spec.days];
	} else if (isEventSpec(spec)) {
		draft.repos = (spec.repos ?? []).join(", ");
	} else {
		draft.cron = spec.expression;
	}
	return draft;
}

/** The editable half of a stored schedule, so a change that is not the editor's (the enabled switch) saves it whole. */
export function scheduleInput(schedule: Schedule): ScheduleInput {
	return {
		title: schedule.title,
		brief: schedule.brief,
		spec: schedule.spec,
		model: schedule.model,
		thinkingLevel: schedule.thinkingLevel,
		isolation: schedule.isolation,
		onReport: schedule.onReport,
		enabled: schedule.enabled,
		...(schedule.kind === undefined ? {} : { kind: schedule.kind }),
	};
}

/** What the draft's repeat rule says, or why it says nothing usable yet. */
export type ScheduleSpecCheck = { spec: ScheduleSpec; errors: [] } | { spec?: undefined; errors: string[] };

/** The repeat rule alone, so the editor can show its description before the rest of the form is filled in. */
export function checkScheduleSpec(draft: ScheduleDraft): ScheduleSpecCheck {
	switch (draft.kind) {
		case "interval": {
			const every = String(draft.every).trim();
			if (!/^\d+$/.test(every)) return { errors: ["Enter a whole number of minutes or hours."] };
			const typed = Number(every);
			const minutes = draft.everyUnit === "hours" ? typed * MINUTES_PER_HOUR : typed;
			if (minutes < MIN_INTERVAL_MINUTES || minutes > MAX_INTERVAL_MINUTES) {
				return {
					errors: [
						`Choose an interval between ${MIN_INTERVAL_MINUTES} minutes and ${MAX_INTERVAL_MINUTES / MINUTES_PER_DAY} days.`,
					],
				};
			}
			return { spec: { kind: "interval", everyMinutes: minutes }, errors: [] };
		}
		case "daily": {
			if (!isTimeOfDay(draft.time)) return { errors: ["Pick a time of day as HH:MM."] };
			return { spec: { kind: "daily", time: draft.time }, errors: [] };
		}
		case "weekly": {
			const days = [...new Set(draft.days)]
				.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
				.sort((left, right) => left - right);
			if (days.length === 0) return { errors: ["Pick at least one day of the week."] };
			if (!isTimeOfDay(draft.time)) return { errors: ["Pick a time of day as HH:MM."] };
			return { spec: { kind: "weekly", days, time: draft.time }, errors: [] };
		}
		case "github-review-requested": {
			const typed = draft.repos.split(/[\s,]+/).filter((repo) => repo.length > 0);
			const bad = typed.find((repo) => normalizeGithubRepo(repo) === undefined);
			if (bad !== undefined) return { errors: [`"${bad}" is not a GitHub repository; write it as owner/name.`] };
			const repos = [...new Set(typed.map((repo) => normalizeGithubRepo(repo) as string))];
			return { spec: { kind: "github-review-requested", ...(repos.length === 0 ? {} : { repos }) }, errors: [] };
		}
		case "cron": {
			const expression = draft.cron.trim().replace(/\s+/g, " ");
			if (expression.length === 0) return { errors: ["Write a cron expression."] };
			if (expression.split(" ").length !== 5) return { errors: ["A cron expression has five fields."] };
			return { spec: { kind: "cron", expression }, errors: [] };
		}
	}
}

/**
 * The schedule the editor would save, or everything that is wrong with it. The title and the brief are trimmed; the
 * repeat rule is checked by `checkScheduleSpec`, and a thinking level is kept only with the model it belongs to.
 */
export function checkScheduleDraft(draft: ScheduleDraft): { input: ScheduleInput; errors: [] } | { errors: string[] } {
	const errors: string[] = [];
	const title = draft.title.trim();
	if (title.length === 0) errors.push("Give the scheduled task a title.");
	const brief = draft.brief.trim();
	if (brief.length === 0) {
		errors.push(draft.runsAs === "thread" ? "Write the prompt the thread starts with." : "Write the brief the worker runs on.");
	}
	const spec = checkScheduleSpec(draft);
	errors.push(...spec.errors);
	if (errors.length > 0 || spec.spec === undefined) return { errors };
	return {
		errors: [],
		input: {
			title,
			brief,
			spec: spec.spec,
			model: draft.model,
			thinkingLevel: draft.model === null ? null : draft.thinkingLevel,
			isolation: draft.isolation,
			onReport: draft.onReport,
			enabled: draft.enabled,
			// A worker schedule is sent without a kind, exactly as before threads, so an older backend takes it.
			...(draft.runsAs === "thread" ? { kind: "thread" as const } : {}),
		},
	};
}

/** The line under the project settings card's title: which clock a schedule's times are read on. */
export function timezoneNote(timezone: string): string {
	return timezone.length === 0
		? "Times follow the backend's clock."
		: `Times are in the backend's timezone, ${timezone}.`;
}
