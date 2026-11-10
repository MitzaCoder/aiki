import { expect, test } from "bun:test";
import { type FcmResult } from "../src/core";
import { fixture, store, random, call, assertStatus, begin, finish, enroll, route, payload, waitFor } from "./support";
import { DAY } from "../src/ports";
test("corrupt, reserved keys, wrong version/route and noncanonical base64 rejected before FCM", async () => {
	const phone = await enroll();
	const credentials = await route(phone.installationId);
	fixture.captures = [];
	for (const change of [
		{ v: 2 },
		{ r: random() },
		{ m: random() },
		{ k: "bad=" },
		{ n: random(16) },
		{ c: random(15) },
		{ c: "not+base64" },
		{ "google.foo": "reserved" },
		{ notification: "reserved" },
		{ extra: true },
	]) {
		const body = payload(credentials.routeId);
		Object.assign(body.envelope, change);
		expect((await call("send", body, credentials.send)).status).toBe(400);
	}
	expect(fixture.captures.length).toBe(0);
});
test("serialized data cap and HTTP body cap rejected before FCM; exact single aiki key and fixed options", async () => {
	const phone = await enroll();
	const credentials = await route(phone.installationId);
	fixture.captures = [];
	const tooLarge = payload(credentials.routeId);
	tooLarge.envelope.c = random(2600);
	expect((await call("send", tooLarge, credentials.send)).status).toBe(413);
	expect((await call("send", {}, credentials.send, { body: "x".repeat(4097) })).status).toBe(413);
	expect(fixture.captures.length).toBe(0);
	expect((await call("send", payload(credentials.routeId), credentials.send)).body?.state).toBe("accepted");
	expect(Object.keys(fixture.captures[0].data)).toEqual(["aiki"]);
	expect(fixture.captures[0].token).toBe(phone.token);
	expect(fixture.captures[0].priority).toBe("high");
	expect(fixture.captures[0].ttlMs).toBe(12 * 60 * 60000);
});
test("duplicate sends and lost HTTP reply reuse result; conflicting envelope gives 409; status is minimal", async () => {
	const phone = await enroll();
	const credentials = await route(phone.installationId);
	const body = payload(credentials.routeId);
	fixture.captures = [];
	const replies = await Promise.all([call("send", body, credentials.send), call("send", body, credentials.send)]);
	expect(replies.every((reply) => ["accepted", "pending"].includes(reply.body?.state ?? ""))).toBe(true);
	const retry = await call("send", body, credentials.send);
	expect(retry.body).toEqual({ state: "accepted", code: "accepted" });
	expect(fixture.captures.length).toBe(1);
	expect(
		(await call("send", { ...body, envelope: { ...body.envelope, c: random(32) } }, credentials.send)).status,
	).toBe(409);
	expect(
		(await call("send/status", { routeId: credentials.routeId, messageId: body.messageId }, credentials.send)).body,
	).toEqual(retry.body);
	expect(
		(await call("send/status", { routeId: credentials.routeId, messageId: random() }, credentials.send)).body,
	).toEqual({ state: "unknown" });
	const stored = (await store.sendAttempts.get()).docs[0].data();
	expect(Object.hasOwn(stored, "token")).toBe(false);
	expect(Object.hasOwn(stored, "envelope")).toBe(false);
	expect(stored.digest).toHaveLength(64);
});
test("crash after FCM acceptance and timeout lease retry same envelope only, never extend first TTL", async () => {
	const phone = await enroll();
	const credentials = await route(phone.installationId);
	const body = payload(credentials.routeId);
	fixture.captures = [];
	fixture.fcmBehavior = async () => {
		throw new Error("synthetic crash after acceptance");
	};
	expect((await call("send", body, credentials.send)).body?.state).toBe("pending");
	expect((await call("send", body, credentials.send)).body?.state).toBe("pending");
	expect(fixture.captures.length).toBe(1);
	fixture.now += 60001;
	fixture.fcmBehavior = async () => "timeout";
	const timeout = await call("send", body, credentials.send);
	expect(timeout.status).toBe(503);
	expect(timeout.body).toEqual({ error: "fcm_unavailable" });
	expect(timeout.headers["Retry-After"]).toBe("60");
	expect(fixture.captures.length).toBe(2);
	fixture.now += 60001;
	fixture.fcmBehavior = async () => "accepted";
	expect((await call("send", body, credentials.send)).body?.state).toBe("accepted");
	expect(fixture.captures[2].ttlMs).toBe(12 * 60 * 60000 - 120002);
	expect(fixture.captures[2].data).toEqual(fixture.captures[0].data);
});
test("FCM 429 and 5xx use fixed codes and do not invalidate tokens", async () => {
	const phone = await enroll();
	const credentials = await route(phone.installationId);
	for (const result of ["rate_limited", "unavailable"] as const) {
		fixture.fcmBehavior = async () => result;
		const response = await call("send", payload(credentials.routeId), credentials.send);
		expect(response.status).toBe(result === "rate_limited" ? 429 : 503);
		expect(response.headers["Retry-After"]).toBe("60");
		expect(response.body?.error).toBe(result === "rate_limited" ? "fcm_rate_limited" : "fcm_unavailable");
		expect((await store.installations.doc(phone.installationId).get()).data()?.state).toBe("active");
	}
});
test("UNREGISTERED purges only sent token generation; concurrent replacement survives stale failure", async () => {
	const phone = await enroll();
	const credentials = await route(phone.installationId);
	let release!: (value: FcmResult) => void;
	fixture.fcmBehavior = (message) =>
		message.priority === "normal"
			? Promise.resolve("accepted")
			: new Promise((resolve) => {
					release = resolve;
				});
	const sending = call("send", payload(credentials.routeId), credentials.send);
	await waitFor(() => !!release);
	const pending = await begin(phone.installationId, "synthetic-rotated-token", fixture.primary.idToken, true);
	assertStatus(await finish(pending));
	release("unregistered");
	expect((await sending).body?.code).toBe("token_invalid");
	expect((await store.installations.doc(phone.installationId).get()).data()?.token).toBe("synthetic-rotated-token");
	fixture.fcmBehavior = async () => "unregistered";
	expect((await call("send", payload(credentials.routeId), credentials.send)).body?.code).toBe("token_invalid");
	expect((await store.installations.doc(phone.installationId).get()).data()?.token).toBeNull();
	expect((await call("send", payload(credentials.routeId), credentials.send)).status).toBe(410);
});
test("remaining route lease caps TTL and message life expires from first reservation", async () => {
	const phone = await enroll();
	const credentials = await route(phone.installationId);
	fixture.now += 30 * DAY - 30000;
	expect((await call("send", payload(credentials.routeId), credentials.send)).body?.state).toBe("accepted");
	expect(fixture.captures.at(-1)?.ttlMs).toBe(30000);
	fixture.now -= 29 * DAY;
	const body = payload(credentials.routeId);
	fixture.fcmBehavior = async () => "timeout";
	await call("send", body, credentials.send);
	fixture.now += 12 * 60 * 60000 + 1;
	expect((await call("send", body, credentials.send)).body?.error).toBe("message_expired");
});
test("full flow logs contain no identity, body, tokens, credentials, challenge or ciphertext", async () => {
	const logs: string[] = [];
	const original = { ...console };
	for (const method of ["log", "info", "warn", "error", "debug"] as const)
		console[method] = (...args) => {
			logs.push(args.join(" "));
		};
	let sensitive: string[] = [];
	try {
		const phone = await enroll();
		const credentials = await route(phone.installationId);
		const body = payload(credentials.routeId);
		sensitive = [
			fixture.primary.idToken,
			fixture.primary.localId,
			phone.token,
			phone.nonce,
			phone.challengeId,
			credentials.send,
			credentials.deletion,
			body.envelope.c,
			JSON.stringify(body),
		];
		await call("send", body, credentials.send);
		await call("delete", { routeId: credentials.routeId }, credentials.deletion);
		await call("installations/delete", { installationId: phone.installationId });
	} finally {
		for (const method of ["log", "info", "warn", "error", "debug"] as const) console[method] = original[method];
	}
	for (const secret of sensitive) expect(logs.join("\n")).not.toContain(secret);
	expect(logs.join("\n")).not.toContain("@example.com");
});
test("transient 429/503 results retry the same digest only after retryAt, including status and first TTL", async () => {
	const phone = await enroll();
	const credentials = await route(phone.installationId);
	for (const outcome of ["rate_limited", "unavailable", "timeout"] as const) {
		const body = payload(credentials.routeId);
		fixture.captures = [];
		fixture.fcmBehavior = async () => outcome;
		const first = await call("send", body, credentials.send);
		expect(first.status).toBe(outcome === "rate_limited" ? 429 : 503);
		expect(first.headers["Retry-After"]).toBe("60");
		const second = await call("send", body, credentials.send);
		expect(second).toEqual(first);
		expect(fixture.captures.length).toBe(1);
		const status = await call("send/status", { routeId: body.routeId, messageId: body.messageId }, credentials.send);
		expect(status.body).toEqual({
			state: "retry",
			code: outcome === "rate_limited" ? "fcm_rate_limited" : "fcm_unavailable",
			retryAt: fixture.now + 60000,
		});
		expect(
			(await call("send", { ...body, envelope: { ...body.envelope, c: random(32) } }, credentials.send)).status,
		).toBe(409);
		fixture.now += 59000;
		expect((await call("send", body, credentials.send)).headers["Retry-After"]).toBe("1");
		expect(fixture.captures.length).toBe(1);
		fixture.now += 1000;
		fixture.fcmBehavior = async () => "accepted";
		expect((await call("send", body, credentials.send)).body?.state).toBe("accepted");
		expect(fixture.captures.length).toBe(2);
		expect(fixture.captures[1].data).toEqual(fixture.captures[0].data);
		expect(fixture.captures[1].ttlMs).toBe(12 * 60 * 60000 - 60000);
		expect((await call("send", body, credentials.send)).body?.state).toBe("accepted");
		expect(fixture.captures.length).toBe(2);
	}
});
test("in-flight attempt is pending with Retry-After; terminal invalid-token results remain queryable", async () => {
	const phone = await enroll();
	const credentials = await route(phone.installationId);
	const body = payload(credentials.routeId);
	let release!: (result: FcmResult) => void;
	fixture.fcmBehavior = () =>
		new Promise((resolve) => {
			release = resolve;
		});
	const first = call("send", body, credentials.send);
	await waitFor(() => Boolean(release));
	const pending = await call("send", body, credentials.send);
	expect(pending.body).toEqual({ state: "pending" });
	expect(pending.headers["Retry-After"]).toBe("60");
	const status = await call("send/status", { routeId: body.routeId, messageId: body.messageId }, credentials.send);
	expect(status.body).toEqual({ state: "pending" });
	expect(status.headers["Retry-After"]).toBe("60");
	release("unregistered");
	expect((await first).body).toEqual({ state: "failed", code: "token_invalid" });
	expect((await call("send", body, credentials.send)).body).toEqual({ state: "failed", code: "token_invalid" });
	expect(
		(await call("send/status", { routeId: body.routeId, messageId: body.messageId }, credentials.send)).body,
	).toEqual({ state: "failed", code: "token_invalid" });
	fixture.now += 12 * 60 * 60000;
	expect((await call("send", body, credentials.send)).body?.error).toBe("message_expired");
});
