import { afterEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { childEnvironment } from "../src/child-environment.ts";
import { startServer } from "../src/server.ts";
import { createSetup, type TestSetup } from "./support.ts";

const setups: TestSetup[] = [];
afterEach(async () => { for (const setup of setups.splice(0)) await setup.cleanup(); });
async function setup() {
	const s = await createSetup({ terminals: false });
	setups.push(s);
	return s;
}

test("a second start refuses a live owner before touching auth state, even with its own control socket off", async () => {
	const s = await setup();
	const file = join(s.dataDir, "auth.sqlite");
	const before = await readFile(file);
	for (const controlSocket of [true, false]) {
		await expect(startServer({
			dataDir: s.dataDir, port: 0, agentDir: s.agentDir, configDir: s.configDir, claudeDir: s.claudeDir,
			auth: { mode: "required", controlSocket },
		})).rejects.toThrow("Another live server owns data directory");
		expect(await readFile(file)).toEqual(before);
		expect(s.server.auth.status().mode).toBe("off");
	}
	expect((await fetch(`${s.server.url}/auth/status`)).status).toBe(200);
}, 15_000);

test("a brief retiring-owner overlap waits, then starts after shutdown finishes", async () => {
	const s = await setup();
	const before = await readFile(join(s.dataDir, "auth.sqlite"));
	const flushFinished = Promise.withResolvers<void>();
	const originalFlush = s.server.notifications.flush.bind(s.server.notifications);
	s.server.notifications.flush = async () => { await flushFinished.promise; await originalFlush(); };
	const startingAt = performance.now();
	const stopping = s.server.stop(); // Request shutdown first, but hold one asynchronous shutdown write.
	const starting = startServer({
		dataDir: s.dataDir, port: 0, agentDir: s.agentDir, configDir: s.configDir, claudeDir: s.claudeDir,
		models: s.models, credentials: s.credentials, terminals: false, auth: { mode: "off" }, log: () => {},
	});
	try {
		await Bun.sleep(150);
		expect(existsSync(join(s.dataDir, "auth.sock"))).toBe(true);
		expect(await readFile(join(s.dataDir, "auth.sqlite"))).toEqual(before);
		flushFinished.resolve();
		await stopping;
		const restarted = await starting;
		expect(performance.now() - startingAt).toBeGreaterThanOrEqual(150);
		expect(performance.now() - startingAt).toBeLessThan(3000);
		expect((await fetch(`${restarted.url}/auth/status`)).status).toBe(200);
	} finally {
		flushFinished.resolve();
		await stopping;
		await (await starting).stop();
	}
});

test("normal restart and stale socket recovery still work", async () => {
	const s = await setup();
	await s.restart();
	await s.server.stop();
	const socket = join(s.dataDir, "auth.sock");
	// Immediate exit, like a crash: leave the socket file but no live listener. No server/data is opened here.
	const child = Bun.spawnSync([process.execPath, "-e", `import { createServer } from "node:net"; createServer().listen(${JSON.stringify(socket)}, () => process.exit(0));`], { env: childEnvironment() });
	expect(child.stderr.toString()).toBe("");
	expect(child.exitCode).toBe(0);
	expect(existsSync(socket)).toBe(true);
	await s.restart();
	expect((await fetch(`${s.server.url}/auth/status`)).status).toBe(200);
});
