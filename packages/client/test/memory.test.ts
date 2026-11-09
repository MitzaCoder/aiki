/**
 * The memory API, against a stub socket: the request shapes, the pushed `memory.changed` event and the snippet markers
 * are the client's own contract, so they are pinned here without a server (the server side has its own tests).
 */
import { afterEach, describe, expect, it } from "bun:test";
import type {
	MemoryChange,
	MemoryFile,
	MemoryFileSummary,
	MemoryMaintenanceSettings,
	MemoryScopeStatus,
	MemorySearchHit,
} from "@mihai-harness/protocol";
import {
	ClientError,
	HarnessClient,
	MEMORY_CONFLICT_CODE,
	MEMORY_MATCH_END,
	MEMORY_MATCH_START,
	memoryChangedIsFor,
	memorySnippetParts,
	memoryTargetOf,
	memoryUndoConflict,
	type HarnessWebSocket,
} from "../src/index.ts";

type StubMessage = {
	type: string;
	id?: string;
	[key: string]: unknown;
};

/** A socket that answers `hello` and the memory requests, and records what the client sent. */
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

function summary(overrides: Partial<MemoryFileSummary> = {}): MemoryFileSummary {
	return {
		scope: "global",
		fileId: "testing",
		title: "Testing",
		summary: "How this user tests.",
		tags: ["testing", "bun"],
		links: [],
		status: "active",
		supersededBy: null,
		headings: ["Unit tests", "Headless Chrome"],
		created: "2026-11-01T09:00:00Z",
		updated: "2026-11-04T18:30:00Z",
		source: { projectId: "project-1", conversationId: 4, entryId: 12 },
		...overrides,
	};
}

function file(overrides: Partial<MemoryFile> = {}): MemoryFile {
	return { file: summary(), body: "## Unit tests\n\nBun only.\n", ...overrides };
}

function hit(overrides: Partial<MemorySearchHit> = {}): MemorySearchHit {
	return {
		scope: "global",
		fileId: "testing",
		title: "Testing",
		heading: "Unit tests",
		snippet: `Bun only. ${MEMORY_MATCH_START}run${MEMORY_MATCH_END} them with ${MEMORY_MATCH_START}bun test${MEMORY_MATCH_END}.`,
		rank: -1.5,
		...overrides,
	};
}

function change(overrides: Partial<MemoryChange> = {}): MemoryChange {
	return {
		commit: "be84355c5bed5b9bcb2f0a8e4f4b9a0f2f6c1d2e",
		message: "memory: add the testing topic\n\nFrom the review conversation.",
		at: "2026-11-04T18:30:00Z",
		files: ["testing"],
		...overrides,
	};
}

function scopeStatus(): MemoryScopeStatus {
	return {
		scope: "global",
		projectId: null,
		writesSinceMaintenance: 3,
		maintaining: false,
		lastMaintenance: {
			at: "2026-11-04T03:00:00Z",
			outcome: "ok",
			commit: "be84355c5bed5b9bcb2f0a8e4f4b9a0f2f6c1d2e",
			message: "Memory maintenance: merged the testing topics.",
		},
		nextMaintenanceAt: "2026-11-05T03:00:00Z",
	};
}

function maintenance(overrides: Partial<MemoryMaintenanceSettings> = {}): MemoryMaintenanceSettings {
	return {
		model: { provider: "anthropic", modelId: "claude-sonnet-4-5" },
		thinkingLevel: "medium",
		time: "03:00",
		afterWrites: 20,
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
		clientName: "memory-test",
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
		features: ["projects", "conversation", "memory"],
	};
}

function answeredMemory(message: StubMessage): unknown | undefined {
	switch (message.type) {
		case "memory.list":
			return { type: "memory.list", id: message.id, files: [summary()] };
		case "memory.read":
			return { type: "memory.read", id: message.id, file: file() };
		case "memory.search":
			return { type: "memory.search", id: message.id, hits: [hit()] };
		case "memory.history":
			return { type: "memory.history", id: message.id, changes: [change()] };
		case "memory.undo":
			return { type: "memory.undo", id: message.id, change: change({ commit: "a1b2c3", message: "memory: undo" }) };
		case "memory.status":
			return {
				type: "memory.status",
				id: message.id,
				status: scopeStatus(),
				maintenance: maintenance(),
				timezone: "Europe/Bucharest",
			};
		case "memory.maintain":
			return { type: "memory.maintain", id: message.id };
		case "memory.settings.set":
			return { type: "memory.settings.set", id: message.id, maintenance: message.maintenance };
		default:
			return undefined;
	}
}

function sentOf(socket: StubSocket, type: string): StubMessage[] {
	return socket.sent.filter((message) => message.type === type);
}

afterEach(() => {
	for (const client of clients.splice(0)) client.close();
	sockets.splice(0);
});

describe("memory requests", () => {
	it("lists a project's files with the scope and project, archived only when asked", async () => {
		const { client, socket } = clientFor((message) => handshakeAnswer(message) ?? answeredMemory(message));
		client.connect();
		await client.whenReady();

		expect(await client.listMemory({ scope: "project", projectId: "project-1" })).toEqual([summary()]);
		const request = sentOf(socket, "memory.list")[0];
		expect(request).toEqual({ type: "memory.list", id: expect.any(String), scope: "project", projectId: "project-1" });

		await client.listMemory({ scope: "project", projectId: "project-1", includeArchived: true });
		expect(sentOf(socket, "memory.list")[1]).toMatchObject({ includeArchived: true });
	});

	it("leaves the project out of a global request, even when one is at hand", async () => {
		const { client, socket } = clientFor((message) => handshakeAnswer(message) ?? answeredMemory(message));
		client.connect();
		await client.whenReady();

		await client.listMemory({ scope: "global", projectId: "project-1" });
		await client.readMemory({ scope: "global", projectId: "project-1", fileId: "testing" });
		await client.readMemoryHistory({ scope: "global", projectId: "project-1" });

		expect(Object.keys(sentOf(socket, "memory.list")[0] ?? {}).sort()).toEqual(["id", "scope", "type"]);
		expect(sentOf(socket, "memory.read")[0]).toEqual({
			type: "memory.read",
			id: expect.any(String),
			scope: "global",
			fileId: "testing",
		});
		expect(Object.keys(sentOf(socket, "memory.history")[0] ?? {}).sort()).toEqual(["id", "scope", "type"]);
	});

	it("reads one file and one scope's history, with an optional limit", async () => {
		const { client, socket } = clientFor((message) => handshakeAnswer(message) ?? answeredMemory(message));
		client.connect();
		await client.whenReady();

		expect(await client.readMemory({ scope: "project", projectId: "project-1", fileId: "deploy" })).toEqual(file());
		expect(sentOf(socket, "memory.read")[0]).toMatchObject({ scope: "project", projectId: "project-1", fileId: "deploy" });

		expect(await client.readMemoryHistory({ scope: "project", projectId: "project-1", limit: 10 })).toEqual([
			change(),
		]);
		expect(sentOf(socket, "memory.history")[0]).toMatchObject({
			scope: "project",
			projectId: "project-1",
			limit: 10,
		});
	});

	it("undoes one change in its scope and answers with the undo commit", async () => {
		const { client, socket } = clientFor((message) => handshakeAnswer(message) ?? answeredMemory(message));
		client.connect();
		await client.whenReady();

		expect(await client.undoMemory({ scope: "project", projectId: "project-1", commit: "abc123" })).toEqual(
			change({ commit: "a1b2c3", message: "memory: undo" }),
		);
		expect(sentOf(socket, "memory.undo")[0]).toEqual({
			type: "memory.undo",
			id: expect.any(String),
			scope: "project",
			projectId: "project-1",
			commit: "abc123",
		});
	});

	it("says whether an undo was refused because later changes touched the same files", async () => {
		const { client, socket } = clientFor((message) => {
			const hello = handshakeAnswer(message);
			if (hello !== undefined) return hello;
			return {
				type: "error",
				id: message.id,
				error: { code: "memory_conflict", message: "testing changed after this commit." },
			};
		});
		client.connect();
		await client.whenReady();

		const refused = await client
			.undoMemory({ scope: "global", commit: "abc123" })
			.catch((error: unknown) => error);
		expect(refused).toBeInstanceOf(ClientError);
		expect((refused as ClientError).code).toBe(MEMORY_CONFLICT_CODE);
		expect(memoryUndoConflict(refused)).toBe(true);
		expect(sentOf(socket, "memory.undo")[0]).toEqual({
			type: "memory.undo",
			id: expect.any(String),
			scope: "global",
			commit: "abc123",
		});
	});

	it("reads a scope's status with the backend's settings and timezone", async () => {
		const { client, socket } = clientFor((message) => handshakeAnswer(message) ?? answeredMemory(message));
		client.connect();
		await client.whenReady();

		expect(await client.readMemoryStatus({ scope: "project", projectId: "project-1" })).toEqual({
			status: scopeStatus(),
			maintenance: maintenance(),
			timezone: "Europe/Bucharest",
		});
		expect(sentOf(socket, "memory.status")[0]).toEqual({
			type: "memory.status",
			id: expect.any(String),
			scope: "project",
			projectId: "project-1",
		});

		await client.readMemoryStatus({ scope: "global", projectId: "project-1" });
		expect(Object.keys(sentOf(socket, "memory.status")[1] ?? {}).sort()).toEqual(["id", "scope", "type"]);
	});

	it("runs maintenance now on one scope, without a body", async () => {
		const { client, socket } = clientFor((message) => handshakeAnswer(message) ?? answeredMemory(message));
		client.connect();
		await client.whenReady();

		await client.maintainMemory({ scope: "global" });
		expect(sentOf(socket, "memory.maintain")[0]).toEqual({
			type: "memory.maintain",
			id: expect.any(String),
			scope: "global",
		});
	});

	it("saves the maintenance settings and answers with the stored ones", async () => {
		const { client, socket } = clientFor((message) => handshakeAnswer(message) ?? answeredMemory(message));
		client.connect();
		await client.whenReady();

		const off = maintenance({ model: null, thinkingLevel: null, time: "04:30", afterWrites: 5 });
		expect(await client.setMemoryMaintenance(off)).toEqual(off);
		expect(sentOf(socket, "memory.settings.set")[0]).toEqual({
			type: "memory.settings.set",
			id: expect.any(String),
			maintenance: off,
		});
	});

	it("searches one scope or both, sending tags, the archive flag and the limit only when given", async () => {
		const { client, socket } = clientFor((message) => handshakeAnswer(message) ?? answeredMemory(message));
		client.connect();
		await client.whenReady();

		expect(await client.searchMemory({ scope: "global", query: "bun" })).toEqual([hit()]);
		expect(sentOf(socket, "memory.search")[0]).toEqual({
			type: "memory.search",
			id: expect.any(String),
			scope: "global",
			query: "bun",
		});

		await client.searchMemory({
			scope: "both",
			projectId: "project-1",
			query: "deploy",
			tags: ["jj", "deploy"],
			includeArchived: true,
			limit: 5,
		});
		expect(sentOf(socket, "memory.search")[1]).toEqual({
			type: "memory.search",
			id: expect.any(String),
			scope: "both",
			projectId: "project-1",
			query: "deploy",
			tags: ["jj", "deploy"],
			includeArchived: true,
			limit: 5,
		});
	});

	it("rejects with the server's error code when a request fails", async () => {		const { client } = clientFor((message) => {
			const hello = handshakeAnswer(message);
			if (hello !== undefined) return hello;
			return {
				type: "error",
				id: message.id,
				error: { code: "unknown_project", message: "No project project-9." },
			};
		});
		client.connect();
		await client.whenReady();

		const failed = await client.listMemory({ scope: "project", projectId: "project-9" }).catch((error: unknown) => error);
		expect(failed).toBeInstanceOf(ClientError);
		expect((failed as ClientError).code).toBe("unknown_project");
	});
});

describe("memoryUndoConflict", () => {
	it("recognises the server's refusal and nothing else", () => {
		expect(memoryUndoConflict(new ClientError("memory_conflict", "testing changed after this commit."))).toBe(true);
		expect(memoryUndoConflict(new ClientError("unknown_memory", "No such memory."))).toBe(false);
		expect(memoryUndoConflict(new Error("socket closed"))).toBe(false);
		expect(memoryUndoConflict(undefined)).toBe(false);
	});
});

describe("pushed memory changes", () => {
	it("delivers every change until the listener unsubscribes", async () => {
		const { client, socket } = clientFor(handshakeAnswer);
		client.connect();
		await client.whenReady();

		const received: unknown[] = [];
		const unsubscribe = client.onMemoryChanged((event) => received.push(event));

		const first = { type: "memory.changed", scope: "global", projectId: null };
		const second = { type: "memory.changed", scope: "project", projectId: "project-1" };
		socket.push(first);
		socket.push(second);
		expect(received).toEqual([first, second]);

		unsubscribe();
		socket.push(first);
		expect(received.length).toBe(2);
	});

	it("survives a listener that throws, and still tells the next one", async () => {
		const { client, socket } = clientFor(handshakeAnswer);
		client.connect();
		await client.whenReady();

		const received: string[] = [];
		client.onMemoryChanged(() => {
			throw new Error("a broken consumer");
		});
		client.onMemoryChanged((event) => received.push(`${event.scope}:${event.projectId ?? "-"}`));

		socket.push({ type: "memory.changed", scope: "global", projectId: null });
		expect(received).toEqual(["global:-"]);
	});
});

describe("memoryChangedIsFor", () => {
	it("matches a scope and, for a project, its project", () => {
		const projectEvent = { scope: "project" as const, projectId: "project-1" };
		expect(memoryChangedIsFor(projectEvent, { scope: "project", projectId: "project-1" })).toBe(true);
		expect(memoryChangedIsFor(projectEvent, { scope: "project", projectId: "project-2" })).toBe(false);
		expect(memoryChangedIsFor(projectEvent, { scope: "global" })).toBe(false);
	});

	it("never lets a global event concern a project's files, nor the reverse", () => {
		const globalEvent = { scope: "global" as const, projectId: null };
		expect(memoryChangedIsFor(globalEvent, { scope: "global" })).toBe(true);
		expect(memoryChangedIsFor(globalEvent, { scope: "global", projectId: "project-1" })).toBe(true);
		expect(memoryChangedIsFor(globalEvent, { scope: "project", projectId: "project-1" })).toBe(false);
	});
});

describe("memoryTargetOf", () => {
	it("drops the protocol's null project for a global change", () => {
		expect(memoryTargetOf({ scope: "global", projectId: null })).toEqual({ scope: "global" });
		expect(memoryTargetOf({ scope: "project", projectId: "project-1" })).toEqual({
			scope: "project",
			projectId: "project-1",
		});
	});
});

describe("memorySnippetParts", () => {
	it("splits a snippet into plain and matched runs, in order", () => {
		expect(memorySnippetParts(`before ${MEMORY_MATCH_START}hit${MEMORY_MATCH_END} after`)).toEqual([
			{ text: "before ", match: false },
			{ text: "hit", match: true },
			{ text: " after", match: false },
		]);
		expect(memorySnippetParts(`${MEMORY_MATCH_START}all of it${MEMORY_MATCH_END}`)).toEqual([
			{ text: "all of it", match: true },
		]);
	});

	it("drops empty runs and stray markers", () => {
		expect(memorySnippetParts("plain")).toEqual([{ text: "plain", match: false }]);
		expect(memorySnippetParts("")).toEqual([]);
		expect(memorySnippetParts(`${MEMORY_MATCH_END}plain${MEMORY_MATCH_START}`)).toEqual([
			{ text: "plain", match: false },
		]);
		expect(memorySnippetParts(`${MEMORY_MATCH_START}a${MEMORY_MATCH_START}b${MEMORY_MATCH_END}`)).toEqual([
			{ text: "ab", match: true },
		]);
	});

	it("runs an unclosed match to the end", () => {
		expect(memorySnippetParts(`x ${MEMORY_MATCH_START}open`)).toEqual([
			{ text: "x ", match: false },
			{ text: "open", match: true },
		]);
	});
});
