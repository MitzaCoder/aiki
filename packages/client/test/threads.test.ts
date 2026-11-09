/**
 * The thread requests, the pushed thread list and the threadId every conversation request carries, against a stub
 * socket: their shapes are the client's own contract, so they are pinned here without a server.
 */
import { afterEach, describe, expect, it } from "bun:test";
import type { ConversationContext, ThreadSummary } from "@mihai-harness/protocol";
import {
	HarnessClient,
	backgroundThreads,
	contextIsFor,
	contextTarget,
	isMainThread,
	isThreadActive,
	isThreadInput,
	parseThreadInput,
	threadField,
	threadsStateIsFor,
	type HarnessWebSocket,
	type ThreadsSnapshot,
} from "../src/index.ts";

type StubMessage = { type: string; id?: string; [key: string]: unknown };

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
	const socket = new StubSocket((message) => {
		if (message.type === "hello") {
			return {
				type: "hello",
				id: message.id,
				protocolVersion: 1,
				server: { name: "stub", version: "0" },
				features: ["projects", "workers", "threads"],
			};
		}
		return answer(message);
	});
	const client = new HarnessClient({
		url: "ws://stub.invalid/ws",
		clientName: "threads-test",
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

afterEach(() => {
	for (const client of clients.splice(0)) client.close();
});

function thread(overrides: Partial<ThreadSummary> = {}): ThreadSummary {
	return {
		id: "jira-run",
		title: "Jira run",
		status: "running",
		main: false,
		startedBy: "main",
		scheduleId: null,
		conversationId: 7,
		model: null,
		thinkingLevel: null,
		onFinish: "review",
		runningWorkers: 2,
		ownedTasks: ["t1"],
		openQuestions: 0,
		current: "Waiting for 2 workers",
		summary: null,
		failure: null,
		createdAt: "2026-11-04T09:00:00.000Z",
		updatedAt: "2026-11-04T09:05:00.000Z",
		finishedAt: null,
		archived: false,
		...overrides,
	};
}

const MAIN = thread({ id: "main", title: "Main", main: true, startedBy: null, runningWorkers: 0, ownedTasks: [] });

describe("threads requests", () => {
	it("lists threads, archived ones only when asked", async () => {
		const { client, socket } = clientFor((message) =>
			message.type === "threads.list" ? { type: "threads.list", id: message.id, threads: [MAIN, thread()] } : undefined,
		);
		client.connect();
		await client.whenReady();

		expect(await client.listThreads("p1")).toEqual({ threads: [MAIN, thread()] });
		await client.listThreads("p1", { includeArchived: true });
		const lists = socket.sent.filter((message) => message.type === "threads.list");
		expect(lists[0]).toMatchObject({ projectId: "p1" });
		expect(lists[0]?.includeArchived).toBeUndefined();
		expect(lists[1]).toMatchObject({ projectId: "p1", includeArchived: true });
	});

	it("stops and archives a thread", async () => {
		const { client, socket } = clientFor((message) => {
			if (message.type === "threads.stop") return { type: "threads.stop", id: message.id, thread: thread({ status: "stopped" }) };
			if (message.type === "threads.archive") {
				return { type: "threads.archive", id: message.id, thread: thread({ archived: message.archived === true }) };
			}
			return undefined;
		});
		client.connect();
		await client.whenReady();

		expect((await client.stopThread("p1", "jira-run")).status).toBe("stopped");
		expect((await client.archiveThread("p1", "jira-run")).archived).toBe(true);
		expect((await client.archiveThread("p1", "jira-run", false)).archived).toBe(false);
		expect(socket.sent.find((message) => message.type === "threads.stop")).toMatchObject({ projectId: "p1", threadId: "jira-run" });
		expect(socket.sent.filter((message) => message.type === "threads.archive").map((message) => message.archived)).toEqual([
			true,
			false,
		]);
	});

	it("hands every threads.state push to the listeners", async () => {
		const { client, socket } = clientFor(() => undefined);
		client.connect();
		await client.whenReady();
		const seen: (ThreadsSnapshot & { projectId: string })[] = [];
		const off = client.onThreadsState((state) => seen.push(state));
		socket.push({ type: "threads.state", projectId: "p1", threads: [MAIN, thread()] });
		off();
		socket.push({ type: "threads.state", projectId: "p1", threads: [] });
		expect(seen).toEqual([{ projectId: "p1", threads: [MAIN, thread()] }]);
		expect(threadsStateIsFor(seen[0] as { projectId: string }, "p1")).toBe(true);
		expect(threadsStateIsFor(seen[0] as { projectId: string }, "p2")).toBe(false);
	});
});

describe("threadId on conversation requests", () => {
	function answering() {
		return clientFor((message) => {
			switch (message.type) {
				case "conversation.submit":
					return { type: "conversation.submit", id: message.id, submissionId: 1 };
				case "conversation.abort":
					return { type: "conversation.abort", id: message.id };
				case "conversation.compact":
					return { type: "conversation.compact", id: message.id };
				case "conversation.page":
					return { type: "conversation.page", id: message.id, entries: [] };
				case "workers.list":
					return { type: "workers.list", id: message.id, workers: [], defaults: { model: null, thinkingLevel: null } };
				default:
					return undefined;
			}
		});
	}

	it("names a background thread and leaves main out", async () => {
		const { client, socket } = answering();
		client.connect();
		await client.whenReady();

		await client.submit("p1", "hi", { threadId: "jira-run" });
		await client.submit("p1", "hi", { threadId: "main" });
		await client.submit("p1", "hi");
		await client.abort("p1", { threadId: "jira-run" });
		await client.compact("p1", { threadId: "jira-run" });
		await client.page("p1", { threadId: "jira-run", workerId: "w1" });
		const submits = socket.sent.filter((message) => message.type === "conversation.submit");
		expect(submits.map((message) => message.threadId)).toEqual(["jira-run", undefined, undefined]);
		for (const type of ["conversation.abort", "conversation.compact", "conversation.page"]) {
			expect(socket.sent.find((message) => message.type === type)).toMatchObject({ projectId: "p1", threadId: "jira-run" });
		}
	});

	it("sends workers.list's threadId as given, main included", async () => {
		const { client, socket } = answering();
		client.connect();
		await client.whenReady();

		await client.listWorkers("p1");
		await client.listWorkers("p1", { threadId: "main" });
		await client.listWorkers("p1", { threadId: "jira-run" });
		expect(socket.sent.filter((message) => message.type === "workers.list").map((message) => message.threadId)).toEqual([
			undefined,
			"main",
			"jira-run",
		]);
	});

	it("watches a thread's conversation and its workers with the threadId", async () => {
		const { client, socket } = clientFor(() => undefined);
		client.connect();
		await client.whenReady();

		const watch = client.watchConversation("p1", { threadId: "jira-run" });
		const worker = client.watchWorkerConversation("p1", "w1", { threadId: "jira-run" });
		const main = client.watchConversation("p1");
		expect(watch.threadId).toBe("jira-run");
		expect(main.threadId).toBeUndefined();
		for (let tick = 0; tick < 5; tick += 1) await Promise.resolve();
		const watches = socket.sent.filter((message) => message.type === "conversation.watch");
		expect(watches.map((message) => [message.threadId, message.workerId])).toEqual([
			["jira-run", undefined],
			["jira-run", "w1"],
			[undefined, undefined],
		]);
		watch.stop();
		worker.stop();
		main.stop();
	});
});

describe("thread helpers", () => {
	it("tells main from background threads", () => {
		expect(isMainThread(undefined)).toBe(true);
		expect(isMainThread(null)).toBe(true);
		expect(isMainThread("main")).toBe(true);
		expect(isMainThread("jira-run")).toBe(false);
		expect(threadField("main")).toEqual({});
		expect(threadField("jira-run")).toEqual({ threadId: "jira-run" });
		expect(backgroundThreads([MAIN, thread()]).map((each) => each.id)).toEqual(["jira-run"]);
		expect(isThreadActive(thread({ status: "idle" }))).toBe(true);
		expect(isThreadActive(thread({ status: "done" }))).toBe(false);
	});

	it("parses what other threads post", () => {
		expect(parseThreadInput("[thread jira-run finished] All **12** tickets triaged.")).toEqual({
			kind: "finished",
			threadId: "jira-run",
			summary: "All **12** tickets triaged.",
		});
		expect(parseThreadInput("[thread jira-run failed: model refused]")).toEqual({
			kind: "failed",
			threadId: "jira-run",
			reason: "model refused",
		});
		expect(parseThreadInput("[thread jira-run failed: 400 [invalid_request] bad input]")).toEqual({
			kind: "failed",
			threadId: "jira-run",
			reason: "400 [invalid_request] bad input",
		});
		expect(parseThreadInput("[thread jira-run failed] out of budget")).toEqual({
			kind: "failed",
			threadId: "jira-run",
			reason: "out of budget",
		});
		expect(parseThreadInput("[from jira-run] Can you take PR 123?")).toEqual({
			kind: "message",
			from: "jira-run",
			message: "Can you take PR 123?",
		});
		expect(parseThreadInput("[thread jira-run stopped by the user]")).toEqual({
			kind: "other",
			threadId: "jira-run",
			text: "[thread jira-run stopped by the user]",
		});
		expect(parseThreadInput("hello [from x] y")).toBeUndefined();
		expect(parseThreadInput("[thread without a close")).toBeUndefined();
		expect(isThreadInput("[from main] hi")).toBe(true);
		expect(isThreadInput("plain text")).toBe(false);
	});

	it("matches contexts by thread, an absent threadId being main", () => {
		const base = { projectId: "p1", workerId: null } as ConversationContext;
		expect(contextIsFor(base, { projectId: "p1" })).toBe(true);
		expect(contextIsFor({ ...base, threadId: "main" }, { projectId: "p1" })).toBe(true);
		expect(contextIsFor({ ...base, threadId: "jira-run" }, { projectId: "p1" })).toBe(false);
		expect(contextIsFor({ ...base, threadId: "jira-run" }, { projectId: "p1", threadId: "jira-run" })).toBe(true);
		expect(contextIsFor(base, { projectId: "p1", threadId: "jira-run" })).toBe(false);
		expect(contextTarget({ ...base, threadId: "jira-run", workerId: "w1" })).toEqual({
			projectId: "p1",
			workerId: "w1",
			threadId: "jira-run",
		});
	});
});
