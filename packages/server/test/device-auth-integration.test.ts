import { expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { ACCESS_TTL } from "../src/device-auth.ts";
import { LEGACY_HARNESS_FEATURES } from "@aiki/protocol";
import { authSetup, authPost, authClient, claimProof, httpEnroll, ownerControl } from "./device-auth-test-support.ts";

const authRoutes = ["/auth/status", "/auth/bootstrap/redeem", "/auth/pairings/redeem", "/auth/claims/poll", "/auth/claims/ack", "/auth/session/refresh", "/auth/session/rotate", "/auth/migration/claims", "/auth/unknown"];
const routes = ["/ws", ...authRoutes, "/artifacts/project/artifact", "/unknown"];

test("required HTTP checks exact Origin and Host before routing every surface", async () => {
	const s = await authSetup({ allowedOrigins: ["https://app.example.com"] });
	for (const path of routes) {
		for (const origin of ["null", "https://evil.example.net", "https://sibling.example.com", "http://app.example.com", "https://app.example.com:444"]) {
			const response = await fetch(s.server.url + path, { headers: { origin }, signal: AbortSignal.timeout(3000) });
			expect(response.status).toBe(403);
			expect(await response.json()).toMatchObject({ error: { code: "forbidden_origin" } });
		}
		const rebound = await fetch(s.server.url + path, { headers: { host: "rebound.example.net" }, signal: AbortSignal.timeout(3000) });
		expect(rebound.status).toBe(403);
		expect(await rebound.json()).toMatchObject({ error: { code: "forbidden_host" } });
		const anonymous = path.startsWith("/auth/") && path !== "/auth/status"
			? await authPost(s, path, {})
			: await fetch(s.server.url + path, { signal: AbortSignal.timeout(3000) });
		// Discovery is deliberately public; the WS upgrade is public but its hello is not.
		expect(anonymous.status).toBe(path === "/auth/status" ? 200 : path === "/ws" ? 426 : path.startsWith("/artifacts/") ? 403 : path === "/unknown" ? 401 : path === "/auth/unknown" ? 404 : path === "/auth/session/refresh" || path === "/auth/session/rotate" ? 401 : 400);
	}
	expect((await authClient(s)).hello).toMatchObject({ type: "error", error: { code: "auth_required" } });
});

test("local bootstrap refuses proxy peers and forwarding metadata without consuming the grant", async () => {
	for (const trustedProxies of [[], ["127.0.0.1"]]) {
		let now = Date.now();
		const s = await authSetup({ auth: { mode: "required", trustedProxies }, now: () => now });
		const grant = s.server.auth.bootstrap(true);
		const body = { requestId: "local", code: grant.secret, ...claimProof() };
		const forwardingHeaders: Record<string, string>[] = [
			{ forwarded: "for=192.0.2.10;host=backend.example.com;proto=https" },
			{ "x-forwarded-for": "192.0.2.10" },
			{ "x-forwarded-host": new URL(s.server.url).host },
			{ "x-forwarded-proto": "http" },
			{ "x-forwarded-port": "443" },
		];
		for (const headers of forwardingHeaders) {
			const response = await authPost(s, "/auth/bootstrap/redeem", body, headers);
			expect(response.status).toBe(401);
		}
		// Five rejected attempts legitimately exhaust this source/grant minute, not the grant itself.
		now += 60_000;
		const direct = await authPost(s, "/auth/bootstrap/redeem", body);
		expect(direct.status).toBe(trustedProxies.length ? 401 : 200);
	}
});

test("trusted proxy source limits cannot be bypassed by spoofing headers from untrusted peers", async () => {
	for (const trusted of [false, true]) {
		const s = await authSetup({ auth: { mode: "required", trustedProxies: trusted ? ["127.0.0.1"] : [] } });
		for (let attempt = 0; attempt < 6; attempt++) {
			const response = await authPost(s, "/auth/bootstrap/redeem", {
				requestId: "guessed", code: "invalid", ...claimProof(),
			}, { "x-forwarded-for": `192.0.2.${attempt + 1}` });
			expect(response.status).toBe(!trusted && attempt === 5 ? 429 : 401);
			if (response.status === 429) expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
		}
	}
});

test("guessed retained IDs cannot exhaust the global refresh budget of a valid session", async () => {
	const s = await authSetup({ auth: { mode: "required", trustedProxies: ["127.0.0.1"] } });
	const credentials = await httpEnroll(s);
	for (let attempt = 0; attempt < 650; attempt++) {
		const response = await authPost(s, "/auth/session/refresh", {}, {
			authorization: `Bearer aiki_s1.${attempt % 2 ? credentials.sessionId : attempt.toString(16).padStart(32, "0")}.${"A".repeat(43)}`,
			"x-forwarded-for": `198.51.100.${attempt % 250 + 1}`,
		});
		expect(response.status).toBe(attempt < 300 ? 401 : 429);
		if (response.status === 429) expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
	}
	const refreshed = await authPost(s, "/auth/session/refresh", {}, { authorization: `Bearer ${credentials.sessionToken}`, "x-forwarded-for": "192.0.2.1" });
	expect(refreshed.status).toBe(200);
}, 15_000);

test("bootstrap HTTP race enrolls just one session and never permits a second claim", async () => {
	const s = await authSetup();
	const grant = s.server.auth.bootstrap();
	const responses = await Promise.all(Array.from({ length: 2 }, () => authPost(s, "/auth/bootstrap/redeem", {
		requestId: grant.requestId, code: grant.secret, ...claimProof(),
	})));
	expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
	expect(s.server.auth.devices()).toHaveLength(1);
});

test("pairing over HTTP/WS binds creator, original expiry and proof, including denied and expired replay", async () => {
	let now = Date.now();
	const s = await authSetup({ now: () => now });
	const owner = await authClient(s, await httpEnroll(s));
	const other = await authClient(s, await httpEnroll(s));
	for (const outcome of ["deny", "cancel", "expire", "approve"] as const) {
		const grant = await owner.client.request({ type: "auth.pairings.create" });
		if (grant.type !== "auth.pairings.create") throw new Error("fixture grant failed");
		const claim = claimProof();
		const body = { grantId: grant.pairing.id, secret: grant.secret, ...claim };
		expect((await authPost(s, "/auth/pairings/redeem", { ...body, secret: "wrong" })).status).toBe(401);
		expect((await authPost(s, "/auth/pairings/redeem", body)).status).toBe(200);
		expect(await other.client.request({ type: "auth.pairings.approve", grantId: grant.pairing.id, claimId: claim.claimId })).toMatchObject({ type: "error", error: { code: "not_found" } });
		if (outcome === "expire") now += 300_000;
		const decision = await owner.client.request(outcome === "cancel"
			? { type: "auth.pairings.cancel", grantId: grant.pairing.id }
			: { type: outcome === "deny" ? "auth.pairings.deny" : "auth.pairings.approve", grantId: grant.pairing.id, claimId: claim.claimId });
		if (outcome === "expire") {
			expect(decision).toMatchObject({ type: "error", error: { code: "auth_expired" } });
			expect(owner.client.stopped).toBe(false);
			expect((await owner.client.request({ type: "projects.list" }, 1000)).type).toBe("projects.list");
		}
		else expect(decision.type).not.toBe("error");
		expect((await authPost(s, "/auth/claims/poll", { ...claim, claimSecret: claimProof().claimSecret })).status).toBe(401);
		const delivered = await authPost(s, "/auth/claims/poll", claim);
		const view = await delivered.json() as { state: string; credentials: unknown };
		expect(view.state).toBe(outcome === "approve" ? "approved" : outcome === "expire" ? "expired" : "denied");
		expect(Boolean(view.credentials)).toBe(outcome === "approve");
		if (outcome === "approve") {
			now += 60_000;
			expect(await (await authPost(s, "/auth/claims/poll", claim)).json()).toMatchObject({ state: "expired", credentials: null });
		}
		// The original grant stays claimed forever, regardless of how this claim ends.
		expect((await authPost(s, "/auth/pairings/redeem", { ...body, ...claimProof() })).status).toBe(409);
	}
});

test("idle pre-auth socket closes at five seconds with no project or hello work", async () => {
	const s = await authSetup();
	const ws = new WebSocket(s.server.url.replace(/^http/, "ws") + "/ws");
	const messages: unknown[] = [];
	ws.onmessage = event => messages.push(event.data);
	const started = Date.now();
	const closed = await new Promise<CloseEvent>((resolve, reject) => {
		const timer = setTimeout(() => { ws.close(); reject(new Error("pre-auth deadline missed")); }, 7000);
		ws.onclose = event => { clearTimeout(timer); resolve(event); };
	});
	expect(closed.code).toBe(4401);
	expect(Date.now() - started).toBeGreaterThanOrEqual(4900);
	expect(messages).toEqual([]);
	expect(await s.server.manager.list()).toEqual([]);
}, 10_000);

test("legacy feature lists do not advertise authentication and explicit auth never silently downgrades", async () => {
	const s = await authSetup({ auth: { mode: "optional" }, features: [...LEGACY_HARNESS_FEATURES] });
	const legacy = await authClient(s);
	if (legacy.hello.type !== "hello") throw new Error("fixture hello failed");
	expect(legacy.hello.features).not.toContain("device-auth-v1");
	expect((await legacy.client.request({ type: "projects.list" })).type).toBe("projects.list");
	const invalid = await authClient(s, { accessToken: "invalid" });
	expect(invalid.hello).toMatchObject({ type: "error", error: { code: "auth_invalid" } });
	await invalid.client.closed();
	expect((await ownerControl(s, ["mode", "required"])).status).toBe(200);
	expect((await authClient(s)).hello).toMatchObject({ type: "error", error: { code: "auth_required" } });
});

test("an anonymous HTTP flood cannot lock valid devices out of refresh or crash-retry rotation", async () => {
	const s = await authSetup({ auth: { mode: "required", trustedProxies: ["127.0.0.1"] } });
	const credentials = await httpEnroll(s);
	for (let attempt = 0; attempt < 605; attempt++) {
		const response = await authPost(s, "/auth/claims/poll", claimProof(), { "x-forwarded-for": `198.51.100.${attempt % 250 + 1}` });
		expect(response.status).toBe(attempt < 599 ? 401 : 429);
	}
	const headers = { authorization: `Bearer ${credentials.sessionToken}`, "x-forwarded-for": "192.0.2.1" };
	expect((await authPost(s, "/auth/session/refresh", {}, headers)).status).toBe(200);
	const successorToken = `aiki_s1.${credentials.sessionId}.${randomBytes(32).toString("base64url")}`;
	for (let retry = 0; retry < 2; retry++) expect((await authPost(s, "/auth/session/rotate", { successorToken }, headers)).status).toBe(200);
	await s.restart();
	expect((await authPost(s, "/auth/session/rotate", { successorToken }, headers)).status).toBe(200);
	expect((await authPost(s, "/auth/session/refresh", {}, headers)).status).toBe(401);
	const different = `aiki_s1.${credentials.sessionId}.${randomBytes(32).toString("base64url")}`;
	expect((await authPost(s, "/auth/session/rotate", { successorToken: different }, headers)).status).toBe(401);
	expect((await authPost(s, "/auth/session/refresh", {}, { ...headers, authorization: `Bearer ${successorToken}` })).status).toBe(200);
});

test("pairing HTTP race has one winner even when approval is disabled", async () => {
	const s = await authSetup();
	const owner = await authClient(s, await httpEnroll(s));
	const grant = await owner.client.request({ type: "auth.pairings.create", confirm: false });
	if (grant.type !== "auth.pairings.create") throw new Error("fixture grant failed");
	const responses = await Promise.all(Array.from({ length: 2 }, () => authPost(s, "/auth/pairings/redeem", {
		grantId: grant.pairing.id, secret: grant.secret, ...claimProof(),
	})));
	expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
	expect(s.server.auth.devices()).toHaveLength(2);
});

test("required first-frame cap counts UTF-8 bytes, accepting exactly 8 KiB", async () => {
	const s = await authSetup();
	const credentials = await httpEnroll(s);
	const hello = JSON.stringify({ type: "hello", id: "cap", protocolVersion: 1, auth: { accessToken: credentials.accessToken } });
	for (const excess of [0, 1]) {
		const ws = new WebSocket(s.server.url.replace(/^http/, "ws") + "/ws");
		await new Promise<void>((resolve, reject) => { ws.onopen = () => resolve(); ws.onerror = () => reject(new Error("fixture socket failed")); });
		const response = new Promise<string>(resolve => { ws.onmessage = event => resolve(String(event.data)); });
		const closed = new Promise<number>(resolve => { ws.onclose = event => resolve(event.code); });
		// Legal JSON whitespace uses ASCII; a multibyte client label fills part of the remaining bytes.
		const labeled = hello.slice(0, -1) + ',"client":{"name":"é","version":"0"}}';
		ws.send(labeled + " ".repeat(8192 - Buffer.byteLength(labeled) + excess));
		expect(JSON.parse(await response).type).toBe(excess ? "error" : "hello");
		if (excess) expect(await closed).toBe(4401);
		else ws.close();
	}
});

test("the access renewal grace ends at sixty seconds and refresh cannot revive the old socket", async () => {
	let now = Date.now();
	const s = await authSetup({ now: () => now });
	const credentials = await httpEnroll(s);
	const { client } = await authClient(s, credentials);
	now += ACCESS_TTL + 60_000;
	client.send({ type: "projects.list", id: "past-grace" });
	await client.closed();
	expect(client.messages).toContainEqual(expect.objectContaining({ type: "error", error: expect.objectContaining({ code: "auth_expired" }) }));
	const refreshed = await authPost(s, "/auth/session/refresh", {}, { authorization: `Bearer ${credentials.sessionToken}` });
	expect(refreshed.status).toBe(200);
	expect((await authClient(s, await refreshed.json() as { accessToken: string })).hello.type).toBe("hello");
});
