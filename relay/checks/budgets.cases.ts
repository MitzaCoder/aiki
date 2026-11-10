import { expect, test } from "bun:test";
import { createRelay } from "../src/core";
import { readControl } from "../src/control";
import { DEFAULT_LIMITS } from "../src/limits";
import { windowStart } from "../src/budgets";
import { DAY, MINUTE } from "../src/ports";
import {
	fixture,
	store,
	db,
	auth,
	random,
	enroll,
	begin,
	finish,
	route,
	payload,
	call,
	checkDependencies,
	restartHandler,
	emailUser,
} from "./support";
import { deleteAccount } from "../src/accounts";

async function settings(limits: Partial<typeof DEFAULT_LIMITS>) {
	await store.control.doc("settings").set({
		enabled: true,
		enrollmentEnabled: true,
		limits: {
			managementMinute: 10000,
			managementDay: 10000,
			requestMinute: 10000,
			accountChallengeHour: 10000,
			accountChallengeDay: 10000,
			ipChallengeHour: 10000,
			ipChallengeDay: 10000,
			newAccountIpDay: 10000,
			...limits,
		},
	});
}

test("missing control pauses both switches with pilot limits; malformed/unreadable control fails closed before FCM", async () => {
	await store.control.doc("settings").delete();
	expect((await readControl(store)).limits).toEqual(DEFAULT_LIMITS);
	expect((await readControl(store)).enabled).toBe(false);
	expect((await readControl(store)).enrollmentEnabled).toBe(false);
	await db.collection("relayControl").doc("settings").set({ enabled: "invalid" });
	expect((await call("accounts/status")).status).toBe(503);
	const broken = new Proxy(db, {
		get(target, property) {
			if (property === "runTransaction")
				return async () => {
					throw new Error("synthetic storage outage");
				};
			const value: unknown = Reflect.get(target, property);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
	const handler = createRelay(checkDependencies({ firestore: broken }));
	const response = await handler({
		method: "POST",
		path: "/v1/accounts/status",
		body: "{}",
		clientIp: "127.0.0.1",
		contentType: "application/octet-stream",
		authorization: "Bearer " + fixture.primary.idToken,
	});
	expect(response.body).toEqual({ error: "relay_unavailable" });
	expect(fixture.captures.length).toBe(0);
});

test("transactional send ceilings have exactly one allowance under concurrency and survive an instance restart", async () => {
	await settings({ routeMinute: 3, routeDay: 500, accountMinute: 60 });
	const phone = await enroll();
	const credentials = await route(phone.installationId);
	fixture.captures = [];
	const replies = await Promise.all(
		Array.from({ length: 8 }, () => call("send", payload(credentials.routeId), credentials.send)),
	);
	expect(replies.filter((reply) => reply.body?.state === "accepted").length).toBe(3);
	expect(replies.filter((reply) => reply.body?.error === "route_rate").length).toBe(5);
	expect(fixture.captures.length).toBe(3);
	restartHandler();
	const stopped = await call("send", payload(credentials.routeId), credentials.send);
	expect(stopped.status).toBe(429);
	expect(stopped.body?.error).toBe("route_rate");
	expect(Number(stopped.headers["Retry-After"])).toBeGreaterThan(0);
}, 60_000);

test("fixed UTC minute windows enforce N per window and at most 2N across any sliding minute", async () => {
	await settings({ routeMinute: 2 });
	const phone = await enroll();
	const credentials = await route(phone.installationId);
	fixture.now = windowStart(fixture.now, MINUTE) + MINUTE - 1;
	for (let count = 0; count < 2; count++)
		expect((await call("send", payload(credentials.routeId), credentials.send)).status).toBe(200);
	expect((await call("send", payload(credentials.routeId), credentials.send)).body?.error).toBe("route_rate");
	fixture.now += 2;
	for (let count = 0; count < 2; count++)
		expect((await call("send", payload(credentials.routeId), credentials.send)).status).toBe(200);
	expect((await call("send", payload(credentials.routeId), credentials.send)).body?.error).toBe("route_rate");
});

test("IP/NAT and global daily scopes survive route/phone/UID churn, then reset on the UTC day", async () => {
	await settings({ ipDay: 2, relaySendDay: 2, newAccountDay: 20 });
	const first = await enroll();
	const a = await route(first.installationId);
	const b = await route(first.installationId);
	for (const credentials of [a, b])
		expect((await call("send", payload(credentials.routeId), credentials.send)).status).toBe(200);
	const failed = await call("send", payload(a.routeId), a.send);
	expect(failed.status).toBe(429);
	expect(["ip_rate", "relay_capacity"]).toContain(failed.body?.error ?? "");
	expect(Number(failed.headers["Retry-After"])).toBe(
		Math.ceil((windowStart(fixture.now, DAY) + DAY - fixture.now) / 1000),
	);
	await call("installations/delete", { installationId: first.installationId });
	const second = await enroll();
	const c = await route(second.installationId);
	expect((await call("send", payload(c.routeId), c.send)).status).toBe(429);
	const user = await emailUser();
	const third = await enroll(random(), undefined, user.idToken);
	const d = await route(third.installationId, user.idToken);
	expect((await call("send", payload(d.routeId), d.send)).status).toBe(429);
	const oldKey = (await store.runtime.doc("state").get()).data()!.ipKey;
	fixture.now = windowStart(fixture.now, DAY) + DAY + 1;
	expect((await call("send", payload(d.routeId), d.send)).status).toBe(200);
	expect((await store.runtime.doc("state").get()).data()!.ipKey).not.toBe(oldKey);
	const buckets = await store.rateLimits.get();
	for (const row of buckets.docs.filter((row) => row.id.startsWith("ip-"))) {
		expect(JSON.stringify(row.data())).not.toContain("127.0.0.1");
		expect(row.data().purgeAt.toMillis() - row.data().day).toBe(DAY);
	}
});

test("account sends persist across route rotation and phone removal; retries charge external attempts but lookups do not", async () => {
	await settings({ accountDay: 2 });
	const phone = await enroll();
	const first = await route(phone.installationId);
	const body = payload(first.routeId);
	fixture.fcmBehavior = async () => "unavailable";
	expect((await call("send", body, first.send)).status).toBe(503);
	expect((await call("send", body, first.send)).status).toBe(503);
	await call("send/status", { routeId: body.routeId, messageId: body.messageId }, first.send);
	fixture.now += MINUTE;
	fixture.fcmBehavior = async () => "accepted";
	expect((await call("send", body, first.send)).body?.state).toBe("accepted");
	expect((await call("send", body, first.send)).body?.state).toBe("accepted");
	const next = await route(phone.installationId, fixture.primary.idToken, first.routeId);
	expect((await call("send", payload(next.routeId), next.send)).body?.error).toBe("account_rate");
	await call("installations/delete", { installationId: phone.installationId });
	const replacement = await enroll();
	const route2 = await route(replacement.installationId);
	expect((await call("send", payload(route2.routeId), route2.send)).body?.error).toBe("account_rate");
});

test("invalid-proof floods share one bounded IP bucket, and status/duplicates spend request allowance", async () => {
	await settings({ requestMinute: 3 });
	for (let count = 0; count < 3; count++) {
		const id = random();
		expect((await call("send", payload(id), "aiki_push1." + id + "." + random(32))).status).toBe(404);
	}
	for (let count = 0; count < 20; count++) {
		const id = random();
		expect((await call("send", payload(id), "aiki_push1." + id + "." + random(32))).body?.error).toBe("request_rate");
	}
	expect((await store.rateLimits.get()).size).toBe(1);
	expect((await store.sendAttempts.get()).size).toBe(0);
});

test("replacement, failed and expired challenges spend account/IP/global allowance; begin retries do not", async () => {
	await settings({ accountChallengeHour: 2 });
	fixture.now = windowStart(fixture.now, 60 * MINUTE) + 1;
	const first = await begin();
	const retry = await call("installations/begin", {
		installationId: first.installationId,
		operationId: first.operationId,
		token: first.token,
	});
	expect(retry.status).toBe(200);
	const second = await begin(first.installationId, first.token);
	expect((await finish(first)).status).toBe(409);
	fixture.now += 300_001;
	expect((await finish(second)).status).toBe(409);
	const blocked = await call("installations/begin", {
		installationId: random(),
		operationId: random(),
		token: "synthetic-later",
	});
	expect(blocked.status).toBe(429);
	expect(blocked.body?.error).toBe("challenge_rate");
});

test("new-account caps do not refund after deletion; direct Auth signup bypasses relay signup caps", async () => {
	await settings({ newAccountIpDay: 1 });
	const user = await emailUser();
	await enroll(random(), undefined, user.idToken);
	const deleted = await deleteAccount(checkDependencies(), await auth.verifyIdToken(user.idToken, true), {
		operationId: random(),
	});
	expect(deleted.body.state).toBe("deleted");
	const other = await emailUser();
	expect((await auth.getUser(other.localId)).disabled).toBe(false);
	const blocked = await call(
		"installations/begin",
		{ installationId: random(), operationId: random(), token: "synthetic-new" },
		other.idToken,
	);
	expect(blocked.body?.error).toBe("enrollment_capacity");
	expect((await store.accounts.get()).size).toBe(0);
}, 30_000);

test("global account and phone capacity reservations compose, and expired phone reservations release capacity", async () => {
	await settings({ activeAccounts: 1, activePhones: 1 });
	await begin();
	const other = await emailUser();
	const request = { installationId: random(), operationId: random(), token: "synthetic-second" };
	expect((await call("installations/begin", request, other.idToken)).body?.error).toBe("enrollment_capacity");
	expect((await call("installations/begin", request)).body?.error).toBe("enrollment_capacity");
	fixture.now += 300_001;
	expect((await call("installations/begin", request)).status).toBe(200);
});

test("management request budgets are IP-scoped, while deletion is exempt with every budget exhausted", async () => {
	const phone = await enroll();
	const credentials = await route(phone.installationId);
	await store.control.doc("settings").set({
		enabled: false,
		enrollmentEnabled: false,
		limits: Object.fromEntries(Object.keys(DEFAULT_LIMITS).map((key) => [key, 0])),
	});
	expect((await call("accounts/status")).status).toBe(429);
	expect((await call("send", payload(credentials.routeId), credentials.send)).body?.error).toBe("relay_disabled");
	expect((await call("delete", { routeId: credentials.routeId }, credentials.deletion)).status).toBe(204);
	expect(
		(await call("routes/delete", { installationId: phone.installationId, routeId: credentials.routeId })).status,
	).toBe(204);
	expect((await call("installations/delete", { installationId: phone.installationId })).status).toBe(204);
	const user = await emailUser();
	expect((await call("accounts/delete", { operationId: random() }, user.idToken)).status).toBe(200);
});

test("kill and enrollment switches stop only their specified operations, including a final pre-FCM recheck", async () => {
	const phone = await enroll();
	const credentials = await route(phone.installationId);
	await store.control.doc("settings").set({ enabled: true, enrollmentEnabled: false });
	expect(
		(await call("installations/begin", { installationId: random(), operationId: random(), token: "synthetic-new" }))
			.body?.error,
	).toBe("enrollment_disabled");
	const replacement = await begin(phone.installationId, "synthetic-token-replacement", fixture.primary.idToken, true);
	expect((await finish(replacement)).status).toBe(200);
	expect((await call("send", payload(credentials.routeId), credentials.send)).status).toBe(200);
	await store.control.doc("settings").set({ enabled: false });
	expect((await call("send", payload(credentials.routeId), credentials.send)).body?.error).toBe("relay_disabled");
	expect(
		(await call("routes/renew", { installationId: phone.installationId, routeId: credentials.routeId })).body?.error,
	).toBe("relay_disabled");
	await store.control.doc("settings").set({ enabled: true, enrollmentEnabled: true });
	let checks = 0;
	restartHandler({
		auth: {
			...checkDependencies().auth,
			verifyIdToken: (token, revoked) => auth.verifyIdToken(token, revoked),
			getUser: async (uid) => {
				checks++;
				if (checks === 2) await store.control.doc("settings").set({ enabled: false });
				return auth.getUser(uid);
			},
			updateUser: (uid, properties) => auth.updateUser(uid, properties),
			revokeRefreshTokens: (uid) => auth.revokeRefreshTokens(uid),
			deleteUser: (uid) => auth.deleteUser(uid),
		},
	});
	const before = fixture.captures.length;
	expect((await call("send", payload(credentials.routeId), credentials.send)).body?.error).toBe("relay_disabled");
	expect(fixture.captures.length).toBe(before);
});

test("management/NAT minute and daily windows compose across different UIDs with reset times", async () => {
	await settings({ managementMinute: 2, managementDay: 3 });
	const other = await emailUser();
	expect((await call("accounts/status")).status).toBe(200);
	expect((await call("accounts/status", {}, other.idToken)).status).toBe(200);
	const minute = await call("accounts/status");
	expect(minute.body?.error).toBe("ip_rate");
	expect(minute.body?.retryAt).toBe(windowStart(fixture.now, MINUTE) + MINUTE);
	fixture.now = windowStart(fixture.now, MINUTE) + MINUTE;
	expect((await call("accounts/status")).status).toBe(200);
	const daily = await call("accounts/status", {}, other.idToken);
	expect(daily.body?.error).toBe("ip_rate");
	expect(daily.body?.retryAt).toBe(windowStart(fixture.now, DAY) + DAY);
});

test("status and identical completed lookups consume coarse request allowance but never new sends", async () => {
	const phone = await enroll();
	const credentials = await route(phone.installationId);
	const body = payload(credentials.routeId);
	await settings({ requestMinute: 3 });
	fixture.now = windowStart(fixture.now, MINUTE) + MINUTE;
	expect((await call("send", body, credentials.send)).status).toBe(200);
	const delivered = fixture.captures.length;
	for (let count = 0; count < 2; count++)
		expect(
			(await call("send/status", { routeId: body.routeId, messageId: body.messageId }, credentials.send)).status,
		).toBe(200);
	expect((await call("send", body, credentials.send)).body?.state).toBe("accepted");
	expect((await call("send", body, credentials.send)).body?.error).toBe("request_rate");
	expect(fixture.captures.length).toBe(delivered);
});

test("global daily sends and new-account budgets compose across distinct source IPs", async () => {
	await settings({ relaySendDay: 1, newAccountDay: 1 });
	const first = await enroll();
	const credentials = await route(first.installationId);
	expect((await call("send", payload(credentials.routeId), credentials.send, { clientIp: "192.0.2.1" })).status).toBe(
		200,
	);
	expect(
		(await call("send", payload(credentials.routeId), credentials.send, { clientIp: "192.0.2.2" })).body?.error,
	).toBe("relay_capacity");
	const user = await emailUser();
	expect(
		(
			await call(
				"installations/begin",
				{ installationId: random(), operationId: random(), token: "synthetic-global-cap" },
				user.idToken,
				{ clientIp: "192.0.2.3" },
			)
		).body?.error,
	).toBe("enrollment_capacity");
});

test("every well-formed new enrollment attempt spends allowance, including capacity rejection, but not duplicate success", async () => {
	await settings({ enrollmentDay: 3, accountPhones: 1 });
	const first = await begin();
	expect(
		(
			await call("installations/begin", {
				installationId: first.installationId,
				operationId: first.operationId,
				token: first.token,
			})
		).status,
	).toBe(200);
	for (let attempt = 0; attempt < 2; attempt++) {
		expect(
			(await call("installations/begin", { installationId: random(), operationId: random(), token: "synthetic-full" }))
				.body?.error,
		).toBe("phone_limit");
	}
	expect(
		(
			await call("installations/begin", {
				installationId: random(),
				operationId: random(),
				token: "synthetic-exhausted",
			})
		).body?.error,
	).toBe("enrollment_rate");
	expect(fixture.captures.length).toBe(1);
});

test("IP and relay challenge ceilings compose across UIDs without charging duplicate begin", async () => {
	await settings({ ipChallengeDay: 1, relayChallengeDay: 2 });
	const first = await begin();
	const user = await emailUser();
	expect(
		(
			await call(
				"installations/begin",
				{ installationId: random(), operationId: random(), token: "synthetic-ip-challenge" },
				user.idToken,
			)
		).body?.error,
	).toBe("challenge_rate");
	expect(
		(
			await call(
				"installations/begin",
				{ installationId: random(), operationId: random(), token: "synthetic-other-ip" },
				user.idToken,
				{ clientIp: "192.0.2.4" },
			)
		).status,
	).toBe(200);
	expect(
		(
			await call(
				"installations/begin",
				{ installationId: first.installationId, operationId: random(), token: first.token },
				fixture.primary.idToken,
				{ clientIp: "192.0.2.5" },
			)
		).body?.error,
	).toBe("relay_capacity");
});

test("specific control-read outage is not mistaken for missing/default settings", async () => {
	const broken = new Proxy(db, {
		get(target, property) {
			if (property === "runTransaction")
				return (callback: (tx: import("firebase-admin/firestore").Transaction) => Promise<unknown>) =>
					target.runTransaction((tx) =>
						callback(
							new Proxy(tx, {
								get(transaction, name) {
									if (name === "get")
										return (ref: { path?: string }) => {
											if (ref.path === "relayControl/settings") throw new Error("synthetic control read outage");
											return Reflect.apply(transaction.get, transaction, [ref]);
										};
									const member: unknown = Reflect.get(transaction, name, transaction);
									return typeof member === "function" ? member.bind(transaction) : member;
								},
							}),
						),
					);
			const member: unknown = Reflect.get(target, property, target);
			return typeof member === "function" ? member.bind(target) : member;
		},
	});
	const handler = createRelay(checkDependencies({ firestore: broken }));
	const response = await handler({
		method: "POST",
		path: "/v1/accounts/status",
		body: "{}",
		contentType: "application/octet-stream",
		clientIp: "127.0.0.1",
		authorization: "Bearer " + fixture.primary.idToken,
	});
	expect(response.body).toEqual({ error: "relay_unavailable" });
	expect(fixture.captures.length).toBe(0);
});
