/**
 * The server-status API, against a stub socket: the request's shape, the pushed event and the deploy judgement are the
 * client's own contract, so they are pinned here without a server (the server side has its own tests).
 */
import { afterEach, describe, expect, it } from "bun:test";
import type { DeployStatus, ReleaseInfo, ServerStatus } from "@mihai-harness/protocol";
import {
	ClientError,
	HarnessClient,
	deployAttemptKey,
	deployProblem,
	shortCommit,
	type HarnessWebSocket,
} from "../src/index.ts";

type StubMessage = {
	type: string;
	id?: string;
	[key: string]: unknown;
};

/** A socket that answers `hello` and `server.status`, and records what the client sent. */
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

function release(overrides: Partial<ReleaseInfo> = {}): ReleaseInfo {
	return {
		name: "20261030T113815Z-be84355",
		commit: "be84355c5bed5b9bcb2f0a8e4f4b9a0f2f6c1d2e",
		description: "feat: give the harness its own SYSTEM.md",
		deployedAt: "2026-10-30T11:38:15Z",
		...overrides,
	};
}

function deploy(overrides: Partial<DeployStatus> = {}): DeployStatus {
	return {
		state: "ok",
		commit: "be84355c5bed5b9bcb2f0a8e4f4b9a0f2f6c1d2e",
		description: "feat: give the harness its own SYSTEM.md",
		message: null,
		at: "2026-10-30T11:39:02Z",
		...overrides,
	};
}

function status(overrides: Partial<ServerStatus> = {}): ServerStatus {
	return {
		release: release(),
		deploy: deploy(),
		busy: { conversations: 0, workers: 0 },
		startedAt: "2026-10-30T11:38:20Z",
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
		clientName: "server-status-test",
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
		features: ["projects", "conversation", "server-status"],
	};
}

afterEach(() => {
	for (const client of clients.splice(0)) client.close();
	sockets.splice(0);
});

describe("server status", () => {
	it("asks with a bare server.status request and reads the status out of the answer", async () => {
		const answer = status();
		const { client, socket } = clientFor((message) => {
			const hello = handshakeAnswer(message);
			if (hello !== undefined) return hello;
			if (message.type !== "server.status") return undefined;
			return { type: "server.status", id: message.id, status: answer };
		});
		client.connect();
		await client.whenReady();

		expect(await client.readServerStatus()).toEqual(answer);
		const request = socket.sent.find((message) => message.type === "server.status");
		expect(request).toMatchObject({ type: "server.status" });
		expect(Object.keys(request ?? {}).sort()).toEqual(["id", "type"]);
	});

	it("rejects with the server's error code when the request fails", async () => {
		const { client } = clientFor((message) => {
			const hello = handshakeAnswer(message);
			if (hello !== undefined) return hello;
			return {
				type: "error",
				id: message.id,
				error: { code: "unknown_project", message: "No project status is available." },
			};
		});
		client.connect();
		await client.whenReady();

		const failed = await client.readServerStatus().catch((error: unknown) => error);
		expect(failed).toBeInstanceOf(ClientError);
		expect((failed as ClientError).code).toBe("unknown_project");
	});
});

describe("pushed server status", () => {
	it("delivers every change until the listener unsubscribes", async () => {
		const { client, socket } = clientFor(handshakeAnswer);
		client.connect();
		await client.whenReady();

		const received: ServerStatus[] = [];
		const unsubscribe = client.onServerStatusChanged((pushed) => received.push(pushed));

		const first = status();
		const second = status({
			release: release({ name: "20261031T090000Z-1231234", commit: "1231234890abcdef" }),
			deploy: deploy({ state: "rolled_back", commit: "1231234890abcdef", message: "health check timed out" }),
		});
		socket.push({ type: "server.status.changed", status: first });
		socket.push({ type: "server.status.changed", status: second });
		expect(received).toEqual([first, second]);

		unsubscribe();
		socket.push({ type: "server.status.changed", status: first });
		expect(received.length).toBe(2);
	});

	it("survives a listener that throws, and still tells the next one", async () => {
		const { client, socket } = clientFor(handshakeAnswer);
		client.connect();
		await client.whenReady();

		const received: ServerStatus[] = [];
		client.onServerStatusChanged(() => {
			throw new Error("a broken consumer");
		});
		client.onServerStatusChanged((pushed) => received.push(pushed));

		const honour = status();
		socket.push({ type: "server.status.changed", status: honour });
		expect(received).toEqual([honour]);
	});
});

describe("deployProblem", () => {
	it("says nothing when there is no status, no deploy, or a matching successful deploy", () => {
		expect(deployProblem(undefined)).toBeUndefined();
		expect(deployProblem(null)).toBeUndefined();
		expect(deployProblem(status({ deploy: null }))).toBeUndefined();
		expect(deployProblem(status())).toBeUndefined();
	});

	it("reports a failed deploy with the release that keeps running", () => {
		const failure = deploy({ state: "failed", commit: "1111111aaaa", message: "checks failed: typecheck" });
		const problem = deployProblem(status({ deploy: failure, busy: { conversations: 1, workers: 2 } }));
		expect(problem).toEqual({ kind: "failed", deploy: failure, running: release() });
	});

	it("reports a rolled back deploy", () => {
		const rollback = deploy({ state: "rolled_back", commit: "2222222bbbb", message: "health check timed out" });
		expect(deployProblem(status({ deploy: rollback }))?.kind).toBe("rolled_back");
	});

	it("flags an ok deploy whose commit differs from the running release", () => {
		const problem = deployProblem(
			status({ deploy: deploy({ commit: "3333333cccc" }), release: release({ commit: "4444444dddd" }) }),
		);
		expect(problem?.kind).toBe("unexpected_release");
		expect(problem?.deploy.commit).toBe("3333333cccc");
		expect(problem?.running?.commit).toBe("4444444dddd");
	});

	it("accepts an older running release when the deploy left the backend unchanged", () => {
		const unchanged = deploy({ commit: "3333333cccc", backendUnchanged: true });
		expect(deployProblem(status({ deploy: unchanged, release: release({ commit: "4444444dddd" }) }))).toBeUndefined();
	});

	it("does not compare commits when the server runs from a checkout", () => {
		expect(deployProblem(status({ release: null }))).toBeUndefined();
	});
});

describe("labels", () => {
	it("shortens commits, leaving short ones alone", () => {
		expect(shortCommit("be84355c5bed5b9bcb2f0a8e4f4b9a0f2f6c1d2e")).toBe("be84355");
		expect(shortCommit("abc")).toBe("abc");
		expect(shortCommit("be84355c5bed", 10)).toBe("be84355c5b");
	});

	it("keys a dismissal by attempt, so the next deploy shows again", () => {
		expect(deployAttemptKey(deploy())).toBe("be84355c5bed5b9bcb2f0a8e4f4b9a0f2f6c1d2e@2026-10-30T11:39:02Z");
		expect(deployAttemptKey(deploy({ at: "2026-10-31T08:00:00Z" }))).not.toBe(deployAttemptKey(deploy()));
	});
});
