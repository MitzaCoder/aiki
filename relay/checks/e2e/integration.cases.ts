import { expect, test } from "bun:test";
import { queueAccountCleanup, resumeAccountCleanup } from "../../src/cleanup.ts";
import { enableAccount } from "../../src/operator.ts";
import { newRelayId } from "../../../packages/protocol/src/index.ts";
import { authClient, authSetup } from "../../../packages/server/test/device-auth-test-support.ts";
import { registerEmulatorChecks, fixture, httpCaptures, store, db, checkDependencies } from "../support.ts";

registerEmulatorChecks();

// Register our explicit enabled control after the relay suite's reset hook.
const { backend, connectPhone, enrollPhone, event, notifications, phoneRequest } = await import("./support.ts");

test("test push and notification stay encrypted through the real relay and reach the phone", async () => {
	const account = await enrollPhone();
	const target = await backend();
	const phone = await connectPhone(account, target);
	expect(await target.client.request({ type: "notifications.test", deviceId: phone.answer.deviceId })).toMatchObject({
		type: "notifications.test",
		ok: true,
		message: "accepted",
	});
	expect((await target.setup.server.notifications.deliver(event)).deliveries[0]?.message).toBe("accepted");
	const messages = notifications(account.token);
	expect(messages).toHaveLength(2);
	// HTTP writes and server attempts must share only the prefixed namespace.
	const collections = (await db.listCollections()).map((collection) => collection.id);
	for (const expected of ["relayAccounts", "relayInstallations", "relayRoutes", "relaySendAttempts"]) {
		expect(collections).toContain(expected);
	}
	for (const name of collections) expect(name).toStartWith("relay");
	expect((await phone.receive(messages[0]!)).payload.kind).toBe("test");
	expect((await phone.receive(messages[1]!)).payload).toMatchObject({
		title: event.title,
		body: event.body,
		threadId: event.threadId,
		backendKey: phone.registration.backendKey,
	});
	const visible = JSON.stringify([messages, target.gate.sends()]);
	for (const secret of [
		event.title,
		event.body,
		event.threadId,
		phone.registration.label,
		phone.registration.backendKey,
		phone.answer.backendId,
		phone.answer.sessionId,
	]) {
		expect(visible).not.toContain(secret);
	}
});

test("three backends keep independent routes and capabilities when one device is revoked", async () => {
	const account = await enrollPhone(fixture.google.idToken);
	const targets = await Promise.all([backend(), backend(), backend()]);
	const phones: Awaited<ReturnType<typeof connectPhone>>[] = [];
	for (const target of targets) phones.push(await connectPhone(account, target));
	expect(new Set(phones.map((phone) => phone.registration.phonePublicKey)).size).toBe(3);
	await targets[1]!.setup.server.notifications.deliver(event);
	const captured = targets[1]!.gate.sends()[0]!;
	const cross = await phoneRequest("send", JSON.parse(captured.body), phones[0]!.registration.sendBearer);
	expect(cross.status).toBe(404);
	await targets[0]!.setup.server.auth.revoke(targets[0]!.credentials.sessionId);
	await targets[0]!.tick(0);
	expect((await store.routes.doc(phones[0]!.registration.routeId).get()).exists).toBe(false);
	for (const index of [1, 2]) {
		expect((await targets[index]!.setup.server.notifications.deliver(event)).deliveries[0]?.message).toBe("accepted");
		const capture = notifications(account.token).findLast(
			(message) => JSON.parse(message.data.aiki).r === phones[index]!.registration.routeId,
		)!;
		expect((await phones[index]!.receive(capture)).payload.title).toBe(event.title);
	}
	for (const path of ["routes/create", "routes/renew"]) {
		const response = await phoneRequest(
			path,
			path.endsWith("create")
				? phones[0]!.create
				: {
						installationId: account.installationId,
						routeId: phones[0]!.registration.routeId,
					},
			phones[0]!.registration.sendBearer,
		);
		expect(response.status).toBe(401);
	}
	expect((await phoneRequest("routes/create", phones[0]!.create, account.identity)).status).not.toBe(200);
	expect((await store.routes.doc(phones[1]!.registration.routeId).get()).exists).toBe(true);
	expect((await store.routes.doc(phones[2]!.registration.routeId).get()).exists).toBe(true);
});

for (const operation of ["revoke", "sign-out", "unregister"] as const) {
	test(`${operation} stops sends and deletes only its route; a known removed route drops accepted messages`, async () => {
		const account = await enrollPhone();
		const target = await backend();
		const phone = await connectPhone(account, target);
		await target.setup.server.notifications.deliver(event);
		const accepted = notifications(account.token)[0]!;
		if (operation === "revoke") await target.setup.server.auth.revoke(target.credentials.sessionId);
		else if (operation === "sign-out") {
			expect(
				(await phoneRequest("installations/delete", { installationId: account.installationId }, account.identity))
					.status,
			).toBe(204);
			expect(
				await target.client.request({
					type: "notifications.syncRelay",
					routeId: phone.registration.routeId,
					unregister: true,
				}),
			).toMatchObject({ type: "notifications.syncRelay" });
		} else
			expect(
				await target.client.request({ type: "notifications.unregister", deviceId: phone.answer.deviceId }),
			).toMatchObject({ type: "notifications.unregister" });
		phone.removeLocally();
		await target.tick(0);
		expect((await store.routes.doc(phone.registration.routeId).get()).exists).toBe(false);
		await target.setup.server.notifications.deliver(event);
		expect(notifications(account.token)).toHaveLength(1);
		await expect(phone.receive(accepted)).rejects.toThrow("route removed");
	});
}

test("revoke during outage survives backend restart and completes deletion after recovery", async () => {
	const account = await enrollPhone();
	const target = await backend();
	const phone = await connectPhone(account, target);
	target.gate.setFault("down");
	await target.setup.server.auth.revoke(target.credentials.sessionId);
	await target.tick(0);
	expect(target.status()).toMatchObject({ state: "revoked", cleanup: "pending" });
	await target.setup.restart();
	target.gate.setFault("none");
	await target.tick(60000);
	expect(target.status()).toMatchObject({ state: "revoked", cleanup: "done" });
	expect((await store.routes.doc(phone.registration.routeId).get()).exists).toBe(false);
});

for (const fault of ["down", "timeout", "lost"] as const) {
	test(`${fault} reply retries identical bytes with backoff and displays once after recovery`, async () => {
		const account = await enrollPhone();
		const target = await backend(false, fault === "timeout" ? 200 : 10000);
		const phone = await connectPhone(account, target);
		target.gate.setFault(fault);
		expect((await target.setup.server.notifications.deliver(event)).deliveries[0]?.message).toBe("relay_unavailable");
		const first = target.gate.sends()[0]!.body;
		if (fault === "lost") await phone.receive(notifications(account.token)[0]!);
		target.gate.setFault("none");
		await target.tick(4999);
		expect(target.gate.sends()).toHaveLength(1);
		await target.tick(1);
		expect(target.gate.sends()[1]!.body).toBe(first);
		expect(notifications(account.token)).toHaveLength(1);
		if (fault === "lost") await expect(phone.receive(notifications(account.token)[0]!)).rejects.toThrow("replay");
		else expect((await phone.receive(notifications(account.token)[0]!)).payload.title).toBe(event.title);
	});
}

test("FCM 429 and 5xx retain the envelope and respect Retry-After before recovery", async () => {
	const account = await enrollPhone();
	const target = await backend();
	const phone = await connectPhone(account, target);
	for (const [failure, expected] of [
		["rate_limited", "fcm_rate_limited"],
		["unavailable", "fcm_unavailable"],
	] as const) {
		fixture.httpFcmResult = failure;
		expect((await target.setup.server.notifications.deliver(event)).deliveries[0]?.message).toBe(expected);
		const initial = target.gate.sends().at(-1)!.body;
		const attempts = await store.sendAttempts.get();
		const retry = attempts.docs.find((doc) => doc.data().state === "retry");
		expect(retry?.data().retryAt).toBeGreaterThan(Date.now());
		const before = httpCaptures.length;
		await target.tick(59999);
		expect(httpCaptures).toHaveLength(before);
		// Emulator fixture advances the durable retry deadline, not the function or phone implementation.
		await retry!.ref.update({ retryAt: Date.now() - 1, leaseUntil: Date.now() - 1 });
		fixture.httpFcmResult = "accepted";
		await target.tick(1);
		expect(target.gate.sends().at(-1)!.body).toBe(initial);
		expect((await phone.receive(notifications(account.token).at(-1)!)).payload.title).toBe(event.title);
	}
});

test("UNREGISTERED pauses the backend; a new token challenge resumes only future events", async () => {
	const account = await enrollPhone();
	const target = await backend();
	const phone = await connectPhone(account, target);
	fixture.httpFcmResult = "unregistered";
	expect((await target.setup.server.notifications.deliver(event)).deliveries[0]?.message).toBe("token_invalid");
	expect(target.status()).toMatchObject({ state: "paused", lastDelivery: "token_invalid" });
	const count = target.gate.sends().length;
	await target.setup.server.notifications.deliver(event);
	expect(target.gate.sends()).toHaveLength(count);
	fixture.httpFcmResult = "accepted";
	const replaced = await enrollPhone(account.identity, account.installationId, true);
	expect(
		await target.client.request({ type: "notifications.syncRelay", routeId: phone.registration.routeId, resume: true }),
	).toMatchObject({ type: "notifications.syncRelay" });
	await target.tick(60000);
	expect(notifications(replaced.token)).toHaveLength(0);
	await target.setup.server.notifications.deliver(event);
	expect((await phone.receive(notifications(replaced.token)[0]!)).payload.title).toBe(event.title);
});

for (const scope of ["route", "account"] as const) {
	test(`${scope} send limit reaches the backend with its scope and Retry-After`, async () => {
		const account = await enrollPhone();
		const target = await backend();
		await connectPhone(account, target);
		await store.control.doc("settings").set({ limits: { [`${scope}Minute`]: 1 } }, { merge: true });
		await target.setup.server.notifications.deliver(event);
		expect((await target.setup.server.notifications.deliver(event)).deliveries[0]?.message).toBe(`${scope}_rate`);
		const entry = target.setup.server.notifications.relay!.store.snapshot().sends[0]!;
		expect(entry.dueAt).toBeGreaterThan(target.clock.now);
		await target.tick(entry.dueAt - target.clock.now - 1);
		expect(target.gate.sends()).toHaveLength(2);
		expect(target.status().lastDelivery).toBe(`${scope}_rate`);
	});
}

test("missing control and kill switch preserve live queued work and still permit deletion", async () => {
	const account = await enrollPhone();
	const target = await backend();
	const phone = await connectPhone(account, target);
	await store.control.doc("settings").delete();
	expect((await target.setup.server.notifications.deliver(event)).deliveries[0]?.message).toBe("relay_disabled");
	expect(notifications(account.token)).toHaveLength(0);
	// Resume only enabled: absent enrollmentEnabled must remain closed, not inherit a permissive default.
	await store.control.doc("settings").set({ enabled: true }, { merge: true });
	const status = await phoneRequest("accounts/status", {}, account.identity);
	expect(await status.json()).toMatchObject({ relayEnabled: true, enrollmentEnabled: false });
	await target.tick(60000);
	expect((await phone.receive(notifications(account.token)[0]!)).payload.title).toBe(event.title);
	await store.control.doc("settings").set({ enabled: false }, { merge: true });
	await target.setup.server.auth.revoke(target.credentials.sessionId);
	await target.tick(0);
	expect(target.status().cleanup).toBe("done");
});

for (const operation of ["disabled", "deleted"] as const) {
	test(`account ${operation} stops sends and cannot revive routes`, async () => {
		const identity = operation === "disabled" ? fixture.other : fixture.google;
		const account = await enrollPhone(identity.idToken);
		const target = await backend();
		const phone = await connectPhone(account, target);
		if (operation === "disabled") await queueAccountCleanup(checkDependencies(), identity.localId, "disable");
		else
			expect((await phoneRequest("accounts/delete", { operationId: newRelayId() }, account.identity)).status).toBeOneOf(
				[200, 202],
			);
		const outcome = (await target.setup.server.notifications.deliver(event)).deliveries[0]!;
		expect(outcome.message).toBe(operation === "disabled" ? "account_disabled" : "not_found");
		expect(target.status().state).toBe("paused");
		await target.tick(60000);
		expect(notifications(account.token)).toHaveLength(0);
		if (operation === "disabled") {
			expect(await resumeAccountCleanup(checkDependencies(), identity.localId)).toBe(true);
			await enableAccount(checkDependencies(), identity.localId);
			expect(
				(await phoneRequest("send", JSON.parse(target.gate.sends()[0]!.body), phone.registration.sendBearer)).status,
			).toBe(404);
			expect((await store.routes.doc(phone.registration.routeId).get()).exists).toBe(false);
		} else expect((await phoneRequest("routes/create", phone.create, account.identity)).status).not.toBe(200);
	});
}

test("successor route replaces keys atomically and carries event dedupe across rotation", async () => {
	const account = await enrollPhone();
	const target = await backend();
	const old = await connectPhone(account, target);
	await target.setup.server.notifications.deliver(event);
	const first = notifications(account.token)[0]!;
	const admitted = await old.receive(first);
	const phone = await connectPhone(account, target, old);
	expect(() => phone.admission().admit(phone.registration.keyId, admitted, target.clock.now, () => undefined)).toThrow(
		"event_duplicate",
	);
	await target.tick(0);
	await target.setup.server.notifications.deliver(event);
	expect(notifications(account.token)).toHaveLength(2);
	expect((await phone.receive(notifications(account.token)[1]!)).payload.title).toBe(event.title);
	await expect(old.receive(first)).rejects.toThrow("replay");
	expect((await store.routes.doc(old.registration.routeId).get()).exists).toBe(false);
	expect(phone.registration.phonePublicKey).not.toBe(old.registration.phonePublicKey);
});

test("anonymous optional mode cannot register; a backend without relay stays unchanged", async () => {
	const account = await enrollPhone();
	const target = await backend(true);
	const phone = await connectPhone(account, target);
	const anonymous = await authClient(target.setup);
	expect(await anonymous.client.request({ type: "notifications.registerRelay", ...phone.registration })).toMatchObject({
		type: "error",
		error: { code: "auth_required" },
	});
	const absent = await authSetup({ auth: { mode: "optional" } });
	const { client, hello } = await authClient(absent);
	expect(hello).toMatchObject({ type: "hello" });
	if (hello.type !== "hello") throw new Error("Missing hello");
	expect(hello.features).not.toContain("fcm-relay-v1");
	expect(await client.request({ type: "notifications.config" })).toMatchObject({
		type: "notifications.config",
		fcm: null,
	});
	target.gate.setFault("down");
	await target.setup.server.notifications.deliver(event);
	expect(notifications(account.token)).toHaveLength(0);
	expect(target.setup.server.notifications.relay!.store.snapshot().sends).toHaveLength(1);
});

test("phone drops replay, tamper, wrong route and expired envelopes from captured FCM", async () => {
	const account = await enrollPhone();
	const target = await backend();
	const phone = await connectPhone(account, target);
	await target.setup.server.notifications.deliver(event);
	const capture = notifications(account.token)[0]!;
	const envelope = JSON.parse(capture.data.aiki) as { r: string; c: string };
	const changed = (patch: Partial<typeof envelope>) => ({
		...capture,
		data: { aiki: JSON.stringify({ ...envelope, ...patch }) },
	});
	await expect(
		phone.receive(changed({ c: (envelope.c[0] === "A" ? "B" : "A") + envelope.c.slice(1) })),
	).rejects.toThrow("authentication");
	await expect(phone.receive(changed({ r: newRelayId() }))).rejects.toThrow("route");
	await expect(phone.receive(capture, target.clock.now + 13 * 3600000)).rejects.toThrow("expired");
	await phone.receive(capture);
	await expect(phone.receive(capture)).rejects.toThrow("replay");
});
