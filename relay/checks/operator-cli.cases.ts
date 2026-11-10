import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { queueAccountCleanup } from "../src/cleanup";
import { createStore } from "../src/documents";
import { DEFAULT_LIMITS } from "../src/limits";
import {
	fixture,
	store,
	db,
	auth,
	databaseId,
	random,
	enroll,
	route,
	payload,
	call,
	emailUser,
	checkDependencies,
} from "./support";

const root = resolve(import.meta.dir, "..");
async function run(words: string[], options: { dry?: boolean; database?: string } = {}) {
	const child = Bun.spawn(
		[
			process.execPath,
			"--no-env-file",
			"tools/operator.ts",
			"--emulator",
			"--database",
			options.database ?? databaseId,
			...words,
			...(!options.dry ? ["--yes"] : []),
		],
		{
			cwd: root,
			env: {
				...process.env,
				GCLOUD_PROJECT: "synthetic-forbidden-project",
				FIREBASE_AUTH_EMULATOR_HOST: "non-loopback.invalid:9",
				FIRESTORE_EMULATOR_HOST: "non-loopback.invalid:9",
				GOOGLE_APPLICATION_CREDENTIALS: "/nonexistent-synthetic/adc.json",
			},
			stdout: "pipe",
			stderr: "pipe",
			stdin: "ignore",
			timeout: 25_000,
		},
	);
	const [code, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	return {
		code,
		stdout,
		stderr,
		result:
			code === 0 && !options.dry
				? (JSON.parse(stdout.trim().split("\n").at(-1)!) as Record<string, unknown>)
				: undefined,
	};
}
async function applied(words: string[], options: { database?: string } = {}) {
	const result = await run(words, options);
	expect(result.code).toBe(0);
	expect(result.stdout).toContain('"apply":true');
	return result;
}

test("operator CLI requires --yes for every operation, including reads, and never echoes phone/account targets", async () => {
	const targets = [fixture.primary.localId, random()];
	for (const words of [
		["status"],
		["seed-control"],
		["pause"],
		["resume"],
		["enrollment", "open"],
		["enrollment", "close"],
		["limits", "set", "relaySendDay", "1"],
		["account", "disable", targets[0]],
		["account", "enable", targets[0]],
		["account", "delete", targets[0]],
		["phone", "disable", targets[1]],
		["reconcile"],
	]) {
		const result = await run(words, { dry: true });
		expect(result.code).toBe(0);
		expect(result.stdout).toContain('"apply":false');
		expect(result.stdout).toContain("Dry run only");
		for (const target of targets) expect(result.stdout + result.stderr).not.toContain(target);
	}
	expect((await store.control.doc("settings").get()).data()?.enabled).toBe(true);
	expect((await store.accounts.get()).empty).toBe(true);
});

test("operator CLI seeds paused once, changes both switches/limits without resetting counters, and reads safe status", async () => {
	await store.control.doc("settings").delete();
	await applied(["seed-control"]);
	expect((await store.control.doc("settings").get()).data()).toEqual({ enabled: false, enrollmentEnabled: false });
	const duplicate = await run(["seed-control"]);
	expect(duplicate.code).toBe(1);
	expect(duplicate.stderr).toContain("control_already_exists");
	await applied(["resume"]);
	expect((await store.control.doc("settings").get()).data()?.enrollmentEnabled).toBe(false);
	await applied(["enrollment", "open"]);
	const user = await emailUser();
	const phone = await enroll(random(), undefined, user.idToken);
	const credentials = await route(phone.installationId, user.idToken);
	expect((await call("send", payload(credentials.routeId), credentials.send)).status).toBe(200);
	await applied(["pause"]);
	expect((await call("send", payload(credentials.routeId), credentials.send)).body?.error).toBe("relay_disabled");
	await applied(["enrollment", "close"]);
	await applied(["limits", "set", "relaySendDay", "7"]);
	const status = await applied(["status"]);
	expect(status.result?.status).toMatchObject({
		enabled: false,
		enrollmentEnabled: false,
		limits: { ...DEFAULT_LIMITS, relaySendDay: 7 },
		counters: { sendAttempts: 1, challenges: 1, newAccounts: 1 },
		capacity: { accountSlots: 1, phoneSlots: 1 },
	});
	for (const secret of [
		user.localId,
		user.idToken,
		phone.token,
		phone.nonce,
		credentials.send,
		credentials.deletion,
		(await auth.getUser(user.localId)).email!,
		(await store.runtime.doc("state").get()).data()!.ipKey,
	]) {
		expect(status.stdout + status.stderr).not.toContain(secret);
	}
	for (const words of [
		["limits", "set", "unknown", "1"],
		["limits", "set", "__proto__", "1"],
		["limits", "set", "relaySendDay", "-1"],
		["limits", "set", "relaySendDay", "9007199254740992"],
	]) {
		expect((await run(words)).code).toBe(1);
	}
	expect((await store.control.doc("settings").get()).data()?.limits?.relaySendDay).toBe(7);
}, 40_000);

test("operator CLI disables one phone, disables/revokes an account and explicitly enables it without restoring authority", async () => {
	const user = await emailUser();
	const first = await enroll(random(), undefined, user.idToken);
	const second = await enroll(random(), undefined, user.idToken);
	const credentials = await route(first.installationId, user.idToken);
	await applied(["phone", "disable", first.installationId]);
	expect((await store.installations.doc(first.installationId).get()).data()?.state).toBe("deleted");
	expect((await store.routes.doc(credentials.routeId).get()).exists).toBe(false);
	expect((await store.installations.doc(second.installationId).get()).data()?.state).toBe("active");
	const disabled = await applied(["account", "disable", user.localId]);
	expect(disabled.result?.complete).toBe(true);
	expect((await auth.getUser(user.localId)).disabled).toBe(true);
	expect((await store.accounts.doc(user.localId).get()).data()).toEqual({
		uid: user.localId,
		state: "disabled",
		cleanupComplete: true,
	});
	await applied(["account", "enable", user.localId]);
	expect((await auth.getUser(user.localId)).disabled).toBe(false);
	expect((await store.accounts.doc(user.localId).get()).data()).toMatchObject({
		state: "active",
		phones: {},
		routes: {},
	});
	expect((await store.installations.where("uid", "==", user.localId).get()).empty).toBe(true);
	await applied(["reconcile"]);
}, 40_000);

test("operator CLI erases a lost disabled Auth account while paused, touching no unprefixed application data", async () => {
	const user = await emailUser();
	const phone = await enroll(random(), undefined, user.idToken);
	const credentials = await route(phone.installationId, user.idToken);
	await call("send", payload(credentials.routeId), credentials.send);
	const unrelated = [
		"accounts",
		"installations",
		"challenges",
		"challengeOperations",
		"tokenOwners",
		"routes",
		"sendAttempts",
		"rateLimits",
		"accountCleanup",
		"routeRevocations",
		"otherApplication",
	];
	for (const name of unrelated)
		await db.collection(name).doc("synthetic-sentinel").set({ uid: user.localId, sentinel: true });
	await auth.updateUser(user.localId, { disabled: true });
	await applied(["pause"]);
	const erased = await applied(["account", "delete", user.localId]);
	expect(erased.result).toEqual({ changed: true, complete: true });
	await expect(auth.getUser(user.localId)).rejects.toMatchObject({ code: "auth/user-not-found" });
	for (const collection of [
		store.installations,
		store.challenges,
		store.challengeOperations,
		store.tokenOwners,
		store.routes,
		store.sendAttempts,
		store.rateLimits,
	]) {
		expect((await collection.where("uid", "==", user.localId).get()).empty).toBe(true);
	}
	expect((await store.accounts.doc(user.localId).get()).exists).toBe(false);
	expect((await store.accountCleanup.doc(user.localId).get()).exists).toBe(false);
	for (const name of unrelated)
		expect((await db.collection(name).doc("synthetic-sentinel").get()).data()).toEqual({
			uid: user.localId,
			sentinel: true,
		});
	expect((await store.rateLimits.doc("global").get()).data()?.windows.sendDay.count).toBe(1);
	// Repeating a completed erasure is harmless even when Auth is already gone.
	expect((await applied(["account", "delete", user.localId])).result?.complete).toBe(true);
}, 40_000);

test("operator CLI reports a busy durable erasure and reconciliation resumes it after lease release", async () => {
	const user = await emailUser();
	await enroll(random(), undefined, user.idToken);
	await queueAccountCleanup(checkDependencies(), user.localId, "delete");
	await store.accountCleanup
		.doc(user.localId)
		.update({ leaseOwner: "synthetic-busy-worker", leaseUntil: Date.now() + 60_000 });
	const pending = await applied(["account", "delete", user.localId]);
	expect(pending.result).toEqual({ changed: true, complete: false, retryAfterSeconds: 60 });
	await store.accountCleanup.doc(user.localId).update({ leaseUntil: 0 });
	await applied(["reconcile"]);
	await expect(auth.getUser(user.localId)).rejects.toMatchObject({ code: "auth/user-not-found" });
	expect((await store.accountCleanup.doc(user.localId).get()).exists).toBe(false);
}, 30_000);

test("operator CLI selects an isolated named database for the same command path", async () => {
	const named = getFirestore(getApp("checks"), "relay-operator-checks");
	try {
		const namedStore = createStore(named);
		await namedStore.control.doc("settings").delete();
		await applied(["seed-control"], { database: "relay-operator-checks" });
		await applied(["resume"], { database: "relay-operator-checks" });
		await applied(["limits", "set", "accountDay", "17"], { database: "relay-operator-checks" });
		const status = await applied(["status"], { database: "relay-operator-checks" });
		expect(status.result?.status).toMatchObject({
			enabled: true,
			enrollmentEnabled: false,
			limits: { accountDay: 17 },
		});
		expect((await store.control.doc("settings").get()).data()?.limits?.accountDay).toBeUndefined();
		expect((await namedStore.control.doc("settings").get()).data()?.limits?.accountDay).toBe(17);
	} finally {
		await named.terminate();
	}
}, 30_000);

test("operator CLI refuses ambiguous modes, non-demo emulator projects and every contaminated real mode before ADC", async () => {
	const invoke = async (args: string[], environment: Record<string, string | undefined> = process.env) => {
		const child = Bun.spawn([process.execPath, "--no-env-file", "tools/operator.ts", ...args], {
			cwd: root,
			env: environment,
			stdout: "pipe",
			stderr: "pipe",
			stdin: "ignore",
			timeout: 5000,
		});
		const [code, stdout, stderr] = await Promise.all([
			child.exited,
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
		]);
		return { code, output: stdout + stderr };
	};
	for (const args of [
		["status"],
		["--project", "synthetic-project", "status"],
		["--emulator", "--project", "synthetic-project", "status", "--yes"],
		["--emulator", "--confirm-real-project", "status"],
		["--emulator", "--database", "../outside", "status"],
	]) {
		expect((await invoke(args)).code).toBe(1);
	}
	// A real-mode dry run uses a synthetic project name, never --yes and no SDK/ADC access.
	const clean = {
		PATH: process.env.PATH!,
		HOME: resolve(root, ".emulator/operator-dry-home"),
		GOOGLE_APPLICATION_CREDENTIALS: "/nonexistent-synthetic/adc.json",
	};
	const real = ["--project", "synthetic-project", "--confirm-real-project", "status"];
	const dry = await invoke(real, clean);
	expect(dry.code).toBe(0);
	expect(dry.output).toContain("Dry run only");
	for (const variable of [
		"FUNCTIONS_EMULATOR",
		"FIRESTORE_EMULATOR_HOST",
		"FIREBASE_AUTH_EMULATOR_HOST",
		"FIREBASE_EMULATOR_HUB",
		"PUBSUB_EMULATOR_HOST",
		"STORAGE_EMULATOR_HOST",
		"RELAY_FCM_PORT",
		"RELAY_APP_CHECK_BYPASS",
	]) {
		const refused = await invoke(real, { ...clean, [variable]: "" });
		expect(refused.code).toBe(1);
		expect(refused.output).toContain("real_project_refused_with_emulator_variables");
	}
});
