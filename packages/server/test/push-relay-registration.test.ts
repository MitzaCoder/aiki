import { expect, test } from "bun:test";
import { HARNESS_FEATURES, newRelayId, newRelaySecret } from "@aiki/protocol";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { authClient, authSetup, httpEnroll } from "./device-auth-test-support.ts";
import { relayPreferences, relaySetup, simulatedPhone } from "./push-relay-support.ts";
import { resolvePushRelayEndpoint } from "../src/push-relay/settings.ts";
import type { RelayFile } from "../src/push-relay/store.ts";

const event = { kind: "reply" as const, title: "Private subject", body: "Private preview", projectId: null };

test("private relay setting accepts HTTPS and loopback only; no credentials, query or fragments", () => {
	expect(resolvePushRelayEndpoint({})).toBeUndefined();
	expect(resolvePushRelayEndpoint({ AIKI_PUSH_RELAY_ENDPOINT: "https://relay.example.com/v1" })).toBe("https://relay.example.com/v1/");
	for (const url of ["http://relay.example.com/v1", "ftp://relay.example.com", "https://secret@relay.example.com", "https://relay.example.com/?secret=x", "https://relay.example.com/#secret"])
		expect(() => resolvePushRelayEndpoint({ AIKI_PUSH_RELAY_ENDPOINT: url })).toThrow();
});

test("no relay setting: hello/config/direct FCM/Web Push remain unchanged and no relay files are created", async () => {
	const s = await authSetup({ auth: { mode: "optional" }, notifications: { fcmKeyFile: null, relayEndpoint: null } });
	const { client, hello } = await authClient(s);
	if (hello.type !== "hello") throw new Error("hello failed");
	expect(hello.features).not.toContain("fcm-relay-v1");
	expect(hello.features).toContain("fcm-push");
	expect(hello.features).toContain("notifications");
	const config = await client.request({ type: "notifications.config" });
	expect(config).toEqual({ type: "notifications.config", id: expect.any(String), publicKey: s.server.notifications.publicKey, fcm: null });
	expect((await client.request({ type: "notifications.registerFcm", deviceId: "direct", token: "synthetic-token",
		label: "Phone", backendKey: "backend", preferences: relayPreferences() })).type).toBe("notifications.registerFcm");
	expect(await client.request({ type: "notifications.test", deviceId: "direct" })).toMatchObject({
		type: "notifications.test", ok: false, message: "FCM is off on this backend (no service-account key)",
	});
	expect((await client.request({ type: "notifications.register", deviceId: "web", label: "Browser", backendKey: "backend",
		preferences: relayPreferences(), subscription: { endpoint: "https://push.example.com", keys: { p256dh: "synthetic", auth: "synthetic" } } })).type).toBe("notifications.register");
	expect(await client.request({ type: "notifications.test", deviceId: "web" })).toMatchObject({ type: "notifications.test", message: "Invalid push subscription" });
	const phone = await simulatedPhone();
	expect(await client.request({ type: "notifications.registerRelay", ...phone.registration })).toMatchObject({ type: "error", error: { code: "unknown_request" } });
	await s.server.notifications.flush();
	expect((await readdir(join(s.dataDir, "notifications"))).filter((f) => f.startsWith("push-relay"))).toEqual([]);
});

test("registration requires sign-in even in optional mode; no feature without device-auth negotiation", async () => {
	const f = await relaySetup({ auth: { mode: "optional" } });
	const phone = await simulatedPhone();
	const anonymous = await authClient(f.setup);
	expect(await anonymous.client.request({ type: "notifications.registerRelay", ...phone.registration })).toMatchObject({ type: "error", error: { code: "auth_required" } });
	expect(f.relay.requests).toHaveLength(0);
	const unsupported = await relaySetup({ features: HARNESS_FEATURES.filter((feature) => feature !== "device-auth-v1") });
	if (unsupported.hello.type !== "hello") throw new Error("hello failed");
	expect(unsupported.hello.features).not.toContain("fcm-relay-v1");
});

test("pending agreement survives crash, same operation returns same answer; mismatched retry is refused", async () => {
	const f = await relaySetup();
	const phone = await simulatedPhone();
	const { answer } = await phone.stage(f.client);
	expect(answer.sessionId).toBe(f.credentials.sessionId);
	expect(answer.backendId).toBe(f.setup.server.auth.backendId);
	expect(answer.serverTime).toBe(f.clock.now);
	expect(f.setup.server.notifications.relay!.status(f.credentials.sessionId).state).toBe("pending");
	await f.setup.server.notifications.deliver(event);
	expect(f.relay.sends()).toHaveLength(0);
	await f.setup.restart();
	const client = await f.reconnect();
	const retry = await client.request({ type: "notifications.registerRelay", ...phone.registration });
	expect(retry).toEqual({ ...answer, id: expect.any(String) });
	expect(await client.request({ type: "notifications.registerRelay", ...phone.registration, phonePublicKey: (await simulatedPhone()).registration.phonePublicKey })).toMatchObject({ type: "error" });
	expect(await client.request({ type: "notifications.registerRelay", ...phone.registration, salt: newRelaySecret() })).toMatchObject({ type: "error" });
	expect(await client.request({ type: "notifications.registerRelay", ...phone.registration, operationId: newRelayId() })).toMatchObject({ type: "error" });
	expect((await phone.activate(client)).sessionId).toBe(f.credentials.sessionId);
});

test("wrong confirmation and substituted transcript cannot activate; identity and reads belong to the session", async () => {
	const f = await relaySetup({ auth: { mode: "optional" } });
	const phone = await simulatedPhone();
	const { answer, confirmation } = await phone.stage(f.client);
	expect(await f.client.request({ type: "notifications.confirmRelay", operationId: phone.registration.operationId, confirmation: newRelaySecret() })).toMatchObject({ type: "error" });
	const other = await authClient(f.setup, await httpEnroll(f.setup));
	expect(await other.client.request({ type: "notifications.confirmRelay", operationId: phone.registration.operationId, confirmation })).toMatchObject({ type: "error" });
	const anonymous = await authClient(f.setup);
	for (const type of ["notifications.device", "notifications.test", "notifications.unregister"])
		expect(await anonymous.client.request({ type, deviceId: answer.deviceId })).toMatchObject({ type: "error", error: { code: "permission_denied" } });
	expect(await f.client.request({ type: "notifications.confirmRelay", operationId: phone.registration.operationId, confirmation })).toMatchObject({ type: "notifications.confirmRelay" });
	expect(f.setup.server.notifications.relay!.status(f.credentials.sessionId).state).toBe("active");
});

test("direct-to-relay switch and successor rotation each have one active transport, no fallback or historical replay", async () => {
	const f = await relaySetup();
	await f.client.request({ type: "notifications.registerFcm", deviceId: "old-direct", token: "synthetic-token", label: "Phone",
		backendKey: "backend", preferences: relayPreferences() });
	const phone = await simulatedPhone();
	const answer = await phone.activate(f.client);
	expect(f.setup.server.notifications.device("old-direct")).toBeNull();
	let result = await f.setup.server.notifications.deliver(event);
	expect(result.deliveries).toHaveLength(1);
	expect(result.deliveries[0]?.message).toBe("accepted");
	expect((await phone.admit(f.relay.sends()[0]!, f.clock.now)).payload.title).toBe(event.title);
	f.relay.replies.push({ status: 503 });
	await f.setup.server.notifications.deliver(event);
	const successor = await simulatedPhone(phone.registration.routeId);
	successor.inheritAdmission(phone);
	await successor.activate(f.client);
	await f.tick(5000);
	expect(f.relay.sends()).toHaveLength(2);
	result = await f.setup.server.notifications.deliver(event);
	expect(result.deliveries).toHaveLength(1);
	expect(JSON.parse(f.relay.sends()[2]!.body).routeId).toBe(successor.registration.routeId);
	expect(await successor.admit(f.relay.sends()[2]!, f.clock.now)).toMatchObject({ sessionId: f.credentials.sessionId, sequence: "0" });
	expect(f.setup.server.notifications.device(answer.deviceId)?.transport).toBe("fcm-relay");
});

test("secrets never appear in config/device/logs; storage and counters are private mode 0600", async () => {
	const f = await relaySetup();
	const phone = await simulatedPhone();
	const answer = await phone.activate(f.client);
	await f.setup.server.notifications.deliver(event);
	const config = await f.client.request({ type: "notifications.config" });
	const device = await f.client.request({ type: "notifications.device", deviceId: answer.deviceId });
	const publicText = JSON.stringify([config, device, f.logs]);
	const route = f.setup.server.notifications.relay!.store.snapshot().routes[0]!;
	for (const secret of [phone.registration.sendBearer, phone.registration.deleteBearer, phone.registration.phonePublicKey,
		phone.registration.salt, answer.backendPublicKey, ...Object.values(route.keys)]) expect(publicText).not.toContain(secret);
	for (const name of ["push-relay.json", "push-relay-counters.json"]) {
		const file = join(f.setup.dataDir, "notifications", name);
		expect((await stat(file)).mode & 0o777).toBe(0o600);
	}
	const relayText = JSON.stringify(f.relay.sends());
	for (const text of [event.title, event.body, phone.registration.backendKey, f.credentials.sessionId]) expect(relayText).not.toContain(text);
	expect(f.relay.sends()[0]?.contentType).toBe("application/octet-stream");
});

test("counter rollback against independent witness marks needs_new_keys and never encrypts again", async () => {
	const f = await relaySetup();
	const phone = await simulatedPhone();
	await phone.activate(f.client);
	const file = join(f.setup.dataDir, "notifications", "push-relay.json");
	await f.setup.server.notifications.deliver(event);
	await f.setup.server.stop();
	const stored = JSON.parse(await readFile(file, "utf8")) as RelayFile;
	stored.routes[0]!.nextSequence = "0";
	await writeFile(file, JSON.stringify(stored));
	await f.setup.restart();
	expect(f.setup.server.notifications.relay!.status(f.credentials.sessionId).state).toBe("needs_new_keys");
	expect((await f.setup.server.notifications.deliver(event)).deliveries[0]?.message).toBe("needs_new_keys");
	expect(f.relay.sends()).toHaveLength(1);
});
