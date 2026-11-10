/**
 * Storing the composer's worker pick (`workers.defaults.set`), against a stub socket: the request's shape and the
 * fallback decision are the client's own contract, so they are pinned here without a server.
 */
import { afterEach, describe, expect, it } from "bun:test";
import type { WorkerDefaults } from "@aiki/protocol";
import {
	ClientError,
	HarnessClient,
	defaultsSetUnsupported,
	shouldSendWorkerDefaults,
	type HarnessWebSocket,
} from "../src/index.ts";

type StubMessage = {
	type: string;
	id?: string;
	projectId?: string;
	defaults?: WorkerDefaults;
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
		clientName: "workers-test",
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
		features: ["projects", "conversation", "workers"],
	};
}

afterEach(() => {
	for (const client of clients.splice(0)) client.close();
});

const PICK: WorkerDefaults = { model: { provider: "anthropic", modelId: "claude" }, thinkingLevel: "high" };

describe("workers.defaults.set", () => {
	it("sends the project and the whole choice, and returns what the server stored", async () => {
		const { client, socket } = clientFor((message) => {
			const hello = handshakeAnswer(message);
			if (hello !== undefined) return hello;
			if (message.type !== "workers.defaults.set") return undefined;
			return { type: "workers.defaults.set", id: message.id, defaults: message.defaults };
		});
		client.connect();
		await client.whenReady();

		expect(await client.setWorkerDefaults("project-1", PICK)).toEqual(PICK);
		const request = socket.sent.find((message) => message.type === "workers.defaults.set");
		expect(request).toMatchObject({
			type: "workers.defaults.set",
			projectId: "project-1",
			defaults: { model: { provider: "anthropic", modelId: "claude" }, thinkingLevel: "high" },
		});
	});

	it("clears the pick with nulls", async () => {
		const { client, socket } = clientFor((message) => {
			const hello = handshakeAnswer(message);
			if (hello !== undefined) return hello;
			return { type: "workers.defaults.set", id: message.id, defaults: message.defaults };
		});
		client.connect();
		await client.whenReady();

		expect(await client.setWorkerDefaults("project-1", { model: null, thinkingLevel: null })).toEqual({
			model: null,
			thinkingLevel: null,
		});
		const request = socket.sent.find((message) => message.type === "workers.defaults.set");
		expect(request?.defaults).toEqual({ model: null, thinkingLevel: null });
	});

	it("rejects with the server's code, which a caller reads as an older backend", async () => {
		const { client } = clientFor((message) => {
			const hello = handshakeAnswer(message);
			if (hello !== undefined) return hello;
			return {
				type: "error",
				id: message.id,
				error: { code: "unknown_request", message: "Unknown request type workers.defaults.set." },
			};
		});
		client.connect();
		await client.whenReady();

		const failed = await client.setWorkerDefaults("project-1", PICK).catch((error: unknown) => error);
		expect(failed).toBeInstanceOf(ClientError);
		expect((failed as ClientError).code).toBe("unknown_request");
		expect(defaultsSetUnsupported(failed)).toBe(true);
	});
});

describe("shouldSendWorkerDefaults", () => {
	it("keeps sending the pick until the backend proves it stores one", () => {
		expect(shouldSendWorkerDefaults(true, "unknown")).toBe(true);
		expect(shouldSendWorkerDefaults(true, "unsupported")).toBe(true);
		expect(shouldSendWorkerDefaults(true, "supported")).toBe(false);
	});

	it("never sends a pick before the worker list has loaded", () => {
		expect(shouldSendWorkerDefaults(false, "unknown")).toBe(false);
		expect(shouldSendWorkerDefaults(false, "unsupported")).toBe(false);
		expect(shouldSendWorkerDefaults(false, "supported")).toBe(false);
	});
});

describe("defaultsSetUnsupported", () => {
	it("only an unknown_request means the backend predates the request", () => {
		expect(defaultsSetUnsupported(new ClientError("unknown_request", "nope"))).toBe(true);
		expect(defaultsSetUnsupported(new ClientError("internal", "boom"))).toBe(false);
		expect(defaultsSetUnsupported(new ClientError("timeout", "slow"))).toBe(false);
		expect(defaultsSetUnsupported(new Error("unknown_request"))).toBe(false);
		expect(defaultsSetUnsupported("unknown_request")).toBe(false);
	});
});
