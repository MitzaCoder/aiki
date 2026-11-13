import { expect, test } from "bun:test";
import { HARNESS_FEATURES } from "@kemiri/protocol";
import { relayPreferences, relaySetup, simulatedPhone } from "./push-relay-support.ts";

const event = { kind: "reply" as const, title: "Synthetic subject", body: "Synthetic body", projectId: null };

test("unregister blocks sends before a slow local write and preserves only delete-only work", async () => {
	const f = await relaySetup();
	const phone = await simulatedPhone();
	await phone.activate(f.client);
	const relay = f.setup.server.notifications.relay!;
	let release = () => {};
	const blocked = relay.store.transaction(async () => {
		await new Promise<void>((resolve) => { release = resolve; });
	});
	// Let the transaction enter its asynchronous local-write stand-in.
	await Bun.sleep(0);
	const unregister = relay.revoke(f.credentials.sessionId);
	const result = await f.setup.server.notifications.deliver(event);
	expect(result.deliveries[0]?.message).toBe("auth_revoked");
	expect(f.relay.sends()).toHaveLength(0);
	release();
	await blocked;
	await unregister;
	expect(relay.store.snapshot().routes).toHaveLength(0);
	expect(relay.store.snapshot().deletes).toHaveLength(1);
});

test("wrong-secret deletion is never called complete; Retry-After is honored and capability erased only after 204", async () => {
	const f = await relaySetup();
	const phone = await simulatedPhone();
	await phone.activate(f.client);
	f.relay.deleteReplies.push({ status: 404 }, { status: 503, retryAfter: "60" });
	await f.client.request({ type: "notifications.syncRelay", routeId: phone.registration.routeId, unregister: true });
	await f.tick(0);
	expect(f.relay.deletes()).toHaveLength(1);
	expect(f.setup.server.notifications.relay!.status(f.credentials.sessionId).cleanup).toBe("pending");
	await f.tick(5000);
	expect(f.relay.deletes()).toHaveLength(2);
	await f.tick(59_999);
	expect(f.relay.deletes()).toHaveLength(2);
	await f.tick(1);
	expect(f.relay.deletes()).toHaveLength(3);
	expect(f.setup.server.notifications.relay!.status(f.credentials.sessionId).cleanup).toBe("done");
	// A lost unregister reply is safely repeatable even after cleanup completed and its secret was erased.
	expect(await f.client.request({ type: "notifications.syncRelay", routeId: phone.registration.routeId, unregister: true }))
		.toMatchObject({ type: "notifications.syncRelay", relay: { cleanup: "done" }, serverTime: f.clock.now });
});

test("lease expiry cancels queued retries, retains safe expired status and queues deletion", async () => {
	const f = await relaySetup();
	const phone = await simulatedPhone();
	phone.registration.leaseExpiresAt = f.clock.now + 1000;
	await phone.activate(f.client);
	f.relay.replies.push({ status: 503 });
	await f.setup.server.notifications.deliver(event);
	await f.tick(1000);
	expect(f.relay.sends()).toHaveLength(1);
	expect(f.setup.server.notifications.relay!.status(f.credentials.sessionId)).toMatchObject({
		state: "revoked", lastDelivery: "route_expired",
	});
	expect(f.relay.deletes()).toHaveLength(1);
});

test("phone lease sync cannot exceed absolute expiry; pending registration cannot send and expires in ten minutes", async () => {
	const f = await relaySetup();
	const phone = await simulatedPhone();
	await phone.stage(f.client);
	expect(await f.client.request({ type: "notifications.syncRelay", routeId: phone.registration.routeId,
		leaseExpiresAt: phone.registration.absoluteExpiresAt + 1 })).toMatchObject({ type: "error", error: { code: "bad_request" } });
	expect(await f.client.request({ type: "notifications.syncRelay", routeId: phone.registration.routeId,
		leaseExpiresAt: phone.registration.leaseExpiresAt + 1000 })).toMatchObject({ type: "notifications.syncRelay", serverTime: f.clock.now });
	await f.tick(600_000);
	expect(f.setup.server.notifications.relay!.store.snapshot().routes).toHaveLength(0);
	expect(f.relay.sends()).toHaveLength(0);
	expect(f.relay.deletes()).toHaveLength(1);
});

test("an archived project cannot drain an existing ciphertext retry", async () => {
	const f = await relaySetup();
	await (await simulatedPhone()).activate(f.client);
	const added = await f.client.request({ type: "projects.add", path: f.setup.projectDir });
	if (added.type !== "projects.add") throw new Error("project failed");
	f.relay.replies.push({ status: 503 });
	await f.setup.server.notifications.deliver({ ...event, projectId: added.project.id });
	expect((await f.client.request({ type: "projects.configure", projectId: added.project.id, archived: true })).type).toBe("projects.configure");
	await f.tick(5000);
	expect(f.relay.sends()).toHaveLength(1);
	expect(f.setup.server.notifications.relay!.store.snapshot().sends).toHaveLength(0);
});

test("a transport switch during an in-flight direct push does not also send the event over the new relay", async () => {
	let entered = () => {};
	let release = () => {};
	const reached = new Promise<void>((resolve) => { entered = resolve; });
	const held = new Promise<void>((resolve) => { release = resolve; });
	const f = await relaySetup({ notifications: { send: async () => {
		entered();
		await held;
		return { status: 201, message: null };
	} } });
	// Valid Web Push public key/auth material from a generated phone; only the fake transport consumes ciphertext.
	const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
	const publicKey = Buffer.from(await crypto.subtle.exportKey("raw", pair.publicKey)).toString("base64url");
	await f.client.request({ type: "notifications.register", deviceId: "old-browser", label: "Synthetic browser",
		backendKey: "backend", preferences: relayPreferences(), subscription: { endpoint: "https://push.example.com/path",
			keys: { p256dh: publicKey, auth: Buffer.alloc(16, 1).toString("base64url") } } });
	const sending = f.setup.server.notifications.deliver(event);
	await reached;
	try {
		await (await simulatedPhone()).activate(f.client);
	} finally {
		release();
	}
	expect((await sending).deliveries).toHaveLength(1);
	expect(f.relay.sends()).toHaveLength(0);
});

test("concurrent explicit direct selection and relay confirmation serialize to one active transport", async () => {
	const f = await relaySetup();
	const phone = await simulatedPhone();
	const staged = await phone.stage(f.client);
	await Promise.all([
		f.setup.server.notifications.confirmRelay(f.credentials.sessionId, {
			type: "notifications.confirmRelay", id: "synthetic-confirm", operationId: phone.registration.operationId,
			confirmation: staged.confirmation,
		}),
		f.setup.server.notifications.register({ deviceId: "explicit-direct", sessionId: f.credentials.sessionId,
			label: "Synthetic phone", backendKey: "backend", preferences: relayPreferences(), fcmToken: "synthetic-token" }),
	]);
	const relay = f.setup.server.notifications.relay!;
	expect(relay.devices()).toHaveLength(0);
	expect(relay.store.selected(f.credentials.sessionId)).toBe(false);
	expect((await f.setup.server.notifications.deliver(event)).deliveries).toHaveLength(1);
	expect(f.relay.sends()).toHaveLength(0);
});

test("legacy client on a relay-capable backend can continue direct FCM without any relay traffic", async () => {
	const f = await relaySetup();
	await f.client.request({ type: "notifications.registerFcm", deviceId: "old-phone", label: "Old phone", backendKey: "backend",
		token: "synthetic-token", preferences: relayPreferences() });
	expect((await f.setup.server.notifications.deliver(event)).deliveries[0]?.message).toBe("FCM is off on this backend (no service-account key)");
	expect(f.relay.requests).toHaveLength(0);
	expect(f.setup.server.features).toContain("fcm-relay-v1");
	expect(HARNESS_FEATURES).toContain("fcm-relay-v1");
});

test("token repair resumes only future events without unnecessary rekey or replaying the failed outbox", async () => {
	const f = await relaySetup();
	const phone = await simulatedPhone();
	const staged = await phone.stage(f.client);
	await phone.activate(f.client);
	f.relay.replies.push({ status: 410, code: "token_invalid" });
	await f.setup.server.notifications.deliver(event);
	expect(f.setup.server.notifications.relay!.status(f.credentials.sessionId).state).toBe("paused");
	await f.setup.server.notifications.deliver(event);
	expect(f.relay.sends()).toHaveLength(1);
	// A duplicate confirmation is only a receipt, not permission to resume a paused route.
	await f.client.request({ type: "notifications.confirmRelay", operationId: phone.registration.operationId,
		confirmation: staged.confirmation });
	expect(f.setup.server.notifications.relay!.status(f.credentials.sessionId).state).toBe("paused");
	expect(await f.client.request({ type: "notifications.syncRelay", routeId: phone.registration.routeId, resume: true }))
		.toMatchObject({ type: "notifications.syncRelay", relay: { state: "active" } });
	await f.tick(60_000);
	expect(f.relay.sends()).toHaveLength(1);
	await f.setup.server.notifications.deliver(event);
	expect(f.relay.sends()).toHaveLength(2);
	expect((await phone.admit(f.relay.sends()[1]!, f.clock.now)).sequence).toBe("1");
});

test("repeated activation of the predecessor never deletes a staged successor", async () => {
	const f = await relaySetup();
	const phone = await simulatedPhone();
	const staged = await phone.stage(f.client);
	await phone.activate(f.client);
	const successor = await simulatedPhone(phone.registration.routeId);
	await successor.stage(f.client);
	await f.client.request({ type: "notifications.confirmRelay", operationId: phone.registration.operationId,
		confirmation: staged.confirmation });
	expect(f.setup.server.notifications.relay!.store.snapshot().routes).toHaveLength(2);
	await successor.activate(f.client);
	expect(f.setup.server.notifications.relay!.store.snapshot().routes).toHaveLength(1);
});
