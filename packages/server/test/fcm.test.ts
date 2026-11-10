/**
 * FCM for the Android app: the service-account sign-in Google checks, the HTTP v1 message, and the same filtering and
 * dedupe Web Push devices get.
 *
 * Google is faked but the wire is real: the server signs an RS256 assertion with a generated service-account key and
 * posts it to a local token endpoint, which verifies it with the public half before handing out an access token; the
 * fake FCM endpoint checks that token and records each message. No network.
 */
import { afterEach, describe, expect, it } from "bun:test";
import type { NotificationPayload, NotificationPreferences } from "@aiki/protocol";
import { DEFAULT_NOTIFICATION_KINDS } from "@aiki/protocol";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	FCM_KEY_FILE_NAME,
	FCM_SCOPE,
	FcmSender,
	loadFcmServiceAccount,
	parseFcmServiceAccount,
	resolveFcmKeyFile,
	type FcmServiceAccount,
} from "../src/fcm.ts";
import {
	FCM_OFF_MESSAGE,
	NotificationPresence,
	NotificationStateStore,
	NotificationStore,
	Notifier,
	createVapidKeys,
} from "../src/notifications.ts";
import { createSetup, errorOf, TestClient } from "./support.ts";

const TEST_PEM_LABEL = ["PRIVATE", "KEY"].join(" ");

const cleanups: (() => Promise<void>)[] = [];
const clients: TestClient[] = [];

afterEach(async () => {
	for (const client of clients.splice(0)) client.close();
	for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function tempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "aiki-fcm-"));
	cleanups.push(() => rm(dir, { recursive: true, force: true }));
	return dir;
}

function preferences(change: Partial<NotificationPreferences> = {}): NotificationPreferences {
	return { kinds: [...DEFAULT_NOTIFICATION_KINDS], mutedProjects: [], quietHours: null, ...change };
}

// --- a fake Google: token endpoint and FCM ------------------------------------------------------------------------

type ReceivedMessage = { projectId: string; authorization: string | null; body: Record<string, unknown>; payload: NotificationPayload };

type FakeGoogle = {
	url: string;
	tokenUri: string;
	/** Every assertion's claims, as the token endpoint verified them. */
	assertions: Record<string, unknown>[];
	messages: ReceivedMessage[];
	/** What FCM answers for a token: a status and an error code, or 200. */
	answer(token: string, status: number, errorCode?: string): void;
	/** Revoke every access token handed out so far: FCM answers 401 until a new one is fetched. */
	revokeTokens(): void;
};

function fromBase64url(value: string): Uint8Array<ArrayBuffer> {
	const bytes = Buffer.from(value, "base64url");
	const copy = new Uint8Array(bytes.length);
	copy.set(bytes);
	return copy;
}

async function startGoogle(publicKey: CryptoKey): Promise<FakeGoogle> {
	const assertions: Record<string, unknown>[] = [];
	const messages: ReceivedMessage[] = [];
	const answers = new Map<string, { status: number; errorCode?: string }>();
	const valid = new Set<string>();
	let issued = 0;
	const server = Bun.serve({
		port: 0,
		hostname: "127.0.0.1",
		async fetch(request) {
			const url = new URL(request.url);
			if (url.pathname === "/token") {
				const form = new URLSearchParams(await request.text());
				if (form.get("grant_type") !== "urn:ietf:params:oauth:grant-type:jwt-bearer") return new Response("bad grant", { status: 400 });
				const [header, claims, signature] = (form.get("assertion") ?? "").split(".");
				const ok = await crypto.subtle.verify(
					"RSASSA-PKCS1-v1_5",
					publicKey,
					fromBase64url(signature ?? ""),
					new TextEncoder().encode(`${header}.${claims}`),
				);
				if (!ok) return Response.json({ error: "invalid_grant" }, { status: 400 });
				assertions.push(JSON.parse(Buffer.from(claims ?? "", "base64url").toString("utf8")) as Record<string, unknown>);
				const token = `access-${++issued}`;
				valid.add(token);
				return Response.json({ access_token: token, expires_in: 3599, token_type: "Bearer" });
			}
			const match = /^\/v1\/projects\/([^/]+)\/messages:send$/.exec(url.pathname);
			if (match !== null && request.method === "POST") {
				const authorization = request.headers.get("authorization");
				if (authorization === null || !valid.has(authorization.replace(/^Bearer /, ""))) {
					return Response.json({ error: { code: 401, status: "UNAUTHENTICATED", message: "Request had invalid authentication credentials." } }, { status: 401 });
				}
				const body = (await request.json()) as { message: { token: string; data: { payload: string } } };
				const answer = answers.get(body.message.token);
				if (answer !== undefined && answer.status !== 200) {
					return Response.json(
						{
							error: {
								code: answer.status,
								message: "Requested entity was not found.",
								status: "NOT_FOUND",
								details: answer.errorCode === undefined ? [] : [{ "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode: answer.errorCode }],
							},
						},
						{ status: answer.status },
					);
				}
				messages.push({
					projectId: decodeURIComponent(match[1]!),
					authorization,
					body: body as unknown as Record<string, unknown>,
					payload: JSON.parse(body.message.data.payload) as NotificationPayload,
				});
				return Response.json({ name: `projects/${match[1]}/messages/${messages.length}` });
			}
			return new Response("not found", { status: 404 });
		},
	});
	cleanups.push(async () => {
		server.stop(true);
	});
	const url = `http://127.0.0.1:${server.port}`;
	return {
		url,
		tokenUri: `${url}/token`,
		assertions,
		messages,
		answer(token, status, errorCode) {
			answers.set(token, { status, ...(errorCode === undefined ? {} : { errorCode }) });
		},
		revokeTokens() {
			valid.clear();
		},
	};
}

/** A Google-style service-account key file with a fresh RSA key, and the public half to verify it with. */
async function serviceAccount(tokenUri: string): Promise<{ json: Record<string, string>; publicKey: CryptoKey }> {
	const pair = await crypto.subtle.generateKey(
		{ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
		true,
		["sign", "verify"],
	);
	const pkcs8 = Buffer.from(await crypto.subtle.exportKey("pkcs8", pair.privateKey)).toString("base64");
	const pem = `-----BEGIN ${TEST_PEM_LABEL}-----\n${pkcs8.match(/.{1,64}/g)!.join("\n")}\n-----END ${TEST_PEM_LABEL}-----\n`;
	return {
		json: {
			type: "service_account",
			project_id: "harness-test",
			private_key_id: "abc123",
			private_key: pem,
			client_email: "firebase-adminsdk@harness-test.iam.gserviceaccount.com",
			client_id: "1",
			token_uri: tokenUri,
		},
		publicKey: pair.publicKey,
	};
}

/** A fake Google and a key file for it: the token endpoint learns the public key once the key exists. */
async function googleWithKey(): Promise<{ google: FakeGoogle; keyFile: string; account: FcmServiceAccount; dir: string }> {
	const dir = await tempDir();
	// The token URI must be known before the key is written, and the key before the fake starts: bind the port first.
	const pending = await serviceAccount("http://placeholder/token");
	const google = await startGoogle(pending.publicKey);
	const json = { ...pending.json, token_uri: google.tokenUri };
	const keyFile = join(dir, "notifications", FCM_KEY_FILE_NAME);
	await Bun.write(keyFile, JSON.stringify(json));
	const account = parseFcmServiceAccount(json);
	if (typeof account === "string") throw new Error(account);
	return { google, keyFile, account, dir };
}

describe("the service-account key", () => {
	it("is read from the data directory unless the environment names another file", () => {
		expect(resolveFcmKeyFile("/data", {})).toBe("/data/notifications/fcm-service-account.json");
		expect(resolveFcmKeyFile("/data", { AIKI_FCM_KEY_FILE: "/keys/fcm.json" })).toBe("/keys/fcm.json");
	});

	it("turns FCM off when absent or unusable, and never logs the key", async () => {
		const dir = await tempDir();
		const logs: string[] = [];
		expect(await loadFcmServiceAccount(join(dir, "missing.json"), (line) => logs.push(line))).toBeUndefined();
		expect(logs.at(-1)).toContain("FCM off (no service-account key");

		const { json } = await serviceAccount("https://oauth2.googleapis.com/token");
		const broken = join(dir, "broken.json");
		await writeFile(broken, `${JSON.stringify(json).slice(0, -10)}`);
		expect(await loadFcmServiceAccount(broken, (line) => logs.push(line))).toBeUndefined();
		expect(logs.at(-1)).toContain("not valid JSON");

		const wrongType = join(dir, "wrong.json");
		await writeFile(wrongType, JSON.stringify({ ...json, type: "authorized_user" }));
		expect(await loadFcmServiceAccount(wrongType, (line) => logs.push(line))).toBeUndefined();
		const badKey = join(dir, "bad-key.json");
		await writeFile(badKey, JSON.stringify({ ...json, private_key: "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n" }));
		expect(await loadFcmServiceAccount(badKey, (line) => logs.push(line))).toBeUndefined();

		const good = join(dir, "good.json");
		await writeFile(good, JSON.stringify(json), { mode: 0o644 });
		const account = await loadFcmServiceAccount(good, (line) => logs.push(line));
		expect(account?.projectId).toBe("harness-test");
		expect(logs.at(-1)).toContain("FCM on for Firebase project harness-test");
		expect((await stat(good)).mode & 0o777).toBe(0o600);
		const body = json.private_key!.split("\n")[1]!;
		for (const line of logs) expect(line).not.toContain(body);
	});
});

describe("sending", () => {
	it("signs in once with a verified assertion and sends the payload as high-priority FCM data", async () => {
		const { google, account } = await googleWithKey();
		const sender = new FcmSender({ account, endpoint: google.url });
		const first = await sender.send({ token: "device-token", data: { payload: '{"kind":"test"}' }, ttlSeconds: 600 });
		const second = await sender.send({ token: "device-token", data: { payload: '{"kind":"reply"}' }, ttlSeconds: 600 });
		expect(first).toEqual({ status: 200, message: null, unregistered: false });
		expect(second.status).toBe(200);
		expect(google.assertions).toHaveLength(1);
		expect(google.assertions[0]).toMatchObject({ iss: account.clientEmail, scope: FCM_SCOPE, aud: google.tokenUri });
		const claims = google.assertions[0]!;
		expect((claims.exp as number) - (claims.iat as number)).toBe(3600);
		expect(google.messages[0]).toMatchObject({
			projectId: "harness-test",
			authorization: "Bearer access-1",
			body: { message: { token: "device-token", android: { priority: "HIGH", ttl: "600s" } } },
		});
		expect(google.messages[1]?.authorization).toBe("Bearer access-1");

		// A revoked access token is renewed once and the message goes through.
		google.revokeTokens();
		const third = await sender.send({ token: "device-token", data: { payload: "{}" }, ttlSeconds: 600 });
		expect(third.status).toBe(200);
		expect(google.messages.at(-1)?.authorization).toBe("Bearer access-2");
	});

	it("tells an unregistered token from a refusal", async () => {
		const { google, account } = await googleWithKey();
		const sender = new FcmSender({ account, endpoint: google.url });
		google.answer("gone", 404, "UNREGISTERED");
		google.answer("mismatch", 403, "SENDER_ID_MISMATCH");
		const gone = await sender.send({ token: "gone", data: {}, ttlSeconds: 60 });
		expect(gone).toMatchObject({ status: 404, unregistered: true });
		expect(gone.message).toContain("UNREGISTERED");
		const mismatch = await sender.send({ token: "mismatch", data: {}, ttlSeconds: 60 });
		expect(mismatch).toMatchObject({ status: 403, unregistered: false });
		expect(mismatch.message).toContain("SENDER_ID_MISMATCH");
	});

	it("filters, dedupes and drops FCM devices exactly like Web Push ones", async () => {
		const { google, account, dir } = await googleWithKey();
		const store = new NotificationStore({ dir });
		const state = new NotificationStateStore({ dir });
		const presence = new NotificationPresence();
		// 21:30Z is 23:30 in Bucharest in November.
		const notifier = new Notifier({
			store,
			state,
			presence,
			vapid: await createVapidKeys(),
			subject: "https://harness.test",
			fcm: new FcmSender({ account, endpoint: google.url }),
			now: () => Date.parse("2026-11-05T21:30:00Z"),
		});
		const register = (deviceId: string, change: Partial<NotificationPreferences> = {}) =>
			notifier.register({ deviceId, label: "Pixel", backendKey: "https://pc.example", fcmToken: `token-${deviceId}`, preferences: preferences(change) });
		expect((await register("plain")).transport).toBe("fcm");
		await register("muted", { mutedProjects: ["p1"] });
		await register("quiet", { quietHours: { start: "22:00", end: "07:00", timezone: "Europe/Bucharest", allowFailures: true } });
		await register("no-replies", { kinds: ["worker_failed"] });

		const reply = { kind: "reply" as const, title: "p replied", body: "Done.", projectId: "p1", taskId: "T4", key: "reply:p1:7" };
		const result = await notifier.deliver(reply);
		expect(result.deliveries.map((delivery) => delivery.deviceId)).toEqual(["plain"]);
		expect(google.messages.map((message) => message.body.message)).toMatchObject([{ token: "token-plain" }]);
		expect(google.messages[0]?.payload).toMatchObject({ kind: "reply", backendKey: "https://pc.example", projectId: "p1", taskId: "T4", tag: "reply:p1" });
		expect(await notifier.deliver(reply)).toEqual({ skipped: "duplicate", deliveries: [] });

		// Quiet hours let a failure through when the device allows it.
		const failure = await notifier.deliver({ kind: "worker_failed", title: "Worker failed", body: "x", projectId: "p1", workerId: "w1" });
		expect(failure.deliveries.map((delivery) => delivery.deviceId).sort()).toEqual(["no-replies", "plain", "quiet"]);

		// A token FCM forgot drops the device; the others stay.
		google.answer("token-plain", 404, "UNREGISTERED");
		const test = await notifier.test("plain");
		expect(test).toMatchObject({ ok: false, status: 404 });
		expect(notifier.device("plain")).toBeNull();
		expect(notifier.device("quiet")?.lastDelivery).toMatchObject({ ok: true, status: 200 });
		await notifier.flush();
		const saved = JSON.parse(await readFile(join(dir, "devices.json"), "utf8")) as { devices: Record<string, unknown>[] };
		expect(saved.devices.find((device) => device.deviceId === "quiet")).toMatchObject({ fcmToken: "token-quiet" });
		expect(saved.devices.find((device) => device.deviceId === "quiet")?.subscription).toBeUndefined();
	});
});

describe("the requests", () => {
	it("registers an FCM device, says which Firebase project it sends through and keeps it across a restart", async () => {
		const { google, keyFile } = await googleWithKey();
		const test = await createSetup({ notifications: { subject: "https://harness.test", fcmKeyFile: keyFile, fcmEndpoint: google.url } });
		cleanups.push(test.cleanup);
		const client = await TestClient.open(test.server);
		clients.push(client);
		const hello = await client.hello();
		if (hello.type !== "hello") throw errorOf(hello);
		expect(hello.features).toContain("fcm-push");

		const config = await client.request({ type: "notifications.config" });
		if (config.type !== "notifications.config") throw errorOf(config);
		expect(config.fcm).toEqual({ projectId: "harness-test" });

		const registered = await client.request({
			type: "notifications.registerFcm",
			deviceId: "android-1",
			label: "Pixel 9 · Harness",
			backendKey: "https://pc.example",
			token: "fcm-token-1",
			preferences: preferences(),
		});
		if (registered.type !== "notifications.registerFcm") throw errorOf(registered);
		expect(registered.device).toMatchObject({ deviceId: "android-1", transport: "fcm", lastDelivery: null });
		expect(JSON.stringify(registered)).not.toContain("fcm-token-1");

		const tested = await client.request({ type: "notifications.test", deviceId: "android-1" });
		if (tested.type !== "notifications.test") throw errorOf(tested);
		expect(tested).toMatchObject({ ok: true, status: 200, message: null });
		expect(google.messages[0]?.payload).toMatchObject({ kind: "test", backendKey: "https://pc.example", tag: "test" });

		client.close();
		const restarted = await test.restart();
		const again = await TestClient.open(restarted);
		clients.push(again);
		await again.hello();
		const device = await again.request({ type: "notifications.device", deviceId: "android-1" });
		if (device.type !== "notifications.device") throw errorOf(device);
		expect(device.device).toMatchObject({ transport: "fcm", lastDelivery: { ok: true, status: 200 } });
	}, 30_000);

	it("keeps FCM devices registered but unsent when the backend has no key", async () => {
		const test = await createSetup({ notifications: { subject: "https://harness.test" } });
		cleanups.push(test.cleanup);
		const client = await TestClient.open(test.server);
		clients.push(client);
		await client.hello();
		const config = await client.request({ type: "notifications.config" });
		if (config.type !== "notifications.config") throw errorOf(config);
		expect(config.fcm).toBeNull();
		const registered = await client.request({
			type: "notifications.registerFcm",
			deviceId: "android-1",
			label: "Pixel",
			backendKey: "pc",
			token: "fcm-token-1",
			preferences: preferences(),
		});
		expect(registered.type).toBe("notifications.registerFcm");
		const tested = await client.request({ type: "notifications.test", deviceId: "android-1" });
		if (tested.type !== "notifications.test") throw errorOf(tested);
		expect(tested).toEqual({ type: "notifications.test", id: tested.id, ok: false, status: null, message: FCM_OFF_MESSAGE });
		const device = await client.request({ type: "notifications.device", deviceId: "android-1" });
		if (device.type !== "notifications.device") throw errorOf(device);
		expect(device.device?.lastDelivery).toMatchObject({ ok: false, message: FCM_OFF_MESSAGE });
	}, 30_000);
});
