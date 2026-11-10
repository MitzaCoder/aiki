import { expect, test } from "bun:test";
import { fixture, store, httpCaptures, functionsUrl, random, enroll, route, payload } from "./support";
test("non-protocol residual: malformed application/json is rejected by the upstream framework", async () => {
	const response = await fetch(functionsUrl + "/v1/accounts/status", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: '{"synthetic_parser_probe":',
	});
	expect(response.status).toBe(400);
	expect(response.headers.get("cache-control")).not.toBe("no-store");
	expect(response.headers.get("content-type")).not.toContain("application/json");
}, 30000);
test("routing, POST only, no-store, body caps and authentication", async () => {
	const get = await fetch(functionsUrl + "/v1/accounts/status");
	expect(get.status).toBe(405);
	expect(get.headers.get("cache-control")).toBe("no-store");
	expect(get.headers.get("set-cookie")).toBeNull();
	expect(get.headers.get("location")).toBeNull();
	const post = (path: string, body = "{}", token?: string) =>
		fetch(functionsUrl + "/v1/" + path, {
			method: "POST",
			headers: { "Content-Type": "application/octet-stream", ...(token ? { Authorization: "Bearer " + token } : {}) },
			body,
		});
	expect((await post("unknown")).status).toBe(404);
	expect((await post("accounts/status")).status).toBe(401);
	expect((await post("accounts/status", "{}", fixture.anonymous.idToken)).status).toBe(403);
	expect((await post("accounts/status", "{}", fixture.wrongProject.idToken)).status).toBe(401);
	expect((await post("accounts/status", "{}", fixture.primary.idToken)).status).toBe(200);
	expect((await post("send", JSON.stringify({ padding: "x".repeat(4097) }))).status).toBe(413);
	expect(
		(await post("accounts/status", JSON.stringify({ padding: "x".repeat(8192) }), fixture.primary.idToken)).status,
	).toBe(413);
}, 30000);
test("real Admin Auth/Firestore wiring sends challenge only to local fake and completes enrollment", async () => {
	httpCaptures.length = 0;
	const installationId = random();
	const operationId = random();
	const token = "synthetic-http-token";
	const post = (path: string, body: unknown) =>
		fetch(functionsUrl + "/v1/" + path, {
			method: "POST",
			headers: { "Content-Type": "application/octet-stream", Authorization: "Bearer " + fixture.primary.idToken },
			body: JSON.stringify(body),
		});
	const beginResponse = await post("installations/begin", { installationId, operationId, token });
	expect(beginResponse.status).toBe(200);
	expect(httpCaptures.length).toBe(1);
	expect(httpCaptures[0].token).toBe(token);
	expect(httpCaptures[0].priority).toBe("normal");
	const challenge = JSON.parse(httpCaptures[0].data.aiki);
	const confirm = await post("installations/confirm", {
		installationId,
		operationId,
		challengeId: challenge.challengeId,
		nonce: challenge.nonce,
	});
	expect(confirm.status).toBe(200);
	expect((await store.installations.doc(installationId).get()).data()?.state).toBe("active");
}, 30000);
test("octet-stream JSON-looking client bytes bypass framework parsing and never enter its logs", async () => {
	const { readFile } = await import("node:fs/promises");
	const probe = "octet_private_probe_" + random();
	const headers = { "Content-Type": "application/octet-stream", Authorization: "Bearer " + fixture.primary.idToken };
	const installationId = random();
	const operationId = random();
	const accepted = await fetch(functionsUrl + "/v1/installations/begin", {
		method: "POST",
		headers,
		body: JSON.stringify({ installationId, operationId, token: probe }),
	});
	expect(accepted.status).toBe(200);
	expect(accepted.headers.get("cache-control")).toBe("no-store");
	// This valid JSON scalar is rejected by our object schema, not the framework's strict JSON parser.
	const scalarProbe = "octet_scalar_probe_" + random();
	const scalar = await fetch(functionsUrl + "/v1/accounts/status", {
		method: "POST",
		headers,
		body: JSON.stringify(scalarProbe),
	});
	expect(scalar.status).toBe(400);
	expect(await scalar.json()).toEqual({ error: "invalid_request" });
	expect(scalar.headers.get("cache-control")).toBe("no-store");
	const malformedProbe = "octet_malformed_probe_" + random();
	const malformed = await fetch(functionsUrl + "/v1/accounts/status", {
		method: "POST",
		headers,
		body: '{"' + malformedProbe + '":',
	});
	expect(malformed.status).toBe(400);
	expect(await malformed.json()).toEqual({ error: "invalid_request" });
	expect(malformed.headers.get("cache-control")).toBe("no-store");
	const otherType = await fetch(functionsUrl + "/v1/accounts/status", {
		method: "POST",
		headers: { ...headers, "Content-Type": "text/plain" },
		body: "{}",
	});
	expect(otherType.status).toBe(415);
	expect(await otherType.json()).toEqual({ error: "unsupported_content_type" });
	expect(otherType.headers.get("cache-control")).toBe("no-store");
	await Bun.sleep(100);
	const logs = await readFile("firebase-debug.log", "utf8");
	for (const secret of [probe, scalarProbe, malformedProbe]) expect(logs).not.toContain(secret);
}, 30000);

test("real HTTP send/status/delete expose D52 retry headers and capability-only deletion", async () => {
	const phone = await enroll();
	const credentials = await route(phone.installationId);
	const body = payload(credentials.routeId);
	const post = (path: string, input: unknown, credential: string) =>
		fetch(functionsUrl + "/v1/" + path, {
			method: "POST",
			headers: { "Content-Type": "application/octet-stream", Authorization: "Bearer " + credential },
			body: JSON.stringify(input),
		});
	httpCaptures.length = 0;
	fixture.httpFcmResult = "rate_limited";
	const first = await post("send", body, credentials.send);
	expect(first.status).toBe(429);
	expect(await first.json()).toEqual({ error: "fcm_rate_limited" });
	expect(Number(first.headers.get("retry-after"))).toBeGreaterThan(0);
	expect(first.headers.get("cache-control")).toBe("no-store");
	const retry = await post("send", body, credentials.send);
	expect(retry.status).toBe(429);
	expect(httpCaptures.length).toBe(1);
	const status = await post("send/status", { routeId: body.routeId, messageId: body.messageId }, credentials.send);
	const result = (await status.json()) as { state: string; code: string; retryAt: number };
	expect(result.state).toBe("retry");
	expect(result.code).toBe("fcm_rate_limited");
	expect(result.retryAt).toBeGreaterThan(Date.now());
	const deleted = await post("delete", { routeId: body.routeId }, credentials.deletion);
	expect(deleted.status).toBe(204);
	expect(await deleted.text()).toBe("");
	expect(deleted.headers.get("cache-control")).toBe("no-store");
	expect((await post("delete", { routeId: body.routeId }, credentials.deletion)).status).toBe(204);
	expect((await post("send", body, credentials.send)).status).toBe(404);
}, 30_000);
