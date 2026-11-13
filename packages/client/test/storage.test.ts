/**
 * Project storage and disk helpers: the `projects.storage` requests against a stub socket, and the pure judgments the
 * app makes from what they and `server.status` return.
 */
import { afterEach, describe, expect, it } from "bun:test";
import type { DiskStatus, ServerStatus, StorageItem } from "@kemiri/protocol";
import {
	HarnessClient,
	diskLevel,
	lowDisks,
	removableStorage,
	serverDisks,
	withoutRemoved,
	type HarnessWebSocket,
} from "../src/index.ts";

type StubMessage = { type: string; id?: string; [key: string]: unknown };

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
				features: ["projects", "storage"],
			};
		}
		return answer(message);
	});
	const client = new HarnessClient({
		url: "ws://stub.invalid/ws",
		clientName: "storage-test",
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

function item(overrides: Partial<StorageItem> = {}): StorageItem {
	return {
		id: "worker:main/w1",
		kind: "worker",
		label: "Android build",
		path: "/data/workspaces/w1",
		bytes: 4_000,
		removable: true,
		updatedAt: "2026-11-05T10:00:00.000Z",
		...overrides,
	};
}

function disk(overrides: Partial<DiskStatus> = {}): DiskStatus {
	return { label: "Data", path: "/data", freeBytes: 50, totalBytes: 100, low: false, ...overrides };
}

function status(disks: DiskStatus[] | undefined): ServerStatus {
	return {
		release: null,
		deploy: null,
		busy: { conversations: 0, workers: 0 },
		startedAt: "2026-11-05T09:00:00.000Z",
		...(disks === undefined ? {} : { disks }),
	};
}

describe("projects.storage", () => {
	it("reads a project's storage and cleans finished items", async () => {
		const items = [item(), item({ id: "thread:t1", kind: "thread", bytes: 1_000, removable: false })];
		const { client, socket } = clientFor((message) => {
			if (message.type === "projects.storage") {
				return { type: "projects.storage", id: message.id, totalBytes: 5_000, items, measuredAt: "2026-11-05T10:01:00.000Z" };
			}
			if (message.type === "projects.storage.clean") {
				return { type: "projects.storage.clean", id: message.id, removed: ["worker:main/w1"], freedBytes: 4_000, refused: [] };
			}
			return undefined;
		});
		client.connect();
		await client.whenReady();

		expect(await client.readProjectStorage("project-1")).toEqual({
			totalBytes: 5_000,
			items,
			measuredAt: "2026-11-05T10:01:00.000Z",
		});
		expect(await client.cleanProjectStorage("project-1")).toEqual({
			removed: ["worker:main/w1"],
			freedBytes: 4_000,
			refused: [],
		});
		await client.cleanProjectStorage("project-1", ["thread:t1"]);
		const cleans = socket.sent.filter((message) => message.type === "projects.storage.clean");
		expect(cleans[0]).not.toHaveProperty("itemIds");
		expect(cleans[1]).toMatchObject({ projectId: "project-1", itemIds: ["thread:t1"] });
	});
});

describe("storage helpers", () => {
	it("counts what a cleanup would free", () => {
		const items = [item(), item({ id: "thread:t1", bytes: 1_000, removable: false }), item({ id: "w2", bytes: 500 })];
		const removable = removableStorage(items);
		expect(removable.items.map((entry) => entry.id)).toEqual(["worker:main/w1", "w2"]);
		expect(removable.bytes).toBe(4_500);
	});

	it("drops removed items and lowers the total", () => {
		const storage = { totalBytes: 5_000, items: [item(), item({ id: "t", bytes: 1_000 })], measuredAt: "x" };
		expect(withoutRemoved(storage, ["worker:main/w1"])).toEqual({ totalBytes: 1_000, items: [item({ id: "t", bytes: 1_000 })], measuredAt: "x" });
	});

	it("reads disks, empty on an older server", () => {
		expect(serverDisks(undefined)).toEqual([]);
		expect(serverDisks(status(undefined))).toEqual([]);
		const low = disk({ label: "VM", low: true, freeBytes: 5 });
		expect(lowDisks(status([disk(), low]))).toEqual([low]);
	});

	it("grades a disk: low when the server says so, tight under 30% free", () => {
		expect(diskLevel(disk())).toBe("ok");
		expect(diskLevel(disk({ freeBytes: 20 }))).toBe("tight");
		expect(diskLevel(disk({ freeBytes: 20, low: true }))).toBe("low");
		expect(diskLevel(disk({ freeBytes: 0, totalBytes: 0 }))).toBe("ok");
	});
});
