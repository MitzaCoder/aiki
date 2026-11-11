/**
 * Archiving projects: an archived project's schedules and event triggers never fire, unarchiving restores them (and
 * takes a fresh GitHub baseline), archiving is refused while work runs, and the flag survives a restart.
 * Notifications for an archived project are covered in `notifications.test.ts`.
 */
import { afterEach, describe, expect, it } from "bun:test";
import type { TranscriptContext } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import type { SetTimer } from "@earendil-works/pi-durable";
import type { ModelRef, ProjectSummary, Schedule, ScheduleInput } from "@aiki/protocol";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { CommandResult, RunCommand } from "../src/host-commands.ts";
import { createSetup, errorOf, TestClient, type TestSetup } from "./support.ts";

const cleanups: (() => Promise<void>)[] = [];
const clients: TestClient[] = [];

const FAUX: ModelRef = { provider: "faux", modelId: "faux-1" };
const TIMEZONE = "Europe/Bucharest";
const BRIEF = "Check the repository for outdated dependencies and report what you find.";
const REVIEW_BRIEF = "Review the pull request and report what you find.";
const START = Date.UTC(2026, 10, 5, 12, 0, 0); // 2026-11-05 14:00 in Bucharest.
const DAY = 24 * 60 * 60_000;

async function setup(options?: Parameters<typeof createSetup>[0]): Promise<TestSetup> {
	const created = await createSetup({ timezone: TIMEZONE, ...options });
	cleanups.push(created.cleanup);
	return created;
}

async function connect(server: TestSetup["server"]): Promise<TestClient> {
	const client = await TestClient.open(server);
	clients.push(client);
	await client.hello();
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
		setTimer: (() => () => undefined) as SetTimer,
		advance(ms: number): void {
			now += ms;
		},
	};
}

async function until(check: () => Promise<boolean> | boolean, timeoutMs = 20_000): Promise<void> {
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		if (await check()) return;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	throw new Error("timed out waiting for a condition");
}

async function addProject(client: TestClient, path: string): Promise<string> {
	const added = await client.request({ type: "projects.add", path });
	if (added.type !== "projects.add") throw errorOf(added);
	const configured = await client.request({
		type: "projects.configure",
		projectId: added.project.id,
		coordinatorModel: FAUX,
		workerModels: [FAUX],
	});
	if (configured.type !== "projects.configure") throw errorOf(configured);
	return added.project.id;
}

async function setArchived(client: TestClient, projectId: string, archived: boolean): Promise<ProjectSummary> {
	const response = await client.request({ type: "projects.configure", projectId, archived });
	if (response.type !== "projects.configure") throw errorOf(response);
	return response.project;
}

async function summary(client: TestClient, projectId: string): Promise<ProjectSummary> {
	const response = await client.request({ type: "projects.list" });
	if (response.type !== "projects.list") throw errorOf(response);
	return response.projects.find((project) => project.id === projectId) as ProjectSummary;
}

function scheduleInput(overrides: Partial<ScheduleInput> = {}): ScheduleInput {
	return {
		title: "Nightly dependency check",
		brief: BRIEF,
		spec: { kind: "daily", time: "03:30" },
		model: null,
		thinkingLevel: null,
		isolation: "shared",
		onReport: "record",
		enabled: true,
		...overrides,
	};
}

async function saveSchedule(client: TestClient, projectId: string, input: ScheduleInput): Promise<Schedule> {
	const response = await client.request({ type: "schedules.save", projectId, schedule: input });
	if (response.type !== "schedules.save") throw errorOf(response);
	return response.schedule;
}

async function schedule(client: TestClient, projectId: string, id: string): Promise<Schedule> {
	const response = await client.request({ type: "schedules.list", projectId });
	if (response.type !== "schedules.list") throw errorOf(response);
	return response.schedules.find((entry) => entry.id === id) as Schedule;
}

function lastText(request: TranscriptContext): { role: string; text: string } {
	const last = request.messages.findLast((message) => message.role !== "system") as
		| { role: string; content?: unknown }
		| undefined;
	const content = last?.content;
	const text =
		typeof content === "string"
			? content
			: Array.isArray(content)
				? content.map((part) => ((part as { type?: string }).type === "text" ? ((part as { text?: string }).text ?? "") : "")).join("")
				: "";
	return { role: last?.role ?? "", text };
}

/** A model that finishes a scheduled worker's brief at once. */
function answerBriefs(test: TestSetup): void {
	test.faux.setResponses(
		Array.from({ length: 80 }, () => (request: TranscriptContext) => {
			const { role, text } = lastText(request);
			if (role === "toolResult") return fauxAssistantMessage("Tool call finished.");
			if (text.includes(BRIEF) || text.includes(REVIEW_BRIEF)) return fauxAssistantMessage("## Report\nOutcome: done\nFiles changed: none");
			return fauxAssistantMessage("Noted.");
		}),
	);
}

describe("an archived project's clock schedules", () => {
	it("never fire, never open the project, and run again from the next slot after unarchiving", async () => {
		const clock = fakeClock();
		const test = await setup({ now: clock.now, setTimer: clock.setTimer });
		answerBriefs(test);
		const client = await connect(test.server);
		const projectId = await addProject(client, test.projectDir);
		const saved = await saveSchedule(client, projectId, scheduleInput());
		expect(saved.nextRunAt).toBe("2026-11-06T01:30:00.000Z");

		const archived = await setArchived(client, projectId, true);
		expect(archived.archived).toBe(true);
		expect(archived.state).toBe("closed");

		// Two days pass, and the clock looks: nothing runs and the project stays closed.
		clock.advance(2 * DAY);
		await test.server.scheduleScheduler.wake();
		const waiting = await schedule(client, projectId, saved.id);
		expect(waiting.runs).toEqual([]);
		expect(waiting.enabled).toBe(true);
		expect(waiting.nextRunAt).toBe("2026-11-06T01:30:00.000Z");
		expect((await summary(client, projectId)).state).toBe("closed");

		// A restart with the project archived does not catch up either.
		await test.restart();
		const again = await connect(test.server);
		expect((await schedule(again, projectId, saved.id)).runs).toEqual([]);
		expect((await summary(again, projectId)).state).toBe("closed");

		// Unarchiving keeps `enabled` and moves the missed slot to the next one: no catch-up burst.
		const back = await setArchived(again, projectId, false);
		expect(back.archived).toBeUndefined();
		const restored = await schedule(again, projectId, saved.id);
		expect(restored.enabled).toBe(true);
		expect(restored.runs).toEqual([]);
		expect(restored.nextRunAt).toBe("2026-11-08T01:30:00.000Z");
		await test.server.scheduleScheduler.wake();
		expect((await schedule(again, projectId, saved.id)).runs).toEqual([]);

		// And it fires as usual when that slot comes.
		clock.advance(DAY);
		await test.server.scheduleScheduler.wake();
		const fired = await schedule(again, projectId, saved.id);
		expect(fired.runs).toHaveLength(1);
		expect(fired.runs[0]).toMatchObject({ trigger: "schedule", outcome: "started" });
	}, 60_000);

	it("keeps a schedule that is still ahead exactly as it was, and a paused one paused", async () => {
		const clock = fakeClock();
		const test = await setup({ now: clock.now, setTimer: clock.setTimer });
		answerBriefs(test);
		const client = await connect(test.server);
		const projectId = await addProject(client, test.projectDir);
		const ahead = await saveSchedule(client, projectId, scheduleInput({ title: "Ahead", spec: { kind: "daily", time: "03:30" } }));
		const paused = await saveSchedule(client, projectId, scheduleInput({ title: "Paused", enabled: false }));

		await setArchived(client, projectId, true);
		clock.advance(60_000);
		await setArchived(client, projectId, false);
		expect((await schedule(client, projectId, ahead.id)).nextRunAt).toBe(ahead.nextRunAt);
		const stillPaused = await schedule(client, projectId, paused.id);
		expect(stillPaused.enabled).toBe(false);
		expect(stillPaused.nextRunAt).toBeNull();
	}, 30_000);
});

// --- event triggers, with a fake `gh` ---------------------------------------------------------------------------------

const ME = "sample-user";
const PLATFORM = "acme/platform";

class FakeGithub {
	searches = 0;
	readonly requests: { number: number; at: string }[] = [];

	request(number: number, at: string): void {
		this.requests.push({ number, at });
	}

	readonly run: RunCommand = async (command, args) => {
		const done = (stdout: string): CommandResult => ({ exitCode: 0, stdout, stderr: "", missing: false });
		if (command !== "gh") return { exitCode: null, stdout: "", stderr: "", missing: true };
		if (args.includes("user/teams")) return done("");
		this.searches += 1;
		const nodes = this.requests.map(({ number, at }) => ({
			number,
			url: `https://github.com/${PLATFORM}/pull/${number}`,
			title: `Change ${number}`,
			isDraft: false,
			baseRefName: "main",
			headRefName: `feature/${number}`,
			headRefOid: `sha-${number}`,
			repository: { nameWithOwner: PLATFORM },
			author: { login: "alice" },
			reviewRequests: { nodes: [{ requestedReviewer: { __typename: "User", login: ME } }] },
			timelineItems: {
				nodes: [
					{
						__typename: "ReviewRequestedEvent",
						id: `RRE_${number}`,
						createdAt: at,
						requestedReviewer: { __typename: "User", login: ME },
					},
				],
			},
		}));
		return done(JSON.stringify({ data: { viewer: { login: ME }, search: { nodes } } }));
	};
}

const eventInput = (): ScheduleInput => scheduleInput({ title: "Review requests", brief: REVIEW_BRIEF, spec: { kind: "github-review-requested" } });

describe("an archived project's event triggers", () => {
	it("do not poll or fire while archived, and take a fresh baseline when unarchived", async () => {
		const github = new FakeGithub();
		const test = await setup({ githubReviews: { run: github.run } });
		answerBriefs(test);
		const client = await connect(test.server);
		const projectId = await addProject(client, test.projectDir);
		// Saving an enabled schedule can immediately establish its baseline. Seed the existing request first:
		// if it arrives after an empty baseline, running it before archiving is correct, not an archive failure.
		github.request(1, "2026-11-08T09:00:00Z");
		const saved = await saveSchedule(client, projectId, eventInput());
		await test.server.scheduleEvents.poll();
		const stateFile = join(test.dataDir, "projects", projectId, "schedule-events.json");
		const baseline = JSON.parse(await readFile(stateFile, "utf8")) as { schedules: Record<string, { seen: Record<string, string> }> };
		expect(Object.keys(baseline.schedules)).toEqual([saved.id]);
		expect(Object.keys(baseline.schedules[saved.id]!.seen)).toHaveLength(1);
		expect((await schedule(client, projectId, saved.id)).runs).toEqual([]);

		await setArchived(client, projectId, true);
		// A request arrives while it is archived. GitHub is not even asked.
		github.request(2, "2026-11-08T10:00:00Z");
		const searchesBefore = github.searches;
		await test.server.scheduleEvents.poll();
		await test.server.scheduleEvents.poll();
		expect(github.searches).toBe(searchesBefore);
		const waiting = await schedule(client, projectId, saved.id);
		expect(waiting.runs).toEqual([]);
		expect(waiting.enabled).toBe(true);
		expect((await summary(client, projectId)).state).toBe("closed");
		// What it had seen is forgotten, as when a schedule is switched off.
		expect(JSON.parse(await readFile(stateFile, "utf8")).schedules).toEqual({});

		// Back: request 2 is part of the new baseline and does not run; request 3 does.
		await setArchived(client, projectId, false);
		await until(() => github.searches > searchesBefore);
		await test.server.scheduleEvents.poll();
		expect((await schedule(client, projectId, saved.id)).runs).toEqual([]);
		github.request(3, "2026-11-08T11:00:00Z");
		await test.server.scheduleEvents.poll();
		const runs = (await schedule(client, projectId, saved.id)).runs.filter((run) => run.outcome === "started");
		expect(runs).toHaveLength(1);
		expect(runs[0]).toMatchObject({ trigger: "event", ref: `https://github.com/${PLATFORM}/pull/3` });
	}, 60_000);

	it("stay silent across a restart while archived", async () => {
		const github = new FakeGithub();
		const test = await setup({ githubReviews: { run: github.run } });
		answerBriefs(test);
		const client = await connect(test.server);
		const projectId = await addProject(client, test.projectDir);
		const saved = await saveSchedule(client, projectId, eventInput());
		await test.server.scheduleEvents.poll();
		await setArchived(client, projectId, true);

		github.request(5, "2026-11-08T10:00:00Z");
		const server = await test.restart();
		const again = await connect(server);
		const searchesBefore = github.searches;
		await server.scheduleEvents.poll();
		expect(github.searches).toBe(searchesBefore);
		expect((await schedule(again, projectId, saved.id)).runs).toEqual([]);
	}, 60_000);
});

describe("archiving", () => {
	it("persists the flag in project.json across a restart, and unarchiving removes it", async () => {
		const test = await setup();
		const client = await connect(test.server);
		const projectId = await addProject(client, test.projectDir);
		const file = join(test.dataDir, "projects", projectId, "project.json");
		expect(JSON.parse(await readFile(file, "utf8")).archived).toBeUndefined();

		await setArchived(client, projectId, true);
		expect(JSON.parse(await readFile(file, "utf8")).archived).toBe(true);
		const server = await test.restart();
		const again = await connect(server);
		const listed = await summary(again, projectId);
		expect(listed.archived).toBe(true);
		// Other settings survive with it, and the project is not opened by being listed.
		expect(listed.coordinator.model).toEqual(FAUX);
		expect(listed.state).toBe("closed");

		await setArchived(again, projectId, false);
		expect(JSON.parse(await readFile(file, "utf8")).archived).toBeUndefined();
		expect((await summary(again, projectId)).archived).toBeUndefined();
	});

	it("announces the change to every connection as a project.state push", async () => {
		const test = await setup();
		const client = await connect(test.server);
		const watcher = await connect(test.server);
		const projectId = await addProject(client, test.projectDir);
		await setArchived(client, projectId, true);
		const pushed = await watcher.waitFor((message) => message.type === "project.state" && message.project.archived === true);
		expect(pushed.type).toBe("project.state");
	});

	it("still opens an archived project by its ID", async () => {
		const test = await setup();
		const client = await connect(test.server);
		const projectId = await addProject(client, test.projectDir);
		await setArchived(client, projectId, true);
		const response = await client.request({ type: "workers.list", projectId });
		expect(response.type).toBe("workers.list");
		const after = await summary(client, projectId);
		expect(after.archived).toBe(true);
		expect(after.state).toBe("open");
	});

	it("is refused, naming what runs, while a worker runs, and works once it has finished", async () => {
		const test = await setup();
		const client = await connect(test.server);
		const projectId = await addProject(client, test.projectDir);
		let release: () => void = () => undefined;
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		test.faux.setResponses(
			Array.from({ length: 60 }, () => async (request: TranscriptContext) => {
				const { role, text } = lastText(request);
				if (role === "toolResult") return fauxAssistantMessage("Tool call finished.");
				if (text === BRIEF) {
					await held;
					return fauxAssistantMessage("## Report\nOutcome: done\nFiles changed: none");
				}
				if (text.includes("reported]")) return fauxAssistantMessage("Report reviewed.");
				if (text.includes("Delegate the reading")) {
					return fauxAssistantMessage([fauxToolCall("worker_spawn", { id: "reader", task: BRIEF, title: "Read" })], { stopReason: "toolUse" });
				}
				return fauxAssistantMessage("Nothing to do.");
			}),
		);
		await client.request({ type: "conversation.submit", projectId, requestId: "r1", content: "Delegate the reading." });
		await until(async () => {
			const workers = await client.request({ type: "workers.list", projectId });
			return workers.type === "workers.list" && workers.workers[0]?.status === "running";
		});

		const refused = await client.request({ type: "projects.configure", projectId, archived: true });
		const error = errorOf(refused);
		expect(error.code).toBe("project_busy");
		expect(error.message).toContain("1 worker is running");
		expect(error.message).toContain("Stop them first");
		expect((await summary(client, projectId)).archived).toBeUndefined();

		release();
		await until(async () => {
			const workers = await client.request({ type: "workers.list", projectId });
			return workers.type === "workers.list" && workers.workers[0]?.status !== "running";
		});
		await until(async () => {
			const response = await client.request({ type: "projects.configure", projectId, archived: true });
			return response.type === "projects.configure";
		});
		expect((await summary(client, projectId)).archived).toBe(true);
	}, 60_000);

	it("is refused while a background thread runs", async () => {
		const test = await setup();
		const client = await connect(test.server);
		const projectId = await addProject(client, test.projectDir);
		const THREAD_BRIEF = "Work through the migration as a thread.";
		let release: () => void = () => undefined;
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		test.faux.setResponses(
			Array.from({ length: 60 }, () => async (request: TranscriptContext) => {
				const { role, text } = lastText(request);
				const added = role === "toolResult" ? /^Added (T\d+) /.exec(text) : null;
				if (added !== null) {
					return fauxAssistantMessage([fauxToolCall("thread_start", { title: "Migration", brief: THREAD_BRIEF, taskId: added[1] as string })], { stopReason: "toolUse" });
				}
				if (role === "toolResult") return fauxAssistantMessage("Tool call finished.");
				if (text === THREAD_BRIEF) {
					await held;
					return fauxAssistantMessage([fauxToolCall("thread_finish", { summary: "Done." })], { stopReason: "toolUse" });
				}
				if (text === "Start the thread.") {
					return fauxAssistantMessage([fauxToolCall("board", { action: "add_task", title: "Migration" })], { stopReason: "toolUse" });
				}
				return fauxAssistantMessage("Noted.");
			}),
		);
		await client.request({ type: "conversation.submit", projectId, requestId: "r1", content: "Start the thread." });
		await until(async () => {
			const threads = await client.request({ type: "threads.list", projectId, includeArchived: false });
			return threads.type === "threads.list" && threads.threads.some((thread) => !thread.main && thread.status === "running");
		});

		const error = errorOf(await client.request({ type: "projects.configure", projectId, archived: true }));
		expect(error.code).toBe("project_busy");
		expect(error.message).toContain("1 background thread is running");
		release();
	}, 60_000);
});
