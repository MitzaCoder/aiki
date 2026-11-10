/** The draft requests and the pushed change, against a stub socket: their shapes are the client's own contract. */
import { afterEach, describe, expect, it } from "bun:test";
import type { ChatDraft, DraftsChangedEvent } from "@aiki/protocol";
import { HarnessClient, type HarnessWebSocket } from "../src/index.ts";

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
	const socket = new StubSocket((message) =>
		message.type === "hello"
			? { type: "hello", id: message.id, protocolVersion: 1, server: { name: "stub", version: "0" }, features: ["projects", "chat-drafts"] }
			: answer(message),
	);
	const client = new HarnessClient({
		url: "ws://stub.invalid/ws",
		clientName: "drafts-test",
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

const entry = (revision: number, text: string): ChatDraft => ({
	projectId: "p1",
	threadId: "main",
	revision,
	updatedAt: "2026-11-08T10:00:00.000Z",
	content: { text, quotes: [] },
});

describe("drafts", () => {
	it("reads one chat or all, and writes with the base revision and the device", async () => {
		const { client, socket } = clientFor((message) => {
			if (message.type === "drafts.get") return { type: "drafts.get", id: message.id, drafts: [entry(2, "hi")] };
			if (message.type === "drafts.set") return { type: "drafts.set", id: message.id, applied: false, draft: entry(3, "theirs") };
			return undefined;
		});
		client.connect();
		await client.whenReady();

		expect(await client.readDrafts("p1", "main")).toEqual([entry(2, "hi")]);
		await client.readDrafts("p1");
		const gets = socket.sent.filter((message) => message.type === "drafts.get");
		expect(gets[0]).toMatchObject({ projectId: "p1", threadId: "main" });
		expect("threadId" in (gets[1] ?? {})).toBe(false);

		const written = await client.writeDraft("p1", "main", { text: "mine", quotes: [] }, 2, { deviceId: "d1", name: "Pixel 8" });
		expect(written).toEqual({ applied: false, draft: entry(3, "theirs") });
		expect(socket.sent.find((message) => message.type === "drafts.set")).toMatchObject({
			projectId: "p1",
			threadId: "main",
			baseRevision: 2,
			content: { text: "mine", quotes: [] },
			device: { deviceId: "d1", name: "Pixel 8" },
		});
		await client.writeDraft("p1", "main", null, 3);
		expect(socket.sent.filter((message) => message.type === "drafts.set")[1]).toMatchObject({ content: null, baseRevision: 3 });
	});

	it("uploads and reads an attachment, and hands pushed changes to listeners", async () => {
		const attachment = { id: "a".repeat(64), mimeType: "image/png" as const, size: 3 };
		const { client, socket } = clientFor((message) => {
			if (message.type === "drafts.attachment.put") return { type: "drafts.attachment.put", id: message.id, attachment };
			if (message.type === "drafts.attachment.get") return { type: "drafts.attachment.get", id: message.id, attachment, data: "AAEC" };
			return undefined;
		});
		const seen: DraftsChangedEvent[] = [];
		const stop = client.onDraftsChanged((event) => seen.push(event));
		client.connect();
		await client.whenReady();
		expect(await client.uploadDraftAttachment("p1", "image/png", "AAEC", "a.png")).toEqual(attachment);
		expect(socket.sent.find((message) => message.type === "drafts.attachment.put")).toMatchObject({ mimeType: "image/png", data: "AAEC", name: "a.png" });
		expect(await client.readDraftAttachment("p1", attachment.id)).toEqual({ attachment, data: "AAEC" });

		const pushed = { type: "drafts.changed", projectId: "p1", threadId: "main", draft: entry(4, "from B") };
		socket.push(pushed);
		expect(seen).toEqual([pushed as DraftsChangedEvent]);
		stop();
		socket.push(pushed);
		expect(seen).toHaveLength(1);
	});
});
