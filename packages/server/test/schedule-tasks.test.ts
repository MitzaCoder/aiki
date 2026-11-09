/** One board task per clock schedule: its runs' workers and threads are linked to it, with a fake clock. */
import { afterEach, describe, expect, it } from "bun:test";
import type { TranscriptContext } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import type { SetTimer } from "@earendil-works/pi-durable";
import type { Board, BoardTask, BoardTaskInput, BoardTaskSnapshot, ModelRef, Schedule, ScheduleInput } from "@mihai-harness/protocol";
import { emptyBoardState, recordScheduledReport, scheduleTaskForRun, saveTask } from "../src/board.ts";
import { createSetup, errorOf, TestClient, type TestSetup } from "./support.ts";

const cleanups: (() => Promise<void>)[] = [];
const clients: TestClient[] = [];

const FAUX: ModelRef = { provider: "faux", modelId: "faux-1" };
const BRIEF = "Check the repository for outdated dependencies and report what you find.";
const THREAD_BRIEF = "Triage the open issues as a thread and finish with a summary.";
const START = Date.UTC(2026, 10, 5, 12, 0, 0);
const DAY = 24 * 60 * 60_000;

afterEach(async () => {
	for (const client of clients.splice(0)) client.close();
	for (const cleanup of cleanups.splice(0)) await cleanup();
});

function fakeClock(): { now(): number; setTimer: SetTimer; advance(ms: number): void } {
	let now = START;
	return {
		now: () => now,
		setTimer: (() => () => undefined) as SetTimer,
		advance(ms: number): void {
			now += ms;
		},
	};
}

function text(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.map((part) => ((part as { type?: string }).type === "text" ? ((part as { text?: string }).text ?? "") : "")).join("");
}

/** Reports as a worker, finishes as a thread, and says "Noted." to everything else. */
function model(test: TestSetup): void {
	const factory = (request: TranscriptContext) => {
		const last = request.messages.findLast((message) => message.role !== "system");
		const asked = text((last as { content?: unknown } | undefined)?.content);
		if (last?.role === "toolResult") return fauxAssistantMessage("Done.");
		if (asked.includes(THREAD_BRIEF)) {
			return fauxAssistantMessage([fauxToolCall("thread_finish", { summary: "Triaged: two issues." })], { stopReason: "toolUse" });
		}
		if (asked.includes(BRIEF)) return fauxAssistantMessage("## Report\nOutcome: done\nFiles changed: none");
		return fauxAssistantMessage("Noted.");
	};
	test.faux.setResponses(Array.from({ length: 200 }, () => factory));
}

async function until(check: () => Promise<boolean> | boolean, timeoutMs = 20_000): Promise<void> {
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		if (await check()) return;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	throw new Error("timed out waiting for a condition");
}

type Started = { test: TestSetup; clock: ReturnType<typeof fakeClock>; client: TestClient; projectId: string };

async function start(options: { workerModels?: ModelRef[] } = {}): Promise<Started> {
	const clock = fakeClock();
	const test = await createSetup({ timezone: "UTC", now: clock.now, setTimer: clock.setTimer });
	cleanups.push(test.cleanup);
	model(test);
	const client = await TestClient.open(test.server);
	clients.push(client);
	await client.hello();
	const added = await client.request({ type: "projects.add", path: test.projectDir });
	if (added.type !== "projects.add") throw errorOf(added);
	const configured = await client.request({
		type: "projects.configure",
		projectId: added.project.id,
		coordinatorModel: FAUX,
		workerModels: options.workerModels ?? [FAUX],
	});
	expect(configured.type).toBe("projects.configure");
	return { test, clock, client, projectId: added.project.id };
}

async function saveSchedule(client: TestClient, projectId: string, extra: Partial<ScheduleInput> = {}): Promise<Schedule> {
	const response = await client.request({
		type: "schedules.save",
		projectId,
		schedule: {
			title: "Nightly check",
			brief: BRIEF,
			spec: { kind: "daily", time: "03:30" },
			model: null,
			thinkingLevel: null,
			isolation: "shared",
			onReport: "record",
			enabled: true,
			...extra,
		},
	});
	if (response.type !== "schedules.save") throw errorOf(response);
	return response.schedule;
}

async function getSchedule(client: TestClient, projectId: string, id: string): Promise<Schedule> {
	const response = await client.request({ type: "schedules.list", projectId });
	if (response.type !== "schedules.list") throw errorOf(response);
	return response.schedules.find((entry) => entry.id === id) as Schedule;
}

async function board(client: TestClient, projectId: string): Promise<Board> {
	const response = await client.request({ type: "board.get", projectId, includeArchived: false });
	if (response.type !== "board.get") throw errorOf(response);
	return response.board;
}

async function runNow(client: TestClient, projectId: string, scheduleId: string): Promise<Schedule["runs"][number]> {
	const response = await client.request({ type: "schedules.run", projectId, scheduleId });
	if (response.type !== "schedules.run") throw errorOf(response);
	return response.run;
}

async function close(client: TestClient, projectId: string, task: BoardTask): Promise<void> {
	const input: BoardTaskInput = {
		title: task.title,
		description: task.description,
		acceptance: null,
		status: "done",
		blockedBy: [],
		blockedReason: null,
		writeScopes: [],
	};
	const response = await client.request({ type: "board.task.save", projectId, task: input, taskId: task.id, expectedRevision: task.revision });
	if (response.type !== "board.task.save") throw errorOf(response);
}

/** The schedule's task has been put in `review` by a `record` run's report: the run is over. */
async function untilReported(client: TestClient, projectId: string, taskId: string, workerId: string): Promise<BoardTask> {
	let found: BoardTask | undefined;
	await until(async () => {
		found = (await board(client, projectId)).tasks.find((task) => task.id === taskId);
		return found?.status === "review" && (found.report.results.includes(`worker ${workerId} reported`) ?? false);
	});
	return found as BoardTask;
}

describe("one board task per clock schedule", () => {
	it("creates the task on the first run, reuses it for later and manual runs, and keeps it across a restart", async () => {
		const { test, clock, client, projectId } = await start();
		const saved = await saveSchedule(client, projectId);
		expect(saved.taskId).toBeUndefined();
		expect((await board(client, projectId)).tasks).toEqual([]);

		// First run, from the clock.
		clock.advance(DAY);
		await test.server.scheduleScheduler.wake();
		const first = await getSchedule(client, projectId, saved.id);
		const firstRun = first.runs[0]!;
		expect(firstRun).toMatchObject({ trigger: "schedule", outcome: "started", taskId: "T1" });
		expect(first.taskId).toBe("T1");
		let tasks = (await board(client, projectId)).tasks;
		expect(tasks).toHaveLength(1);
		expect(tasks[0]).toMatchObject({
			id: "T1",
			title: "Scheduled: Nightly check",
			createdBy: "harness",
			scheduleId: saved.id,
			workerIds: [firstRun.workerId!],
			refs: [],
		});
		expect(tasks[0]!.description).toContain(`settings#schedule-${saved.id}`);
		expect(tasks[0]!.description).toContain("Collects every run");

		// A `record` run's report puts the run into the task and moves it to review, quietly.
		const reported = await untilReported(client, projectId, "T1", firstRun.workerId!);
		expect(reported.report.now).toBe("");
		expect(reported.report.results).toContain("Outcome: done");
		const history = await client.request({ type: "board.task.history", projectId, taskId: "T1" });
		if (history.type !== "board.task.history") throw errorOf(history);
		expect(history.snapshots.map((snapshot: BoardTaskSnapshot) => snapshot.label)).toEqual(["todo → in_progress", "in_progress → review"]);

		// The second run reuses it: back to in_progress by the spawn, the new worker listed next to the first.
		clock.advance(DAY);
		await test.server.scheduleScheduler.wake();
		const second = await getSchedule(client, projectId, saved.id);
		expect(second.runs[0]).toMatchObject({ trigger: "schedule", taskId: "T1" });
		const secondWorker = second.runs[0]!.workerId!;
		await untilReported(client, projectId, "T1", secondWorker);
		tasks = (await board(client, projectId)).tasks;
		expect(tasks.map((task) => task.id)).toEqual(["T1"]);
		expect(tasks[0]!.workerIds).toEqual([firstRun.workerId!, secondWorker]);
		// The report shows the latest run only.
		expect(tasks[0]!.report.results.split("\n")).toHaveLength(1);
		expect(tasks[0]!.report.results).toContain(`worker ${secondWorker} reported`);

		// A manual run uses the same task.
		clock.advance(60_000);
		const manual = await runNow(client, projectId, saved.id);
		expect(manual).toMatchObject({ trigger: "manual", outcome: "started", taskId: "T1" });
		await untilReported(client, projectId, "T1", manual.workerId!);
		expect((await board(client, projectId)).tasks.map((task) => task.id)).toEqual(["T1"]);

		// The stored task ID survives a restart, and so does the task the next run reuses.
		await test.restart();
		const next = await TestClient.open(test.server);
		clients.push(next);
		await next.hello();
		expect((await getSchedule(next, projectId, saved.id)).taskId).toBe("T1");
		clock.advance(DAY);
		await test.server.scheduleScheduler.wake();
		const after = await getSchedule(next, projectId, saved.id);
		expect(after.runs[0]).toMatchObject({ trigger: "schedule", outcome: "started", taskId: "T1" });
		expect(after.taskId).toBe("T1");
		await untilReported(next, projectId, "T1", after.runs[0]!.workerId!);
		expect((await board(next, projectId)).tasks.map((task) => task.id)).toEqual(["T1"]);
	}, 90_000);

	it("makes a fresh task once the user closed the old one, and links the new one", async () => {
		const { test, clock, client, projectId } = await start();
		const saved = await saveSchedule(client, projectId);
		clock.advance(DAY);
		await test.server.scheduleScheduler.wake();
		const firstWorker = (await getSchedule(client, projectId, saved.id)).runs[0]!.workerId!;
		const old = await untilReported(client, projectId, "T1", firstWorker);
		await close(client, projectId, old);

		clock.advance(DAY);
		await test.server.scheduleScheduler.wake();
		const second = await getSchedule(client, projectId, saved.id);
		expect(second.taskId).toBe("T2");
		expect(second.runs[0]).toMatchObject({ outcome: "started", taskId: "T2" });
		await untilReported(client, projectId, "T2", second.runs[0]!.workerId!);
		const tasks = (await board(client, projectId)).tasks;
		expect(tasks.map((task) => [task.id, task.status, task.workerIds.length])).toEqual([
			["T1", "done", 1],
			["T2", "review", 1],
		]);
	}, 60_000);

	it("moves the task to blocked when a run fails, and the next good run takes it back", async () => {
		const { test, clock, client, projectId } = await start({ workerModels: [] });
		const saved = await saveSchedule(client, projectId);
		clock.advance(DAY);
		await test.server.scheduleScheduler.wake();
		const failed = await getSchedule(client, projectId, saved.id);
		expect(failed.runs[0]).toMatchObject({ outcome: "failed", taskId: "T1" });
		expect(failed.taskId).toBe("T1");
		const [blocked] = (await board(client, projectId)).tasks;
		expect(blocked).toMatchObject({ id: "T1", status: "blocked", scheduleId: saved.id, title: "Scheduled: Nightly check" });
		expect(blocked!.blockedReason).toContain("No worker model is set");

		// A worker model appears: the same task is reused and unblocked by the spawn.
		const configured = await client.request({ type: "projects.configure", projectId, workerModels: [FAUX] });
		expect(configured.type).toBe("projects.configure");
		clock.advance(DAY);
		await test.server.scheduleScheduler.wake();
		const good = await getSchedule(client, projectId, saved.id);
		expect(good.runs[0]).toMatchObject({ outcome: "started", taskId: "T1" });
		const task = await untilReported(client, projectId, "T1", good.runs[0]!.workerId!);
		expect(task.blockedReason).toBeNull();
		expect((await board(client, projectId)).tasks).toHaveLength(1);
	}, 60_000);

	it("leaves the move to the coordinator when the report is reviewed", async () => {
		const { test, clock, client, projectId } = await start();
		const saved = await saveSchedule(client, projectId, { onReport: "review" });
		clock.advance(DAY);
		await test.server.scheduleScheduler.wake();
		const workerId = (await getSchedule(client, projectId, saved.id)).runs[0]!.workerId!;
		// The report reached the coordinator (the worker is forgotten); the harness moved nothing and wrote nothing.
		await until(async () => {
			const listed = await client.request({ type: "workers.list", projectId });
			return listed.type === "workers.list" && listed.workers.find((worker) => worker.id === workerId)?.status === "done";
		});
		const [task] = (await board(client, projectId)).tasks;
		expect(task).toMatchObject({ id: "T1", status: "in_progress", workerIds: [workerId] });
		expect(task!.report.results).toBe("");
	}, 60_000);

	it("gives a thread schedule's thread the same task, reused by the next thread", async () => {
		const { test, clock, client, projectId } = await start();
		const saved = await saveSchedule(client, projectId, { kind: "thread", brief: THREAD_BRIEF });
		clock.advance(DAY);
		await test.server.scheduleScheduler.wake();
		const first = await getSchedule(client, projectId, saved.id);
		expect(first.runs[0]).toMatchObject({ outcome: "started", workerId: null, taskId: "T1" });
		expect(first.taskId).toBe("T1");
		const firstThread = first.runs[0]!.threadId!;
		const threadsOf = async () => {
			const listed = await client.request({ type: "threads.list", projectId, includeArchived: true });
			if (listed.type !== "threads.list") throw errorOf(listed);
			return listed.threads;
		};
		expect((await threadsOf()).find((thread) => thread.id === firstThread)).toMatchObject({ taskId: "T1", scheduleId: saved.id });
		expect((await board(client, projectId)).tasks[0]).toMatchObject({ id: "T1", title: "Scheduled: Nightly check", scheduleId: saved.id });
		await until(async () => (await threadsOf()).find((thread) => thread.id === firstThread)?.status === "done");

		clock.advance(DAY);
		await test.server.scheduleScheduler.wake();
		const second = await getSchedule(client, projectId, saved.id);
		expect(second.runs[0]).toMatchObject({ outcome: "started", taskId: "T1" });
		expect(second.runs[0]!.threadId).not.toBe(firstThread);
		expect((await board(client, projectId)).tasks.map((task) => task.id)).toEqual(["T1"]);
	}, 60_000);
});

describe("the schedule task on the board, as pure state", () => {
	const NOW = "2026-11-05T12:00:00.000Z";
	const input = (title: string, status: BoardTaskInput["status"]): BoardTaskInput => ({
		title,
		description: "",
		acceptance: null,
		status,
		blockedBy: [],
		blockedReason: null,
		writeScopes: [],
	});

	it("reuses an open task in every open status, and makes a new one after a delete", () => {
		const state = emptyBoardState();
		const first = scheduleTaskForRun(state, { scheduleId: "s", title: "Nightly", now: NOW });
		expect(first).toMatchObject({ id: "T1", status: "todo", scheduleId: "s", title: "Scheduled: Nightly" });
		for (const status of ["in_progress", "blocked", "review", "todo"] as const) {
			const task = state.tasks[0] as BoardTask;
			saveTask(state, {
				taskId: "T1",
				expectedRevision: task.revision,
				task: input(task.title, status).status === "blocked" ? { ...input(task.title, status), blockedReason: "stuck" } : input(task.title, status),
				author: "user",
				now: NOW,
			});
			expect(scheduleTaskForRun(state, { scheduleId: "s", title: "Nightly", now: NOW }).id).toBe("T1");
		}
		// Another schedule has its own task.
		expect(scheduleTaskForRun(state, { scheduleId: "other", title: "Other", now: NOW }).id).toBe("T2");
		// The task is gone (deleted): a fresh one, never the old ID.
		state.tasks.splice(0, 1);
		expect(scheduleTaskForRun(state, { scheduleId: "s", title: "Nightly", now: NOW }).id).toBe("T3");
	});

	it("records a record run's report only in the schedule's own task, and only moves an in_progress one", () => {
		const state = emptyBoardState();
		const task = scheduleTaskForRun(state, { scheduleId: "s", title: "Nightly", now: NOW });
		const report = { key: "k1", scheduleId: "s", taskId: task.id, workerId: "w1", text: "## Report\nAll good.\nNothing outdated.", now: NOW };
		// Still todo (the spawn has not moved it): the result lands, the status stays.
		expect(recordScheduledReport(state, report)?.after).toMatchObject({ status: "todo" });
		expect(state.tasks[0]!.report.results).toBe("- 2026-11-05 12:00 UTC, worker w1 reported: Report All good. Nothing outdated.");
		// Once per key.
		expect(recordScheduledReport(state, report)).toBeUndefined();
		const saved = state.tasks[0] as BoardTask;
		saveTask(state, { taskId: saved.id, expectedRevision: saved.revision, task: input(saved.title, "in_progress"), author: "coordinator", now: NOW });
		expect(recordScheduledReport(state, { ...report, key: "k2", workerId: "w2" })?.after).toMatchObject({ status: "review" });
		expect(state.tasks[0]!.report.results).toContain("worker w2 reported");
		// Not the schedule's task: left alone.
		expect(recordScheduledReport(state, { ...report, key: "k3", scheduleId: "elsewhere" })).toBeUndefined();
	});
});
