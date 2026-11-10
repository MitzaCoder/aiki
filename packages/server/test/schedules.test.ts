import { afterEach, describe, expect, it } from "bun:test";
import type { TranscriptContext } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxToolCall, type FauxResponseFactory } from "@earendil-works/pi-ai/providers/faux";
import type { SetTimer } from "@earendil-works/pi-durable";
import type {
	ConversationView,
	ModelRef,
	Schedule,
	SchedulesListResponse,
	SchedulesRunResponse,
	SchedulesSaveResponse,
	WorkerModel,
	WorkersListResponse,
} from "@aiki/protocol";
import { formatLocalTime, formatRunStamp, nextRunAfter, parseCron, validateSpec } from "../src/schedules.ts";
import { createSetup, entryText, errorOf, TestClient, ViewClient, type TestSetup } from "./support.ts";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const cleanups: (() => Promise<void>)[] = [];
const clients: TestClient[] = [];

const FAUX: ModelRef = { provider: "faux", modelId: "faux-1" };
const TIMEZONE = "Europe/Bucharest";
const BRIEF = "Check the repository for outdated dependencies and report what you find.";
const START = Date.UTC(2026, 10, 5, 12, 0, 0); // 2026-11-05 14:00 in Bucharest (UTC+2).

async function setup(options?: Parameters<typeof createSetup>[0]): Promise<TestSetup> {
	const created = await createSetup({ timezone: TIMEZONE, ...options });
	cleanups.push(created.cleanup);
	return created;
}

async function connect(server: TestSetup["server"]): Promise<TestClient> {
	const client = await TestClient.open(server);
	clients.push(client);
	return client;
}

afterEach(async () => {
	for (const client of clients.splice(0)) client.close();
	for (const cleanup of cleanups.splice(0)) await cleanup();
});

/** A clock a test moves by hand; nothing fires on its own, so a test calls `wake()` when it wants the clock to look. */
function fakeClock(start = START): { now(): number; setTimer: SetTimer; advance(ms: number): void } {
	let now = start;
	return {
		now: () => now,
		setTimer: ((callback: () => void, delayMs: number) => {
			void callback;
			void delayMs;
			return () => undefined;
		}) as SetTimer,
		advance(ms: number): void {
			now += ms;
		},
	};
}

async function greet(client: TestClient): Promise<void> {
	expect((await client.hello()).type).toBe("hello");
}

async function addProject(client: TestClient, path: string): Promise<string> {
	const response = await client.request({ type: "projects.add", path });
	if (response.type !== "projects.add") throw new Error(JSON.stringify(response));
	return response.project.id;
}

async function configure(client: TestClient, projectId: string, workerModels: WorkerModel[] = [FAUX]): Promise<void> {
	const response = await client.request({
		type: "projects.configure",
		projectId,
		coordinatorModel: FAUX,
		workerModels,
	});
	expect(response.type).toBe("projects.configure");
}

async function until(check: () => Promise<boolean>, timeoutMs = 20_000): Promise<void> {
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		if (await check()) return;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	throw new Error("timed out waiting for a condition");
}

function messageText(message: { content?: unknown }): string {
	const content = message.content;
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

function lastMessage(request: { messages: readonly { role: string; content?: unknown }[] }): {
	role: string;
	text: string;
} {
	const last = request.messages.findLast((message) => message.role !== "system");
	return { role: last?.role ?? "", text: messageText(last ?? {}) };
}

/** A model that answers the coordinator and its scheduled workers by what they are asked. */
function script(options: { seen?: string[]; tools?: boolean } = {}): FauxResponseFactory {
	return (request) => {
		const { role, text } = lastMessage(request);
		options.seen?.push(text);
		if (role === "toolResult") return fauxAssistantMessage("Tool call finished.");
		if (text.includes(BRIEF)) return fauxAssistantMessage("## Report\nOutcome: done\nFiles changed: none");
		if (text.includes("reported]") || text.includes("failed:")) return fauxAssistantMessage("Report reviewed.");
		if (text.includes("Save the nightly check")) {
			return fauxAssistantMessage(
				[
					fauxToolCall("schedule_save", {
						title: "Nightly dependency check",
						brief: BRIEF,
						spec: { kind: "daily", time: "03:30" },
						onReport: "record",
					}),
				],
				{ stopReason: "toolUse" },
			);
		}
		if (text.includes("Delegate the reading")) {
			return fauxAssistantMessage([fauxToolCall("worker_spawn", { id: "reader", task: "Read the README." })], {
				stopReason: "toolUse",
			});
		}
		return fauxAssistantMessage("Nothing to do.");
	};
}

async function listSchedules(client: TestClient, projectId: string): Promise<SchedulesListResponse> {
	const response = await client.request({ type: "schedules.list", projectId });
	if (response.type !== "schedules.list") throw new Error(JSON.stringify(response));
	return response;
}

async function saveSchedule(
	client: TestClient,
	projectId: string,
	schedule: Partial<Schedule> & { title: string; brief: string },
	scheduleId?: string,
): Promise<Schedule> {
	const response = await client.request({
		type: "schedules.save",
		projectId,
		...(scheduleId === undefined ? {} : { scheduleId }),
		schedule: {
			spec: { kind: "daily", time: "03:30" },
			model: null,
			thinkingLevel: null,
			isolation: "shared",
			onReport: "review",
			enabled: true,
			...schedule,
		},
	});
	const message = response as SchedulesSaveResponse | { type: "error" };
	if (message.type !== "schedules.save") throw new Error(JSON.stringify(response));
	return message.schedule;
}

async function runSchedule(client: TestClient, projectId: string, scheduleId: string): Promise<SchedulesRunResponse["run"]> {
	const response = await client.request({ type: "schedules.run", projectId, scheduleId });
	if (response.type !== "schedules.run") throw new Error(JSON.stringify(response));
	return response.run;
}

async function listWorkers(client: TestClient, projectId: string): Promise<WorkersListResponse> {
	const response = await client.request({ type: "workers.list", projectId });
	if (response.type !== "workers.list") throw new Error(JSON.stringify(response));
	return response;
}

function reportEntries(view: ConversationView | undefined): ConversationView["entries"] {
	return view?.entries.filter((entry) => entry.kind === "pi.user" && entryText(entry).startsWith("[worker ")) ?? [];
}

function scheduledTest(name: string, run: () => Promise<void>): void {
	it(name, run, 60_000);
}

describe("schedule times", () => {
	it("finds the next daily run in the backend's timezone, not in UTC", () => {
		const at = START; // 14:00 local, after 03:30
		const next = nextRunAfter({ kind: "daily", time: "03:30" }, at, TIMEZONE)!;
		// 2026-11-06 03:30 at UTC+2 is 01:30Z.
		expect(new Date(next).toISOString()).toBe("2026-11-06T01:30:00.000Z");
	});

	it("finds the next weekly run among several days, and skips the weekend for a weekday cron", () => {
		const weekly = nextRunAfter({ kind: "weekly", days: [1, 4], time: "09:00" }, START, TIMEZONE)!;
		// 2026-11-05 is a Thursday; 09:00 has passed, so the next is Monday 2026-11-09 09:00 local (07:00Z).
		expect(new Date(weekly).toISOString()).toBe("2026-11-09T07:00:00.000Z");
		const weekday = nextRunAfter({ kind: "cron", expression: "0 9 * * 1-5" }, START, TIMEZONE)!;
		expect(new Date(weekday).toISOString()).toBe("2026-11-06T07:00:00.000Z");
	});

	it("counts an interval from the schedule's creation and understands cron steps", () => {
		const anchor = START;
		expect(nextRunAfter({ kind: "interval", everyMinutes: 30 }, anchor, TIMEZONE, anchor)).toBe(anchor + 30 * 60_000);
		expect(nextRunAfter({ kind: "interval", everyMinutes: 30 }, anchor + 3 * 60_000, TIMEZONE, anchor)).toBe(
			anchor + 30 * 60_000,
		);
		const cron = parseCron("*/15 * * * *");
		expect(cron.minutes).toEqual([0, 15, 30, 45]);
		const quarter = nextRunAfter({ kind: "cron", expression: "*/15 * * * *" }, START, TIMEZONE)!;
		expect(new Date(quarter).toISOString()).toBe("2026-11-05T12:15:00.000Z");
	});

	it("refuses an expression it cannot run instead of scheduling nothing", () => {
		expect(() => parseCron("0 9 * *")).toThrow(/five fields/);
		expect(() => parseCron("61 * * * *")).toThrow(/minute/);
		expect(validateSpec({ kind: "cron", expression: "0 9 * *" }, TIMEZONE)).toContain("five fields");
		expect(validateSpec({ kind: "daily", time: "03:30" }, TIMEZONE)).toBeUndefined();
	});

	it("stamps a run's worker ID in local time", () => {
		expect(formatRunStamp(Date.UTC(2026, 10, 5, 12, 0), TIMEZONE)).toBe("2026-11-05-1400");
	});

	it("keeps a daily run at its wall-clock time across a DST switch", () => {
		// Bucharest jumps from 03:00 to 04:00 on 2026-03-29, so that day's 03:30 does not exist and lands on the next
		// wall time; the day after it is back at 03:30.
		const before = nextRunAfter({ kind: "daily", time: "03:30" }, Date.parse("2026-03-27T12:00:00Z"), TIMEZONE)!;
		const across = nextRunAfter({ kind: "daily", time: "03:30" }, before, TIMEZONE)!;
		const after = nextRunAfter({ kind: "daily", time: "03:30" }, across, TIMEZONE)!;
		expect(formatLocalTime(before, TIMEZONE)).toBe("2026-03-28 03:30");
		expect(formatLocalTime(across, TIMEZONE)).toBe("2026-03-29 04:30");
		expect(formatLocalTime(after, TIMEZONE)).toBe("2026-03-30 03:30");
	});
});

describe("schedules", () => {
	scheduledTest("runs a schedule as a worker of the coordinator and reviews its report", async () => {
		const clock = fakeClock();
		const test = await setup({ now: clock.now, setTimer: clock.setTimer });
		const client = await connect(test.server);
		const second = await connect(test.server);
		await greet(client);
		await greet(second);
		const projectId = await addProject(client, test.projectDir);
		await configure(client, projectId);
		test.faux.setResponses(Array.from({ length: 40 }, () => script()));

		const saved = await saveSchedule(client, projectId, { title: "Nightly dependency check", brief: BRIEF });
		expect(saved.createdBy).toBe("user");
		expect(saved.enabled).toBe(true);
		expect(saved.nextRunAt).not.toBeNull();
		expect(saved.runs).toEqual([]);
		// 03:30 local tomorrow is 01:30Z.
		expect(saved.nextRunAt).toBe("2026-11-06T01:30:00.000Z");

		const listed = await listSchedules(client, projectId);
		expect(listed.timezone).toBe(TIMEZONE);
		expect(listed.schedules.map((schedule) => schedule.id)).toEqual([saved.id]);

		// Saving and running push the whole list to every connection.
		await second.waitFor(
			(message) => message.type === "schedules.state" && message.projectId === projectId && message.schedules.length === 1,
		);

		const run = await runSchedule(client, projectId, saved.id);
		expect(run.outcome).toBe("started");
		expect(run.trigger).toBe("manual");
		expect(run.workerId).toBe(`${saved.id}-2026-11-05-1400`);

		// The worker is an ordinary worker, marked with the schedule that started it.
		const pushed = await untilWorker(client, projectId, run.workerId!);
		expect(pushed.scheduleId).toBe(saved.id);
		expect(pushed.model).toEqual(FAUX);
		expect(pushed.isolation).toBe("shared");

		const view = new ViewClient(client);
		await view.start(projectId);
		const withReport = await view.waitForView((value) =>
			reportEntries(value).some((entry) => entryText(entry).startsWith(`[worker ${run.workerId} reported]`)),
		);
		expect(reportEntries(withReport)).toHaveLength(1);

		// `review` wakes the coordinator, which answers; a shared run is forgotten once it reports.
		await view.waitForView((value) =>
			value.entries.some(
				(entry) => entry.kind === "pi.assistant" && entryText(entry).includes("Report reviewed"),
			),
		);
		await until(async () => (await listWorkers(client, projectId)).workers[0]?.status === "done");
		const after = await listSchedules(client, projectId);
		expect(after.schedules[0]?.runs).toHaveLength(1);
		expect(after.schedules[0]?.runs[0]).toMatchObject({
			trigger: "manual",
			outcome: "started",
			workerId: run.workerId,
			message: null,
		});
		// A manual run does not move the next one.
		expect(after.schedules[0]?.nextRunAt).toBe(saved.nextRunAt);
	});

	scheduledTest("records a report without starting a turn, and the next message carries it", async () => {
		const clock = fakeClock();
		const test = await setup({ now: clock.now, setTimer: clock.setTimer });
		const client = await connect(test.server);
		await greet(client);
		const projectId = await addProject(client, test.projectDir);
		await configure(client, projectId);
		const seen: string[] = [];
		let carried: string[] = [];
		test.faux.setResponses(
			Array.from({ length: 40 }, () => (request: TranscriptContext) => {
				const { role, text } = lastMessage(request);
				seen.push(text);
				if (text.includes(BRIEF)) return fauxAssistantMessage("## Report\nOutcome: done\nFiles changed: none");
				if (text === "What did the check find?") {
					carried = request.messages.filter((message) => message.role !== "system").map((message) => messageText(message));
					return fauxAssistantMessage("Nothing was outdated.");
				}
				return fauxAssistantMessage("Report reviewed.");
			}),
		);

		const saved = await saveSchedule(client, projectId, {
			title: "Nightly dependency check",
			brief: BRIEF,
			onReport: "record",
		});
		const run = await runSchedule(client, projectId, saved.id);
		expect(run.outcome).toBe("started");

		const view = new ViewClient(client);
		await view.start(projectId);
		const withReport = await view.waitForView(
			(value) => reportEntries(value).some((entry) => entryText(entry).startsWith(`[worker ${run.workerId} reported]`)),
		);
		// The report is in the transcript, but nothing woke the coordinator: no answer followed it.
		expect(withReport.entries.filter((entry) => entry.kind === "pi.assistant")).toHaveLength(0);
		expect(seen).not.toContain("Report reviewed.");
		await until(async () => (await listWorkers(client, projectId)).workers[0]?.status === "done");

		// The user's own next message carries it: the model sees the report before that message.
		await client.request({ type: "conversation.submit", projectId, requestId: "q1", content: "What did the check find?" });
		await view.waitForView((value) =>
			value.entries.some((entry) => entry.kind === "pi.assistant" && entryText(entry).includes("Nothing was outdated")),
		);
		expect(carried.some((text) => text.includes(`[worker ${run.workerId} reported]`))).toBe(true);
	});

	scheduledTest("records a report that arrives during a coordinator turn without starting another turn", async () => {
		const clock = fakeClock();
		const test = await setup({ now: clock.now, setTimer: clock.setTimer });
		const client = await connect(test.server);
		await greet(client);
		const projectId = await addProject(client, test.projectDir);
		await configure(client, projectId);

		let release: () => void = () => undefined;
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		let reached = false;
		const seen: string[] = [];
		let carried: string[] = [];
		test.faux.setResponses(
			Array.from({ length: 40 }, () => async (request: TranscriptContext, options?: { signal?: AbortSignal }) => {
				const { text } = lastMessage(request);
				seen.push(text);
				if (text.includes(BRIEF)) return fauxAssistantMessage("## Report\nOutcome: done");
				if (text === "Work on something long.") {
					reached = true;
					await new Promise<void>((resolve) => {
						held.then(resolve);
						options?.signal?.addEventListener("abort", () => resolve(), { once: true });
					});
					return fauxAssistantMessage("Worked on it.");
				}
				if (text === "Now what?") {
					carried = request.messages.filter((message) => message.role !== "system").map((message) => messageText(message));
					return fauxAssistantMessage("Nothing more.");
				}
				return fauxAssistantMessage("Report reviewed.");
			}),
		);

		const view = new ViewClient(client);
		await view.start(projectId);
		await client.request({ type: "conversation.submit", projectId, requestId: "r1", content: "Work on something long." });
		await until(async () => reached);

		const saved = await saveSchedule(client, projectId, {
			title: "Nightly dependency check",
			brief: BRIEF,
			onReport: "record",
		});
		const run = await runSchedule(client, projectId, saved.id);
		expect(run.outcome).toBe("started");
		await until(async () => (await listWorkers(client, projectId)).workers[0]?.status === "done");

		// The coordinator's own turn ends; the report never starts a turn of its own.
		release();
		await view.waitForView((value) =>
			value.entries.some((entry) => entry.kind === "pi.assistant" && entryText(entry).includes("Worked on it")),
		);
		await view.waitForView((value) =>
			reportEntries(value).some((entry) => entryText(entry).startsWith(`[worker ${run.workerId} reported]`)),
		);
		expect(seen).not.toContain("Report reviewed.");
		expect(seen.filter((text) => text === "Work on something long.")).toHaveLength(1);

		// It is in the context the user's next message is answered with.
		await client.request({ type: "conversation.submit", projectId, requestId: "r2", content: "Now what?" });
		await view.waitForView((value) =>
			value.entries.some((entry) => entry.kind === "pi.assistant" && entryText(entry).includes("Nothing more")),
		);
		expect(carried.some((text) => text.includes(`[worker ${run.workerId} reported]`))).toBe(true);
	});

	scheduledTest("skips a run while the previous run of that schedule is still running", async () => {		const clock = fakeClock();
		const test = await setup({ now: clock.now, setTimer: clock.setTimer });
		const client = await connect(test.server);
		await greet(client);
		const projectId = await addProject(client, test.projectDir);
		await configure(client, projectId);

		let release: () => void = () => undefined;
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		test.faux.setResponses(
			Array.from({ length: 40 }, () => (request: TranscriptContext, options?: { signal?: AbortSignal }) => {
				const { role, text } = lastMessage(request);
				if (text.includes(BRIEF)) {
					return new Promise<never>((resolve, reject) => {
						held.then(() => resolve(undefined as never));
						options?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
					}) as never;
				}
				void role;
				return fauxAssistantMessage("Report reviewed.");
			}),
		);

		const saved = await saveSchedule(client, projectId, { title: "Nightly dependency check", brief: BRIEF });
		const first = await runSchedule(client, projectId, saved.id);
		expect(first.outcome).toBe("started");
		await until(async () => (await listWorkers(client, projectId)).workers[0]?.status === "running");

		const second = await runSchedule(client, projectId, saved.id);
		expect(second.outcome).toBe("skipped");
		expect(second.message).toBe("previous run still running");

		const schedule = (await listSchedules(client, projectId)).schedules[0]!;
		expect(schedule.runs.map((run) => run.outcome)).toEqual(["skipped", "started"]);
		release();
	});

	scheduledTest("edits, deletes and refuses an unknown schedule", async () => {
		const test = await setup();
		const client = await connect(test.server);
		await greet(client);
		const projectId = await addProject(client, test.projectDir);
		await configure(client, projectId);

		const created = await saveSchedule(client, projectId, { title: "Nightly dependency check", brief: BRIEF });
		const edited = await saveSchedule(
			client,
			projectId,
			{ title: "Weekly dependency check", brief: BRIEF, spec: { kind: "weekly", days: [1], time: "09:00" }, enabled: false },
			created.id,
		);
		expect(edited.id).toBe(created.id);
		expect(edited.createdAt).toBe(created.createdAt);
		expect(edited.nextRunAt).toBeNull();

		const unknown = await client.request({
			type: "schedules.save",
			projectId,
			scheduleId: "nobody",
			schedule: {
				title: "x",
				brief: "x",
				spec: { kind: "daily", time: "09:00" },
				model: null,
				thinkingLevel: null,
				isolation: "shared",
				onReport: "review",
				enabled: true,
			},
		});
		expect(errorOf(unknown).code).toBe("unknown_schedule");

		const badCron = await client.request({
			type: "schedules.save",
			projectId,
			schedule: {
				title: "x",
				brief: "x",
				spec: { kind: "cron", expression: "0 9 * *" },
				model: null,
				thinkingLevel: null,
				isolation: "shared",
				onReport: "review",
				enabled: true,
			},
		});
		expect(errorOf(badCron).code).toBe("bad_request");

		const deleted = await client.request({ type: "schedules.delete", projectId, scheduleId: created.id });
		expect(deleted.type).toBe("schedules.delete");
		expect((await listSchedules(client, projectId)).schedules).toEqual([]);
		expect(errorOf(await client.request({ type: "schedules.delete", projectId, scheduleId: created.id })).code).toBe(
			"unknown_schedule",
		);
	});

	scheduledTest("lets the coordinator create a schedule, and gives workers no schedule tools", async () => {
		const test = await setup();
		const client = await connect(test.server);
		await greet(client);
		const projectId = await addProject(client, test.projectDir);
		await configure(client, projectId);
		test.faux.setResponses(Array.from({ length: 40 }, () => script()));

		const view = new ViewClient(client);
		await view.start(projectId);
		await client.request({ type: "conversation.submit", projectId, requestId: "r1", content: "Save the nightly check." });
		await view.waitForView((value) =>
			value.entries.some((entry) => entry.kind === "pi.tool-result" && entryText(entry).includes("Saved the schedule")),
		);
		const schedules = (await listSchedules(client, projectId)).schedules;
		expect(schedules).toHaveLength(1);
		expect(schedules[0]?.createdBy).toBe("coordinator");
		expect(schedules[0]?.onReport).toBe("record");

		// The coordinator has the schedule tools; a worker never does.
		const coordinator = await test.server.manager.context(projectId);
		expect(coordinator.tools.map((tool) => tool.name)).toContain("schedule_save");
		await client.request({ type: "conversation.submit", projectId, requestId: "r2", content: "Delegate the reading." });
		await until(async () => (await listWorkers(client, projectId)).workers.length === 1);
		const worker = await test.server.manager.context(projectId, "reader");
		const workerTools = worker.tools.map((tool) => tool.name);
		expect(workerTools).not.toContain("schedule_save");
		expect(workerTools).not.toContain("schedule_list");
		expect(workerTools).not.toContain("worker_spawn");
	});
});

async function untilWorker(
	client: TestClient,
	projectId: string,
	workerId: string,
): Promise<WorkersListResponse["workers"][number]> {
	let found: WorkersListResponse["workers"][number] | undefined;
	await until(async () => {
		found = (await listWorkers(client, projectId)).workers.find((worker) => worker.id === workerId);
		return found !== undefined;
	});
	return found!;
}

/** Run a command and collect its output, for the jj parts. */
async function command(args: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
	const child = Bun.spawn(args, { cwd, stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	return { code, stdout, stderr };
}

describe("the schedule clock", () => {
	scheduledTest("catches up once on runs missed while the server was off, and not again on the next start", async () => {
		const clock = fakeClock();
		const test = await setup({ now: clock.now, setTimer: clock.setTimer });
		const client = await connect(test.server);
		await greet(client);
		const projectId = await addProject(client, test.projectDir);
		await configure(client, projectId);
		test.faux.setResponses(Array.from({ length: 40 }, () => script()));

		const saved = await saveSchedule(client, projectId, {
			title: "Nightly dependency check",
			brief: BRIEF,
			onReport: "record",
		});
		expect(saved.nextRunAt).toBe("2026-11-06T01:30:00.000Z");

		// Three days go by with the process off. Restarting runs it once, with trigger `catch-up`, and moves it past now.
		clock.advance(3 * 24 * 60 * 60_000);
		await test.restart();
		const next = await connect(test.server);
		await greet(next);
		const caughtUp = (await listSchedules(next, projectId)).schedules[0]!;
		expect(caughtUp.runs).toHaveLength(1);
		expect(caughtUp.runs[0]?.outcome).toBe("started");
		expect(caughtUp.runs[0]?.trigger).toBe("catch-up");
		expect(Date.parse(caughtUp.nextRunAt!)).toBeGreaterThan(clock.now());

		// A second restart with nothing new due adds nothing.
		await test.restart();
		const again = await connect(test.server);
		await greet(again);
		expect((await listSchedules(again, projectId)).schedules[0]?.runs).toHaveLength(1);
	});

	scheduledTest("fires a closed project's schedule and opens the project only then", async () => {
		const clock = fakeClock();
		const test = await setup({ now: clock.now, setTimer: clock.setTimer });
		const client = await connect(test.server);
		await greet(client);
		const projectId = await addProject(client, test.projectDir);
		await configure(client, projectId);
		test.faux.setResponses(Array.from({ length: 40 }, () => script()));

		// Saving a schedule and listing it does not open the project.
		const saved = await saveSchedule(client, projectId, {
			title: "Nightly dependency check",
			brief: BRIEF,
			onReport: "record",
		});
		const projects = await client.request({ type: "projects.list" });
		if (projects.type !== "projects.list") throw new Error(JSON.stringify(projects));
		expect(projects.projects.find((project) => project.id === projectId)?.state).toBe("closed");

		// The clock comes due; the server's scheduler opens the project and starts the worker.
		clock.advance(24 * 60 * 60_000);
		await test.server.scheduleScheduler.wake();
		const fired = (await listSchedules(client, projectId)).schedules[0]!;
		expect(fired.runs).toHaveLength(1);
		expect(fired.runs[0]?.outcome).toBe("started");
		expect(fired.runs[0]?.trigger).toBe("schedule");
		expect(fired.runs[0]?.workerId).toBe(`${saved.id}-2026-11-06-0330`);

		const opened = await client.request({ type: "projects.list" });
		if (opened.type !== "projects.list") throw new Error(JSON.stringify(opened));
		expect(opened.projects.find((project) => project.id === projectId)?.state).toBe("open");
		const worker = await untilWorker(client, projectId, fired.runs[0]!.workerId!);
		expect(worker.scheduleId).toBe(saved.id);
	});

	scheduledTest("records a failed run when no worker model resolves, and moves on", async () => {		const clock = fakeClock();
		const test = await setup({ now: clock.now, setTimer: clock.setTimer });
		const client = await connect(test.server);
		await greet(client);
		const projectId = await addProject(client, test.projectDir);
		// A coordinator model, but no worker model anywhere.
		await configure(client, projectId, []);

		const saved = await saveSchedule(client, projectId, {
			title: "Nightly dependency check",
			brief: BRIEF,
			onReport: "record",
		});
		clock.advance(24 * 60 * 60_000);
		await test.server.scheduleScheduler.wake();

		const schedule = (await listSchedules(client, projectId)).schedules[0]!;
		expect(schedule.runs).toHaveLength(1);
		expect(schedule.runs[0]?.outcome).toBe("failed");
		expect(schedule.runs[0]?.message).toContain("No worker model is set");
		expect(Date.parse(schedule.nextRunAt!)).toBeGreaterThan(clock.now());
		void saved;
	});

	scheduledTest("fires an interval again at each slot, each time a new worker", async () => {
		const clock = fakeClock();
		const test = await setup({ now: clock.now, setTimer: clock.setTimer });
		const client = await connect(test.server);
		await greet(client);
		const projectId = await addProject(client, test.projectDir);
		await configure(client, projectId);
		test.faux.setResponses(Array.from({ length: 60 }, () => script()));

		const saved = await saveSchedule(client, projectId, {
			title: "Frequent dependency check",
			brief: BRIEF,
			spec: { kind: "interval", everyMinutes: 30 },
			onReport: "record",
		});
		expect(saved.nextRunAt).toBe(new Date(START + 30 * 60_000).toISOString());

		// Nothing is due yet.
		await test.server.scheduleScheduler.wake();
		expect((await listSchedules(client, projectId)).schedules[0]?.runs).toEqual([]);

		const workerIds: string[] = [];
		for (let slot = 1; slot <= 2; slot += 1) {
			clock.advance(30 * 60_000);
			await test.server.scheduleScheduler.wake();
			const schedule = (await listSchedules(client, projectId)).schedules[0]!;
			const run = schedule.runs[0]!;
			expect(run.outcome).toBe("started");
			expect(run.trigger).toBe("schedule");
			expect(schedule.runs).toHaveLength(slot);
			expect(Date.parse(schedule.nextRunAt!)).toBe(clock.now() + 30 * 60_000);
			workerIds.push(run.workerId!);
			// Let this run report before the next slot, so the next one is not skipped as overlapping.
			await until(async () => (await listWorkers(client, projectId)).workers[0]?.status === "done");
		}
		expect(new Set(workerIds).size).toBe(2);
	});

	scheduledTest("keeps a workspace run until the coordinator forgets it", async () => {
		const clock = fakeClock();
		const test = await setup({ now: clock.now, setTimer: clock.setTimer });
		const client = await connect(test.server);
		await greet(client);

		const repo = join(test.root, "repo");
		await mkdir(repo, { recursive: true });
		await writeFile(join(repo, "README.md"), "# repo\n");
		expect((await command(["jj", "git", "init"], repo)).code).toBe(0);
		expect((await command(["jj", "describe", "-m", "init"], repo)).code).toBe(0);
		expect((await command(["jj", "new"], repo)).code).toBe(0);

		const projectId = await addProject(client, repo);
		await configure(client, projectId);
		test.faux.setResponses(Array.from({ length: 40 }, () => script()));

		const saved = await saveSchedule(client, projectId, {
			title: "Nightly dependency check",
			brief: BRIEF,
			isolation: "workspace",
			onReport: "record",
		});
		const run = await runSchedule(client, projectId, saved.id);
		expect(run.outcome).toBe("started");

		// Unlike a shared run, a workspace run stays: its edits wait for the coordinator to merge them.
		await until(async () => (await listWorkers(client, projectId)).workers[0]?.lastReport !== null);
		const worker = (await listWorkers(client, projectId)).workers[0]!;
		expect(worker.status).toBe("idle");
		expect(worker.workspacePath).not.toBeNull();
		expect(await readdir(worker.workspacePath!)).toContain("README.md");
		// Its report is in the transcript without a coordinator turn, as `record` asks.
		const view = new ViewClient(client);
		await view.start(projectId);
		await view.waitForView((value) =>
			reportEntries(value).some((entry) => entryText(entry).startsWith(`[worker ${run.workerId} reported]`)),
		);
	});
});
