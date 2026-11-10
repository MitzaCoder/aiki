/**
 * Web Push notifications: the crypto a real push service checks, the filtering rules, and every event source firing once.
 *
 * The push service is fake but the wire is real: the server encrypts and signs with `web-push`, posts with `fetch` to a
 * local `Bun.serve`, and this file decrypts the RFC 8291 body and verifies the VAPID JWT with WebCrypto — the checks a
 * real push service makes. No network, no service worker.
 */
import { afterEach, describe, expect, it } from "bun:test";
import type { TranscriptContext } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import type { Conversation, JsonObject } from "@earendil-works/pi-durable";
import type { ConversationView, ModelRef, NotificationPreferences } from "@aiki/protocol";
import { DEFAULT_NOTIFICATION_KINDS } from "@aiki/protocol";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	DEFAULT_ACTIVITY,
	ProjectActivityService,
	type CompactionFailureNotice,
	type ReplyNotice,
} from "../src/activity.ts";
import {
	KEPT_NOTIFIED_KEYS,
	NotificationPresence,
	NotificationStateStore,
	NotificationStore,
	Notifier,
	createVapidKeys,
	inQuietHours,
	loadOrCreateVapidKeys,
	notificationBlocked,
	notificationPayload,
	notificationTag,
	replyNotification,
	resolveVapidSubject,
	vapidKeysWork,
} from "../src/notifications.ts";
import { fakeOAuthProvider } from "./fake-oauth-provider.ts";
import { createSetup, errorOf, TestClient, ViewClient, type TestSetup } from "./support.ts";

const cleanups: (() => Promise<void>)[] = [];
const clients: TestClient[] = [];
const services: FakePushService[] = [];

afterEach(async () => {
	for (const client of clients.splice(0)) client.close();
	for (const service of services.splice(0)) service.stop();
	for (const cleanup of cleanups.splice(0)) await cleanup();
});

const FAUX: ModelRef = { provider: "faux", modelId: "faux-1" };
const APP_ORIGIN = "https://harness.test";

const ALL_KINDS: NotificationPreferences["kinds"] = [
	...DEFAULT_NOTIFICATION_KINDS,
	"worker_report",
	"task_review",
	"schedule_done",
	"compaction_failed",
	"maintenance_failed",
];

function preferences(change: Partial<NotificationPreferences> = {}): NotificationPreferences {
	return { kinds: [...ALL_KINDS], mutedProjects: [], quietHours: null, ...change };
}

async function tempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "aiki-notify-"));
	cleanups.push(() => rm(dir, { recursive: true, force: true }));
	return dir;
}

async function until(check: () => boolean | Promise<boolean>, timeoutMs = 20_000): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		if (await check()) return;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	throw new Error("timed out waiting for a condition");
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function base64url(bytes: Uint8Array | ArrayBuffer): string {
	return Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString("base64url");
}

function bytesOf(source: Uint8Array): Uint8Array<ArrayBuffer> {
	const copy = new Uint8Array(source.length);
	copy.set(source);
	return copy;
}

// --- the fake push service ----------------------------------------------------------------------------------------

type FakeSubscription = { id: string; privateKey: CryptoKey; auth: string; status: number };

/** One push the fake service received, with the payload it could decrypt. */
type ReceivedPush = {
	id: string;
	headers: Record<string, string>;
	payload: Record<string, unknown> | undefined;
	/** Why the payload could not be decrypted, when that happened. */
	decryptError: string | undefined;
};

async function hkdf(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
	const key = await crypto.subtle.importKey("raw", bytesOf(ikm), "HKDF", false, ["deriveBits"]);
	return new Uint8Array(
		await crypto.subtle.deriveBits(
			{ name: "HKDF", hash: "SHA-256", salt: bytesOf(salt), info: bytesOf(info) },
			key,
			length * 8,
		),
	);
}

const encoder = new TextEncoder();

/**
 * RFC 8291 aes128gcm as a browser performs it: the body is salt(16) | record size(4) | key id length(1) | the
 * sender's public key | one encrypted record, and the keys come from ECDH with the subscription's private key plus
 * HKDF over the auth secret.
 */
async function decryptPush(
	subscription: FakeSubscription,
	uaPublic: Uint8Array,
	body: Uint8Array,
): Promise<string> {
	const salt = body.subarray(0, 16);
	const idLength = body[20]!;
	const senderPublic = body.subarray(21, 21 + idLength);
	const ciphertext = body.subarray(21 + idLength);
	const senderKey = await crypto.subtle.importKey(
		"raw",
		bytesOf(senderPublic),
		{ name: "ECDH", namedCurve: "P-256" },
		false,
		[],
	);
	const shared = new Uint8Array(
		await crypto.subtle.deriveBits(
			{ name: "ECDH", public: senderKey },
			subscription.privateKey,
			256,
		),
	);
	const keyInfo = Buffer.concat([
		Buffer.from(encoder.encode("WebPush: info\0")),
		Buffer.from(uaPublic),
		Buffer.from(senderPublic),
	]);
	const ikm = await hkdf(shared, Buffer.from(subscription.auth, "base64url"), keyInfo, 32);
	const cek = await hkdf(ikm, salt, encoder.encode("Content-Encoding: aes128gcm\0"), 16);
	const nonce = await hkdf(ikm, salt, encoder.encode("Content-Encoding: nonce\0"), 12);
	const key = await crypto.subtle.importKey("raw", bytesOf(cek), "AES-GCM", false, ["decrypt"]);
	const plain = new Uint8Array(
		await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytesOf(nonce) }, key, bytesOf(ciphertext)),
	);
	// The last byte is the padding delimiter; everything before it is the payload.
	let end = plain.length - 1;
	while (end >= 0 && plain[end] === 0) end -= 1;
	if (end < 0 || plain[end] !== 0x02) throw new Error("no padding delimiter");
	return new TextDecoder().decode(plain.subarray(0, end));
}

/** A push service on loopback: it holds each subscription's private key and answers with a status of its choosing. */
class FakePushService {
	readonly pushes: ReceivedPush[] = [];
	readonly #subscriptions = new Map<string, FakeSubscription & { publicKey: Uint8Array }>();
	#server: ReturnType<typeof Bun.serve> | undefined;
	#sequence = 0;

	get url(): string {
		const server = this.#server;
		if (server === undefined) throw new Error("the fake push service is not running");
		return `http://127.0.0.1:${server.port}`;
	}

	start(): void {
		this.#server = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch: async (request) => {
				const url = new URL(request.url);
				const id = url.pathname.split("/").pop() ?? "";
				const subscription = this.#subscriptions.get(id);
				const body = new Uint8Array(await request.arrayBuffer());
				const headers: Record<string, string> = {};
				request.headers.forEach((value, name) => {
					headers[name.toLowerCase()] = value;
				});
				if (subscription === undefined) return new Response("unknown subscription", { status: 404 });
				const record: ReceivedPush = { id, headers, payload: undefined, decryptError: undefined };
				try {
					const text = await decryptPush(subscription, subscription.publicKey, body);
					record.payload = JSON.parse(text) as Record<string, unknown>;
				} catch (error) {
					record.decryptError = error instanceof Error ? error.message : String(error);
				}
				this.pushes.push(record);
				return new Response(null, { status: subscription.status });
			},
		});
		this.#server.unref?.();
	}

	/** A browser subscription, with its keys and the endpoint that leads back here. */
	async subscribe(status = 201): Promise<{
		subscription: { endpoint: string; keys: { p256dh: string; auth: string } };
		publicKey: Uint8Array;
	}> {
		const keys = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
		const jwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
		const publicKey = Buffer.concat([
			Buffer.from([0x04]),
			Buffer.from(jwk.x ?? "", "base64url"),
			Buffer.from(jwk.y ?? "", "base64url"),
		]);
		const auth = base64url(crypto.getRandomValues(new Uint8Array(16)));
		const id = `sub-${++this.#sequence}`;
		this.#subscriptions.set(id, { id, privateKey: keys.privateKey, publicKey, auth, status });
		return {
			subscription: { endpoint: `${this.url}/push/${id}`, keys: { p256dh: base64url(publicKey), auth } },
			publicKey: new Uint8Array(publicKey),
		};
	}

	setStatus(endpoint: string, status: number): void {
		const id = endpoint.split("/").pop() ?? "";
		const subscription = this.#subscriptions.get(id);
		if (subscription === undefined) throw new Error(`no fake subscription for ${endpoint}`);
		subscription.status = status;
	}

	ofKind(kind: string): ReceivedPush[] {
		return this.pushes.filter((push) => push.payload?.["kind"] === kind);
	}

	stop(): void {
		this.#server?.stop(true);
		this.#server = undefined;
	}
}

function startPush(): FakePushService {
	const service = new FakePushService();
	service.start();
	services.push(service);
	return service;
}

/** Verify the VAPID JWT a push carries with the public key the backend answers in `notifications.config`. */
async function verifyVapidJwt(authorization: string, publicKey: string): Promise<Record<string, unknown>> {
	const match = /^vapid t=([^,]+), k=(.+)$/.exec(authorization);
	expect(match).not.toBeNull();
	const jwt = match![1]!;
	const header = match![2]!;
	expect(header).toBe(publicKey);
	const [encodedHeader, encodedPayload, signature] = jwt.split(".");
	const key = await crypto.subtle.importKey(
		"raw",
		bytesOf(Buffer.from(publicKey, "base64url")),
		{ name: "ECDSA", namedCurve: "P-256" },
		false,
		["verify"],
	);
	const valid = await crypto.subtle.verify(
		{ name: "ECDSA", hash: "SHA-256" },
		key,
		bytesOf(Buffer.from(signature ?? "", "base64url")),
		bytesOf(encoder.encode(`${encodedHeader}.${encodedPayload}`)),
	);
	expect(valid).toBe(true);
	return JSON.parse(Buffer.from(encodedPayload ?? "", "base64url").toString("utf8")) as Record<string, unknown>;
}

// --- server helpers ---------------------------------------------------------------------------------------------

type Harness = { test: TestSetup; push: FakePushService };

async function setupWithPush(options: Parameters<typeof createSetup>[0] = {}): Promise<Harness> {
	const push = startPush();
	// Every test registers its own subscriptions on this service; the server pushes to nobody else.
	const test = await createSetup({
		allowedOrigins: [APP_ORIGIN],
		...options,
		notifications: { subject: APP_ORIGIN, ...(options.notifications ?? {}) },
	});
	cleanups.push(test.cleanup);
	return { test, push };
}

async function connect(server: TestSetup["server"]): Promise<TestClient> {
	const client = await TestClient.open(server);
	clients.push(client);
	return client;
}

async function addProject(client: TestClient, path: string): Promise<string> {
	const response = await client.request({ type: "projects.add", path });
	if (response.type !== "projects.add") throw new Error(JSON.stringify(response));
	return response.project.id;
}

async function configureCoordinator(client: TestClient, projectId: string): Promise<void> {
	const response = await client.request({
		type: "projects.configure",
		projectId,
		coordinatorModel: FAUX,
		coordinatorThinkingLevel: null,
		workerModels: [FAUX],
	});
	if (response.type !== "projects.configure") throw errorOf(response);
}

/** Register one device with the fake push service's subscription. */
async function registerDevice(
	client: TestClient,
	push: FakePushService,
	options: { deviceId?: string; backendKey?: string; preferences?: NotificationPreferences } = {},
): Promise<{ deviceId: string; endpoint: string }> {
	const { subscription } = await push.subscribe();
	const deviceId = options.deviceId ?? "device-1";
	const response = await client.request({
		type: "notifications.register",
		deviceId,
		label: "Test device",
		backendKey: options.backendKey ?? "harness-pc",
		subscription,
		preferences: options.preferences ?? preferences(),
	});
	if (response.type !== "notifications.register") throw errorOf(response);
	return { deviceId, endpoint: subscription.endpoint };
}

// --- crypto against a fake push endpoint -------------------------------------------------------------------------

describe("a push the fake service can decrypt", () => {
	it("encrypts for the subscription and signs a VAPID JWT with the backend's key", async () => {
		const push = startPush();
		const dir = await tempDir();
		const keys = await loadOrCreateVapidKeys(join(dir, "notifications", "vapid.json"));
		expect(await vapidKeysWork(keys)).toBe(true);
		// The file is private and holds the same pair a second read reports.
		expect((await readFile(join(dir, "notifications", "vapid.json"), "utf8")).length).toBeGreaterThan(0);
		expect(await loadOrCreateVapidKeys(join(dir, "notifications", "vapid.json"))).toEqual(keys);

		const store = new NotificationStore({ dir: join(dir, "notifications") });
		const state = new NotificationStateStore({ dir: join(dir, "notifications") });
		const notifier = new Notifier({ store, state, vapid: keys, subject: APP_ORIGIN });
		const { subscription, publicKey } = await push.subscribe();
		await notifier.register({
			deviceId: "pixel",
			label: "Pixel",
			backendKey: "harness-pc",
			subscription,
			preferences: preferences(),
		});

		const result = await notifier.deliver({
			kind: "reply",
			title: "harness replied",
			body: "The build is green.",
			projectId: "project-1",
			key: "reply:project-1:7",
		});
		expect(result.deliveries).toEqual([{ deviceId: "pixel", ok: true, status: 201, message: null }]);

		const [received] = push.pushes;
		expect(received?.decryptError).toBeUndefined();
		expect(received?.payload).toMatchObject({
			kind: "reply",
			title: "harness replied",
			body: "The build is green.",
			backendKey: "harness-pc",
			projectId: "project-1",
			workerId: null,
			scheduleId: null,
			tag: "reply:project-1",
		});
		expect(typeof received?.payload?.["at"]).toBe("string");
		// aes128gcm, a 12-hour TTL, and the VAPID JWT signed with the key `notifications.config` answers.
		expect(received?.headers["content-encoding"]).toBe("aes128gcm");
		expect(received?.headers["ttl"]).toBe("43200");
		const claims = await verifyVapidJwt(received?.headers["authorization"] ?? "", keys.publicKey);
		expect(claims["sub"]).toBe(APP_ORIGIN);
		expect(claims["aud"]).toBe(push.url);
		// The payload is what the service worker parses, per the protocol.
		expect(publicKey.length).toBe(65);
	});

	it("marks failures urgent and keeps a normal push normal", async () => {
		const push = startPush();
		const dir = await tempDir();
		const keys = await createVapidKeys();
		const store = new NotificationStore({ dir });
		const notifier = new Notifier({ store, state: new NotificationStateStore({ dir }), vapid: keys, subject: APP_ORIGIN });
		const { subscription } = await push.subscribe();
		await notifier.register({
			deviceId: "pixel",
			label: "Pixel",
			backendKey: "harness-pc",
			subscription,
			preferences: preferences(),
		});

		await notifier.deliver({ kind: "worker_failed", title: "Worker failed", body: "it broke", projectId: "p" });
		await notifier.deliver({ kind: "worker_report", title: "Worker reported", body: "done", projectId: "p" });

		expect(push.pushes[0]?.headers["urgency"]).toBe("high");
		expect(push.pushes[1]?.headers["urgency"]).toBe("normal");
		expect(push.pushes[0]?.headers["topic"]).toBeTruthy();
		expect((push.pushes[0]?.headers["topic"] ?? "").length).toBeLessThanOrEqual(32);
	});

	it("drops a device whose subscription the push service forgot, and records other failures", async () => {
		const push = startPush();
		const dir = await tempDir();
		const keys = await createVapidKeys();
		const store = new NotificationStore({ dir });
		const notifier = new Notifier({
			store,
			state: new NotificationStateStore({ dir }),
			vapid: keys,
			subject: APP_ORIGIN,
		});
		const gone = await push.subscribe(410);
		await notifier.register({
			deviceId: "gone",
			label: "Gone",
			backendKey: "harness-pc",
			subscription: gone.subscription,
			preferences: preferences(),
		});
		const broken = await push.subscribe(500);
		await notifier.register({
			deviceId: "broken",
			label: "Broken",
			backendKey: "harness-pc",
			subscription: broken.subscription,
			preferences: preferences(),
		});

		// A failure reaches no caller: the delivery reports it, the event still counts as handled.
		const result = await notifier.deliver({ kind: "reply", title: "Reply", body: "hi", projectId: "p", key: "reply:p:1" });
		expect(result.deliveries.map((delivery) => [delivery.deviceId, delivery.ok, delivery.status])).toEqual([
			["gone", false, 410],
			["broken", false, 500],
		]);
		expect(store.list().map((device) => device.deviceId)).toEqual(["broken"]);
		expect(store.get("broken")?.lastDelivery).toMatchObject({ ok: false, status: 500 });
		expect(store.get("broken")?.lastDelivery?.message).toBeNull();

		// The same key is not delivered twice, and a new one is.
		const duplicate = await notifier.deliver({ kind: "reply", title: "Reply", body: "hi", projectId: "p", key: "reply:p:1" });
		expect(duplicate.skipped).toBe("duplicate");
		expect(push.pushes.length).toBe(2);
	});
});

// --- filtering ----------------------------------------------------------------------------------------------------

describe("filtering", () => {
	const device = (change: Partial<NotificationPreferences> = {}) => ({
		deviceId: "device-1",
		preferences: preferences(change),
	});

	it("reads quiet hours in the device's timezone, across midnight", () => {
		const quiet = { start: "22:00", end: "07:00", timezone: "Europe/Bucharest", allowFailures: false };
		// Bucharest is UTC+2 in November, so 21:30Z is 23:30 local and 05:30Z is 07:30 local.
		expect(inQuietHours(quiet, new Date("2026-11-05T21:30:00Z"))).toBe(true);
		expect(inQuietHours(quiet, new Date("2026-11-05T04:59:00Z"))).toBe(true); // 06:59 local
		expect(inQuietHours(quiet, new Date("2026-11-05T05:00:00Z"))).toBe(false); // 07:00 local
		expect(inQuietHours(quiet, new Date("2026-11-05T10:00:00Z"))).toBe(false); // 12:00 local
		// A window inside one day, and the two ends that mean no quiet hours.
		const daytime = { start: "09:00", end: "17:00", timezone: "UTC", allowFailures: false };
		expect(inQuietHours(daytime, new Date("2026-11-05T08:59:00Z"))).toBe(false);
		expect(inQuietHours(daytime, new Date("2026-11-05T09:00:00Z"))).toBe(true);
		expect(inQuietHours(daytime, new Date("2026-11-05T17:00:00Z"))).toBe(false);
		expect(inQuietHours({ ...daytime, start: "09:00", end: "09:00" }, new Date("2026-11-05T09:00:00Z"))).toBe(false);
		// A zone Intl does not know never silences a device.
		expect(inQuietHours({ ...quiet, timezone: "Mars/Olympus" }, new Date("2026-11-05T21:30:00Z"))).toBe(false);
	});

	it("blocks by kind, mute and quiet hours, letting failures through when asked", () => {
		const at = new Date("2026-11-05T21:30:00Z");
		const event = { kind: "reply" as const, projectId: "project-1" };
		expect(notificationBlocked(device(), event, { at })).toBeUndefined();
		expect(notificationBlocked(device({ kinds: ["worker_failed"] }), event, { at })).toBe("kind");
		expect(notificationBlocked(device({ mutedProjects: ["project-1"] }), event, { at })).toBe("muted");
		expect(notificationBlocked(device({ mutedProjects: ["other"] }), event, { at })).toBeUndefined();
		// A global event has no project to be muted.
		expect(
			notificationBlocked(device({ mutedProjects: ["project-1"] }), { kind: "deploy_problem", projectId: null }, { at }),
		).toBeUndefined();

		const quiet = { start: "22:00", end: "07:00", timezone: "Europe/Bucharest", allowFailures: false };
		expect(notificationBlocked(device({ quietHours: quiet }), event, { at })).toBe("quiet");
		expect(
			notificationBlocked(device({ quietHours: { ...quiet, allowFailures: true } }), event, { at }),
		).toBe("quiet");
		expect(
			notificationBlocked(device({ quietHours: { ...quiet, allowFailures: true } }), { kind: "worker_failed", projectId: "project-1" }, { at }),
		).toBeUndefined();
		// A test push is never filtered: the user asked for it just now.
		expect(
			notificationBlocked(
				device({ kinds: [], mutedProjects: ["project-1"], quietHours: quiet }),
				{ kind: "test", projectId: null },
				{ at },
			),
		).toBeUndefined();
	});

	it("forgets presence when a connection is removed, and counts a hidden page as not open", () => {
		const presence = new NotificationPresence();
		const first = {};
		const second = {};
		expect(presence.anyVisible()).toBe(false);
		presence.set(second, { deviceId: "device-2", visible: false, projectId: "project-1" });
		expect(presence.anyVisible()).toBe(false);
		presence.set(first, { deviceId: "device-1", visible: true, projectId: null });
		expect(presence.anyVisible()).toBe(true);
		presence.remove(first);
		expect(presence.anyVisible()).toBe(false);
		expect(presence.of("device-1")).toEqual([]);
	});

	it("keeps a payload's fields per device and one line of body", () => {
		const event = replyNotification({
			projectId: "project-1",
			projectName: "Harness",
			entryId: 4,
			at: "2026-11-05T10:00:00Z",
			text: "First line.\nSecond line.",
		});
		const payload = notificationPayload({ backendKey: "harness-vm" }, event, "2026-11-05T10:00:01Z");
		expect(payload).toEqual({
			kind: "reply",
			title: "Harness replied",
			body: "First line.",
			backendKey: "harness-vm",
			projectId: "project-1",
			workerId: null,
			scheduleId: null,
			tag: "reply:project-1",
			at: "2026-11-05T10:00:01Z",
		});
		expect(notificationTag({ kind: "worker_report", projectId: "p", workerId: "w", scheduleId: null })).toBe(
			"worker_report:p:w",
		);
	});

	it("keeps the dedupe keys bounded and names the app as the VAPID subject", async () => {
		const dir = await tempDir();
		const state = new NotificationStateStore({ dir });
		for (let index = 0; index < KEPT_NOTIFIED_KEYS + 5; index += 1) expect(state.claim(`key-${index}`)).toBe(true);
		expect(state.claim("key-0")).toBe(true); // fell off the end, so it may be claimed again
		await state.flush();
		expect([...state.keys].length).toBeLessThanOrEqual(KEPT_NOTIFIED_KEYS);
		// The burst of claims shares writes, and the file still ends with the last state.
		const reread = new NotificationStateStore({ dir });
		await reread.read();
		expect([...reread.keys]).toEqual([...state.keys]);

		expect(resolveVapidSubject([APP_ORIGIN])).toBe(APP_ORIGIN);
		expect(resolveVapidSubject(["http://localhost:5173", APP_ORIGIN])).toBe(APP_ORIGIN);
		expect(resolveVapidSubject(["http://localhost:5173"])).toBe("https://localhost");
		expect(resolveVapidSubject([], { AIKI_VAPID_SUBJECT: "https://other.test" })).toBe("https://other.test");
	});
});

// --- events from the running server -------------------------------------------------------------------------------

function script(options: { delegate?: { text: string; call: JsonObject }; workerAnswer?: string }) {
	const delegate = options.delegate ?? {
		text: "Delegate the reading.",
		call: { id: "reader", task: "Read the README.", title: "Read the README" },
	};
	const workerAnswer = options.workerAnswer ?? "## Report\nOutcome: done";
	return (request: TranscriptContext) => {
		const last = request.messages.findLast((message) => message.role !== "system");
		const text =
			typeof last?.content === "string"
				? last.content
				: Array.isArray(last?.content)
					? last.content
							.map((part) => (part.type === "text" ? part.text : ""))
							.join("")
					: "";
		if (last?.role === "toolResult") return fauxAssistantMessage("Tool call finished.");
		if (text.includes(delegate.call["task"] as string)) return fauxAssistantMessage(workerAnswer);
		if (text.includes("reported]") || text.includes("failed:")) return fauxAssistantMessage("Report reviewed.");
		if (text.includes(delegate.text)) {
			return fauxAssistantMessage([fauxToolCall("worker_spawn", delegate.call)], { stopReason: "toolUse" });
		}
		return fauxAssistantMessage("Nothing to do.");
	};
}

/** The newest answer the project has published, which is how a test knows a reply landed. */
async function lastReplyId(test: TestSetup): Promise<number | null> {
	const [project] = await test.server.manager.list();
	return project?.activity?.lastReplyEntryId ?? null;
}

async function submit(client: TestClient, projectId: string, content: string, requestId: string): Promise<void> {
	const response = await client.request({ type: "conversation.submit", projectId, content, requestId });
	if (response.type !== "conversation.submit") throw errorOf(response);
}

describe("the requests", () => {
	it("answers the VAPID key, registers, tests, reports and forgets a device", async () => {
		const { test, push } = await setupWithPush();
		const client = await connect(test.server);
		await client.hello();

		const config = await client.request({ type: "notifications.config" });
		if (config.type !== "notifications.config") throw errorOf(config);
		expect(config.publicKey).toBe(test.server.notifications.publicKey);
		expect(await vapidKeysWork(test.server.notifications.vapid)).toBe(true);

		const { deviceId, endpoint } = await registerDevice(client, push);
		const device = await client.request({ type: "notifications.device", deviceId });
		if (device.type !== "notifications.device") throw errorOf(device);
		expect(device.device).toMatchObject({ deviceId, label: "Test device", backendKey: "harness-pc", lastDelivery: null });
		expect(device.device?.preferences.kinds).toEqual(ALL_KINDS);

		const tested = await client.request({ type: "notifications.test", deviceId });
		if (tested.type !== "notifications.test") throw errorOf(tested);
		expect(tested).toMatchObject({ ok: true, status: 201, message: null });
		expect(push.pushes[0]?.payload).toMatchObject({ kind: "test", tag: "test", projectId: null });
		const afterTest = await client.request({ type: "notifications.device", deviceId });
		if (afterTest.type !== "notifications.device") throw errorOf(afterTest);
		expect(afterTest.device?.lastDelivery).toMatchObject({ ok: true, status: 201 });

		// The push service forgot the subscription: the test says so and the device is gone.
		push.setStatus(endpoint, 410);
		const gone = await client.request({ type: "notifications.test", deviceId });
		if (gone.type !== "notifications.test") throw errorOf(gone);
		expect(gone).toMatchObject({ ok: false, status: 410 });
		const missing = await client.request({ type: "notifications.device", deviceId });
		if (missing.type !== "notifications.device") throw errorOf(missing);
		expect(missing.device).toBeNull();
		const unknown = await client.request({ type: "notifications.test", deviceId });
		expect(errorOf(unknown).code).toBe("bad_request");

		const unregistered = await client.request({ type: "notifications.unregister", deviceId });
		expect(unregistered.type).toBe("notifications.unregister");
	}, 30_000);
});

describe("events", () => {
	it("announces a reply once, and not again when the activity watch replays after a restart", async () => {
		const { test, push } = await setupWithPush();
		const client = await connect(test.server);
		await client.hello();
		const projectId = await addProject(client, test.projectDir);
		await configureCoordinator(client, projectId);
		await registerDevice(client, push);
		test.faux.setResponses([fauxAssistantMessage("All green.\nTwo checks passed.")]);

		await submit(client, projectId, "How is it?", "req-1");
		await until(() => push.ofKind("reply").length === 1);
		expect(push.ofKind("reply")[0]?.payload).toMatchObject({
			kind: "reply",
			title: "project replied",
			body: "All green.",
			projectId,
			backendKey: "harness-pc",
		});

		// The activity's last reply is persisted before the restart, so replaying the transcript notifies nothing.
		await until(async () => (await lastReplyId(test)) !== null);
		await sleep(100);
		const restarted = await test.restart();
		const again = await connect(restarted);
		await again.hello();
		await again.request({ type: "conversation.page", projectId, limit: 10 });
		await sleep(500);
		expect(push.ofKind("reply").length).toBe(1);
	}, 30_000);

	it("says nothing for an archived project, and notifies again once it is unarchived", async () => {
		const { test, push } = await setupWithPush();
		const client = await connect(test.server);
		await client.hello();
		const projectId = await addProject(client, test.projectDir);
		await configureCoordinator(client, projectId);
		await registerDevice(client, push);
		test.faux.setResponses(Array.from({ length: 10 }, () => fauxAssistantMessage("Done.")));

		const archive = async (archived: boolean): Promise<void> => {
			const response = await client.request({ type: "projects.configure", projectId, archived });
			if (response.type !== "projects.configure") throw errorOf(response);
			expect(response.project.archived).toBe(archived ? true : undefined);
		};
		await archive(true);
		await submit(client, projectId, "one", "req-1");
		await until(async () => (await lastReplyId(test)) !== null);
		await sleep(300);
		expect(push.pushes.length).toBe(0);
		// A device-wide event (no project) still goes through.
		const deployLike = await test.server.notifications.deliver({ kind: "test", title: "Test", body: "x", projectId: null });
		expect(deployLike.deliveries).toHaveLength(1);

		await archive(false);
		await submit(client, projectId, "two", "req-2");
		await until(() => push.ofKind("reply").length === 1);
		expect(push.ofKind("reply")[0]?.payload).toMatchObject({ projectId });
	}, 30_000);

	it("tells the devices once when the coordinator asks a question on the board", async () => {
		const { test, push } = await setupWithPush();
		const client = await connect(test.server);
		await client.hello();
		const projectId = await addProject(client, test.projectDir);
		await configureCoordinator(client, projectId);
		await registerDevice(client, push);
		test.faux.setResponses([
			fauxAssistantMessage([fauxToolCall("board", { action: "ask", text: "Which database should it use?" })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("Asked."),
		]);

		await submit(client, projectId, "Plan the storage.", "req-1");
		await until(() => push.ofKind("board_question").length === 1);
		expect(push.ofKind("board_question")[0]?.payload).toMatchObject({
			kind: "board_question",
			title: "Question · project",
			body: "Which database should it use?",
			projectId,
		});
		await sleep(300);
		expect(push.ofKind("board_question").length).toBe(1);
	}, 30_000);

	it("tells the devices about a warning and a move to review, each naming its task", async () => {
		const { test, push } = await setupWithPush();
		const client = await connect(test.server);
		await client.hello();
		const projectId = await addProject(client, test.projectDir);
		await configureCoordinator(client, projectId);
		await registerDevice(client, push);
		const board = (args: Record<string, unknown>) =>
			fauxAssistantMessage([fauxToolCall("board", args as never)], { stopReason: "toolUse" });
		test.faux.setResponses([
			board({ action: "add_task", title: "Migrate the database" }),
			board({ action: "ask", kind: "warning", text: "The backup is a week old.", taskId: "T1" }),
			board({ action: "update_task", id: "T1", expectedRevision: 1, status: "review" }),
			fauxAssistantMessage("T1 is ready for review."),
		]);

		await submit(client, projectId, "Migrate the database.", "req-1");
		await until(() => push.ofKind("board_question").length === 1 && push.ofKind("task_review").length === 1);
		expect(push.ofKind("board_question")[0]?.payload).toMatchObject({ title: "Warning · project", taskId: "T1" });
		expect(push.ofKind("task_review")[0]?.payload).toMatchObject({
			kind: "task_review",
			title: "Ready for review · project",
			body: "T1 Migrate the database",
			taskId: "T1",
		});
	}, 30_000);

	it("returns a dated waiting task on time and sends one review notification through Notifier", async () => {
		let now = Date.parse("2026-11-10T12:00:00Z");
		const { test, push } = await setupWithPush({ now: () => now, boardEditDebounceMs: 5 });
		test.faux.setResponses(Array.from({ length: 20 }, () => fauxAssistantMessage("Noted.")));
		const client = await connect(test.server);
		await client.hello();
		const projectId = await addProject(client, test.projectDir);
		await configureCoordinator(client, projectId);
		await registerDevice(client, push);
		const saved = await client.request({ type: "board.task.save", projectId, task: {
			title: "Ship auth", description: "", acceptance: null, status: "waiting", waitingFor: "PR #312 approval from Ana",
			waitUntil: new Date(now + 100).toISOString(), blockedBy: [], blockedReason: null, writeScopes: [],
		} });
		expect(saved.type).toBe("board.task.save");
		now += 100;
		await until(() => push.ofKind("task_review").length === 1);
		expect(push.ofKind("task_review")[0]?.payload).toMatchObject({ taskId: "T1", body: "T1 is back for review: waiting for PR #312 approval from Ana" });
		const board = await client.request({ type: "board.get", projectId });
		if (board.type !== "board.get") throw new Error(JSON.stringify(board));
		expect(board.board.tasks[0]?.status).toBe("review");
		await sleep(150);
		expect(push.ofKind("task_review")).toHaveLength(1);
	}, 20_000);

	it("reports a worker's answer, and a scheduled run's completion and failure", async () => {
		const { test, push } = await setupWithPush();
		const client = await connect(test.server);
		await client.hello();
		const projectId = await addProject(client, test.projectDir);
		await configureCoordinator(client, projectId);
		await registerDevice(client, push);
		test.faux.setResponses(Array.from({ length: 20 }, () => script({})));

		await submit(client, projectId, "Delegate the reading.", "req-1");
		await until(() => push.ofKind("worker_report").length === 1);
		expect(push.ofKind("worker_report")[0]?.payload).toMatchObject({
			kind: "worker_report",
			title: "Worker reported · project",
			body: "## Report",
			projectId,
			workerId: "reader",
		});

		// A schedule whose model does not exist fails before a worker starts: that is a schedule problem.
		const saved = await client.request({
			type: "schedules.save",
			projectId,
			schedule: {
				title: "Nightly",
				brief: "Say goodnight.",
				spec: { kind: "daily", time: "23:00" },
				model: { provider: "faux", modelId: "missing-model" },
				thinkingLevel: null,
				isolation: "shared",
				onReport: "record",
				enabled: false,
			},
		});
		if (saved.type !== "schedules.save") throw errorOf(saved);
		const ran = await client.request({ type: "schedules.run", projectId, scheduleId: saved.schedule.id });
		if (ran.type !== "schedules.run") throw errorOf(ran);
		expect(ran.run.outcome).toBe("failed");
		await until(() => push.ofKind("schedule_problem").length === 1);
		expect(push.ofKind("schedule_problem")[0]?.payload).toMatchObject({
			kind: "schedule_problem",
			title: "Scheduled task failed · Nightly",
			scheduleId: saved.schedule.id,
		});

		// A run that starts and reports is a schedule that finished.
		const healthy = await client.request({
			type: "schedules.save",
			projectId,
			schedule: {
				title: "Morning",
				brief: "Say good morning.",
				spec: { kind: "daily", time: "08:00" },
				model: FAUX,
				thinkingLevel: null,
				isolation: "shared",
				onReport: "record",
				enabled: false,
			},
		});
		if (healthy.type !== "schedules.save") throw errorOf(healthy);
		const started = await client.request({ type: "schedules.run", projectId, scheduleId: healthy.schedule.id });
		if (started.type !== "schedules.run") throw errorOf(started);
		expect(started.run.outcome).toBe("started");
		await until(() => push.ofKind("schedule_done").length === 1);
		expect(push.ofKind("schedule_done")[0]?.payload).toMatchObject({
			kind: "schedule_done",
			title: "Scheduled task done · Morning",
			scheduleId: healthy.schedule.id,
		});
	}, 40_000);

	it("holds back replies while a worker runs, then says once that the work finished", async () => {
		const { test, push } = await setupWithPush({ workFinished: { minWorkMs: 0, quietMs: 300 } });
		const client = await connect(test.server);
		await client.hello();
		const projectId = await addProject(client, test.projectDir);
		await configureCoordinator(client, projectId);
		await registerDevice(client, push);
		let release: () => void = () => undefined;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const answer = script({});
		test.faux.setResponses(
			Array.from({ length: 20 }, () => async (request: TranscriptContext, options?: { signal?: AbortSignal }) => {
				const reply = answer(request);
				const text = JSON.stringify(request.messages.at(-1) ?? null);
				if (text.includes("Read the README.") && !text.includes("reported]")) {
					await new Promise<void>((resolve) => {
						options?.signal?.addEventListener("abort", () => resolve(), { once: true });
						void gate.then(() => resolve());
					});
				}
				return text.includes("reported]") ? fauxAssistantMessage("All read.\nNothing else to do.") : reply;
			}),
		);

		await submit(client, projectId, "Delegate the reading.", "req-1");
		// The coordinator answers while its worker still runs: no reply push, and the work is not finished.
		await until(async () => (await lastReplyId(test)) !== null);
		await sleep(600);
		expect(push.ofKind("reply")).toHaveLength(0);
		expect(push.ofKind("work_finished")).toHaveLength(0);

		release();
		await until(() => push.ofKind("work_finished").length === 1);
		expect(push.ofKind("work_finished")[0]?.payload).toMatchObject({
			kind: "work_finished",
			title: "project finished",
			body: "All read.",
			projectId,
		});
		// The last answer came with nothing running: that one is a reply like any other.
		expect(push.ofKind("reply")).toHaveLength(1);

		const restarted = await test.restart();
		const again = await connect(restarted);
		await again.hello();
		await again.request({ type: "conversation.page", projectId, limit: 10 });
		await sleep(600);
		expect(push.ofKind("work_finished")).toHaveLength(1);
	}, 30_000);

	it("holds a reply while a page is visible, pushes it when nobody interacts, and drops it when someone does", async () => {
		const { test, push } = await setupWithPush({ notifications: { holdMs: 1_500 } });
		const watcher = await connect(test.server);
		const sender = await connect(test.server);
		await watcher.hello();
		await sender.hello();
		const projectId = await addProject(sender, test.projectDir);
		await configureCoordinator(sender, projectId);
		const device = await registerDevice(sender, push);
		test.faux.setResponses(Array.from({ length: 10 }, () => fauxAssistantMessage("First.")));

		// An open page on this very project no longer silences it: the push comes once the hold has run out.
		const view = new ViewClient(watcher);
		await view.start(projectId);
		const presence = await watcher.request({
			type: "notifications.presence",
			deviceId: "watching-device",
			visible: true,
			projectId,
		});
		expect(presence.type).toBe("notifications.presence");
		await submit(sender, projectId, "one", "req-1");
		await until(() => test.server.notifications.heldCount === 1);
		expect(push.ofKind("reply").length).toBe(0);
		await until(() => push.ofKind("reply").length === 1);
		expect(test.server.notifications.heldCount).toBe(0);

		// Interaction from another connection (here the sender's) during the hold drops the next one.
		await submit(sender, projectId, "two", "req-2");
		await until(() => test.server.notifications.heldCount === 1);
		const interaction = await sender.request({ type: "notifications.interaction", deviceId: device.deviceId });
		expect(interaction).toMatchObject({ type: "notifications.interaction", dropped: 1 });
		await sleep(2_000);
		expect(push.ofKind("reply").length).toBe(1);

		// The socket closes, so nothing is open: the next answer is pushed at once.
		watcher.close();
		await watcher.closed();
		await submit(sender, projectId, "three", "req-3");
		await until(() => push.ofKind("reply").length === 2, 10_000);
	}, 60_000);

	it("mutes a project and honours quiet hours, letting a failure through only when asked", async () => {
		// 23:30 in Bucharest, inside the device's 22:00–07:00 quiet hours.
		const now = () => Date.parse("2026-11-05T21:30:00Z");
		const deployDir = await tempDir();
		const deployFile = join(deployDir, "deploy-status.json");
		const { test, push } = await setupWithPush({
			now,
			notifications: { now },
			status: { deployStatusFile: deployFile },
		});
		const client = await connect(test.server);
		await client.hello();
		const projectId = await addProject(client, test.projectDir);
		await configureCoordinator(client, projectId);
		test.faux.setResponses(Array.from({ length: 10 }, () => fauxAssistantMessage("Quiet.")));

		// Muted: nothing for this project.
		await registerDevice(client, push, { preferences: preferences({ mutedProjects: [projectId] }) });
		await submit(client, projectId, "one", "req-1");
		await until(async () => (await lastReplyId(test)) !== null);
		await sleep(300);
		expect(push.pushes.length).toBe(0);

		// Unmuted, but in quiet hours.
		await registerDevice(client, push, {
			preferences: preferences({
				quietHours: { start: "22:00", end: "07:00", timezone: "Europe/Bucharest", allowFailures: false },
			}),
		});
		await submit(client, projectId, "two", "req-2");
		await until(async () => ((await lastReplyId(test)) ?? 0) > 1);
		await sleep(300);
		expect(push.pushes.length).toBe(0);

		// A failure at the same hour: blocked here, let through on a device that allows failures.
		await registerDevice(client, push, {
			deviceId: "forgiving",
			preferences: preferences({
				quietHours: { start: "22:00", end: "07:00", timezone: "Europe/Bucharest", allowFailures: true },
			}),
		});
		await writeFile(
			deployFile,
			JSON.stringify({
				state: "failed",
				commit: "0f1e2d3c4b5a69788796a5b4c3d2e1f009182736",
				description: "feat: a deploy",
				message: "the tests failed",
				at: "2026-11-05T21:20:00Z",
			}),
		);
		await test.server.serverStatus.refresh();
		await until(() => push.ofKind("deploy_problem").length === 1);
		expect(push.ofKind("deploy_problem")[0]?.id).toBeTruthy();
		expect(push.ofKind("deploy_problem")[0]?.payload).toMatchObject({
			kind: "deploy_problem",
			title: "Deploy failed",
			body: "0f1e2d3 feat: a deploy: the tests failed",
			projectId: null,
		});
		expect(push.ofKind("deploy_problem").length).toBe(1);
	}, 40_000);

	it("reports a failed deploy once per attempt, including after the rolled-back restart", async () => {
		const deployDir = await tempDir();
		const deployFile = join(deployDir, "deploy-status.json");
		const writeAttempt = (state: "failed" | "rolled_back", at: string): Promise<void> =>
			writeFile(
				deployFile,
				JSON.stringify({
					state,
					commit: "1231234890abcdef1231234890abcdef12312348",
					description: "fix: ship it",
					message: "the health check failed",
					at,
				}),
			);
		const push = startPush();
		const test = await createSetup({
			allowedOrigins: [APP_ORIGIN],
			status: { deployStatusFile: deployFile },
			notifications: { subject: APP_ORIGIN },
		});
		cleanups.push(test.cleanup);
		const client = await connect(test.server);
		await client.hello();
		await registerDevice(client, push);
		// The deploy writes its status while the server runs; the watcher (or this refresh) makes it news.
		await writeAttempt("failed", "2026-11-05T09:00:00Z");
		await test.server.serverStatus.refresh();
		await until(() => push.ofKind("deploy_problem").length === 1);
		expect(push.ofKind("deploy_problem")[0]?.payload?.["body"]).toBe(
			"1231234 fix: ship it: the health check failed",
		);

		// The same attempt after a restart is old news, even though the file is read again on the way in.
		await test.restart();
		const again = await connect(test.server);
		await again.hello();
		await sleep(300);
		expect(push.ofKind("deploy_problem").length).toBe(1);

		// A new attempt is a new problem.
		await writeAttempt("rolled_back", "2026-11-05T10:00:00Z");
		await test.server.serverStatus.refresh();
		await until(() => push.ofKind("deploy_problem").length === 2);
		expect(push.ofKind("deploy_problem")[1]?.payload).toMatchObject({
			title: "Deploy rolled back",
			body: "1231234 fix: ship it: the health check failed",
		});
	}, 40_000);

	it("says when a sign-in waits for an answer", async () => {
		const provider = fakeOAuthProvider();
		const { test, push } = await setupWithPush({
			configureModels: (models) => models.setProvider(provider.provider),
		});
		const client = await connect(test.server);
		await client.hello();
		await registerDevice(client, push);
		const started = await client.request({ type: "credentials.loginStart", providerId: "fake-subscription" });
		if (started.type !== "credentials.loginStart") throw errorOf(started);
		await until(() => push.ofKind("login_prompt").length === 1);
		const payload = push.ofKind("login_prompt")[0]?.payload;
		expect(payload).toMatchObject({ kind: "login_prompt", title: "Sign in · fake-subscription" });
		expect(String(payload?.["body"])).toContain("Select a fake login method");
	}, 30_000);

	it("says when memory maintenance fails", async () => {
		const { test, push } = await setupWithPush({ timezone: "UTC" });
		const client = await connect(test.server);
		await client.hello();
		const projectId = await addProject(client, test.projectDir);
		await registerDevice(client, push);
		await client.request({
			type: "memory.settings.set",
			maintenance: { model: FAUX, thinkingLevel: null, time: "03:00", afterWrites: 100 },
		});
		await test.server.manager.memory.write({
			target: { scope: "project", projectId },
			fileId: "testing",
			text: "Use `bun test`.",
		});
		test.faux.setResponses(
			Array.from({ length: 10 }, () => fauxAssistantMessage("", { stopReason: "error", errorMessage: "provider is down" })),
		);
		const maintain = await client.request({ type: "memory.maintain", scope: "project", projectId });
		expect(maintain.type).toBe("memory.maintain");

		await until(() => push.ofKind("maintenance_failed").length === 1, 30_000);
		const payload = push.ofKind("maintenance_failed")[0]?.payload;
		expect(payload).toMatchObject({
			kind: "maintenance_failed",
			title: "Memory maintenance failed",
			projectId,
		});
		expect(String(payload?.["body"])).toContain("provider is down");
	}, 40_000);
});

describe("the activity watch", () => {
	it("reports a compaction failure once per failed task", async () => {
		const initial = { entries: [], docs: {} } as unknown as ConversationView;
		let push: ((value: ConversationView) => void) | undefined;
		const stub = {
			watch: async () => ({
				value: initial,
				start: (fn: (call: { kind: "value"; value: ConversationView; ops: []; retired: false }) => Promise<void>) => {
					push = value => { void fn({ kind: "value", value, ops: [], retired: false }); };
				},
				stop: async () => undefined,
				closed: new Promise(() => undefined),
			}),
			entries: async () => ({ items: [] }),
		} as unknown as Conversation;
		const failures: CompactionFailureNotice[] = [];
		const replies: ReplyNotice[] = [];
		const service = new ProjectActivityService({
			conversation: stub,
			initial: DEFAULT_ACTIVITY,
			onChange: () => undefined,
			onReply: (reply) => replies.push(reply),
			onCompactionFailure: (failure) => failures.push(failure),
		});
		await service.start();

		const failed = (taskId: number) =>
			({ entries: [], docs: { "pi.live": { compactionFailure: { taskId, trigger: "threshold", error: "the model failed" } } } }) as unknown as ConversationView;
		push?.(failed(3));
		push?.(failed(3));
		push?.(failed(4));
		expect(failures).toEqual([
			{ taskId: 3, reason: "threshold", error: "the model failed" },
			{ taskId: 4, reason: "threshold", error: "the model failed" },
		]);
		expect(replies).toEqual([]);
		await service.stop();
	});
});
