/**
 * Compacting the coordinator's conversation now (`conversation.compact`), against a stub socket: the request's shape
 * and what the caller learns from the answer are the client's own contract, so they are pinned here without a server.
 */
import { afterEach, describe, expect, it } from "bun:test";
import { ClientError, HarnessClient, type HarnessWebSocket } from "../src/index.ts";

type StubMessage = {
	type: string;
	id?: string;
	projectId?: string;
	instructions?: string;
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
		clientName: "compaction-test",
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
		features: ["projects", "conversation", "context"],
	};
}

/** Answer the request the way a server that supports it does: the same type, under the request's ID. */
function compactAnswer(message: StubMessage): unknown | undefined {
	if (message.type !== "conversation.compact") return undefined;
	return { type: "conversation.compact", id: message.id };
}

afterEach(() => {
	for (const client of clients.splice(0)) client.close();
});

describe("conversation.compact", () => {
	it("names the project and carries no instructions when none are given", async () => {
		const { client, socket } = clientFor((message) => handshakeAnswer(message) ?? compactAnswer(message));
		client.connect();
		await client.whenReady();

		await client.compact("project-1");
		const request = socket.sent.find((message) => message.type === "conversation.compact");
		expect(request).toMatchObject({ type: "conversation.compact", projectId: "project-1" });
		expect(request === undefined ? true : "instructions" in request).toBe(false);
	});

	it("sends instructions trimmed, which the summary is built from", async () => {
		const { client, socket } = clientFor((message) => handshakeAnswer(message) ?? compactAnswer(message));
		client.connect();
		await client.whenReady();

		await client.compact("project-1", { instructions: "  keep the deploy details  " });
		const request = socket.sent.find((message) => message.type === "conversation.compact");
		expect(request?.instructions).toBe("keep the deploy details");
	});

	it("treats empty and blank instructions as none", async () => {
		const { client, socket } = clientFor((message) => handshakeAnswer(message) ?? compactAnswer(message));
		client.connect();
		await client.whenReady();

		await client.compact("project-1", { instructions: "" });
		await client.compact("project-1", { instructions: "   \n " });
		const requests = socket.sent.filter((message) => message.type === "conversation.compact");
		expect(requests).toHaveLength(2);
		for (const request of requests) expect("instructions" in request).toBe(false);
	});

	it("rejects with the server's code when the backend does not compact", async () => {
		const { client } = clientFor((message) => {
			const hello = handshakeAnswer(message);
			if (hello !== undefined) return hello;
			return {
				type: "error",
				id: message.id,
				error: { code: "unknown_request", message: "This server does not know conversation.compact." },
			};
		});
		client.connect();
		await client.whenReady();

		const failed = await client.compact("project-1").catch((error: unknown) => error);
		expect(failed).toBeInstanceOf(ClientError);
		expect((failed as ClientError).code).toBe("unknown_request");
	});
});
