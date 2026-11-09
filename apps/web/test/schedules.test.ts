/**
 * How a scheduled task reads and what the editor accepts: the schedule in plain words, the next run in the backend's
 * timezone, the last run, the worker badge, and the form's validation. All of it is outside the components on purpose.
 */
import { describe, expect, test } from "bun:test";
import type { Schedule, ScheduleRun, ScheduleSpec } from "@mihai-harness/protocol";
import {
	MAX_INTERVAL_MINUTES,
	MIN_INTERVAL_MINUTES,
	absoluteTime,
	briefLabel,
	checkScheduleDraft,
	checkScheduleSpec,
	describeSchedule,
	draftFromSchedule,
	emptyScheduleDraft,
	isTimeOfDay,
	lastRunText,
	nextRunText,
	runOutcomeLabel,
	runReason,
	runTriggerLabel,
	runRefLabel,
	whenText,
	runHasThread,
	runsAsLabel,
	scheduleInput,
	scheduleRunsAs,
	timezoneNote,
	untilPhrase,
	workerScheduleLabel,
} from "../src/lib/schedules.ts";

const NOW = Date.parse("2026-11-06T08:00:00.000Z");
const TZ = "Europe/Bucharest";

function run(overrides: Partial<ScheduleRun> = {}): ScheduleRun {
	return {
		at: "2026-11-06T07:00:00.000Z",
		trigger: "schedule",
		outcome: "started",
		workerId: "nightly-1",
		message: null,
		...overrides,
	};
}

function schedule(overrides: Partial<Schedule> = {}): Schedule {
	return {
		id: "nightly",
		title: "Nightly check",
		brief: "Run the suite.",
		spec: { kind: "daily", time: "09:00" },
		model: null,
		thinkingLevel: null,
		isolation: "shared",
		onReport: "review",
		enabled: true,
		createdBy: "user",
		createdAt: "2026-11-01T09:00:00.000Z",
		updatedAt: "2026-11-01T09:00:00.000Z",
		nextRunAt: "2026-11-07T07:00:00.000Z",
		runs: [run()],
		...overrides,
	};
}

describe("describeSchedule", () => {
	test("intervals read in the largest whole unit", () => {
		expect(describeSchedule({ kind: "interval", everyMinutes: 5 })).toBe("Every 5 minutes");
		expect(describeSchedule({ kind: "interval", everyMinutes: 90 })).toBe("Every 90 minutes");
		expect(describeSchedule({ kind: "interval", everyMinutes: 60 })).toBe("Every hour");
		expect(describeSchedule({ kind: "interval", everyMinutes: 120 })).toBe("Every 2 hours");
		expect(describeSchedule({ kind: "interval", everyMinutes: 1440 })).toBe("Every day");
		expect(describeSchedule({ kind: "interval", everyMinutes: 2880 })).toBe("Every 2 days");
	});

	test("a daily schedule names its time", () => {
		expect(describeSchedule({ kind: "daily", time: "09:00" })).toBe("Every day at 09:00");
		expect(describeSchedule({ kind: "daily", time: "18:45" })).toBe("Every day at 18:45");
	});

	test("weekly schedules read as weekdays, weekends, one day or a list", () => {
		expect(describeSchedule({ kind: "weekly", days: [1, 2, 3, 4, 5], time: "09:00" })).toBe("Weekdays at 09:00");
		expect(describeSchedule({ kind: "weekly", days: [5, 3, 1, 2, 4], time: "09:00" })).toBe("Weekdays at 09:00");
		expect(describeSchedule({ kind: "weekly", days: [0, 6], time: "11:00" })).toBe("Weekends at 11:00");
		expect(describeSchedule({ kind: "weekly", days: [0, 1, 2, 3, 4, 5, 6], time: "09:00" })).toBe(
			"Every day at 09:00",
		);
		expect(describeSchedule({ kind: "weekly", days: [1], time: "09:00" })).toBe("Every Monday at 09:00");
		expect(describeSchedule({ kind: "weekly", days: [1, 3, 5], time: "18:30" })).toBe("Mon, Wed and Fri at 18:30");
		expect(describeSchedule({ kind: "weekly", days: [3, 3, 1], time: "18:30" })).toBe("Mon and Wed at 18:30");
	});

	test("a cron schedule shows its expression", () => {
		expect(describeSchedule({ kind: "cron", expression: "0 9 * * 1-5" })).toBe("Cron: 0 9 * * 1-5");
	});
});

describe("absoluteTime", () => {
	test("reads a time on the backend's clock and names the timezone", () => {
		expect(absoluteTime("2026-11-07T07:00:00.000Z", TZ)).toBe("Sat, 7 Nov 2026, 09:00 (Europe/Bucharest)");
		expect(absoluteTime("2026-11-07T07:00:00.000Z", "UTC")).toBe("Sat, 7 Nov 2026, 07:00 (UTC)");
	});

	test("a timezone the browser does not know falls back instead of throwing", () => {
		expect(absoluteTime("2026-11-07T07:00:00.000Z", "Bogus/Zone")).not.toContain("Bogus/Zone");
		expect(absoluteTime("not a time", TZ)).toBe("not a time");
	});
});

describe("untilPhrase", () => {
	test("counts up in minutes, hours, days and months", () => {
		expect(untilPhrase(30_000)).toBe("in less than a minute");
		expect(untilPhrase(25 * 60_000)).toBe("in 25 min");
		expect(untilPhrase(59 * 60_000)).toBe("in 59 min");
		expect(untilPhrase(3 * 3_600_000)).toBe("in 3 h");
		expect(untilPhrase(2 * 86_400_000)).toBe("in 2 days");
		expect(untilPhrase(1 * 86_400_000)).toBe("in 1 day");
		expect(untilPhrase(45 * 86_400_000)).toBe("in 2 months");
	});

	test("a run that is due says so rather than counting backwards", () => {
		expect(untilPhrase(-60_000)).toBe("in less than a minute");
	});
});

describe("nextRunText", () => {
	test("gives the relative and the absolute time in the backend's timezone", () => {
		expect(nextRunText("2026-11-06T10:00:00.000Z", TZ, NOW)).toBe(
			"Next in 2 h · Fri, 6 Nov 2026, 12:00 (Europe/Bucharest)",
		);
	});

	test("a disabled schedule has no next run", () => {
		expect(nextRunText(null, TZ, NOW)).toBe("Paused");
		expect(nextRunText("not a time", TZ, NOW)).toBe("Next run at an unknown time");
	});
});

describe("run labels and the last run", () => {
	test("names each trigger and outcome", () => {
		expect(runTriggerLabel("schedule")).toBe("Scheduled");
		expect(runTriggerLabel("catch-up")).toBe("Catch-up");
		expect(runTriggerLabel("manual")).toBe("Run by hand");
		expect(runOutcomeLabel("started")).toBe("Started");
		expect(runOutcomeLabel("skipped")).toBe("Skipped");
		expect(runOutcomeLabel("failed")).toBe("Failed");
	});

	test("a started run is when it ran; a skip or failure carries its reason", () => {
		expect(lastRunText(schedule(), NOW)).toBe("Last run started 1 h ago");
		expect(
			lastRunText(schedule({ runs: [run({ outcome: "skipped", message: "previous run still running" })] }), NOW),
		).toBe("Skipped 1 h ago — previous run still running");
		expect(lastRunText(schedule({ runs: [run({ outcome: "failed", message: "model error" })] }), NOW)).toBe(
			"Failed 1 h ago — model error",
		);
	});

	test("nothing to say about a run with no message, or no runs", () => {
		expect(runReason(run({ outcome: "skipped", message: "  " }))).toBeUndefined();
		expect(runReason(run({ outcome: "failed", message: "boom" }))).toBe("boom");
		expect(lastRunText(schedule({ runs: [run({ outcome: "skipped" })] }), NOW)).toBe("Skipped 1 h ago — not started");
		expect(lastRunText(schedule({ runs: [] }), NOW)).toBe("Never ran");
	});
});

describe("workerScheduleLabel", () => {
	test("names the schedule, or says it is one once the title is gone", () => {
		expect(workerScheduleLabel("nightly", "Nightly check")).toBe("Nightly check");
		expect(workerScheduleLabel("nightly", undefined)).toBe("Scheduled task");
		expect(workerScheduleLabel("nightly", "")).toBe("Scheduled task");
	});

	test("a worker the coordinator started has no badge", () => {
		expect(workerScheduleLabel(null, "Nightly check")).toBeUndefined();
		expect(workerScheduleLabel(undefined, "Nightly check")).toBeUndefined();
		expect(workerScheduleLabel("", "Nightly check")).toBeUndefined();
	});
});

describe("checkScheduleSpec", () => {
	test("intervals are whole numbers of minutes or hours inside the protocol's bounds", () => {
		const draft = { ...emptyScheduleDraft(), kind: "interval" as const, every: "90" };
		expect(checkScheduleSpec(draft)).toEqual({ spec: { kind: "interval", everyMinutes: 90 }, errors: [] });
		expect(checkScheduleSpec({ ...draft, everyUnit: "hours", every: "2" })).toEqual({
			spec: { kind: "interval", everyMinutes: 120 },
			errors: [],
		});
		expect(checkScheduleSpec({ ...draft, every: "2.5" }).errors).toEqual(["Enter a whole number of minutes or hours."]);
		expect(checkScheduleSpec({ ...draft, every: String(MIN_INTERVAL_MINUTES - 1) }).errors).toHaveLength(1);
		expect(
			checkScheduleSpec({ ...draft, every: String(MAX_INTERVAL_MINUTES / 60), everyUnit: "hours" }).errors,
		).toHaveLength(0);
		expect(
			checkScheduleSpec({ ...draft, every: String(MAX_INTERVAL_MINUTES / 60 + 1), everyUnit: "hours" }).errors,
		).toHaveLength(1);
	});

	test("a daily and a weekly schedule need a time, and a weekly one needs a day", () => {
		expect(checkScheduleSpec({ ...emptyScheduleDraft(), kind: "daily", time: "7:00" }).errors).toEqual([
			"Pick a time of day as HH:MM.",
		]);
		expect(checkScheduleSpec({ ...emptyScheduleDraft(), kind: "weekly", days: [] }).errors).toEqual([
			"Pick at least one day of the week.",
		]);
		expect(checkScheduleSpec({ ...emptyScheduleDraft(), kind: "weekly", days: [5, 1, 5] })).toEqual({
			spec: { kind: "weekly", days: [1, 5], time: "09:00" },
			errors: [],
		});
	});

	test("a cron expression has five fields and is tidied", () => {
		expect(checkScheduleSpec({ ...emptyScheduleDraft(), kind: "cron", cron: "  0  9 * *  1-5 " })).toEqual({
			spec: { kind: "cron", expression: "0 9 * * 1-5" },
			errors: [],
		});
		expect(checkScheduleSpec({ ...emptyScheduleDraft(), kind: "cron", cron: "0 9 *" }).errors).toEqual([
			"A cron expression has five fields.",
		]);
		expect(checkScheduleSpec({ ...emptyScheduleDraft(), kind: "cron", cron: "  " }).errors).toEqual([
			"Write a cron expression.",
		]);
	});
});

describe("schedules that start a background thread", () => {
	test("send kind thread only for a thread, so a worker schedule reads as before", () => {
		const base = { ...emptyScheduleDraft(), title: "Triage", brief: "Triage the Jira backlog." };
		const worker = checkScheduleDraft(base);
		expect("input" in worker && worker.input.kind).toBeUndefined();
		const thread = checkScheduleDraft({ ...base, runsAs: "thread" });
		expect("input" in thread && thread.input.kind).toBe("thread");
		expect(checkScheduleDraft({ ...base, brief: "", runsAs: "thread" }).errors).toContain("Write the prompt the thread starts with.");
	});

	test("reads a stored kind back, and labels the choice", () => {
		expect(draftFromSchedule(schedule({ kind: "thread" })).runsAs).toBe("thread");
		expect(draftFromSchedule(schedule()).runsAs).toBe("worker");
		expect(scheduleInput(schedule({ kind: "thread" })).kind).toBe("thread");
		expect(scheduleInput(schedule())).not.toHaveProperty("kind");
		expect(scheduleRunsAs({})).toBe("worker");
		expect(runsAsLabel("worker")).toBe("Run one worker");
		expect(runsAsLabel("thread")).toBe("Start a background thread");
		expect(briefLabel("thread")).toBe("Prompt");
		expect(briefLabel("worker")).toBe("Brief");
	});

	test("links a run to the thread it started", () => {
		const started = { at: "2026-11-04T09:00:00.000Z", trigger: "schedule", outcome: "started", workerId: null, message: null } as const;
		expect(runHasThread({ ...started, threadId: "t1" })).toBe(true);
		expect(runHasThread({ ...started, threadId: null })).toBe(false);
		expect(runHasThread(started)).toBe(false);
		expect(runHasThread({ ...started, outcome: "failed", threadId: "t1" })).toBe(false);
	});
});

describe("checkScheduleDraft", () => {
	test("trims the title and the brief and builds the whole input", () => {
		const draft = {
			...emptyScheduleDraft(),
			title: "  Nightly check ",
			brief: " Run the suite.\n",
			model: { provider: "anthropic", modelId: "claude" },
			thinkingLevel: "high" as const,
			isolation: "workspace" as const,
			onReport: "record" as const,
			enabled: false,
		};
		expect(checkScheduleDraft(draft)).toEqual({
			errors: [],
			input: {
				title: "Nightly check",
				brief: "Run the suite.",
				spec: { kind: "weekly", days: [1, 2, 3, 4, 5], time: "09:00" },
				model: { provider: "anthropic", modelId: "claude" },
				thinkingLevel: "high",
				isolation: "workspace",
				onReport: "record",
				enabled: false,
			},
		});
	});

	test("a thinking level only travels with a model", () => {
		const draft = {
			...emptyScheduleDraft(),
			title: "Check",
			brief: "Do it.",
			thinkingLevel: "high" as const,
		};
		const checked = checkScheduleDraft(draft);
		expect(checked.errors).toHaveLength(0);
		expect(checked.errors.length === 0 ? checked.input.thinkingLevel : "wrong").toBeNull();
	});

	test("collects every problem at once instead of the first", () => {
		const errors = checkScheduleDraft({ ...emptyScheduleDraft(), title: " ", brief: " ", kind: "cron", cron: "x" }).errors;
		expect(errors).toHaveLength(3);
		expect(errors[0]).toBe("Give the scheduled task a title.");
		expect(errors[1]).toBe("Write the brief the worker runs on.");
	});
});

describe("draft round trip", () => {
	test("an interval in whole hours keeps its unit, one that is not stays in minutes", () => {
		const hours = draftFromSchedule(schedule({ spec: { kind: "interval", everyMinutes: 120 } }));
		expect([hours.kind, hours.every, hours.everyUnit]).toEqual(["interval", "2", "hours"]);
		const minutes = draftFromSchedule(schedule({ spec: { kind: "interval", everyMinutes: 90 } }));
		expect([minutes.kind, minutes.every, minutes.everyUnit]).toEqual(["interval", "90", "minutes"]);
	});

	test("every rule comes back unchanged through the editor", () => {
		const specs: ScheduleSpec[] = [
			{ kind: "interval", everyMinutes: 15 },
			{ kind: "daily", time: "06:45" },
			{ kind: "weekly", days: [2, 4], time: "18:30" },
			{ kind: "cron", expression: "*/5 * * * *" },
			{ kind: "github-review-requested" },
			{ kind: "github-review-requested", repos: ["acme/platform", "acme/app"] },
		];
		for (const spec of specs) {
			const draft = draftFromSchedule(schedule({ spec, model: null, thinkingLevel: null }));
			const checked = checkScheduleDraft(draft);
			expect(checked.errors).toHaveLength(0);
			expect(checked.errors.length === 0 ? checked.input.spec : undefined).toEqual(spec);
		}
	});

	test("the editable half of a stored schedule is what a switch saves", () => {
		const stored = schedule({ enabled: false, onReport: "record", isolation: "workspace" });
		expect(scheduleInput(stored)).toEqual({
			title: "Nightly check",
			brief: "Run the suite.",
			spec: { kind: "daily", time: "09:00" },
			model: null,
			thinkingLevel: null,
			isolation: "workspace",
			onReport: "record",
			enabled: false,
		});
	});

	test("the rest of a schedule comes back too", () => {
		const stored = schedule({
			title: "Review",
			brief: "Look at the diff.",
			model: { provider: "openai", modelId: "gpt" },
			thinkingLevel: "low",
			isolation: "workspace",
			onReport: "record",
			enabled: false,
			createdBy: "coordinator",
		});
		const draft = draftFromSchedule(stored);
		expect(draft).toMatchObject({
			title: "Review",
			brief: "Look at the diff.",
			model: { provider: "openai", modelId: "gpt" },
			thinkingLevel: "low",
			isolation: "workspace",
			onReport: "record",
			enabled: false,
		});
	});
});

describe("small labels", () => {
	test("times of day are HH:MM", () => {
		expect(isTimeOfDay("09:00")).toBe(true);
		expect(isTimeOfDay("23:59")).toBe(true);
		expect(isTimeOfDay("24:00")).toBe(false);
		expect(isTimeOfDay("9:00")).toBe(false);
	});

	test("the timezone note names the clock", () => {
		expect(timezoneNote(TZ)).toBe("Times are in the backend's timezone, Europe/Bucharest.");
		expect(timezoneNote("")).toBe("Times follow the backend's clock.");
	});
});

describe("event rules", () => {
	const event = (overrides: Partial<Schedule> = {}): Schedule =>
		schedule({ spec: { kind: "github-review-requested" }, nextRunAt: null, ...overrides });

	test("read in plain words, with the repositories when the schedule has its own", () => {
		expect(describeSchedule({ kind: "github-review-requested" })).toBe("When a review is requested from you on GitHub");
		expect(describeSchedule({ kind: "github-review-requested", repos: ["acme/app", "acme/web"] })).toBe(
			"When a review is requested from you on GitHub in acme/app, acme/web",
		);
	});

	test("show how GitHub is checked and how the last check went instead of a next run", () => {
		const checked = new Date(NOW - 3 * 60_000).toISOString();
		expect(whenText(event(), TZ, NOW)).toBe("Checks GitHub every 2 min · not checked yet");
		expect(whenText(event({ eventState: { checkedAt: checked, error: null } }), TZ, NOW)).toBe(
			"Checks GitHub every 2 min · last checked 3 min ago",
		);
		expect(whenText(event({ eventState: { checkedAt: checked, error: "gh failed: not logged in" } }), TZ, NOW)).toBe(
			"Checks GitHub every 2 min · last check failed 3 min ago: gh failed: not logged in",
		);
		expect(whenText(event({ enabled: false }), TZ, NOW)).toBe("Paused");
		// A clock rule still says when it runs next.
		expect(whenText(schedule(), TZ, NOW)).toBe(nextRunText("2026-11-07T07:00:00.000Z", TZ, NOW));
	});

	test("an event run is labelled with its trigger and its pull request", () => {
		expect(runTriggerLabel("event")).toBe("Review requested");
		expect(runRefLabel({ ref: "https://github.com/acme/platform/pull/1205" })).toBe("acme/platform#1205");
		expect(runRefLabel({})).toBeUndefined();
		expect(runRefLabel({ ref: null })).toBeUndefined();
	});

	test("the editor takes repositories as owner/name or a GitHub address, and refuses anything else", () => {
		const draft = { ...emptyScheduleDraft(), kind: "github-review-requested" as const };
		expect(checkScheduleSpec(draft)).toEqual({ spec: { kind: "github-review-requested" }, errors: [] });
		expect(
			checkScheduleSpec({ ...draft, repos: "acme/app, https://github.com/acme/web.git\nacme/app" }),
		).toEqual({ spec: { kind: "github-review-requested", repos: ["acme/app", "acme/web"] }, errors: [] });
		expect(checkScheduleSpec({ ...draft, repos: "acme" }).errors).toEqual([
			'"acme" is not a GitHub repository; write it as owner/name.',
		]);
	});
});
