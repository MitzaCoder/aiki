import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ReleaseUpdates, UPDATE_CHECK_INTERVAL_MS as DAY } from "../src/release-updates.ts";
import { createSetup, TestClient } from "./support.ts";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const feed = [{ tag_name: "v0.1.0-pilot.2", draft: false, prerelease: true }, { tag_name: "v0.0.9", draft: false, prerelease: false }];
async function file() { const root = await mkdtemp(join(tmpdir(), "aiki-updates-")); roots.push(root); return join(root, "checks.json"); }
const transport = (fn: (url: string | URL | Request, init?: RequestInit) => Promise<Response>) => fn as typeof fetch;

test("installed pilot: ETag, 304, persisted daily budget, dismissal and setting survive restarts", async () => {
	const path = await file(); let now = DAY; const headers: Headers[] = [];
	const fetcher = transport(async (_url, init) => { headers.push(new Headers(init?.headers)); return headers.length === 1 ? Response.json(feed, { headers: { etag: '"synthetic"' } }) : new Response(null, { status: 304 }); });
	const options = { file: path, installedVersion: "v0.1.0-pilot.1", channel: "pilot" as const, transport: fetcher, now: () => now };
	let service = await ReleaseUpdates.create(options);
	await Promise.all([service.check(), service.check()]);
	expect(headers).toHaveLength(1); expect(headers[0]!.has("authorization")).toBe(false);
	expect(service.state.available?.version).toBe("v0.1.0-pilot.2");
	await service.set({ dismissVersion: "v0.1.0-pilot.2" }); service.stop();
	service = await ReleaseUpdates.create(options); await service.check(); expect(headers).toHaveLength(1);
	expect(service.state.dismissedVersion).toBe("v0.1.0-pilot.2");
	now += DAY; await service.check(); expect(headers).toHaveLength(2);
	expect(headers[1]!.get("if-none-match")).toBe('"synthetic"'); expect(service.state.available?.version).toBe("v0.1.0-pilot.2");
	await service.set({ enabled: false }); service.stop();
	service = await ReleaseUpdates.create(options); now += DAY * 3; await service.check(); expect(headers).toHaveLength(2); expect(service.state.available).toBeNull(); service.stop();
});

test("stable ignores pilots and equal/older releases; dev/source and deploy checkouts never request or nag by default", async () => {
	let calls = 0; const fetcher = transport(async () => { calls++; return Response.json(feed); });
	const dev = await ReleaseUpdates.create({ file: await file(), transport: fetcher });
	await dev.check(); expect(calls).toBe(0); expect(dev.state.enabled).toBe(false); expect(dev.state.available).toBeNull();
	await dev.set({ enabled: true }); await dev.check(); expect(calls).toBe(1); expect(dev.state.available).not.toBeNull(); dev.stop();
	for (const version of ["v0.0.9", "v0.1.0"]) {
		const stable = await ReleaseUpdates.create({ file: await file(), installedVersion: version, transport: fetcher });
		await stable.check(); expect(stable.state.available).toBeNull(); stable.stop();
	}
});

test("403/429 honour Retry-After and rate-limit reset across restarts; offline and bad responses stay silent", async () => {
	for (const status of [403, 429]) {
		let now = DAY; let calls = 0; const path = await file();
		const options = { file: path, installedVersion: "v0.1.0", now: () => now, transport: transport(async () => { calls++; return new Response(null, { status, headers: { "retry-after": String(3 * DAY / 1000), "x-ratelimit-reset": String(5 * DAY / 1000) } }); }) };
		let service = await ReleaseUpdates.create(options); await service.check(); service.stop();
		service = await ReleaseUpdates.create(options); now = 4 * DAY; await service.check(); expect(calls).toBe(1);
		now = 5 * DAY; await service.check(); expect(calls).toBe(2); service.stop();
	}
	for (const response of [() => { throw new Error("offline"); }, () => new Response("bad json"), () => new Response(null, { status: 500 })]) {
		let calls = 0;
		const service = await ReleaseUpdates.create({ file: await file(), installedVersion: "v0.1.0", transport: transport(async () => { calls++; return response(); }) });
		await service.check(); await service.check(); expect(calls).toBe(1); expect(service.state.available).toBeNull(); service.stop();
	}
});

test("startup is delayed and corrupt state disables checks without preventing startup", async () => {
	let calls = 0; const path = await file();
	const options = { file: path, installedVersion: "v0.1.0", transport: transport(async () => { calls++; return Response.json(feed); }) };
	const service = await ReleaseUpdates.create(options); service.start();
	expect(calls).toBe(0); service.stop();
	await writeFile(path, "broken cache");
	const corrupted = await ReleaseUpdates.create(options); await corrupted.check(); expect(calls).toBe(0); expect(corrupted.state.enabled).toBe(false); corrupted.stop();
});

test("status is optional/versioned; backend-wide settings and dismissal publish through the authenticated protocol", async () => {
	const setup = await createSetup({ updates: { installedVersion: "v0.1.0-pilot.1", channel: "pilot", transport: transport(async () => Response.json(feed)) } });
	try {
		const client = await TestClient.open(setup.server); const hello = await client.hello();
		expect(hello.type).toBe("hello");
		if (hello.type === "hello") expect(hello.features).toContain("release-updates");
		await setup.server.releaseUpdates.check();
		const initial = await client.request({ type: "server.status" });
		expect(initial.type).toBe("server.status");
		if (initial.type === "server.status") {
			expect(initial.status.updates?.schemaVersion).toBe(1);
			expect(initial.status.updates?.available?.version).toBe("v0.1.0-pilot.2");
		}
		const dismissed = await client.request({ type: "server.updates.set", dismissVersion: "v0.1.0-pilot.2" });
		if (dismissed.type === "server.updates.set") expect(dismissed.updates.dismissedVersion).toBe("v0.1.0-pilot.2");
		const saved = await client.request({ type: "server.updates.set", enabled: false });
		if (saved.type === "server.updates.set") expect(saved.updates.enabled).toBe(false);
		await setup.server.stop(); const server = await setup.restart();
		const next = await TestClient.open(server); await next.hello();
		const status = await next.request({ type: "server.status" });
		if (status.type === "server.status") expect(status.status.updates?.enabled).toBe(false);
	} finally { await setup.cleanup(); }
});
