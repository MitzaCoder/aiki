/**
 * The notification requests and the device-side helpers: the request shapes are the client's own contract, and the
 * payload → URL, device identity, preferences and quiet-hours rules are what the app and the service worker share.
 */
import { afterEach, describe, expect, it } from "bun:test";
import {
	DEFAULT_NOTIFICATION_KINDS,
	NOTIFICATION_FAILURE_KINDS,
	type NotificationDevice,
	type NotificationKind,
	type NotificationPayload,
} from "@kemiri/protocol";
import {
	HarnessClient,
	NOTIFICATION_DEFAULTS_VERSION,
	NOTIFICATION_KINDS,
	NOTIFICATION_SETTINGS_STORAGE_KEY,
	applicationServerKey,
	defaultDeviceSettings,
	deviceLabelFromUserAgent,
	deviceTimezone,
	isProjectMuted,
	loadDeviceSettings,
	migrateDefaultKinds,
	threadAnchor,
	threadFromAnchor,
	mutedProjectEntries,
	notificationRenotify,
	notificationUrl,
	parseDeviceSettings,
	parseNotificationPayload,
	preferencesForBackend,
	quietHoursActive,
	quietHoursSummary,
	samePublicKey,
	saveDeviceSettings,
	scheduleAnchor,
	subscriptionServerKey,
	timeOfDayIn,
	withKind,
	withMutedProject,
	type DeviceNotificationSettings,
	type HarnessWebSocket,
} from "../src/index.ts";

type StubMessage = {
	type: string;
	id?: string;
	[key: string]: unknown;
};

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
		clientName: "notifications-test",
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
		features: ["notifications"],
	};
}

afterEach(() => {
	for (const client of clients.splice(0)) client.close();
});

const KEY = "B".repeat(65);

function device(overrides: Partial<NotificationDevice> = {}): NotificationDevice {
	return {
		deviceId: "device-1",
		label: "Pixel · Chrome",
		backendKey: "harness-pc",
		preferences: {
			kinds: [...DEFAULT_NOTIFICATION_KINDS],
			mutedProjects: [],
			quietHours: null,
		},
		createdAt: "2026-11-06T07:00:00.000Z",
		lastDelivery: null,
		...overrides,
	};
}

function subscription() {
	return {
		endpoint: "https://push.example/abc",
		expirationTime: null,
		keys: { p256dh: "p256dh", auth: "auth" },
	};
}

const REGISTRATION = {
	deviceId: "device-1",
	label: "Pixel · Chrome",
	backendKey: "harness-pc",
	subscription: subscription(),
	preferences: {
		kinds: [...DEFAULT_NOTIFICATION_KINDS],
		mutedProjects: ["project-1"],
		quietHours: { start: "22:00", end: "07:00", timezone: "Europe/Bucharest", allowFailures: true },
	},
};

/** Every request, one stub answer each. */
function notificationAnswer(message: StubMessage): unknown {
	const hello = handshakeAnswer(message);
	if (hello !== undefined) return hello;
	switch (message.type) {
		case "notifications.config":
			return { type: "notifications.config", id: message.id, publicKey: KEY };
		case "notifications.register":
			return { type: "notifications.register", id: message.id, device: device() };
		case "notifications.unregister":
			return { type: "notifications.unregister", id: message.id };
		case "notifications.device":
			return { type: "notifications.device", id: message.id, device: device() };
		case "notifications.test":
			return { type: "notifications.test", id: message.id, ok: false, status: 410, message: "Gone" };
		case "notifications.presence":
			return { type: "notifications.presence", id: message.id };
		case "notifications.interaction":
			return { type: "notifications.interaction", id: message.id, dropped: 2 };
		default:
			return undefined;
	}
}

describe("notification requests", () => {
	it("reads the VAPID key", async () => {
		const { client, socket } = clientFor(notificationAnswer);
		client.connect();
		await client.whenReady();

		expect(await client.readNotificationsConfig()).toBe(KEY);
		expect(socket.sent.find((message) => message.type === "notifications.config")).toMatchObject({
			type: "notifications.config",
		});
	});

	it("registers the device, its subscription and its preferences", async () => {
		const { client, socket } = clientFor(notificationAnswer);
		client.connect();
		await client.whenReady();

		expect(await client.registerNotifications(REGISTRATION)).toMatchObject({ deviceId: "device-1" });
		expect(socket.sent.find((message) => message.type === "notifications.register")).toMatchObject({
			type: "notifications.register",
			...REGISTRATION,
		});
	});

	it("unregisters, reads the device and sends a test notification", async () => {
		const { client, socket } = clientFor(notificationAnswer);
		client.connect();
		await client.whenReady();

		await client.unregisterNotifications("device-1");
		expect(await client.readNotificationDevice("device-1")).toMatchObject({ label: "Pixel · Chrome" });
		expect(await client.sendTestNotification("device-1")).toEqual({ ok: false, status: 410, message: "Gone" });

		expect(socket.sent.filter((message) => message.type === "notifications.unregister")).toHaveLength(1);
		expect(socket.sent.find((message) => message.type === "notifications.device")).toMatchObject({
			deviceId: "device-1",
		});
		expect(socket.sent.find((message) => message.type === "notifications.test")).toMatchObject({
			deviceId: "device-1",
		});
	});

	it("sends presence with the project, or none", async () => {
		const { client, socket } = clientFor(notificationAnswer);
		client.connect();
		await client.whenReady();

		await client.setNotificationsPresence({ deviceId: "device-1", visible: true, projectId: "project-1" });
		await client.setNotificationsPresence({ deviceId: "device-1", visible: false, projectId: null });

		const presence = socket.sent.filter((message) => message.type === "notifications.presence");
		expect(presence).toHaveLength(2);
		expect(presence[0]).toMatchObject({ deviceId: "device-1", visible: true, projectId: "project-1" });
		expect(presence[1]).toMatchObject({ visible: false, projectId: null });
	});

	it("reports interaction and says how many held notifications it dropped", async () => {
		const { client, socket } = clientFor(notificationAnswer);
		client.connect();
		await client.whenReady();

		expect(await client.reportNotificationInteraction("device-1")).toBe(2);
		expect(socket.sent.find((message) => message.type === "notifications.interaction")).toMatchObject({
			deviceId: "device-1",
		});
	});
});

const OLD_DEFAULTS = ["reply", "worker_report", "worker_failed", "schedule_problem", "deploy_problem", "login_prompt"] as const;

describe("notification payload to URL", () => {
	const payload = (overrides: Partial<NotificationPayload> = {}): NotificationPayload => ({
		kind: "reply",
		title: "Coordinator answered",
		body: "Nightly check: done.",
		backendKey: "harness-pc",
		projectId: "project-1",
		workerId: null,
		scheduleId: null,
		tag: "reply-project-1",
		at: "2026-11-06T07:00:00.000Z",
		...overrides,
	});

	it("opens the project, then the worker, then the schedule", () => {
		expect(notificationUrl(payload())).toBe("/b/harness-pc/projects/project-1");
		expect(notificationUrl(payload({ workerId: "nightly-1" }))).toBe(
			"/b/harness-pc/projects/project-1/workers/nightly-1",
		);
		expect(notificationUrl(payload({ scheduleId: "nightly" }))).toBe(
			`/b/harness-pc/projects/project-1/settings#${scheduleAnchor("nightly")}`,
		);
	});

	it("opens main at a background thread's card, and a thread's worker in its thread", () => {
		expect(notificationUrl(payload({ kind: "thread_finished", threadId: "jira-run" }))).toBe(
			`/b/harness-pc/projects/project-1#${threadAnchor("jira-run")}`,
		);
		expect(notificationUrl(payload({ kind: "thread_failed", threadId: "jira-run", scheduleId: "nightly" }))).toBe(
			"/b/harness-pc/projects/project-1#thread-jira-run",
		);
		expect(notificationUrl(payload({ threadId: "main" }))).toBe("/b/harness-pc/projects/project-1");
		expect(notificationUrl(payload({ threadId: "jira-run", workerId: "w1" }))).toBe(
			"/b/harness-pc/projects/project-1/threads/jira-run/workers/w1",
		);
		expect(threadFromAnchor("#thread-jira-run")).toBe("jira-run");
		expect(threadFromAnchor("#thread-a%20b")).toBe("a b");
		expect(threadFromAnchor("#schedule-x")).toBeUndefined();
		expect(threadFromAnchor("")).toBeUndefined();
	});

	it("opens a task's sheet over main's chat, whatever else the payload names", () => {
		expect(notificationUrl(payload({ kind: "task_review", taskId: "T12" }))).toBe(
			"/b/harness-pc/projects/project-1?task=T12",
		);
		expect(notificationUrl(payload({ kind: "task_review", taskId: "T12", threadId: "jira-run" }))).toBe(
			"/b/harness-pc/projects/project-1?task=T12",
		);
		expect(notificationUrl(payload({ taskId: "T 1/2" }))).toBe("/b/harness-pc/projects/project-1?task=T%201%2F2");
		expect(notificationUrl(payload({ taskId: null }))).toBe("/b/harness-pc/projects/project-1");
	});

	it("opens the app's home for a backend-wide problem", () => {
		expect(notificationUrl(payload({ kind: "deploy_problem", projectId: null }))).toBe("/");
	});

	it("encodes each part of the route", () => {
		expect(notificationUrl(payload({ backendKey: "a b", projectId: "p/1", workerId: "w 2" }))).toBe(
			"/b/a%20b/projects/p%2F1/workers/w%202",
		);
	});

	it("renotifies failures only", () => {
		for (const kind of NOTIFICATION_FAILURE_KINDS) expect(notificationRenotify(kind)).toBe(true);
		expect(notificationRenotify("reply")).toBe(false);
		expect(notificationRenotify("worker_report")).toBe(false);
		expect(notificationRenotify("test")).toBe(false);
	});

	it("knows every kind the protocol declares", () => {
		const declared: NotificationKind[] = [
			"reply",
			"worker_report",
			"worker_failed",
			"schedule_done",
			"schedule_problem",
			"deploy_problem",
			"login_prompt",
			"compaction_failed",
			"maintenance_failed",
			"board_question",
			"thread_finished",
			"thread_failed",
			"work_finished",
			"disk_low",
			"task_review",
		];
		expect([...NOTIFICATION_KINDS].sort()).toEqual(declared.sort());
		for (const kind of DEFAULT_NOTIFICATION_KINDS) expect(NOTIFICATION_KINDS).toContain(kind);
	});
});

describe("a pushed payload", () => {
	const payload: NotificationPayload = {
		kind: "worker_failed",
		title: "Worker failed",
		body: "Nightly check stopped.",
		backendKey: "harness-pc",
		projectId: "project-1",
		workerId: "nightly-1",
		scheduleId: null,
		tag: "worker_failed-nightly-1",
		at: "2026-11-06T07:00:00.000Z",
	};

	it("reads a payload the protocol allows", () => {
		expect(parseNotificationPayload(JSON.stringify(payload))).toEqual(payload);
	});

	it("keeps the task a payload names", () => {
		const withTask = { ...payload, kind: "task_review" as const, taskId: "T12" };
		expect(parseNotificationPayload(JSON.stringify(withTask))).toEqual(withTask);
		expect(parseNotificationPayload(JSON.stringify({ ...withTask, taskId: 7 }))).toBeNull();
	});

	it("fills a missing time and accepts a test kind", () => {
		const { at, ...rest } = payload;
		void at;
		const parsed = parseNotificationPayload(JSON.stringify({ ...rest, kind: "test" }));
		expect(parsed?.kind).toBe("test");
		expect(typeof parsed?.at).toBe("string");
	});

	it("refuses anything it cannot draw or route", () => {
		for (const raw of [
			undefined,
			null,
			"",
			"not json",
			"[]",
			JSON.stringify({ ...payload, kind: "made_up" }),
			JSON.stringify({ ...payload, title: "" }),
			JSON.stringify({ ...payload, backendKey: "" }),
			JSON.stringify({ ...payload, tag: undefined }),
			JSON.stringify({ ...payload, projectId: 7 }),
			JSON.stringify({ ...payload, workerId: undefined }),
		]) {
			expect(parseNotificationPayload(raw)).toBeNull();
		}
	});
});

describe("the push key", () => {
	function keyBytes(): Uint8Array<ArrayBuffer> {
		const bytes = new Uint8Array(65);
		bytes[0] = 4;
		for (let index = 1; index < bytes.length; index += 1) bytes[index] = (index * 7) % 256;
		return bytes;
	}

	function base64url(bytes: Uint8Array): string {
		let binary = "";
		for (const byte of bytes) binary += String.fromCharCode(byte);
		return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
	}

	it("decodes a base64url P-256 point to the same bytes", () => {
		const bytes = keyBytes();
		expect(applicationServerKey(base64url(bytes))).toEqual(bytes);
	});

	it("refuses a key that is not a P-256 point", () => {
		expect(() => applicationServerKey("not base64!")).toThrow();
		expect(() => applicationServerKey(base64url(new Uint8Array(16)))).toThrow();
	});

	it("compares keys without padding differences", () => {
		expect(samePublicKey("abc", "abc=")).toBe(true);
		expect(samePublicKey("abc", "abd")).toBe(false);
	});

	it("reads the key a subscription was made with", () => {
		const bytes = keyBytes();
		const subscription = { options: { applicationServerKey: bytes.buffer } } as unknown as PushSubscription;
		expect(subscriptionServerKey(subscription)).toBe(base64url(bytes));
	});
});

describe("the device name", () => {
	it("names an Android phone and its browser", () => {
		const pixel =
			"Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
		expect(deviceLabelFromUserAgent(pixel)).toBe("Pixel 8 · Chrome");
		const samsung =
			"Mozilla/5.0 (Linux; Android 13; SM-S911B Build/TP1A.220624.014) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36";
		expect(deviceLabelFromUserAgent(samsung)).toBe("SM-S911B · Samsung Internet");
	});

	it("falls back when the model is hidden or unknown", () => {
		const reduced =
			"Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
		expect(deviceLabelFromUserAgent(reduced)).toBe("Android · Chrome");
		expect(deviceLabelFromUserAgent("")).toBe("Device · Browser");
		expect(
			deviceLabelFromUserAgent(
				"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
			),
		).toBe("Mac · Safari");
	});
});

describe("device settings", () => {
	function fakeStorage(initial: Record<string, string> = {}) {
		const data = new Map(Object.entries(initial));
		return {
			data,
			getItem: (key: string) => data.get(key) ?? null,
			setItem: (key: string, value: string) => void data.set(key, value),
		};
	}

	it("starts with the protocol's default kinds and no quiet hours", () => {
		const settings = defaultDeviceSettings("device-1", "Europe/Bucharest");
		expect(settings.kinds).toEqual([...DEFAULT_NOTIFICATION_KINDS]);
		expect(settings.quietHours).toBeNull();
		expect(settings.mutedProjects).toEqual({});
	});

	it("makes up a device ID once and keeps it", () => {
		const storage = fakeStorage();
		const first = loadDeviceSettings(storage, "Europe/Bucharest");
		expect(first.deviceId.length).toBeGreaterThan(0);
		const again = loadDeviceSettings(storage, "Europe/Bucharest");
		expect(again.deviceId).toBe(first.deviceId);
	});

	it("round trips settings, keeping mutes per backend", () => {
		const storage = fakeStorage();
		let settings: DeviceNotificationSettings = defaultDeviceSettings("device-1", "Europe/Bucharest");
		settings = { ...settings, kinds: withKind(settings.kinds, "schedule_done", true) };
		settings = withMutedProject(settings, "harness-pc", "project-1", true);
		settings = withMutedProject(settings, "harness-vm", "project-9", true);
		settings = {
			...settings,
			quietHours: { start: "22:00", end: "07:00", timezone: "Europe/Bucharest", allowFailures: true },
		};
		saveDeviceSettings(settings, storage);

		expect(loadDeviceSettings(storage, "Europe/Bucharest")).toEqual(settings);
		expect(isProjectMuted(settings, "harness-pc", "project-1")).toBe(true);
		expect(isProjectMuted(settings, "harness-pc", "project-9")).toBe(false);
		expect(mutedProjectEntries(settings)).toEqual([
			{ backendKey: "harness-pc", projectId: "project-1" },
			{ backendKey: "harness-vm", projectId: "project-9" },
		]);
	});

	it("keeps kinds in the protocol's order and drops what it does not know", () => {
		expect(withKind(["reply", "worker_report"], "reply", false)).toEqual(["worker_report"]);
		expect(withKind(["worker_report"], "reply", true)).toEqual(["reply", "worker_report"]);

		const parsed = parseDeviceSettings(
			JSON.stringify({ kinds: ["reply", "made_up", "reply"], mutedProjects: { "harness-pc": ["p"], "": ["q"] } }),
			"device-1",
			"Europe/Bucharest",
		);
		expect(parsed.kinds).toEqual(["reply"]);
		expect(parsed.mutedProjects).toEqual({ "harness-pc": ["p"] });
	});

	it("brings a device on the board-question defaults up to today's defaults, once", () => {
		const v1: NotificationKind[] = [...OLD_DEFAULTS, "board_question"];
		const storage = fakeStorage({
			[NOTIFICATION_SETTINGS_STORAGE_KEY]: JSON.stringify({ deviceId: "device-1", kinds: v1, defaultsVersion: 1 }),
		});
		const migrated = loadDeviceSettings(storage, "Europe/Bucharest");
		expect([...migrated.kinds].sort()).toEqual([...DEFAULT_NOTIFICATION_KINDS].sort());
		saveDeviceSettings({ ...migrated, kinds: withKind(migrated.kinds, "thread_finished", false) }, storage);
		expect(loadDeviceSettings(storage, "Europe/Bucharest").kinds).not.toContain("thread_finished");
	});

	it("adds the board question to a device that kept the old defaults, once", () => {
		const oldDefaults = ["reply", "worker_report", "worker_failed", "schedule_problem", "deploy_problem", "login_prompt"] as const;
		const storage = fakeStorage({
			[NOTIFICATION_SETTINGS_STORAGE_KEY]: JSON.stringify({ deviceId: "device-1", kinds: oldDefaults }),
		});
		const migrated = loadDeviceSettings(storage, "Europe/Bucharest");
		expect([...migrated.kinds].sort()).toEqual([...DEFAULT_NOTIFICATION_KINDS].sort());
		expect(migrated.defaultsVersion).toBe(NOTIFICATION_DEFAULTS_VERSION);
		expect(JSON.parse(storage.data.get(NOTIFICATION_SETTINGS_STORAGE_KEY) ?? "{}").kinds).toContain("board_question");

		// The user turns it off afterwards: it must not come back.
		saveDeviceSettings({ ...migrated, kinds: withKind(migrated.kinds, "board_question", false) }, storage);
		expect(loadDeviceSettings(storage, "Europe/Bucharest").kinds).not.toContain("board_question");
	});

	it("leaves a device that chose its own kinds alone, but still marks it current", () => {
		const storage = fakeStorage({
			[NOTIFICATION_SETTINGS_STORAGE_KEY]: JSON.stringify({ deviceId: "device-1", kinds: ["reply", "schedule_done"] }),
		});
		const loaded = loadDeviceSettings(storage, "Europe/Bucharest");
		expect(loaded.kinds).toEqual(["reply", "schedule_done"]);
		expect(loaded.defaultsVersion).toBe(NOTIFICATION_DEFAULTS_VERSION);
	});

	it("migrates only from the version it was stored at", () => {
		const oldDefaults = ["reply", "worker_report", "worker_failed", "schedule_problem", "deploy_problem", "login_prompt"] as const;
		expect(migrateDefaultKinds(oldDefaults, 0).sort()).toEqual([...DEFAULT_NOTIFICATION_KINDS].sort());
		expect(migrateDefaultKinds([...oldDefaults, "board_question"], 1).sort()).toEqual([...DEFAULT_NOTIFICATION_KINDS].sort());
		expect(migrateDefaultKinds(oldDefaults, NOTIFICATION_DEFAULTS_VERSION)).toEqual([...oldDefaults]);
		expect(migrateDefaultKinds([...oldDefaults].reverse(), 0).sort()).toEqual([...DEFAULT_NOTIFICATION_KINDS].sort());
		expect(migrateDefaultKinds([], 0)).toEqual([]);
	});

	it("turns task reviews on for a device that kept the previous defaults", () => {
		const previous = [
			"reply",
			"worker_failed",
			"schedule_problem",
			"deploy_problem",
			"login_prompt",
			"board_question",
			"thread_finished",
			"thread_failed",
			"work_finished",
			"disk_low",
		] as const;
		expect(migrateDefaultKinds(previous, 3)).toContain("task_review");
		expect(NOTIFICATION_DEFAULTS_VERSION).toBe(4);
		const chosen = previous.filter((kind) => kind !== "reply");
		expect(migrateDefaultKinds(chosen, 3)).toEqual([...chosen]);
	});

	it("turns per-worker reports off and work-finished and disk-low on for a device that kept the defaults", () => {
		const keptDefaults = [
			"reply",
			"worker_report",
			"worker_failed",
			"schedule_problem",
			"deploy_problem",
			"login_prompt",
			"board_question",
			"thread_finished",
			"thread_failed",
		] as const;
		const migrated = migrateDefaultKinds(keptDefaults, 2);
		expect(migrated).not.toContain("worker_report");
		expect(migrated).toContain("work_finished");
		expect(migrated).toContain("disk_low");
		expect(migrated.sort()).toEqual([...DEFAULT_NOTIFICATION_KINDS].sort());
		const chosen = keptDefaults.filter((kind) => kind !== "reply");
		expect(migrateDefaultKinds(chosen, 2)).toEqual([...chosen]);
	});

	it("survives a damaged store", () => {
		for (const raw of ["{", "[]", "null", JSON.stringify({ quietHours: { start: "99:99" } })]) {
			const parsed = parseDeviceSettings(raw, "device-1", "Europe/Bucharest");
			expect(parsed.deviceId).toBe("device-1");
			expect(parsed.kinds).toEqual([...DEFAULT_NOTIFICATION_KINDS]);
			expect(parsed.quietHours).toBeNull();
		}
	});

	it("sends each backend its own muted projects and the shared preferences", () => {
		let settings = defaultDeviceSettings("device-1", "Europe/Bucharest");
		settings = withMutedProject(settings, "harness-pc", "project-1", true);
		settings = { ...settings, kinds: withKind(settings.kinds, "worker_failed", false) };
		settings = {
			...settings,
			quietHours: { start: "23:00", end: "06:30", timezone: "Europe/Bucharest", allowFailures: false },
		};

		const pc = preferencesForBackend(settings, "harness-pc");
		expect(pc.mutedProjects).toEqual(["project-1"]);
		expect(pc.kinds).not.toContain("worker_failed");
		expect(pc.quietHours).toEqual({
			start: "23:00",
			end: "06:30",
			timezone: "Europe/Bucharest",
			allowFailures: false,
		});
		expect(preferencesForBackend(settings, "harness-vm").mutedProjects).toEqual([]);
	});
});

describe("quiet hours", () => {
	const quiet = (start: string, end: string, allowFailures = false) => ({
		start,
		end,
		timezone: "Europe/Bucharest",
		allowFailures,
	});

	it("reads the time in the device's zone", () => {
		// 2026-11-06T05:30:00Z is 07:30 in Bucharest (EET, +02:00).
		expect(timeOfDayIn("Europe/Bucharest", new Date("2026-11-06T05:30:00.000Z"))).toBe("07:30");
		expect(timeOfDayIn("UTC", new Date("2026-11-06T05:30:00.000Z"))).toBe("05:30");
		expect(timeOfDayIn("Not/AZone", new Date("2026-11-06T05:30:00.000Z"))).toMatch(/^\d\d:\d\d$/);
	});

	it("covers a window that does not cross midnight", () => {
		const hours = quiet("09:00", "17:00");
		expect(quietHoursActive(hours, new Date("2026-11-06T07:30:00.000Z"))).toBe(true); // 09:30 Bucharest
		expect(quietHoursActive(hours, new Date("2026-11-06T06:30:00.000Z"))).toBe(false); // 08:30
		expect(quietHoursActive(hours, new Date("2026-11-06T15:00:00.000Z"))).toBe(false); // 17:00
	});

	it("covers a window that crosses midnight", () => {
		const hours = quiet("22:00", "07:00");
		expect(quietHoursActive(hours, new Date("2026-11-06T20:30:00.000Z"))).toBe(true); // 22:30
		expect(quietHoursActive(hours, new Date("2026-11-06T03:00:00.000Z"))).toBe(true); // 05:00
		expect(quietHoursActive(hours, new Date("2026-11-06T06:30:00.000Z"))).toBe(false); // 08:30
		expect(quietHoursActive(hours, new Date("2026-11-06T10:00:00.000Z"))).toBe(false); // 12:00
	});

	it("lets failures through when asked", () => {
		const hours = quiet("00:00", "23:59", true);
		const at = new Date("2026-11-06T10:00:00.000Z");
		expect(quietHoursActive(hours, at, "reply")).toBe(true);
		expect(quietHoursActive(hours, at, "worker_failed")).toBe(false);
		expect(quietHoursActive({ ...hours, allowFailures: false }, at, "worker_failed")).toBe(true);
	});

	it("treats equal ends as no quiet hours, and null as none", () => {
		const at = new Date("2026-11-06T10:00:00.000Z");
		expect(quietHoursActive(quiet("08:00", "08:00"), at)).toBe(false);
		expect(quietHoursActive(null, at)).toBe(false);
	});

	it("summarises the window", () => {
		expect(quietHoursSummary(quiet("22:00", "07:00"))).toBe("22:00–07:00 (Europe/Bucharest)");
	});

	it("knows the browser's zone", () => {
		expect(deviceTimezone().length).toBeGreaterThan(0);
	});
});
