/**
 * The schedule requests and the pushed schedule list, against a stub socket: their shapes are the client's own
 * contract, so they are pinned here without a server.
 */
import { afterEach, describe, expect, it } from "bun:test";
import type { Schedule, ScheduleInput, ScheduleRun } from "@mihai-harness/protocol";
import {
	HarnessClient,
	latestScheduleRun,
	runHasWorker,
	schedulesStateIsFor,
	type HarnessWebSocket,
	type SchedulesSnapshot,
} from "../src/index.ts";

type StubMessage = {
	type: string;
	id?: string;
	projectId?: string;
	scheduleId?: string;
	schedule?: ScheduleInput;
	[key: string]: unknown;
};

/** A socket that answers `hello` and one request per call, and records what the client sent. */
class StubSocket implements HarnessWebSocket {
	onopen: (() => void) | null = null;
	onmessage: ((event: { data: unknown }) => void) | null = null;
	onclose: ((event: { code?: number; reason?: string }) => void) | null = null;
	onerror: ((event: unknown) => void) | null = null;
	readonly sent: StubMessage[] = [];

	constructor(readonly answer: (message: StubMessage) => unknown) {}

	send(data: string): void {
		const message = JSON.parse(data) as StubMessage;
		this.sent.push(message);
		const response = this.answer(message);
		if (response !== undefined) this.push(response);
	}

	push(message: unknown): void {
		this.onmessage?.({ data: JSON.stringify(message) });
	}

	close(): void {
		this.onclose?.({ code: 1000, reason: "stub closed" });
	}
}

const clients: HarnessClient[] = [];

function clientFor(answer: (message: StubMessage) => unknown): { client: HarnessClient; socket: StubSocket } {
	const socket = new StubSocket(answer);
	const client = new HarnessClient({
		url: "ws://stub.invalid/ws",
		clientName: "schedules-test",
		requestTimeoutMs: 2_000,
		reconnect: false,
		webSocketFactory: () => {
			queueMicrotask(() => socket.onopen?.());
			return socket;
		},
	});
	clients.push(client);
	return { client, socket };
}

function handshakeAnswer(message: StubMessage): unknown | undefined {
	if (message.type !== "hello") return undefined;
	return {
		type: "hello",
		id: message.id,
		protocolVersion: 1,
		server: { name: "stub", version: "0" },
		features: ["projects", "workers", "schedules"],
	};
}

afterEach(() => {
	for (const client of clients.splice(0)) client.close();
});

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
		brief: "Run the test suite and report.",
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

const INPUT: ScheduleInput = {
	title: "Nightly check",
	brief: "Run the test suite and report.",
	spec: { kind: "weekly", days: [1, 3, 5], time: "09:30" },
	model: { provider: "anthropic", modelId: "claude" },
	thinkingLevel: "high",
	isolation: "workspace",
	onReport: "record",
	enabled: true,
};

describe("schedules.list", () => {
	it("sends the project and returns the list with the backend's timezone", async () => {
		const { client, socket } = clientFor((message) => {
			const hello = handshakeAnswer(message);
			if (hello !== undefined) return hello;
			if (message.type !== "schedules.list") return undefined;
			return {
				type: "schedules.list",
				id: message.id,
				schedules: [schedule()],
				timezone: "Europe/Bucharest",
			};
		});
		client.connect();
		await client.whenReady();

		expect(await client.listSchedules("project-1")).toEqual({
			schedules: [schedule()],
			timezone: "Europe/Bucharest",
		});
		expect(socket.sent.find((message) => message.type === "schedules.list")).toMatchObject({
			type: "schedules.list",
			projectId: "project-1",
		});
	});
});

describe("schedules.save", () => {
	it("creates without a scheduleId and sends the whole input", async () => {
		const { client, socket } = clientFor((message) => {
			const hello = handshakeAnswer(message);
			if (hello !== undefined) return hello;
			if (message.type !== "schedules.save") return undefined;
			return { type: "schedules.save", id: message.id, schedule: schedule({ ...INPUT }) };
		});
		client.connect();
		await client.whenReady();

		expect(await client.saveSchedule("project-1", INPUT)).toMatchObject({ id: "nightly", title: "Nightly check" });
		const request = socket.sent.find((message) => message.type === "schedules.save");
		expect(request).toMatchObject({ type: "schedules.save", projectId: "project-1", schedule: INPUT });
		expect(request?.scheduleId).toBeUndefined();
	});

	it("replaces a schedule when given its ID", async () => {
		const { client, socket } = clientFor((message) => {
			const hello = handshakeAnswer(message);
			if (hello !== undefined) return hello;
			if (message.type !== "schedules.save") return undefined;
			return { type: "schedules.save", id: message.id, schedule: schedule({ id: "nightly", ...INPUT }) };
		});
		client.connect();
		await client.whenReady();

		await client.saveSchedule("project-1", INPUT, "nightly");
		expect(socket.sent.find((message) => message.type === "schedules.save")).toMatchObject({
			type: "schedules.save",
			projectId: "project-1",
			scheduleId: "nightly",
			schedule: INPUT,
		});
	});
});

describe("schedules.delete and schedules.run", () => {
	it("deletes one schedule", async () => {
		const { client, socket } = clientFor((message) => {
			const hello = handshakeAnswer(message);
			if (hello !== undefined) return hello;
			if (message.type !== "schedules.delete") return undefined;
			return { type: "schedules.delete", id: message.id };
		});
		client.connect();
		await client.whenReady();

		await client.deleteSchedule("project-1", "nightly");
		expect(socket.sent.find((message) => message.type === "schedules.delete")).toMatchObject({
			type: "schedules.delete",
			projectId: "project-1",
			scheduleId: "nightly",
		});
	});

	it("runs now and returns the recorded run", async () => {
		const recorded = run({ trigger: "manual", outcome: "skipped", workerId: null, message: "previous run still running" });
		const { client, socket } = clientFor((message) => {
			const hello = handshakeAnswer(message);
			if (hello !== undefined) return hello;
			if (message.type !== "schedules.run") return undefined;
			return { type: "schedules.run", id: message.id, run: recorded };
		});
		client.connect();
		await client.whenReady();

		expect(await client.runSchedule("project-1", "nightly")).toEqual(recorded);
		expect(socket.sent.find((message) => message.type === "schedules.run")).toMatchObject({
			type: "schedules.run",
			projectId: "project-1",
			scheduleId: "nightly",
		});
	});
});

describe("schedules.state", () => {
	it("hands every pushed list to the listener with its project and timezone", async () => {
		const { client, socket } = clientFor(handshakeAnswer);
		client.connect();
		await client.whenReady();

		const seen: (SchedulesSnapshot & { projectId: string })[] = [];
		const unsubscribe = client.onSchedulesState((state) => seen.push(state));
		socket.push({
			type: "schedules.state",
			projectId: "project-1",
			schedules: [schedule()],
			timezone: "Europe/Bucharest",
		});
		socket.push({
			type: "schedules.state",
			projectId: "project-2",
			schedules: [],
			timezone: "Europe/Bucharest",
		});

		expect(seen).toHaveLength(2);
		expect(seen[0]).toEqual({
			projectId: "project-1",
			schedules: [schedule()],
			timezone: "Europe/Bucharest",
		});
		expect(seen[1]?.schedules).toEqual([]);
		expect(schedulesStateIsFor(seen[0]!, "project-1")).toBe(true);
		expect(schedulesStateIsFor(seen[1]!, "project-1")).toBe(false);

		unsubscribe();
		socket.push({ type: "schedules.state", projectId: "project-1", schedules: [], timezone: "UTC" });
		expect(seen).toHaveLength(2);
	});
});

describe("latestScheduleRun and runHasWorker", () => {
	it("reads the newest run, which the server keeps first", () => {
		expect(latestScheduleRun(schedule())).toEqual(run());
		expect(
			latestScheduleRun(
				schedule({
					runs: [run({ outcome: "failed", workerId: null }), run({ at: "2026-11-05T07:00:00.000Z" })],
				}),
			)?.outcome,
		).toBe("failed");
		expect(latestScheduleRun(schedule({ runs: [] }))).toBeUndefined();
	});

	it("only a started run has a transcript to open", () => {
		expect(runHasWorker(run())).toBe(true);
		expect(runHasWorker(run({ outcome: "started", workerId: null }))).toBe(false);
		expect(runHasWorker(run({ outcome: "skipped", workerId: null }))).toBe(false);
		expect(runHasWorker(run({ outcome: "failed", workerId: null }))).toBe(false);
	});
});
