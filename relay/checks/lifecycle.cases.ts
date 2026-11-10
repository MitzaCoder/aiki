import { expect, test } from "bun:test";
import { queueAccountCleanup, resumeAccountCleanup } from "../src/cleanup";
import { disableAccount, enableAccount, disablePhone, setRelayControl } from "../src/operator";
import { reconcileRelay } from "../src/reconciliation";
import type { CleanupPhase } from "../src/documents";
import { DAY } from "../src/ports";
import {
	fixture,
	store,
	db,
	auth,
	checkDependencies,
	restartHandler,
	emailUser,
	enroll,
	route,
	payload,
	call,
	random,
	linkGoogleIdentity,
} from "./support";

const phases: CleanupPhase[] = [
	"auth_disable",
	"routes",
	"installations",
	"challenges",
	"operations",
	"attempts",
	"owners",
	"counters",
	"auth_delete",
	"finish",
];
for (const phase of phases)
	test(
		"cleanup resumes after a crash at phase " + phase,
		async () => {
			const user = await emailUser();
			const phone = await enroll(random(), undefined, user.idToken);
			const second = await enroll(random(), undefined, user.idToken);
			const credentials = await route(phone.installationId, user.idToken);
			await route(second.installationId, user.idToken);
			await call("send", payload(credentials.routeId), credentials.send);
			const mode = phase === "auth_disable" ? "disable" : "delete";
			await queueAccountCleanup(checkDependencies(), user.localId, mode);
			expect((await store.accounts.doc(user.localId).get()).data()?.state).toBe(
				mode === "disable" ? "disabled" : "deleting",
			);
			const before = fixture.captures.length;
			expect((await call("send", payload(credentials.routeId), credentials.send)).status).not.toBe(200);
			expect(fixture.captures.length).toBe(before);
			let interrupted = false;
			const paused = await resumeAccountCleanup(
				checkDependencies({
					checkpoint: async (current) => {
						if (current === phase && !interrupted) {
							interrupted = true;
							throw new Error("synthetic crash");
						}
					},
				}),
				user.localId,
			);
			expect(paused).toBe(false);
			expect(interrupted).toBe(true);
			expect((await store.accountCleanup.doc(user.localId).get()).exists).toBe(true);
			expect(await resumeAccountCleanup(checkDependencies(), user.localId)).toBe(true);
			for (const collection of [
				store.installations,
				store.routes,
				store.challenges,
				store.challengeOperations,
				store.sendAttempts,
				store.tokenOwners,
			]) {
				expect((await collection.where("uid", "==", user.localId).get()).empty).toBe(true);
			}
			expect((await store.accountCleanup.doc(user.localId).get()).exists).toBe(false);
			if (mode === "delete") {
				expect((await store.accounts.doc(user.localId).get()).exists).toBe(false);
				await expect(auth.getUser(user.localId)).rejects.toMatchObject({ code: "auth/user-not-found" });
				expect((await store.rateLimits.where("uid", "==", user.localId).get()).empty).toBe(true);
			} else {
				expect((await auth.getUser(user.localId)).disabled).toBe(true);
				expect((await store.accounts.doc(user.localId).get()).data()?.state).toBe("disabled");
			}
			expect((await call("send", payload(credentials.routeId), credentials.send)).status).toBe(404);
		},
		30_000,
	);

test("account deletion requires recent revoked-checked authentication and reports pending until confirmed erasure", async () => {
	const user = await emailUser();
	await enroll(random(), undefined, user.idToken);
	const deps = checkDependencies();
	restartHandler({
		auth: {
			...deps.auth,
			getUser: (uid) => auth.getUser(uid),
			updateUser: (uid, properties) => auth.updateUser(uid, properties),
			revokeRefreshTokens: (uid) => auth.revokeRefreshTokens(uid),
			deleteUser: (uid) => auth.deleteUser(uid),
			verifyIdToken: async (token, checkRevoked) => {
				expect(checkRevoked).toBe(true);
				return { ...(await auth.verifyIdToken(token, checkRevoked)), auth_time: Math.floor(fixture.now / 1000) - 301 };
			},
		},
	});
	expect((await call("accounts/delete", { operationId: random() }, user.idToken)).body?.error).toBe(
		"recent_auth_required",
	);
	expect((await store.accountCleanup.get()).empty).toBe(true);
	restartHandler({
		checkpoint: async (phase) => {
			if (phase === "routes") throw new Error("synthetic outage");
		},
	});
	const operationId = random();
	const first = await call("accounts/delete", { operationId }, user.idToken);
	expect(first.status).toBe(202);
	expect(first.body).toEqual({ state: "deleting", deletionPending: true });
	expect(first.headers["Retry-After"]).toBe("60");
	expect((await call("accounts/status", {}, user.idToken)).body?.deletionPending).toBe(true);
	expect((await call("accounts/delete", { operationId }, user.idToken)).status).toBe(202);
	restartHandler();
	expect((await call("accounts/delete", { operationId }, user.idToken)).body).toEqual({
		state: "deleted",
		deletionPending: false,
	});
	expect((await call("accounts/delete", { operationId }, user.idToken)).status).toBe(410);
});

test("operator disable/re-enable needs fresh enrollment and never revives old routes", async () => {
	const user = await emailUser();
	const phone = await enroll(random(), undefined, user.idToken);
	const credentials = await route(phone.installationId, user.idToken);
	expect(await disableAccount(checkDependencies(), user.localId)).toBe(true);
	expect((await auth.getUser(user.localId)).disabled).toBe(true);
	expect((await call("accounts/status", {}, user.idToken)).body?.error).toBe("account_disabled");
	expect((await call("delete", { routeId: credentials.routeId }, credentials.deletion)).status).toBe(204);
	await enableAccount(checkDependencies(), user.localId);
	const refreshed = await emailUser((await auth.getUser(user.localId)).email!);
	expect(refreshed.localId).toBe(user.localId);
	expect((await call("send", payload(credentials.routeId), credentials.send)).status).toBe(404);
	const fresh = await enroll(random(), undefined, refreshed.idToken);
	await route(fresh.installationId, refreshed.idToken);
	const counters = await store.rateLimits.where("uid", "==", user.localId).get();
	expect(counters.empty).toBe(false);
}, 30_000);

test("one-phone disable and sign-out preserve other phones and their account counters", async () => {
	const first = await enroll();
	const second = await enroll();
	const third = await enroll();
	const a = await route(first.installationId);
	const b = await route(second.installationId);
	const c = await route(third.installationId);
	await disablePhone(checkDependencies(), fixture.primary.localId, first.installationId);
	expect((await call("send", payload(a.routeId), a.send)).status).toBe(404);
	expect((await call("send", payload(b.routeId), b.send)).status).toBe(200);
	expect((await call("installations/delete", { installationId: second.installationId })).status).toBe(204);
	expect((await call("send", payload(c.routeId), c.send)).status).toBe(200);
	expect((await call("accounts/status")).body?.phones).toBe(1);
});

test("out-of-band Auth disable/delete blocks the next send and hourly reconciliation erases relay state", async () => {
	for (const mode of ["disable", "delete"] as const) {
		const user = await emailUser();
		const phone = await enroll(random(), undefined, user.idToken);
		const credentials = await route(phone.installationId, user.idToken);
		if (mode === "disable") await auth.updateUser(user.localId, { disabled: true });
		else await auth.deleteUser(user.localId);
		expect((await call("send", payload(credentials.routeId), credentials.send)).status).not.toBe(200);
		await reconcileRelay(checkDependencies());
		expect((await store.routes.doc(credentials.routeId).get()).exists).toBe(false);
		expect((await store.tokenOwners.get()).docs.some((row) => row.data().uid === user.localId)).toBe(false);
		if (mode === "disable") expect((await store.accounts.doc(user.localId).get()).data()?.state).toBe("disabled");
		else expect((await store.accounts.doc(user.localId).get()).exists).toBe(false);
	}
}, 30_000);

test("reconciliation resumes unfinished deletion and scrubs expiration, orphan ownership and account maps", async () => {
	const user = await emailUser();
	const phone = await enroll(random(), undefined, user.idToken);
	await route(phone.installationId, user.idToken);
	await queueAccountCleanup(checkDependencies(), user.localId, "delete");
	const current = await enroll();
	const credentials = await route(current.installationId);
	await call("send", payload(credentials.routeId), credentials.send);
	await store.tokenOwners
		.doc("synthetic-orphan")
		.set({ uid: fixture.primary.localId, installationId: random(), generation: 1 });
	fixture.now += 31 * DAY;
	await reconcileRelay(checkDependencies());
	expect((await store.accountCleanup.get()).empty).toBe(true);
	expect((await store.accounts.doc(user.localId).get()).exists).toBe(false);
	expect((await store.routes.get()).empty).toBe(true);
	expect((await store.installations.get()).empty).toBe(true);
	expect((await store.tokenOwners.get()).empty).toBe(true);
	expect((await store.challenges.get()).empty).toBe(true);
	expect((await store.challengeOperations.get()).empty).toBe(true);
	expect((await store.sendAttempts.get()).empty).toBe(true);
	expect((await store.accounts.doc(fixture.primary.localId).get()).data()?.phones).toEqual({});
}, 30_000);

test("linked Google/email providers share one UID, relay account and quota", async () => {
	const user = await emailUser();
	const linked = await linkGoogleIdentity(user);
	expect(linked.localId).toBe(user.localId);
	await enroll(random(), undefined, user.idToken);
	await enroll(random(), undefined, linked.idToken);
	expect((await store.accounts.get()).size).toBe(1);
	expect((await call("accounts/status", {}, linked.idToken)).body?.phones).toBe(2);
	expect((await store.rateLimits.where("uid", "==", user.localId).get()).size).toBe(1);
});

test("operator settings and lifecycle logs contain no UID, email, tokens, body, IP or ciphertext", async () => {
	const user = await emailUser();
	const phone = await enroll(random(), undefined, user.idToken);
	const credentials = await route(phone.installationId, user.idToken);
	const body = payload(credentials.routeId);
	const email = (await auth.getUser(user.localId)).email!;
	const logs: string[] = [];
	const original = { ...console };
	for (const method of ["info", "log", "warn", "error", "debug"] as const) {
		console[method] = (...args: unknown[]) => {
			logs.push(args.join(" "));
		};
	}
	try {
		await call("send", body, credentials.send);
		await setRelayControl(checkDependencies(), { enabled: false, limits: { relaySendDay: 1 } });
		await disableAccount(checkDependencies(), user.localId);
		await queueAccountCleanup(checkDependencies(), user.localId, "delete");
		await reconcileRelay(checkDependencies());
	} finally {
		for (const method of ["info", "log", "warn", "error", "debug"] as const) console[method] = original[method];
	}
	for (const secret of [
		user.localId,
		user.idToken,
		email,
		phone.token,
		phone.nonce,
		credentials.send,
		credentials.deletion,
		JSON.stringify(body),
		body.envelope.c,
		"127.0.0.1",
	])
		expect(logs.join("\n")).not.toContain(secret);
}, 30_000);

test("emulator-only admin launcher scrubs its child environment and applies settings without exposing identifiers", async () => {
	const child = Bun.spawn(
		[
			process.execPath,
			"tools/admin.ts",
			"settings",
			JSON.stringify({
				enabled: false,
				limits: { relaySendDay: 7 },
			}),
		],
		{ cwd: process.cwd(), stdout: "pipe", stderr: "pipe", timeout: 15_000 },
	);
	expect(await child.exited).toBe(0);
	const output = await new Response(child.stdout).text();
	expect(output).toContain("Operator action finished");
	expect(output).not.toContain(fixture.primary.localId);
	expect((await store.control.doc("settings").get()).data()?.enabled).toBe(false);
	expect((await store.control.doc("settings").get()).data()?.limits?.relaySendDay).toBe(7);
});

test("reconciliation removes a phone after its last route without waiting thirty days", async () => {
	const phone = await enroll();
	const credentials = await route(phone.installationId);
	await call("delete", { routeId: credentials.routeId }, credentials.deletion);
	await reconcileRelay(checkDependencies());
	expect((await store.installations.doc(phone.installationId).get()).exists).toBe(false);
	expect((await store.tokenOwners.get()).empty).toBe(true);
});

test("disabled marker stays minimal and reconciliation does not repeatedly revoke the same Auth identity", async () => {
	const user = await emailUser();
	await enroll(random(), undefined, user.idToken);
	await disableAccount(checkDependencies(), user.localId);
	expect((await store.accounts.doc(user.localId).get()).data()).toEqual({
		uid: user.localId,
		state: "disabled",
		cleanupComplete: true,
	});
	let revoked = 0;
	await reconcileRelay(
		checkDependencies({
			auth: {
				getUser: (uid) => auth.getUser(uid),
				verifyIdToken: (token, checkRevoked) => auth.verifyIdToken(token, checkRevoked),
				updateUser: (uid, properties) => auth.updateUser(uid, properties),
				deleteUser: (uid) => auth.deleteUser(uid),
				revokeRefreshTokens: async (uid) => {
					revoked++;
					await auth.revokeRefreshTokens(uid);
				},
			},
		}),
	);
	expect(revoked).toBe(0);
});

test("Auth-erased deletion polling fails closed until reconciliation finishes the durable final marker", async () => {
	const user = await emailUser();
	await enroll(random(), undefined, user.idToken);
	restartHandler({
		checkpoint: async (phase) => {
			if (phase === "finish") throw new Error("synthetic finalization crash");
		},
	});
	const operationId = random();
	expect((await call("accounts/delete", { operationId }, user.idToken)).status).toBe(202);
	expect((await store.accountCleanup.doc(user.localId).get()).exists).toBe(true);
	expect((await call("accounts/status", {}, user.idToken)).body?.error).toBe("account_deleted");
	expect((await call("accounts/delete", { operationId }, user.idToken)).status).toBe(410);
	await reconcileRelay(checkDependencies());
	expect((await store.accountCleanup.doc(user.localId).get()).exists).toBe(false);
	expect((await store.accounts.doc(user.localId).get()).exists).toBe(false);
});
