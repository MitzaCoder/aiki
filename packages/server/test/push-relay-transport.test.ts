import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { relaySetup, simulatedPhone } from "./push-relay-support.ts";
import { authClient, httpEnroll } from "./device-auth-test-support.ts";

const event = { kind: "reply" as const, title: "Encrypted subject", body: "Encrypted preview", projectId: null };

test("relay success decrypts and admits; sequences increase; acceptance is not described as delivery", async () => {
	const f = await relaySetup();
	const phone = await simulatedPhone();
	const answer = await phone.activate(f.client);
	for (let i = 0; i < 3; i++) {
		expect((await f.setup.server.notifications.deliver(event)).deliveries).toMatchObject([{ ok: true, message: "accepted" }]);
		const plaintext = await phone.admit(f.relay.sends()[i]!, f.clock.now);
		expect(plaintext.sequence).toBe(String(i));
		expect(plaintext.payload).toMatchObject({ kind: "reply", title: event.title, body: event.body });
	}
	expect(await f.client.request({ type: "notifications.test", deviceId: answer.deviceId })).toMatchObject({
		type: "notifications.test", ok: true, message: "accepted",
	});
	expect(f.setup.server.notifications.relay!.store.snapshot().sends).toHaveLength(0);
	await f.setup.restart();
	await f.tick(60_000);
	expect(f.relay.sends()).toHaveLength(4);
});

test("lost acceptance reply retries identical HTTP bytes/message/nonce/event and phone admits once", async () => {
	const f = await relaySetup();
	const phone = await simulatedPhone();
	await phone.activate(f.client);
	f.relay.replies.push({ status: 200, lost: true });
	expect((await f.setup.server.notifications.deliver(event)).deliveries[0]?.message).toBe("relay_unavailable");
	await phone.admit(f.relay.sends()[0]!, f.clock.now);
	const initial = await phone.decrypt(f.relay.sends()[0]!);
	await f.tick(4999);
	expect(f.relay.sends()).toHaveLength(1);
	await f.tick(1);
	expect(f.relay.sends()).toHaveLength(2);
	expect(f.relay.sends()[1]!.body).toBe(f.relay.sends()[0]!.body);
	expect((await phone.decrypt(f.relay.sends()[1]!)).eventId).toBe(initial.eventId);
	await expect(phone.admit(f.relay.sends()[1]!, f.clock.now)).rejects.toThrow("replay");
	expect(f.setup.server.notifications.relay!.store.snapshot().sends).toHaveLength(0);
});

test("pending exact envelope survives restart and accepted events never replay", async () => {
	const f = await relaySetup();
	const phone = await simulatedPhone();
	await phone.activate(f.client);
	f.relay.replies.push({ status: 503 });
	await f.setup.server.notifications.deliver(event);
	const before = f.setup.server.notifications.relay!.store.snapshot().routes[0]!.nextSequence;
	await f.setup.restart();
	await f.tick(5000);
	expect(f.relay.sends()).toHaveLength(2);
	expect(f.relay.sends()[1]!.body).toBe(f.relay.sends()[0]!.body);
	expect(f.setup.server.notifications.relay!.store.snapshot().routes[0]!.nextSequence).toBe(before);
	await f.setup.restart();
	await f.tick(60_000);
	expect(f.relay.sends()).toHaveLength(2);
	await f.setup.server.notifications.deliver(event);
	expect((await phone.admit(f.relay.sends()[2]!, f.clock.now)).sequence).toBe("1");
});

for (const code of ["fcm_rate_limited", "route_rate", "account_rate", "ip_rate", "relay_capacity", "future_rate"]) {
	test(`429 ${code} respects Retry-After with identical envelope and safe rate-limited status`, async () => {
		const f = await relaySetup();
		const phone = await simulatedPhone();
		await phone.activate(f.client);
		f.relay.replies.push({ status: 429, code, retryAfter: "120" });
		expect((await f.setup.server.notifications.deliver(event)).deliveries[0]).toMatchObject({ ok: false, status: 429, message: "rate_limited" });
		expect(f.setup.server.notifications.relay!.status(f.credentials.sessionId).lastDelivery).toBe("rate_limited");
		await f.tick(119_999);
		expect(f.relay.sends()).toHaveLength(1);
		await f.tick(1);
		expect(f.relay.sends()).toHaveLength(2);
		expect(f.relay.sends()[1]!.body).toBe(f.relay.sends()[0]!.body);
	});
}

for (const code of ["fcm_unavailable", "relay_disabled", "future_unavailable"]) {
	test(`503 ${code} is transient, including unknown codes`, async () => {
		const f = await relaySetup();
		await (await simulatedPhone()).activate(f.client);
		f.relay.replies.push({ status: 503, code, retryAfter: new Date(f.clock.now + 30_000).toUTCString() });
		expect((await f.setup.server.notifications.deliver(event)).deliveries[0]?.message).toBe("relay_unavailable");
		await f.tick(29_999);
		expect(f.relay.sends()).toHaveLength(1);
		await f.tick(1);
		expect(f.relay.sends()).toHaveLength(2);
	});
}

for (const failure of [
	{ status: 404, code: "not_found", expected: "not_found" },
	{ status: 410, code: "route_expired", expected: "route_expired" },
	{ status: 410, code: "route_inactive", expected: "route_inactive" },
	{ status: 410, code: "token_invalid", expected: "token_invalid" },
	{ status: 410, code: "message_expired", expected: "message_expired" },
	{ status: 410, code: "account_deleted", expected: "account_deleted" },
	{ status: 403, code: "account_disabled", expected: "account_disabled" },
	{ status: 409, code: "message_conflict", expected: "message_conflict" },
	{ status: 400, code: "private upstream text", expected: "rejected" },
	{ status: 200, code: "token_invalid", state: "failed", expected: "token_invalid" },
]) {
	test(`terminal ${failure.status}/${failure.code} stops retries and records safe status`, async () => {
		const f = await relaySetup();
		const phone = await simulatedPhone();
		await phone.activate(f.client);
		f.relay.replies.push(failure);
		expect((await f.setup.server.notifications.deliver(event)).deliveries[0]?.message).toBe(failure.expected);
		expect(f.setup.server.notifications.relay!.status(f.credentials.sessionId).lastDelivery).toBe(failure.expected);
		await f.tick(60_000);
		expect(f.relay.sends()).toHaveLength(1);
		expect(f.setup.server.notifications.relay!.store.snapshot().sends).toHaveLength(0);
	});
}

test("timeouts, 500 and pending acceptance use bounded exponential retry with jitter", async () => {
	const f = await relaySetup({ notifications: { relayRandom: () => 0.5, relayRequestTimeoutMs: 50 } });
	await (await simulatedPhone()).activate(f.client);
	f.relay.replies.push({ status: 200, timeout: true }, { status: 500 }, { status: 200, state: "pending" });
	await f.setup.server.notifications.deliver(event);
	const next = () => f.setup.server.notifications.relay!.store.snapshot().sends[0]!.dueAt - f.clock.now;
	expect(next()).toBe(5500);
	await f.tick(5500);
	expect(next()).toBe(11000);
	await f.tick(11000);
	expect(f.setup.server.notifications.relay!.status(f.credentials.sessionId).lastDelivery).toBe("retrying");
	expect(next()).toBe(22000);
	await f.tick(22000);
	expect(f.relay.sends()).toHaveLength(4);
});

test("redirects are never followed and have safe unknown-acceptance status", async () => {
	const f = await relaySetup();
	await (await simulatedPhone()).activate(f.client);
	f.relay.replies.push({ status: 307, redirect: `${f.relay.endpoint}forbidden` });
	await f.setup.server.notifications.deliver(event);
	expect(f.relay.requests.every((r) => r.path === "/v1/send")).toBe(true);
	// Fetch redirect:error rejects; it is conservatively unknown acceptance, and retried without forwarding the bearer.
	expect(f.setup.server.notifications.relay!.status(f.credentials.sessionId).lastDelivery).toBe("relay_unavailable");
});

test("100-message cap drops newest without allocating a sequence, bounds retry delay, and stops at twelve hours", async () => {
	const f = await relaySetup();
	await (await simulatedPhone()).activate(f.client);
	for (let i = 0; i < 100; i++) {
		f.relay.replies.push({ status: 503 });
		await f.setup.server.notifications.deliver(event);
	}
	const store = f.setup.server.notifications.relay!.store;
	expect(store.snapshot().sends).toHaveLength(100);
	expect(store.snapshot().routes[0]!.nextSequence).toBe("100");
	expect((await f.setup.server.notifications.deliver(event)).deliveries[0]?.message).toBe("queue_full");
	expect(store.snapshot().routes[0]!.nextSequence).toBe("100");
	await store.transaction((draft) => {
		draft.sends = draft.sends.slice(0, 1);
		draft.sends[0]!.attempts = 30;
	});
	f.relay.replies.push({ status: 503 });
	await f.tick(5000);
	expect(store.snapshot().sends[0]!.dueAt - f.clock.now).toBe(900_000);
	await f.tick(43_200_000);
	expect(store.snapshot().sends).toHaveLength(0);
	expect(f.relay.sends()).toHaveLength(101);
}, 20_000);

test("queued sends obey new mutes, quiet hours, disabled kinds and revoke, and never drain after repair", async () => {
	for (const change of [
		{ kinds: [] }, { quietHours: { start: "00:00", end: "23:59", timezone: "UTC", allowFailures: false } },
		{ mutedProjects: ["synthetic-project"] },
	]) {
		const f = await relaySetup();
		const phone = await simulatedPhone();
		await phone.activate(f.client);
		f.relay.replies.push({ status: 503 });
		await f.setup.server.notifications.deliver({ ...event, projectId: "synthetic-project" });
		await f.client.request({ type: "notifications.syncRelay", routeId: phone.registration.routeId,
			preferences: { ...phone.registration.preferences, ...change } });
		await f.tick(5000);
		expect(f.relay.sends()).toHaveLength(1);
		expect(f.setup.server.notifications.relay!.store.snapshot().sends).toHaveLength(0);
	}
});

test("held events retain existing dedupe/interaction policy before any encryption", async () => {
	const f = await relaySetup();
	const phone = await simulatedPhone();
	const answer = await phone.activate(f.client);
	await f.client.request({ type: "notifications.presence", deviceId: answer.deviceId, visible: true, projectId: null });
	expect(await f.setup.server.notifications.deliver({ ...event, key: "synthetic-once" })).toMatchObject({ skipped: "held" });
	expect(await f.setup.server.notifications.deliver({ ...event, key: "synthetic-once" })).toMatchObject({ skipped: "duplicate" });
	await f.client.request({ type: "notifications.interaction", deviceId: answer.deviceId });
	await f.tick(15_000);
	expect(f.relay.sends()).toHaveLength(0);
	expect(f.setup.server.notifications.relay!.store.snapshot().routes[0]!.nextSequence).toBe("0");
	await f.setup.server.notifications.deliver(event);
	await f.tick(15_000);
	expect(f.relay.sends()).toHaveLength(1);
});

test("revoke during outage is local immediately; delete-only retries survive restart and erase secret after 204", async () => {
	const f = await relaySetup();
	const phone = await simulatedPhone();
	await phone.activate(f.client);
	f.relay.replies.push({ status: 503 });
	await f.setup.server.notifications.deliver(event);
	f.relay.deleteReplies.push({ status: 503 });
	await f.setup.server.auth.revoke(f.credentials.sessionId);
	const relay = f.setup.server.notifications.relay!;
	const before = relay.store.snapshot();
	expect(before.routes).toHaveLength(0);
	expect(before.sends).toHaveLength(0);
	expect(before.deletes[0]).toMatchObject({ routeId: phone.registration.routeId, deleteBearer: phone.registration.deleteBearer });
	expect(Object.keys(before.deletes[0]!).sort()).toEqual(["attempts", "deleteBearer", "dueAt", "routeId", "sessionId"]);
	expect(JSON.stringify(before)).not.toContain(phone.registration.sendBearer);
	expect(relay.status(f.credentials.sessionId)).toMatchObject({ state: "revoked", cleanup: "pending" });
	await f.tick(0);
	expect(f.relay.deletes()).toHaveLength(1);
	await f.setup.restart();
	await f.tick(5000);
	expect(f.relay.sends()).toHaveLength(1);
	expect(f.relay.deletes()).toHaveLength(2);
	expect(f.relay.deletes()[1]?.authorization).toBe(`Bearer ${phone.registration.deleteBearer}`);
	expect(f.setup.server.notifications.relay!.status(f.credentials.sessionId)).toMatchObject({ state: "revoked", cleanup: "done" });
	expect(await readFile(join(f.setup.dataDir, "notifications", "push-relay.json"), "utf8")).not.toContain(phone.registration.deleteBearer);
});

test("unregister and session expiry both leave delete-only cleanup, independent across three sessions", async () => {
	const f = await relaySetup();
	const phones = [await simulatedPhone(), await simulatedPhone(), await simulatedPhone()];
	const second = await authClient(f.setup, await httpEnroll(f.setup));
	const third = await authClient(f.setup, await httpEnroll(f.setup));
	const answers = [await phones[0]!.activate(f.client), await phones[1]!.activate(second.client), await phones[2]!.activate(third.client)];
	f.relay.replies.push({ status: 503 }, { status: 503 }, { status: 503 });
	await f.setup.server.notifications.deliver(event);
	expect(f.relay.sends()).toHaveLength(3);
	expect(await f.client.request({ type: "notifications.unregister", deviceId: answers[0]!.deviceId })).toMatchObject({ type: "notifications.unregister" });
	await f.tick(5000);
	expect(f.relay.sends()).toHaveLength(5);
	for (let i = 0; i < 3; i++) expect((await phones[i]!.decrypt(f.relay.sends()[i]!)).sessionId).toBe(answers[i]!.sessionId);
	await f.tick(181 * 86_400_000);
	expect(f.setup.server.notifications.relay!.store.snapshot().routes).toHaveLength(0);
	expect(f.relay.sends()).toHaveLength(5);
});
