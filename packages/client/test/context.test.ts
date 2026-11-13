/**
 * The conversation-context API, against a stub socket: the request's shape, the pushed
 * event and its routing are the client's own contract, so they are pinned here without
 * a server (the server side has its own tests).
 */
import { afterEach, describe, expect, it } from "bun:test";
import type { ConversationContext } from "@kemiri/protocol";
import {
	ClientError,
	HarnessClient,
	contextIsFor,
	contextTarget,
	type HarnessWebSocket,
} from "../src/index.ts";

type StubMessage = {
	type: string;
	id?: string;
	workerId?: string;
	[key: string]: unknown;
};

/** A socket that answers `hello` and `conversation.context`, and records what the client sent. */
class StubSocket implements HarnessWebSocket {
	onopen: (() => void) | null = null;
	onmessage: ((event: { data: unknown }) => void) | null = null;
	onclose: ((event: { code?: number; reason?: string }) => void) | null = null;
	onerror: ((event: unknown) => void) | null = null;
	readonly sent: StubMessage[] = [];

	constructor(
		/** Answer one request, or return undefined to leave it unanswered (a timeout). */
		readonly answer: (message: StubMessage) => unknown,
	) {}

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

function context(overrides: Partial<ConversationContext> = {}): ConversationContext {
	return {
		projectId: "project-1",
		workerId: null,
		cwd: "/repos/demo",
		projectPath: "/repos/demo",
		homeDir: "/home/user",
		systemPrompt: "You are the coordinator.",
		tools: [{ name: "read", description: "Read a file.", extension: null }],
		contextFiles: [],
		skills: [],
		...overrides,
	};
}

const clients: HarnessClient[] = [];
const sockets: StubSocket[] = [];

function clientFor(answer: (message: StubMessage) => unknown): { client: HarnessClient; socket: StubSocket } {
	const socket = new StubSocket(answer);
	sockets.push(socket);
	const client = new HarnessClient({
		url: "ws://stub.invalid/ws",
		clientName: "context-test",
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
		features: ["projects", "conversation", "workers", "context"],
	};
}

afterEach(() => {
	for (const client of clients.splice(0)) client.close();
	sockets.splice(0);
});

describe("conversation context", () => {
	it("requests the coordinator's context, and a worker's when given one", async () => {
		const answers: Record<string, ConversationContext> = {
			coordinator: context(),
			worker: context({ workerId: "alpha", cwd: "/data/workspaces/alpha" }),
		};
		const { client, socket } = clientFor((message) => {
			const hello = handshakeAnswer(message);
			if (hello !== undefined) return hello;
			if (message.type !== "conversation.context") return undefined;
			return {
				type: "conversation.context",
				id: message.id,
				context: message.workerId === undefined ? answers.coordinator : answers.worker,
			};
		});
		client.connect();
		await client.whenReady();

		expect(await client.readContext("project-1")).toEqual(answers.coordinator);
		const coordinatorRequest = socket.sent.find((message) => message.type === "conversation.context");
		expect(coordinatorRequest).toMatchObject({ type: "conversation.context", projectId: "project-1" });
		expect("workerId" in (coordinatorRequest ?? {})).toBe(false);

		expect(await client.readContext("project-1", { workerId: "alpha" })).toEqual(answers.worker);
		const workerRequest = socket.sent.filter((message) => message.type === "conversation.context").at(-1);
		expect(workerRequest).toMatchObject({ type: "conversation.context", projectId: "project-1", workerId: "alpha" });
	});

	it("rejects with the server's error code when the conversation is unknown", async () => {
		const { client } = clientFor((message) => {
			const hello = handshakeAnswer(message);
			if (hello !== undefined) return hello;
			return {
				type: "error",
				id: message.id,
				error: { code: "unknown_worker", message: "No worker alpha in this project." },
			};
		});
		client.connect();
		await client.whenReady();

		const failed = await client.readContext("project-1", { workerId: "alpha" }).catch((error: unknown) => error);
		expect(failed).toBeInstanceOf(ClientError);
		expect((failed as ClientError).code).toBe("unknown_worker");
		expect((failed as ClientError).message).toContain("alpha");
	});
});

describe("pushed contexts", () => {
	it("delivers every context change and keeps the coordinator apart from a worker", async () => {
		const { client, socket } = clientFor(handshakeAnswer);
		client.connect();
		await client.whenReady();

		const received: ConversationContext[] = [];
		const unsubscribe = client.onContextChanged((pushed) => received.push(pushed));

		const coordinator = context({ systemPrompt: "You are the coordinator. (edited)" });
		const worker = context({ workerId: "alpha", cwd: "/data/workspaces/alpha" });
		socket.push({ type: "conversation.context.changed", context: coordinator });
		socket.push({ type: "conversation.context.changed", context: worker });

		expect(received).toEqual([coordinator, worker]);
		expect(received.filter((pushed) => contextIsFor(pushed, { projectId: "project-1" }))).toEqual([coordinator]);
		expect(received.filter((pushed) => contextIsFor(pushed, { projectId: "project-1", workerId: "alpha" }))).toEqual([
			worker,
		]);
		expect(received.filter((pushed) => contextIsFor(pushed, { projectId: "project-2" }))).toEqual([]);

		unsubscribe();
		socket.push({ type: "conversation.context.changed", context: coordinator });
		expect(received.length).toBe(2);
	});

	it("survives a listener that throws, and names the conversation a context belongs to", async () => {
		const { client, socket } = clientFor(handshakeAnswer);
		client.connect();
		await client.whenReady();

		const received: ConversationContext[] = [];
		client.onContextChanged(() => {
			throw new Error("a broken consumer");
		});
		client.onContextChanged((pushed) => received.push(pushed));

		const worker = context({ workerId: "alpha" });
		socket.push({ type: "conversation.context.changed", context: worker });
		expect(received).toEqual([worker]);
		expect(contextTarget(worker)).toEqual({ projectId: "project-1", workerId: "alpha" });
		expect(contextTarget(context())).toEqual({ projectId: "project-1" });
	});
});
