import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { deleteApp, getApp } from "firebase-admin/app";
import { requireDatabaseId } from "../src/database";
import { relayDatabase, relayMaxInstances, relayRegion, runtimeServiceAccount } from "../src/deployment";
import {
	fixture,
	store,
	db,
	random,
	enroll,
	route,
	payload,
	call,
	firestoreHost,
	projectId,
	databaseId,
} from "./support";

const root = resolve(import.meta.dir, "..");
test("fresh/missing switches pause all authority paths before lookups, while route and phone deletion stay available", async () => {
	const phone = await enroll();
	const credentials = await route(phone.installationId);
	await store.control.doc("settings").delete();
	const captured = fixture.captures.length;
	for (const path of [
		"send",
		"installations/begin",
		"installations/token/begin",
		"installations/confirm",
		"installations/token/confirm",
		"routes/create",
		"routes/activate",
		"routes/renew",
	]) {
		const reply = await call(path, path === "send" ? payload(credentials.routeId) : {}, credentials.send);
		expect(reply.status).toBe(503);
		expect(reply.body).toEqual({ error: "relay_disabled" });
	}
	expect(fixture.captures.length).toBe(captured);
	expect((await call("delete", { routeId: credentials.routeId }, credentials.deletion)).status).toBe(204);
	expect((await call("installations/delete", { installationId: phone.installationId })).status).toBe(204);
	await store.control.doc("settings").set({ limits: { relaySendDay: 1 } });
	expect(
		(await call("installations/begin", { installationId: random(), operationId: random(), token: "synthetic-fresh" }))
			.body?.error,
	).toBe("relay_disabled");
});

test("all relay collections/index groups are prefixed, with durable cleanup work excluded from TTL", async () => {
	const names = Object.values(store).map((collection) => collection.id);
	expect(new Set(names).size).toBe(12);
	for (const name of names) expect(name).toMatch(/^relay[A-Z][A-Za-z]+$/);
	const indexes = (await Bun.file(resolve(root, "firestore.indexes.json")).json()) as {
		fieldOverrides: { collectionGroup: string; fieldPath: string; ttl?: boolean }[];
	};
	expect([...new Set(indexes.fieldOverrides.map((field) => field.collectionGroup))].sort()).toEqual(names.sort());
	expect(indexes.fieldOverrides.some((field) => field.collectionGroup === "relayAccountCleanup" && field.ttl)).toBe(
		false,
	);
});

test("both exports share parameterized region/identity and defer database resolution until invocation", async () => {
	const before = process.env.FUNCTIONS_EMULATOR;
	const originalValue = relayDatabase.value;
	process.env.FUNCTIONS_EMULATOR = "true";
	relayDatabase.value = () => {
		throw new Error("Database resolved during discovery");
	};
	try {
		const { relay, reconcile } = await import("../src/index");
		expect(relay.__endpoint.serviceAccountEmail).toBe(runtimeServiceAccount);
		expect(reconcile.__endpoint.serviceAccountEmail).toBe(runtimeServiceAccount);
		expect(String(relay.__endpoint.region)).toBe(String(relayRegion));
		expect(String(reconcile.__endpoint.region)).toBe(String(relayRegion));
		expect(relay.__endpoint.maxInstances).toBe(relayMaxInstances);
		expect(reconcile.__endpoint.maxInstances).toBe(1);
		expect(reconcile.__endpoint.scheduleTrigger?.schedule).toBe("every 60 minutes");
		expect(relayDatabase.options.default).toBe("(default)");
	} finally {
		relayDatabase.value = originalValue;
		if (before === undefined) delete process.env.FUNCTIONS_EMULATOR;
		else process.env.FUNCTIONS_EMULATOR = before;
		await deleteApp(getApp());
	}
});

test("database selection rejects paths, malformed and UUID-shaped names", () => {
	for (const name of ["(default)", "relay-checks", "abcd"]) expect(requireDatabaseId(name)).toBe(name);
	for (const name of [
		"",
		"abc",
		"../database",
		"A-uppercase",
		"relay/path",
		"abcd-",
		"a".repeat(64),
		"abcdef01-2345-6789-abcd-0123456789ab",
	])
		expect(() => requireDatabaseId(name)).toThrow();
});

test("local deploy-config generation preserves unrelated shared indexes and never configures shared rules overwrite", async () => {
	const invoke = async (args: string[]) => {
		const child = Bun.spawn([process.execPath, "--no-env-file", "tools/deploy-config.ts", ...args], {
			cwd: root,
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
		return { code, stdout, stderr };
	};
	expect((await invoke(["--rules", "sole", "--database", "relay-checks"])).code).toBe(0);
	const sole = await Bun.file(resolve(root, ".deploy.firebase.json")).json();
	expect(sole.firestore).toEqual([
		{ database: "relay-checks", rules: "firestore.rules", indexes: "firestore.indexes.json" },
	]);
	expect(sole.functions.codebase).toBe("aiki-push-relay");
	expect(sole.emulators).toBeUndefined();
	const existing = {
		indexes: [
			{
				collectionGroup: "otherApplication",
				queryScope: "COLLECTION",
				fields: [
					{ fieldPath: "kind", order: "ASCENDING" },
					{ fieldPath: "createdAt", order: "DESCENDING" },
				],
			},
		],
		fieldOverrides: [{ collectionGroup: "otherApplication", fieldPath: "private", indexes: [] }],
	};
	const fixturePath = resolve(root, ".emulator/synthetic-existing-indexes.json");
	await Bun.write(fixturePath, JSON.stringify(existing));
	expect(
		(await invoke(["--rules", "shared", "--database", "relay-checks", "--existing-indexes", fixturePath])).code,
	).toBe(0);
	const shared = await Bun.file(resolve(root, ".deploy.firebase.json")).json();
	expect(shared.firestore).toEqual([{ database: "relay-checks", indexes: ".deploy.indexes.json" }]);
	const merged = await Bun.file(resolve(root, ".deploy.indexes.json")).json();
	expect(merged.indexes).toEqual(existing.indexes);
	expect(merged.fieldOverrides).toContainEqual(existing.fieldOverrides[0]);
	expect(merged.fieldOverrides).toContainEqual({
		collectionGroup: "relayChallenges",
		fieldPath: "purgeAt",
		ttl: true,
		indexes: [],
	});
	expect((await invoke(["--rules", "shared"])).code).toBe(1);
	expect((await invoke(["--rules", "sole", "--database", "../outside"])).code).toBe(1);
});

test("sole rules deny all client relay access; shared fragment excludes every relay collection while keeping other data usable", async () => {
	const sole = await Bun.file(resolve(root, "firestore.rules")).text();
	const fragment = await Bun.file(resolve(root, "firestore.shared.rules.example")).text();
	const rules = async (content: string) => {
		const response = await fetch(`http://${firestoreHost}/emulator/v1/projects/${projectId}:securityRules`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ rules: { files: [{ name: "security.rules", content }] } }),
			signal: AbortSignal.timeout(10_000),
		});
		expect(response.status).toBe(200);
		const result = (await response.json()) as { issues?: { severity: string }[] };
		expect((result.issues ?? []).filter((issue) => issue.severity === "ERROR")).toEqual([]);
	};
	const client = (collection: string, method: "GET" | "PATCH") =>
		fetch(
			`http://${firestoreHost}/v1/projects/${projectId}/databases/${databaseId}/documents/${collection}/synthetic-client-probe`,
			{
				method,
				headers: { Authorization: "Bearer " + fixture.primary.idToken, "Content-Type": "application/json" },
				...(method === "PATCH" ? { body: JSON.stringify({ fields: { synthetic: { booleanValue: true } } }) } : {}),
			},
		);
	try {
		await rules(sole);
		for (const collection of Object.values(store)) {
			expect((await client(collection.id, "GET")).status).toBe(403);
			expect((await client(collection.id, "PATCH")).status).toBe(403);
		}
		expect((await client("otherApplication", "PATCH")).status).toBe(403);
		await rules(`rules_version = '2'; service cloud.firestore {match /databases/{database}/documents {
			${fragment}
			match /{collectionId}/{document=**} {allow read, write: if !isRelayCollection(collectionId);}
		}}`);
		for (const collection of Object.values(store)) {
			expect((await client(collection.id, "GET")).status).toBe(403);
			expect((await client(collection.id, "PATCH")).status).toBe(403);
		}
		expect((await client("otherApplication", "PATCH")).status).toBe(200);
		expect((await client("otherApplication", "GET")).status).toBe(200);
	} finally {
		await rules(sole);
	}
}, 30_000);
