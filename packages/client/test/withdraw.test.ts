/** Withdrawing a waiting message (`conversation.withdraw`) and the submit answer's `status`, against a stub socket. */
import { afterEach, describe, expect, it } from "bun:test";
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
		if (response !== undefined) this.onmessage?.({ data: JSON.stringify(response) });
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
		clientName: "withdraw-test",
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

function answers(message: StubMessage): unknown {
	switch (message.type) {
		case "hello":
			return {
				type: "hello",
				id: message.id,
				protocolVersion: 1,
				server: { name: "stub", version: "0" },
				features: ["conversation", "queued-inputs"],
			};
		case "conversation.submit":
			return { type: "conversation.submit", id: message.id, submissionId: 7, status: "queued" };
		case "conversation.withdraw":
			return { type: "conversation.withdraw", id: message.id, outcome: "withdrawn" };
		default:
			return undefined;
	}
}

afterEach(() => {
	for (const client of clients.splice(0)) client.close();
});

describe("conversation.withdraw", () => {
	it("names the project, the thread and the submission, and returns the outcome", async () => {
		const { client, socket } = clientFor(answers);
		client.connect();
		await client.whenReady();
		expect(await client.withdraw("project-1", 7, { threadId: "thread-2" })).toBe("withdrawn");
		expect(socket.sent.find((message) => message.type === "conversation.withdraw")).toMatchObject({
			projectId: "project-1",
			threadId: "thread-2",
			submissionId: 7,
		});
	});

	it("returns whether the run took the message at once or it waits", async () => {
		const { client } = clientFor(answers);
		client.connect();
		await client.whenReady();
		const sent = await client.submit("project-1", "hi", { whenBusy: "steer", requestId: "r1" });
		expect(sent).toEqual({ submissionId: 7, requestId: "r1", status: "queued" });
	});
});
