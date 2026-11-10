import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, stat, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import {
	deviceComparisonCode,
	encodePairingFragment,
	decodePairingFragment,
	type DeviceAuthMode,
} from "@aiki/protocol";
import { DeviceAuth, DeviceAuthError, authSecret, ACCESS_TTL, type SessionCredentials } from "../src/device-auth.ts";
import { ArtifactUrlSigner } from "../src/artifacts.ts";
import { ownerCommand } from "../src/device-auth-cli.ts";
import { createSetup, TestClient, type TestSetup } from "./support.ts";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const proof = () => ({
	claimId: randomBytes(16).toString("hex"),
	claimSecret: authSecret("aiki_c1"),
	label: "Synthetic phone",
	platform: "android",
});
async function store(mode?: DeviceAuthMode) {
	const root = await mkdtemp(join(tmpdir(), "device-auth-"));
	let clock = Date.UTC(2026, 0, 1);
	const auth = new DeviceAuth(root, mode ? { mode } : {}, () => clock);
	cleanups.push(async () => {
		try {
			auth.close();
		} catch {}
		await rm(root, { recursive: true, force: true });
	});
	return {
		auth,
		root,
		advance: (ms: number) => {
			clock += ms;
		},
	};
}
async function enroll(auth: DeviceAuth): Promise<SessionCredentials> {
	const grant = auth.bootstrap();
	const result = await auth.redeem({ grantId: grant.requestId, secret: grant.secret, ...proof() }, "loopback", true);
	return result.credentials!;
}
async function setup(mode: DeviceAuthMode = "required", extra: Parameters<typeof createSetup>[0] = {}) {
	const s = await createSetup({ auth: { mode }, terminals: false, ...extra });
	cleanups.push(s.cleanup);
	return s;
}
async function client(s: TestSetup, credentials?: SessionCredentials) {
	const c = await TestClient.open(s.server);
	cleanups.push(async () => c.close());
	const hello = await c.request({
		type: "hello",
		protocolVersion: 1,
		...(credentials ? { auth: { accessToken: credentials.accessToken } } : {}),
	});
	return { c, hello };
}
async function post(s: TestSetup, path: string, body: unknown, token?: string) {
	return fetch(`${s.server.url}${path}`, {
		method: "POST",
		headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(3000),
	});
}

describe("durable device sessions", () => {
	test("new directories required; existing directories optional; explicit off persists", async () => {
		const { auth, root } = await store();
		expect(auth.mode).toBe("required");
		const backend = auth.backendId;
		auth.setMode("off");
		auth.close();
		const reopened = new DeviceAuth(root);
		expect(reopened.backendId).toBe(backend);
		expect(reopened.mode).toBe("off");
		reopened.close();
		const legacy = await mkdtemp(join(tmpdir(), "device-auth-old-"));
		await writeFile(join(legacy, "projects.json"), "{}");
		const migrated = new DeviceAuth(legacy);
		expect(migrated.mode).toBe("optional");
		migrated.close();
		await rm(legacy, { recursive: true, force: true });
	});
	test("owner-only storage and no plaintext token on disk", async () => {
		const { auth, root } = await store();
		const credentials = await enroll(auth);
		expect((await stat(root)).mode & 0o777).toBe(0o700);
		expect((await stat(join(root, "auth.sqlite"))).mode & 0o777).toBe(0o600);
		expect((await readFile(join(root, "auth.sqlite"))).includes(Buffer.from(credentials.sessionToken))).toBe(false);
		expect((await readFile(join(root, "auth.sqlite"))).includes(Buffer.from(credentials.accessToken))).toBe(false);
	});
	test("bootstrap single use, bad secrets do not consume, wrong codes invalidate", async () => {
		const { auth } = await store();
		let grant = auth.bootstrap();
		for (let n = 0; n < 4; n++)
			await expect(
				auth.redeem({ grantId: grant.requestId, secret: "WRONG", ...proof() }, `source-${n}`, true),
			).rejects.toThrow("auth_invalid");
		const credentials = (
			await auth.redeem({ grantId: grant.requestId, secret: grant.secret, ...proof() }, "good", true)
		).credentials;
		expect(credentials?.sessionToken).toStartWith("aiki_s1.");
		await expect(
			auth.redeem({ grantId: grant.requestId, secret: grant.secret, ...proof() }, "new", true),
		).rejects.toThrow("grant_used");
		grant = auth.bootstrap();
		for (let n = 0; n < 5; n++)
			await expect(
				auth.redeem({ grantId: grant.requestId, secret: "WRONG", ...proof() }, `wrong-${n}`, true),
			).rejects.toThrow();
		await expect(
			auth.redeem({ grantId: grant.requestId, secret: grant.secret, ...proof() }, "good", true),
		).rejects.toThrow("grant_used");
	});
	test("bootstrap expires and only newest bootstrap remains active", async () => {
		const { auth, advance } = await store();
		const old = auth.bootstrap(),
			fresh = auth.bootstrap();
		await expect(
			auth.redeem({ grantId: old.requestId, secret: old.secret, ...proof() }, "loopback", true),
		).rejects.toThrow("grant_used");
		advance(600001);
		await expect(
			auth.redeem({ grantId: fresh.requestId, secret: fresh.secret, ...proof() }, "loopback", true),
		).rejects.toThrow("auth_expired");
	});
	test("local bootstrap requires actual local transport", async () => {
		const { auth } = await store();
		const grant = auth.bootstrap(true);
		await expect(
			auth.redeem({ grantId: "local", secret: grant.secret, ...proof() }, "remote", true, false),
		).rejects.toThrow("auth_invalid");
		const claim = proof(),
			input = { grantId: "local", secret: grant.secret, ...claim };
		const accepted = await auth.redeem(input, "loopback", true, true);
		expect(accepted.state).toBe("approved");
		expect(await auth.redeem(input, "loopback", true, true)).toEqual(accepted);
	});
	test("pairing defaults to confirmation and approval binds exact claim", async () => {
		const { auth } = await store();
		const owner = await enroll(auth),
			grant = auth.createPairing(owner.sessionId),
			claim = proof();
		const pending = await auth.redeem({ grantId: grant.pairing.id, secret: grant.secret, ...claim }, "loopback");
		expect(pending.state).toBe("pending");
		expect(pending.credentials).toBeNull();
		expect(pending.comparisonCode).toBe(
			await deviceComparisonCode(auth.backendId, grant.pairing.id, claim.claimId, claim.claimSecret),
		);
		expect(() => auth.decide(owner.sessionId, grant.pairing.id, "other", true)).toThrow("not_found");
		auth.decide(owner.sessionId, grant.pairing.id, claim.claimId, true);
		const approved = auth.poll(claim.claimId, claim.claimSecret);
		expect(approved.credentials?.sessionId).not.toBe(owner.sessionId);
		expect(() => auth.poll(claim.claimId, "wrong")).toThrow();
		expect(auth.ack(claim.claimId, claim.claimSecret)).toEqual({ ok: true });
		expect(auth.ack(claim.claimId, claim.claimSecret)).toEqual({ ok: true });
	});
	test("unconfirmed pairing, lost-response retry and ack deletion", async () => {
		const { auth, advance } = await store();
		const owner = await enroll(auth),
			grant = auth.createPairing(owner.sessionId, false),
			claim = proof();
		const input = { grantId: grant.pairing.id, secret: grant.secret, ...claim };
		const first = await auth.redeem(input, "loopback");
		expect(first.state).toBe("approved");
		expect(await auth.redeem(input, "loopback")).toEqual(first);
		advance(1001);
		expect(auth.poll(claim.claimId, claim.claimSecret)).toEqual(first);
		auth.ack(claim.claimId, claim.claimSecret);
		advance(1001);
		expect(auth.poll(claim.claimId, claim.claimSecret).credentials).toBeNull();
	});
	test("concurrent redeem has exactly one winner", async () => {
		const { auth } = await store();
		const owner = await enroll(auth),
			grant = auth.createPairing(owner.sessionId, false);
		const results = await Promise.allSettled([
			auth.redeem({ grantId: grant.pairing.id, secret: grant.secret, ...proof() }, "one"),
			auth.redeem({ grantId: grant.pairing.id, secret: grant.secret, ...proof() }, "two"),
		]);
		expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
		expect(auth.devices()).toHaveLength(2);
	});
	test("pairing bad secret, deny, cancel, original expiry and delivery expiry", async () => {
		const { auth, advance } = await store();
		const owner = await enroll(auth),
			grant = auth.createPairing(owner.sessionId),
			claim = proof();
		await expect(auth.redeem({ grantId: grant.pairing.id, secret: "wrong", ...claim }, "loopback")).rejects.toThrow();
		await auth.redeem({ grantId: grant.pairing.id, secret: grant.secret, ...claim }, "loopback");
		auth.decide(owner.sessionId, grant.pairing.id, claim.claimId, false);
		expect(auth.poll(claim.claimId, claim.claimSecret).state).toBe("denied");
		const canceled = auth.createPairing(owner.sessionId);
		auth.cancel(owner.sessionId, canceled.pairing.id);
		await expect(
			auth.redeem({ grantId: canceled.pairing.id, secret: canceled.secret, ...proof() }, "loopback"),
		).rejects.toThrow("grant_used");
		const expired = auth.createPairing(owner.sessionId);
		advance(300001);
		await expect(
			auth.redeem({ grantId: expired.pairing.id, secret: expired.secret, ...proof() }, "loopback"),
		).rejects.toThrow("auth_expired");
		const direct = auth.createPairing(owner.sessionId, false),
			directClaim = proof();
		await auth.redeem({ grantId: direct.pairing.id, secret: direct.secret, ...directClaim }, "loopback");
		advance(60001);
		expect(auth.poll(directClaim.claimId, directClaim.claimSecret)).toMatchObject({
			state: "expired",
			credentials: null,
		});
	});
	test("refresh, access expiry and retained idle expiry", async () => {
		const { auth, advance } = await store();
		const c = await enroll(auth);
		expect(auth.authenticate(c.accessToken).sessionId).toBe(c.sessionId);
		advance(ACCESS_TTL);
		expect(() => auth.authenticate(c.accessToken)).toThrow("auth_expired");
		const refreshed = auth.refresh(c.sessionToken, "loopback");
		expect(auth.authenticate(refreshed.accessToken).sessionId).toBe(c.sessionId);
		advance(180 * 86400_000 + 1);
		expect(() => auth.refresh(c.sessionToken, "loopback")).toThrow("auth_expired");
	});
	test("live sessions count as use but cannot exceed absolute lifetime", async () => {
		const { auth, advance } = await store();
		const c = await enroll(auth);
		for (let n = 0; n < 365; n++) {
			advance(86400_000);
			if (n < 364) auth.session(c.sessionId, true);
		}
		expect(() => auth.refresh(c.sessionToken, "loopback")).toThrow("auth_expired");
	});
	test("rotation crash-retry survives restart, same successor only for sixty seconds", async () => {
		const { auth, root, advance } = await store();
		const c = await enroll(auth),
			successor = `aiki_s1.${c.sessionId}.${randomBytes(32).toString("base64url")}`;
		auth.rotate(c.sessionToken, successor);
		const replay = auth.rotate(c.sessionToken, successor);
		auth.close();
		const restarted = new DeviceAuth(root, {}, auth.now);
		expect(restarted.rotate(c.sessionToken, successor)).toEqual(replay);
		expect(() => restarted.refresh(c.sessionToken, "loopback")).toThrow();
		expect(() =>
			restarted.rotate(c.sessionToken, `aiki_s1.${c.sessionId}.${randomBytes(32).toString("base64url")}`),
		).toThrow();
		expect(restarted.refresh(successor, "loopback").sessionId).toBe(c.sessionId);
		advance(60001);
		expect(() => restarted.rotate(c.sessionToken, successor)).toThrow();
		restarted.close();
	});
	test("revoke persists, blocks all token generations and cancels unused grants", async () => {
		const { auth, root } = await store();
		const c = await enroll(auth),
			grant = auth.createPairing(c.sessionId);
		await auth.revoke(c.sessionId);
		expect(() => auth.authenticate(c.accessToken)).toThrow();
		expect(() => auth.refresh(c.sessionToken, "loopback")).toThrow("auth_revoked");
		await expect(
			auth.redeem({ grantId: grant.pairing.id, secret: grant.secret, ...proof() }, "loopback"),
		).rejects.toThrow("grant_used");
		auth.close();
		const restarted = new DeviceAuth(root);
		expect(() => restarted.refresh(c.sessionToken, "loopback")).toThrow("auth_revoked");
		restarted.close();
	});
	test("poll, grant creation, enrollment limits return retry hints", async () => {
		const { auth } = await store();
		const c = await enroll(auth),
			grant = auth.createPairing(c.sessionId),
			claim = proof();
		await auth.redeem({ grantId: grant.pairing.id, secret: grant.secret, ...claim }, "loopback");
		auth.poll(claim.claimId, claim.claimSecret);
		try {
			auth.poll(claim.claimId, claim.claimSecret);
			throw new Error("missing limit");
		} catch (error) {
			expect(error).toBeInstanceOf(DeviceAuthError);
			expect((error as DeviceAuthError).retryAfter).toBe(1);
		}
		for (let n = 0; n < 4; n++) auth.createPairing(c.sessionId);
		expect(() => auth.createPairing(c.sessionId)).toThrow("pending_limit");
		for (let n = 0; n < 5; n++)
			await expect(auth.redeem({ grantId: "missing", secret: "bad", ...proof() }, "same")).rejects.toThrow();
		try {
			await auth.redeem({ grantId: "missing", secret: "bad", ...proof() }, "same");
		} catch (error) {
			expect((error as DeviceAuthError).status).toBe(429);
		}
	});
});

describe("device-auth network boundary", () => {
	for (const mode of ["off", "optional"] as const)
		test(`${mode} retains legacy hello but denies auth management`, async () => {
			const s = await setup(mode),
				{ c, hello } = await client(s);
			expect(hello).toMatchObject({
				type: "hello",
				backendId: s.server.auth.backendId,
				auth: { mode, sessionId: null, accessExpiresAt: null },
			});
			expect((await c.request({ type: "projects.list" })).type).toBe("projects.list");
			expect(await c.request({ type: "auth.devices.list" })).toMatchObject({
				type: "error",
				error: { code: "auth_required" },
			});
		});
	test("Origin-less required socket reveals nothing before authenticated hello", async () => {
		const s = await setup(),
			{ c, hello } = await client(s);
		expect(hello).toMatchObject({ type: "error", error: { code: "auth_required" } });
		await c.closed();
		expect((await s.server.manager.list()).length).toBe(0);
	});
	test("required binary and oversized first frames close without activation", async () => {
		const s = await setup();
		for (const payload of [new Uint8Array([2, 0, 0, 0, 1]), "x".repeat(8193)]) {
			const ws = new WebSocket(`${s.server.url.replace("http", "ws")}/ws`);
			await new Promise((r) => (ws.onopen = r));
			const closed = new Promise<number>((r) => (ws.onclose = (e) => r(e.code)));
			ws.send(payload);
			expect(await closed).toBe(4401);
		}
	});
	test("authenticated hello, refresh/renew same session, immutable identity", async () => {
		const s = await setup();
		const credentials = await enroll(s.server.auth),
			{ c, hello } = await client(s, credentials);
		expect(hello).toMatchObject({ type: "hello", auth: { sessionId: credentials.sessionId } });
		expect(await c.request({ type: "auth.devices.list" })).toMatchObject({
			type: "auth.devices.list",
			devices: [{ current: true, connectedCount: 1 }],
		});
		const refresh = await post(s, "/auth/session/refresh", {}, credentials.sessionToken);
		expect(refresh.status).toBe(200);
		const next = (await refresh.json()) as { accessToken: string };
		expect(await c.request({ type: "auth.renew", accessToken: next.accessToken })).toMatchObject({
			type: "auth.renew",
		});
		const other = await enroll(s.server.auth);
		expect(await c.request({ type: "auth.renew", accessToken: other.accessToken })).toMatchObject({
			type: "error",
			error: { code: "auth_invalid" },
		});
	});
	test("renew works within grace while ordinary traffic is denied", async () => {
		let now = Date.now();
		const s = await setup("required", { now: () => now });
		const credentials = await enroll(s.server.auth),
			{ c } = await client(s, credentials);
		now += ACCESS_TTL + 1;
		expect(await c.request({ type: "projects.list" }, 1000)).toMatchObject({
			type: "error",
			error: { code: "auth_expired" },
		});
		const fresh = s.server.auth.refresh(credentials.sessionToken, "loopback");
		expect(await c.request({ type: "auth.renew", accessToken: fresh.accessToken })).toMatchObject({
			type: "auth.renew",
		});
		expect((await c.request({ type: "projects.list" })).type).toBe("projects.list");
	});
	test("revocation closes live WS 4403, removes push registration and detaches PTY", async () => {
		const terminalRoot = await mkdtemp(join(tmpdir(), "auth-terminal-"));
		cleanups.push(() => rm(terminalRoot, { recursive: true, force: true }));
		const s = await setup("required", {
			terminals: { multiplexer: "none", command: ["bash", "--norc", "--noprofile"] },
		});
		const credentials = await enroll(s.server.auth);
		const { c } = await client(s, credentials);
		const ws = new WebSocket(`${s.server.url.replace("http", "ws")}/ws`);
		await new Promise((r) => (ws.onopen = r));
		const greeted = new Promise((r) => (ws.onmessage = r));
		ws.send(
			JSON.stringify({ type: "hello", id: "g", protocolVersion: 1, auth: { accessToken: credentials.accessToken } }),
		);
		await greeted;
		const close = new Promise<number>((r) => (ws.onclose = (e) => r(e.code)));
		expect(await c.request({ type: "terminal.open", cols: 80, rows: 24 })).toMatchObject({ type: "terminal.open" });
		expect(s.server.terminals?.attachedCount).toBe(1);
		expect(
			await c.request({
				type: "notifications.registerFcm",
				deviceId: "fixture",
				label: "Phone",
				backendKey: "example",
				token: "synthetic-token",
				preferences: { kinds: [], mutedProjects: [], quietHours: null },
			}),
		).toMatchObject({ type: "notifications.registerFcm" });
		await s.server.auth.revoke(credentials.sessionId);
		expect(await close).toBe(4403);
		await c.closed();
		for (let n = 0; n < 50 && s.server.terminals?.attachedCount; n++) await Bun.sleep(10);
		expect(s.server.terminals?.attachedCount).toBe(0);
		expect(s.server.notifications.device("fixture")).toBeNull();
		const reconnected = await client(s, credentials);
		expect(reconnected.hello).toMatchObject({ type: "error", error: { code: "auth_revoked" } });
	});
	test("HTTP discovery minimal no-store, CORS and Host checks differ by mode", async () => {
		const s = await setup("required", { allowedOrigins: ["https://app.example.com"] });
		const status = await fetch(`${s.server.url}/auth/status`);
		expect(await status.json()).toEqual(s.server.auth.status());
		expect(status.headers.get("cache-control")).toBe("no-store");
		for (const origin of [
			"null",
			"https://app.example.com:444",
			"http://app.example.com",
			"https://app.example.com/path",
		]) {
			expect((await fetch(`${s.server.url}/auth/status`, { headers: { origin } })).status).toBe(403);
		}
		const options = await fetch(`${s.server.url}/auth/status`, {
			method: "OPTIONS",
			headers: { origin: "https://app.example.com" },
		});
		expect(options.status).toBe(204);
		expect(options.headers.get("access-control-allow-origin")).toBe("https://app.example.com");
		expect((await fetch(`${s.server.url}/auth/status`, { headers: { host: "untrusted.example.net" } })).status).toBe(
			403,
		);
		s.server.auth.setMode("optional");
		expect((await fetch(`${s.server.url}/auth/status`, { headers: { host: "untrusted.example.net" } })).status).toBe(
			200,
		);
		expect(s.server.auth.hostsList().observed).toContain("http://untrusted.example.net");
		expect(s.server.auth.hostsList().allowed).not.toContain("http://untrusted.example.net");
	});
	test("HTTP bootstrap + polling retry + ack and bounded body", async () => {
		const s = await setup(),
			grant = s.server.auth.bootstrap(),
			claim = proof();
		const response = await post(s, "/auth/bootstrap/redeem", {
			requestId: grant.requestId,
			code: grant.secret,
			...claim,
		});
		expect(response.status).toBe(200);
		const approved = (await response.json()) as { credentials: SessionCredentials };
		expect(approved.credentials.backendId).toBe(s.server.auth.backendId);
		expect((await post(s, "/auth/claims/poll", claim)).status).toBe(200);
		const limited = await post(s, "/auth/claims/poll", claim);
		expect(limited.status).toBe(429);
		expect(limited.headers.get("retry-after")).toBe("1");
		expect((await post(s, "/auth/claims/ack", claim)).status).toBe(200);
		expect(
			(await post(s, "/auth/session/refresh", { oversized: "x".repeat(9000) }, approved.credentials.sessionToken))
				.status,
		).toBe(413);
	});
	test("migration inventory → exact batch approval → credentials → ack; required closes migration", async () => {
		const s = await setup("optional"),
			claim = proof();
		expect((await post(s, "/auth/migration/claims", claim)).status).toBe(200);
		expect(s.server.auth.inventory()).toMatchObject([{ claimId: claim.claimId, state: "pending" }]);
		s.server.auth.approveMigration("fixture-batch", [claim.claimId]);
		expect(s.server.auth.approveMigration("fixture-batch", [claim.claimId])).toEqual({ ok: true });
		expect(() => s.server.auth.approveMigration("fixture-batch", ["different"])).toThrow("batch_mismatch");
		const delivered = await post(s, "/auth/claims/poll", claim);
		expect(((await delivered.json()) as { credentials: SessionCredentials }).credentials.sessionToken).toStartWith(
			"aiki_s1.",
		);
		await post(s, "/auth/claims/ack", claim);
		s.server.auth.setMode("required");
		expect((await post(s, "/auth/migration/claims", proof())).status).toBe(403);
	});
	test("owner Unix socket reaches running server; CLI emits bootstrap only to caller", async () => {
		const logs: string[] = [];
		const s = await setup("required", { log: (line) => logs.push(line) });
		const socket = join(s.dataDir, "auth.sock");
		expect((await stat(socket)).mode & 0o777).toBe(0o600);
		const command = async (args: string[]) => {
			const r = await fetch("http://localhost/", {
				unix: socket,
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ args }),
				signal: AbortSignal.timeout(3000),
			});
			expect(r.ok).toBe(true);
			return r.json() as Promise<Record<string, unknown>>;
		};
		expect(await command(["status"])).toEqual(s.server.auth.status());
		await command(["hosts", "allow", "https://backend.example.com"]);
		const paired = await command([
			"pair",
			"--backend",
			"https://backend.example.com",
			"--web-app",
			"https://app.example.com",
		]);
		expect(paired.code).toMatch(/^[A-Z2-7]{12}$/);
		expect(logs.join("\n")).not.toContain(String(paired.code));
		expect(logs.join("\n")).not.toContain(String(paired.url));
		await command(["mode", "optional"]);
		expect(s.server.auth.mode).toBe("optional");
	});
	test("restart retains backend identity and sessions", async () => {
		const s = await setup(),
			c = await enroll(s.server.auth),
			backend = s.server.auth.backendId;
		await s.restart();
		expect(s.server.auth.backendId).toBe(backend);
		const { hello } = await client(s, c);
		expect(hello).toMatchObject({ type: "hello", auth: { sessionId: c.sessionId } });
	});
	test("no credentials, claim bodies, code or Authorization in logs or auth errors", async () => {
		const logs: string[] = [];
		const s = await setup("required", { log: (line) => logs.push(line) }),
			grant = s.server.auth.bootstrap(),
			claim = proof();
		const response = await post(s, "/auth/bootstrap/redeem", {
			requestId: grant.requestId,
			code: grant.secret,
			...claim,
		});
		const c = ((await response.json()) as { credentials: SessionCredentials }).credentials;
		const bad = await post(s, "/auth/session/refresh", {}, c.sessionToken + "invalid");
		const errors = await bad.text();
		const invalid = await client(s, { ...c, accessToken: c.accessToken + "bad" });
		expect(invalid.hello.type).toBe("error");
		for (const secret of [grant.secret, claim.claimSecret, c.sessionToken, c.accessToken]) {
			expect(logs.join("\n")).not.toContain(secret);
			expect(errors).not.toContain(secret);
		}
	});
});

describe("artifact session capabilities and pairing encoding", () => {
	test("v2 signatures have ten-minute TTL, reject legacy in required and fail after revoke", async () => {
		const { auth, advance } = await store();
		const c = await enroll(auth);
		const signer = new ArtifactUrlSigner({
			secret: randomBytes(32),
			now: auth.now,
			sessionActive: (id) => auth.active(id),
			required: () => auth.mode === "required",
		});
		expect(signer.ttlMs).toBe(600000);
		const signed = signer.sign("project", "artifact", "inline", c.sessionId),
			token = new URL(signed.path, "http://localhost").searchParams.get("token");
		expect(token).toStartWith("v2.");
		expect(signer.verify("project", "artifact", token)).toBe("inline");
		const stream = signer.stream(new Blob(["synthetic"]), c.sessionId);
		const reader = stream.getReader();
		await auth.revoke(c.sessionId);
		signer.revoke(c.sessionId);
		await expect(reader.read()).rejects.toThrow();
		expect(signer.verify("project", "artifact", token)).toBeUndefined();
		auth.setMode("optional");
		const legacy = signer.sign("project", "artifact", "inline");
		auth.setMode("required");
		expect(
			signer.verify("project", "artifact", new URL(legacy.path, "http://localhost").searchParams.get("token")),
		).toBeUndefined();
		advance(600001);
		expect(signer.verify("project", "artifact", token)).toBeUndefined();
	});
	test("pair fragment canonical roundtrip and cross-platform comparison fixture", async () => {
		const pairing = {
			backendId: "backend-example",
			backendOrigin: "https://backend.example.com",
			grantId: "grant-example",
			secret: `aiki_p1.${"A".repeat(43)}`,
		};
		const encoded = encodePairingFragment(pairing);
		expect(decodePairingFragment(encoded)).toEqual(pairing);
		expect(() => decodePairingFragment("#pair=v1.e30")).toThrow();
		expect(() => encodePairingFragment({ ...pairing, backendOrigin: "http://backend.example.com" })).toThrow();
		expect(
			await deviceComparisonCode("backend-example", "grant-example", "claim-example", `aiki_c1.${"A".repeat(43)}`),
		).toBe("VE2X-TWTS");
	});
});

describe("revocation and boundary regressions", () => {
	test("session-bound artifact GET/HEAD is public with signature but fails immediately after revoke", async () => {
		const s = await setup(),
			credentials = await enroll(s.server.auth),
			{ c } = await client(s, credentials);
		const added = await c.request({ type: "projects.add", path: s.projectDir });
		if (added.type !== "projects.add") throw new Error("project fixture failed");
		const source = join(s.projectDir, "hostile.html");
		await writeFile(source, "<script>throw new Error('synthetic')</script>");
		const artifact = await s.server.artifacts.save({
			projectId: added.project.id,
			sourcePath: source,
			title: null,
			note: null,
			threadId: "main",
			workerId: null,
			taskId: null,
		});
		const signed = await c.request({ type: "artifacts.url", projectId: added.project.id, artifactId: artifact.id });
		if (signed.type !== "artifacts.url") throw new Error("signature fixture failed");
		const before = await fetch(signed.url);
		expect(before.status).toBe(200);
		expect(before.headers.get("content-disposition")).toStartWith("attachment;");
		expect(before.headers.get("cache-control")).toBe("private, no-store");
		expect(before.headers.get("referrer-policy")).toBe("no-referrer");
		await before.text();
		expect(new Date(signed.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(600000);
		await s.server.auth.revoke(credentials.sessionId);
		expect((await fetch(signed.url)).status).toBe(403);
		expect((await fetch(signed.url, { method: "HEAD" })).status).toBe(403);
	});
	test("optional→required closes legacy WS and management RPC never creates a grant anonymously", async () => {
		const s = await setup("optional"),
			{ c } = await client(s);
		expect(await c.request({ type: "auth.pairings.create" })).toMatchObject({
			type: "error",
			error: { code: "auth_required" },
		});
		s.server.auth.setMode("required");
		await c.closed();
		expect(s.server.auth.pairings("untrusted")).toEqual([]);
	});
	test("authenticated re-registration binds FCM while optional legacy updates retain that binding", async () => {
		const s = await setup("optional"),
			legacy = await client(s),
			registration = {
				deviceId: "migration-phone",
				label: "Phone",
				backendKey: "example",
				token: "synthetic-fcm-token",
				preferences: { kinds: [], mutedProjects: [], quietHours: null },
			};
		expect((await legacy.c.request({ type: "notifications.registerFcm", ...registration })).type).toBe(
			"notifications.registerFcm",
		);
		const credentials = await enroll(s.server.auth),
			authenticated = await client(s, credentials);
		expect((await authenticated.c.request({ type: "notifications.registerFcm", ...registration })).type).toBe(
			"notifications.registerFcm",
		);
		expect(await legacy.c.request({ type: "notifications.registerFcm", ...registration })).toMatchObject({type:"notifications.registerFcm"});
  expect(await legacy.c.request({ type: "notifications.device", deviceId: registration.deviceId })).toMatchObject({type:"notifications.device"});
		await s.server.auth.revoke(credentials.sessionId);
		expect(s.server.notifications.device(registration.deviceId)).toBeNull();
	});
	test("untrusted proxy headers cannot mint attacker origins; configured proxy origin is exact", async () => {
		const s = await setup();
		expect(
			(
				await fetch(`${s.server.url}/auth/status`, {
					headers: { "x-forwarded-host": "evil.example.net", "x-forwarded-proto": "https" },
				})
			).status,
		).toBe(200);
		const proxy = await setup("required", {
			auth: { mode: "required", backendOrigins: ["https://backend.example.com"], trustedProxies: ["127.0.0.1"] },
		});
		expect(
			(
				await fetch(`${proxy.server.url}/auth/status`, {
					headers: { "x-forwarded-host": "backend.example.com", "x-forwarded-proto": "https" },
				})
			).status,
		).toBe(200);
		expect(
			(
				await fetch(`${proxy.server.url}/auth/status`, {
					headers: { "x-forwarded-host": "backend.example.com:444", "x-forwarded-proto": "https" },
				})
			).status,
		).toBe(403);
	});
	test("owner CLI entry point talks to running backend, not a second server", async () => {
		const s = await setup();
		const child = Bun.spawn(["bun", "packages/server/src/main.ts", "auth", "status"], {
			env: { ...process.env, AIKI_DATA_DIR: s.dataDir },
			stdout: "pipe",
			stderr: "pipe",
			timeout: 5000,
		});
		const [stdout, stderr, exit] = await Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited,
		]);
		expect(exit).toBe(0);
		expect(stderr).toBe("");
		expect(JSON.parse(stdout)).toEqual(s.server.auth.status());
	});
	test("invalid retained proofs and expired access cannot keep idle sessions alive", async () => {
		const { auth, advance } = await store();
		const c = await enroll(auth);
		advance(179 * 86400_000);
		const wrong = `aiki_s1.${c.sessionId}.${"A".repeat(43)}`;
		expect(() => auth.refresh(wrong, "loopback")).toThrow();
		expect(() => auth.authenticate(c.accessToken)).toThrow();
		advance(86400_000 + 1);
		expect(() => auth.refresh(c.sessionToken, "loopback")).toThrow("auth_expired");
	});
});
