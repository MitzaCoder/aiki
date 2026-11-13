/** Stage 1 deploys optional with no backend-origin/proxy configuration. Existing clients must keep working. */
import { afterEach, describe, expect, test } from "bun:test";
import { createECDH, randomBytes } from "node:crypto";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import type { DeviceAuthMode } from "@kemiri/protocol";
import { requestOrigin } from "../src/artifacts.ts";
import { authSecret } from "../src/device-auth.ts";
import { TestClient, createSetup, type TestSetup } from "./support.ts";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function setup(mode: DeviceAuthMode) {
	const s = await createSetup({
		auth: { mode, backendOrigins: [], trustedProxies: [] },
		terminals: false,
		allowedOrigins: ["https://app.example.com"],
		notifications: { send: async () => ({ status: 201, message: null }) },
	});
	cleanups.push(s.cleanup);
	return s;
}
async function connect(s: TestSetup, headers?: Record<string, string>, accessToken?: string) {
	const c = await TestClient.open(s.server, { headers });
	cleanups.push(async () => c.close());
	const hello = await c.request({
		type: "hello",
		protocolVersion: 1,
		...(accessToken ? { auth: { accessToken } } : {}),
	});
	expect(hello.type).toBe("hello");
	return c;
}
async function token(s: TestSetup) {
	const grant = s.server.auth.bootstrap();
	const claim = {
		claimId: randomBytes(16).toString("hex"),
		claimSecret: authSecret("aiki_c1"),
		label: "Fixture",
		platform: "web",
	};
	return (await s.server.auth.redeem({ grantId: grant.requestId, secret: grant.secret, ...claim }, "loopback", true))
		.credentials!;
}
async function artifact(s: TestSetup, c: TestClient) {
	const project = await c.request({ type: "projects.add", path: s.projectDir });
	if (project.type !== "projects.add") throw new Error("Project fixture failed");
	const sourcePath = join(s.projectDir, "example.txt");
	await writeFile(sourcePath, "Synthetic artifact");
	return s.server.artifacts.save({
		projectId: project.project.id,
		sourcePath,
		title: null,
		note: null,
		threadId: "main",
		workerId: null,
		taskId: null,
	});
}
async function signed(c: TestClient, a: Awaited<ReturnType<typeof artifact>>) {
	const response = await c.request({ type: "artifacts.url", projectId: a.projectId, artifactId: a.id });
	if (response.type !== "artifacts.url") throw new Error("Artifact URL fixture failed");
	return response.url;
}

for (const mode of ["optional", "off"] as const)
	describe(`${mode} migration compatibility`, () => {
		test("legacy proxy and direct Host origins still mint remote artifact URLs without configuration", async () => {
			const s = await setup(mode);
			const proxy = await connect(s, { "x-forwarded-proto": "https", "x-forwarded-host": "proxy.example.net" });
			const a = await artifact(s, proxy);
			expect(await signed(proxy, a)).toStartWith("https://proxy.example.net/artifacts/");
			const proxyPublicHost = await connect(s, { host: "proxy.example.net", "x-forwarded-proto": "https" });
			expect(await signed(proxyPublicHost, a)).toStartWith("https://proxy.example.net/artifacts/");
			const direct = await connect(s, { host: "backend.example.net:7317" });
			expect(await signed(direct, a)).toStartWith("http://backend.example.net:7317/artifacts/");
			expect(s.server.auth.hosts).toEqual([]);
		});
		test("reconnect storms from one proxy source and delayed/large legacy hello are not auth-limited", async () => {
			const s = await setup(mode);
			// Cross both the 30/source and 120/backend required-mode thresholds with real completed handshakes.
			for (let n = 0; n < 125; n++) {
				const c = await connect(s);
				expect((await c.request({ type: "projects.list" })).type).toBe("projects.list");
				c.close();
			}
			// The 100 outstanding cap and five-second/8 KiB hello restrictions also belong only to required mode.
			const pending: TestClient[] = [];
			for (let n = 0; n < 101; n++) {
				const c = await TestClient.open(s.server);
				pending.push(c);
				cleanups.push(async () => c.close());
			}
			await Bun.sleep(5100);
			expect(
				await pending[0]!.request({ type: "hello", protocolVersion: 1, client: { name: "x".repeat(9000) } }),
			).toMatchObject({ type: "hello" });
			for (const c of pending.slice(1)) c.close();
		}, 15000);
		test("WS Origin rejection and artifact Origin/CORS responses match the pre-auth server", async () => {
			const s = await setup(mode),
				c = await connect(s),
				a = await artifact(s, c),
				url = await signed(c, a);
			for (const origin of [undefined, "https://unlisted.example.net", "null"]) {
				const headers: Record<string, string> = origin === undefined ? {} : { origin };
				const ws = await fetch(`${s.server.url}/ws`, { headers });
				expect(ws.status).toBe(origin === undefined ? 426 : 403);
				if (origin !== undefined) expect(await ws.text()).toBe("Forbidden origin");
				else await ws.body?.cancel();
				for (const method of ["GET", "HEAD", "OPTIONS"]) {
					const response = await fetch(url, { method, headers });
					expect(response.status).toBe(method === "OPTIONS" ? 204 : 200);
					expect(response.headers.get("access-control-allow-origin")).toBeNull();
					if (method === "OPTIONS") expect(response.headers.get("access-control-allow-headers")).toBeNull();
					await response.body?.cancel();
				}
			}
			const allowed = await fetch(url, { method: "OPTIONS", headers: { origin: "https://app.example.com" } });
			expect(allowed.status).toBe(204);
			expect(allowed.headers.get("access-control-allow-origin")).toBe("https://app.example.com");
			expect(allowed.headers.get("access-control-allow-headers")).toBe("Range");
			const normalized = await fetch(`${s.server.url}/ws`, { headers: { origin: "https://app.example.com/" } });
			expect(normalized.status).toBe(426);
			await normalized.body?.cancel();
		});
		test("legacy web-push/FCM registration and every notification RPC remain available, including bound rows", async () => {
			const s = await setup(mode),
				legacy = await connect(s),
				credentials = await token(s),
				authenticated = await connect(s, undefined, credentials.accessToken);
			const key = createECDH("prime256v1");
			key.generateKeys();
			const common = {
				label: "Synthetic browser",
				backendKey: "example",
				preferences: { kinds: [], mutedProjects: [], quietHours: null },
			};
			const web = {
				type: "notifications.register" as const,
				deviceId: "fixture-web",
				...common,
				subscription: {
					endpoint: "https://push.example.net/fixture",
					keys: { p256dh: key.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") },
				},
			};
			const fcm = {
				type: "notifications.registerFcm" as const,
				deviceId: "fixture-fcm",
				...common,
				token: "synthetic-fcm-token",
			};
			expect((await legacy.request({ type: "notifications.config" })).type).toBe("notifications.config");
			for (const registration of [web, fcm]) {
				expect((await legacy.request(registration)).type).toBe(registration.type);
				expect((await authenticated.request(registration)).type).toBe(registration.type);
				// Old tabs keep refreshing the same notification ID even after an updated tab binds it.
				expect((await legacy.request(registration)).type).toBe(registration.type);
				const deviceId = registration.deviceId;
				expect((await legacy.request({ type: "notifications.device", deviceId })).type).toBe("notifications.device");
				expect(
					(await legacy.request({ type: "notifications.presence", deviceId, visible: true, projectId: null })).type,
				).toBe("notifications.presence");
				expect((await legacy.request({ type: "notifications.test", deviceId })).type).toBe("notifications.test");
			}
			expect((await legacy.request({ type: "notifications.interaction", deviceId: "fixture-web" })).type).toBe(
				"notifications.interaction",
			);
			expect((await legacy.request({ type: "notifications.unregister", deviceId: "fixture-fcm" })).type).toBe(
				"notifications.unregister",
			);
			await s.server.auth.revoke(credentials.sessionId);
			expect(s.server.notifications.device("fixture-web")).toBeNull();
		});
	});

test("required mode rejects the direct unknown Host and never trusts unconfigured proxy artifact origins", async () => {
	const s = await setup("required");
	expect((await fetch(`${s.server.url}/ws`, { headers: { host: "backend.example.net:7317" } })).status).toBe(403);
	const credentials = await token(s),
		c = await connect(
			s,
			{ "x-forwarded-proto": "https", "x-forwarded-host": "proxy.example.net" },
			credentials.accessToken,
		),
		a = await artifact(s, c);
	expect(await signed(c, a)).toStartWith(`${s.server.url}/artifacts/`);
	expect((await fetch(`${s.server.url}/ws`, { headers: { origin: "https://unlisted.example.net" } })).status).toBe(403);
	for (let n = 0; n < 30; n++) {
		const response = await fetch(`${s.server.url}/ws`);
		await response.body?.cancel();
	}
	const limited = await fetch(`${s.server.url}/ws`);
	expect(limited.status).toBe(429);
	expect(limited.headers.get("retry-after")).not.toBeNull();
	// A socket admitted during the compatibility window must not retain an unapproved minting origin at cutover.
	const migrating = await setup("optional"),
		migratingCredentials = await token(migrating);
	const migrated = await connect(
		migrating,
		{ "x-forwarded-proto": "https", "x-forwarded-host": "proxy.example.net" },
		migratingCredentials.accessToken,
	);
	const migrationArtifact = await artifact(migrating, migrated);
	expect(await signed(migrated, migrationArtifact)).toStartWith("https://proxy.example.net/artifacts/");
	migrating.server.auth.setMode("required");
	await migrated.closed();
	expect(migrated.stopped).toBe(true);
});

test("legacy origin derivation still prioritizes explicit PUBLIC_URL over forwarded and Host addresses", () => {
	const r = new Request("http://127.0.0.1:7317/ws", {
		headers: {
			host: "backend.example.net:7317",
			"x-forwarded-proto": "https",
			"x-forwarded-host": "proxy.example.net",
		},
	});
	expect(requestOrigin(r, { KEMIRI_PUBLIC_URL: "https://configured.example.com/path" })).toBe(
		"https://configured.example.com",
	);
	expect(requestOrigin(r, {})).toBe("https://proxy.example.net");
});

test("unchanged deploy health check passes hello and deep/record-open-projects against optional", async () => {
	const s = await setup("optional"),
		c = await connect(s),
		a = await artifact(s, c);
	expect((await c.request({ type: "conversation.watch", projectId: a.projectId })).type).toBe("conversation.watch");
	const inventory = join(s.root, "health-open-projects.json");
	for (const flags of [[], [`--record-open-projects=${inventory}`], ["--deep", `--open-projects=${inventory}`]]) {
		const child = Bun.spawn(["bun", "deploy/health-check.ts", s.server.url, "--timeout-ms=2000", ...flags], {
			stdout: "pipe",
			stderr: "pipe",
			timeout: 10000,
		});
		const [stdout, stderr, exit] = await Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited,
		]);
		expect({ exit, stderr }).toEqual({ exit: 0, stderr: "" });
		expect(stdout.length).toBeGreaterThan(0);
	}
});
