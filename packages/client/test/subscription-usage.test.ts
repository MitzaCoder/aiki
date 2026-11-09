/**
 * The subscription usage API, against a stub socket (the request's shape and the pushed event), and the pace arithmetic
 * every screen shares: elapsed share, pace ratio, projected exhaustion and the tightest window.
 */
import { afterEach, describe, expect, it } from "bun:test";
import type { SubscriptionUsage, UsageWindow } from "@mihai-harness/protocol";
import {
	ClientError,
	HarnessClient,
	projectedUsedPercent,
	tightestWindow,
	windowElapsedShare,
	windowPace,
	windowStart,
	type HarnessWebSocket,
} from "../src/index.ts";

type StubMessage = {
	type: string;
	id?: string;
	[key: string]: unknown;
};

/** A socket that answers `hello` and whatever the test answers, and records what the client sent. */
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
		clientName: "subscription-usage-test",
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
		features: ["projects", "subscription-usage"],
	};
}

afterEach(() => {
	for (const client of clients.splice(0)) client.close();
});

const HOUR = 3_600_000;
/** The reference clock: a 5-hour window that resets at 15:00 began at 10:00. */
const NOW = Date.parse("2026-11-04T12:00:00Z");

function usageWindow(overrides: Partial<UsageWindow> = {}): UsageWindow {
	return {
		id: "five_hour",
		label: "5-hour limit",
		usedPercent: 40,
		resetsAt: "2026-11-04T15:00:00Z",
		windowMinutes: 300,
		samples: [],
		...overrides,
	};
}

function subscription(overrides: Partial<SubscriptionUsage> = {}): SubscriptionUsage {
	return {
		providerId: "anthropic",
		label: "Claude",
		plan: "Max 20x",
		account: "me@example.com",
		windows: [usageWindow()],
		source: "usage_api",
		updatedAt: "2026-11-04T11:59:00Z",
		error: null,
		...overrides,
	};
}

describe("subscriptions usage", () => {
	it("reads every subscription, and sends refresh only when asked", async () => {
		const answer = [subscription()];
		const { client, socket } = clientFor((message) => {
			const hello = handshakeAnswer(message);
			if (hello !== undefined) return hello;
			if (message.type !== "subscriptions.usage") return undefined;
			return { type: "subscriptions.usage", id: message.id, subscriptions: answer };
		});
		client.connect();
		await client.whenReady();

		expect(await client.readSubscriptionsUsage()).toEqual(answer);
		expect(await client.readSubscriptionsUsage({ refresh: true })).toEqual(answer);
		const requests = socket.sent.filter((message) => message.type === "subscriptions.usage");
		expect(Object.keys(requests[0] ?? {}).sort()).toEqual(["id", "type"]);
		expect(requests[1]).toMatchObject({ type: "subscriptions.usage", refresh: true });
	});

	it("rejects with the server's error code when the request fails", async () => {
		const { client } = clientFor((message) => {
			const hello = handshakeAnswer(message);
			if (hello !== undefined) return hello;
			return { type: "error", id: message.id, error: { code: "unknown_request", message: "Unknown request." } };
		});
		client.connect();
		await client.whenReady();

		const failed = await client.readSubscriptionsUsage().catch((error: unknown) => error);
		expect(failed).toBeInstanceOf(ClientError);
		expect((failed as ClientError).code).toBe("unknown_request");
	});

	it("delivers every pushed change until the listener unsubscribes, past a listener that throws", async () => {
		const { client, socket } = clientFor(handshakeAnswer);
		client.connect();
		await client.whenReady();

		const received: SubscriptionUsage[][] = [];
		client.onSubscriptionsUsageChanged(() => {
			throw new Error("a broken consumer");
		});
		const unsubscribe = client.onSubscriptionsUsageChanged((subscriptions) => received.push(subscriptions));
		const first = [subscription()];
		const second = [subscription({ windows: [usageWindow({ usedPercent: 55 })] })];
		socket.push({ type: "subscriptions.usage.changed", subscriptions: first });
		socket.push({ type: "subscriptions.usage.changed", subscriptions: second });
		expect(received).toEqual([first, second]);

		unsubscribe();
		socket.push({ type: "subscriptions.usage.changed", subscriptions: first });
		expect(received.length).toBe(2);
	});
});

describe("windowElapsedShare", () => {
	it("is the share of the window between its start and now", () => {
		expect(windowStart(usageWindow())).toBe(Date.parse("2026-11-04T10:00:00Z"));
		expect(windowElapsedShare(usageWindow(), NOW)).toBeCloseTo(0.4);
	});

	it("clamps before the start and after the reset", () => {
		expect(windowElapsedShare(usageWindow(), NOW - 3 * HOUR)).toBe(0);
		expect(windowElapsedShare(usageWindow(), NOW + 4 * HOUR)).toBe(1);
	});

	it("is unknown without a reset time, a length, or with a reset time that does not parse", () => {
		expect(windowElapsedShare(usageWindow({ resetsAt: null }), NOW)).toBeNull();
		expect(windowElapsedShare(usageWindow({ windowMinutes: null }), NOW)).toBeNull();
		expect(windowElapsedShare(usageWindow({ resetsAt: "soon" }), NOW)).toBeNull();
	});
});

describe("windowPace", () => {
	it("is on pace when used share and elapsed share match", () => {
		const pace = windowPace(usageWindow({ usedPercent: 40 }), NOW);
		expect(pace.kind).toBe("on_pace");
		expect(pace.ratio).toBeCloseTo(1);
		expect(pace.projectedAtReset).toBeCloseTo(100);
		expect(pace.early).toBe(false);
	});

	it("is ahead and projects when the limit is reached at the average rate so far", () => {
		// 60% in 2 hours is 30%/h: the last 40% take 1h 20m, so the limit is reached at 13:20, 1h 40m before the reset.
		const pace = windowPace(usageWindow({ usedPercent: 60 }), NOW);
		expect(pace.kind).toBe("ahead");
		expect(pace.ratio).toBeCloseTo(1.5);
		expect(pace.projectedAtReset).toBeCloseTo(150);
		expect(pace.exhaustsAt).toBe(Date.parse("2026-11-04T13:20:00Z"));
	});

	it("is behind with room to spare, and never runs out before the reset", () => {
		const pace = windowPace(usageWindow({ usedPercent: 10 }), NOW);
		expect(pace.kind).toBe("behind");
		expect(pace.ratio).toBeCloseTo(0.25);
		expect(pace.exhaustsAt).toBeNull();
		expect(pace.projectedAtReset).toBeCloseTo(25);
	});

	it("keeps the band around the even pace on pace", () => {
		expect(windowPace(usageWindow({ usedPercent: 45 }), NOW).kind).toBe("on_pace");
		expect(windowPace(usageWindow({ usedPercent: 35 }), NOW).kind).toBe("on_pace");
		expect(windowPace(usageWindow({ usedPercent: 47 }), NOW).kind).toBe("ahead");
		expect(windowPace(usageWindow({ usedPercent: 33 }), NOW).kind).toBe("behind");
	});

	it("says the limit is reached at 100% and above", () => {
		expect(windowPace(usageWindow({ usedPercent: 100 }), NOW).kind).toBe("exhausted");
		expect(windowPace(usageWindow({ usedPercent: 104 }), NOW).kind).toBe("exhausted");
	});

	it("is unknown without a used percent or a window start, and keeps what it knows", () => {
		expect(windowPace(usageWindow({ usedPercent: null }), NOW).kind).toBe("unknown");
		const noReset = windowPace(usageWindow({ resetsAt: null }), NOW);
		expect(noReset).toMatchObject({ kind: "unknown", usedPercent: 40, elapsedShare: null, resetsAt: null });
		const noLength = windowPace(usageWindow({ windowMinutes: null }), NOW);
		expect(noLength).toMatchObject({ kind: "unknown", resetsAt: Date.parse("2026-11-04T15:00:00Z") });
	});

	it("marks the first tenth of a window as early, and has no ratio at its very start", () => {
		expect(windowPace(usageWindow({ usedPercent: 5 }), Date.parse("2026-11-04T10:15:00Z")).early).toBe(true);
		expect(windowPace(usageWindow({ usedPercent: 0 }), Date.parse("2026-11-04T10:00:00Z")).ratio).toBeNull();
	});

	it("has no exhaustion time once the reset has passed", () => {
		const pace = windowPace(usageWindow({ usedPercent: 90 }), Date.parse("2026-11-04T16:00:00Z"));
		expect(pace.elapsedShare).toBe(1);
		expect(pace.exhaustsAt).toBeNull();
	});
});

describe("projectedUsedPercent", () => {
	it("follows the average rate from now and stops at 100", () => {
		const pace = windowPace(usageWindow({ usedPercent: 40 }), NOW);
		expect(projectedUsedPercent(pace, NOW, NOW + HOUR)).toBeCloseTo(60);
		expect(projectedUsedPercent(pace, NOW, NOW + 10 * HOUR)).toBe(100);
		expect(projectedUsedPercent(pace, NOW, NOW - HOUR)).toBeCloseTo(40);
		expect(projectedUsedPercent(windowPace(usageWindow({ resetsAt: null }), NOW), NOW, NOW)).toBeNull();
	});
});

describe("tightestWindow", () => {
	it("prefers the window whose pace ends highest over a fuller window that is behind", () => {
		const weekly = usageWindow({
			id: "seven_day",
			label: "Weekly limit",
			usedPercent: 70,
			resetsAt: "2026-11-08T12:00:00Z",
			windowMinutes: 7 * 24 * 60,
		});
		const claude = subscription({ windows: [usageWindow({ usedPercent: 60 }), weekly] });
		const tightest = tightestWindow([claude], NOW);
		// The 5-hour window ends at 150% at its pace; the weekly one at 70% / (3/7) ≈ 163%.
		expect(tightest?.window.id).toBe("seven_day");
	});

	it("puts a reached limit first, and skips windows with no used percent", () => {
		const chatgpt = subscription({
			providerId: "openai-codex",
			label: "ChatGPT",
			windows: [usageWindow({ id: "primary", usedPercent: 100 })],
		});
		const claude = subscription({ windows: [usageWindow({ usedPercent: 90 }), usageWindow({ id: "x", usedPercent: null })] });
		expect(tightestWindow([claude, chatgpt], NOW)?.subscription.label).toBe("ChatGPT");
		expect(tightestWindow([subscription({ windows: [usageWindow({ usedPercent: null })] })], NOW)).toBeUndefined();
		expect(tightestWindow([], NOW)).toBeUndefined();
	});

	it("counts only the used percent early in a window", () => {
		const early = usageWindow({ id: "early", usedPercent: 8, resetsAt: "2026-11-04T16:50:00Z" });
		const steady = usageWindow({ id: "steady", usedPercent: 30 });
		expect(tightestWindow([subscription({ windows: [early, steady] })], NOW)?.window.id).toBe("steady");
	});
});
