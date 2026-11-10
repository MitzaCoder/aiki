import { expect, test } from "bun:test";
import net from "node:net";
import { assertLoopback } from "./network-guard";
import { fixture, call } from "./support";
test("POST only, bounded JSON, strict bodies and headers", async () => {
	expect((await call("accounts/status", {}, undefined, { method: "GET" })).status).toBe(405);
	expect((await call("accounts/status", {}, undefined, { body: "{" })).status).toBe(400);
	expect((await call("accounts/status", {}, undefined, { body: "x".repeat(8193) })).status).toBe(413);
	expect((await call("accounts/status", {}, undefined, { contentEncoding: "gzip" })).status).toBe(415);
	expect((await call("unknown")).status).toBe(404);
	const response = await call("accounts/status");
	expect(response.headers["Cache-Control"]).toBe("no-store");
	expect(response.headers["Set-Cookie"]).toBeUndefined();
	expect(response.headers.Location).toBeUndefined();
	expect((await call("accounts/status", { uid: fixture.other.localId })).status).toBe(400);
});
test("network guard rejects fetch, socket, TLS and DNS destinations outside loopback", async () => {
	expect(() => assertLoopback("example.com")).toThrow();
	expect(() => fetch("https://example.com")).toThrow("Non-loopback");
	expect(() => net.connect({ host: "192.0.2.1", port: 443 })).toThrow("Non-loopback");
	const tls = await import("node:tls");
	expect(() => tls.connect({ host: "example.com", port: 443 })).toThrow("Non-loopback");
	const dns = await import("node:dns");
	expect(() => dns.lookup("example.com", () => {})).toThrow("Non-loopback");
	expect(() => Bun.dns.lookup("example.com")).toThrow("Non-loopback");
	expect(() => dns.resolve("example.com", () => {})).toThrow("Non-loopback");
});
test("only octet-stream reaches our JSON parser; missing or other content types get fixed 415", async () => {
	for (const contentType of [undefined, "application/json", "text/plain", "application/x-www-form-urlencoded"]) {
		const response = await call("accounts/status", {}, undefined, { contentType });
		expect(response.status).toBe(415);
		expect(response.body).toEqual({ error: "unsupported_content_type" });
		expect(response.headers["Cache-Control"]).toBe("no-store");
	}
	const malformed = await call("accounts/status", {}, undefined, { body: '{"synthetic_private_probe":' });
	expect(malformed.status).toBe(400);
	expect(malformed.body).toEqual({ error: "invalid_request" });
});
