import "./clean-env.ts";
import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSetup, TestClient, type TestSetup } from "../../packages/server/test/support.ts";

const checker = join(import.meta.dir, "../health-check.ts");
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function run(args: string[], env: Record<string, string | undefined>) {
	const child = Bun.spawn([process.execPath, checker, ...args], {
		env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe", timeout: 10000,
	});
	const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
	return { code, stdout, stderr };
}

async function setup(mode: "off" | "optional" | "required") {
	const releaseRoot = await mkdtemp(join(tmpdir(), "aiki-check-release-"));
	cleanups.push(() => rm(releaseRoot, { recursive: true, force: true }));
	await writeFile(join(releaseRoot, "RELEASE.json"), JSON.stringify({
		name: "synthetic", commit: "abc123", description: "test", deployedAt: new Date().toISOString(),
	}));
	const s = await createSetup({ auth: { mode: "optional" }, terminals: false, status: { releaseRoot } });
	cleanups.push(s.cleanup);
	const client = await TestClient.open(s.server);
	await client.request({ type: "hello", protocolVersion: 1 });
	const added = await client.request({ type: "projects.add", path: s.projectDir });
	if (added.type !== "projects.add") throw new Error(JSON.stringify(added));
	await client.request({ type: "conversation.page", projectId: added.project.id, limit: 1 });
	client.close();
	s.server.auth.setMode(mode);
	const config = join(s.root, "config/aiki");
	await mkdir(config, { recursive: true });
	await writeFile(join(config, "server.env"), `AIKI_DATA_DIR=${JSON.stringify(s.dataDir)}\n`, { mode: 0o600 });
	return { s, projectId: added.project.id, env: { HOME: s.root, AIKI_DATA_DIR: undefined, AIKI_ENV_FILE: undefined, XDG_CONFIG_HOME: join(s.root, "config") } };
}

for (const mode of ["off", "optional", "required"] as const) test(`real standalone checker: ${mode}, release, saved projects, deep and drain`, async () => {
	const { s, projectId, env } = await setup(mode);
	const check = (args: string[]) => run([s.server.url, "--timeout-ms=0", ...args], env);
	const recorded = join(s.root, "open-projects");
	expect((await check([`--record-open-projects=${recorded}`])).code).toBe(0);
	expect(await readFile(recorded, "utf8")).toBe(`${projectId}\n`);
	await s.restart();
	s.server.auth.setMode(mode);
	const deep = await check(["--deep", "--expect-commit=abc123", `--open-projects=${recorded}`]);
	expect(deep).toMatchObject({ code: 0, stderr: "" });
	expect(deep.stdout).toContain("paged the 1 project(s)");
	expect((await check(["--deep", "--expect-commit=wrong"])).code).toBe(1);
	await writeFile(recorded, "missing-project\n");
	expect((await check(["--deep", `--open-projects=${recorded}`])).code).toBe(1);
	const idle = await check(["--wait-idle", "--idle-timeout-ms=500", "--idle-poll-ms=10"]);
	expect(idle.code).toBe(0);
	expect(idle.stdout).toContain("is drained");
	expect(s.server.auth.devices()).toEqual([]);
	expect(s.server.auth.inventory()).toEqual([]);
	expect(s.server.auth.connected.size).toBe(0);
	const persisted = s.server.auth.db.query("SELECT state FROM auth WHERE id=1").get() as { state: string };
	expect(JSON.parse(persisted.state)).toMatchObject({ sessions: [], access: {}, grants: [], claims: [] });
	if (mode === "required") {
		expect((await stat(join(s.dataDir, "auth.sock"))).mode & 0o777).toBe(0o600);
		const anonymous = await TestClient.open(s.server);
		const hello = await anonymous.request({ type: "hello", protocolVersion: 1 });
		expect(hello).toMatchObject({ type: "error", error: { code: "auth_required" } });
		anonymous.close();
		// Warning-only remote discovery never tries the (deliberately wrong) local socket.
		const alive = await run([s.server.url, "--alive-only", "--timeout-ms=0"], { ...env, AIKI_DATA_DIR: join(s.root, "absent") });
		expect(alive.code).toBe(0);
		expect(alive.stdout).toContain("discovery alive");
		const wrongSocket = await run([s.server.url, "--deep", "--timeout-ms=0"], { ...env, AIKI_DATA_DIR: join(s.root, "absent") });
		expect(wrongSocket.code).toBe(1);
	}
}, 15000);

test("owner socket exposes only check RPCs, never enrollment or arbitrary mutations", async () => {
	const { s } = await setup("required");
	for (const type of ["projects.add", "auth.pairings.create", "auth.devices.list", "conversation.watch"]) {
		const response = await control(s, type);
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: { code: "invalid_command" } });
	}
	const network = await fetch(`${s.server.url}/health-check`, {
		method: "POST", headers: { "content-type": "application/json" },
		body: JSON.stringify({ args: ["health-check", "{}"] }), signal: AbortSignal.timeout(2000),
	});
	expect(network.ok).toBe(false);
});

function control(s: TestSetup, type: string) {
	return fetch("http://localhost/", {
		unix: join(s.dataDir, "auth.sock"), method: "POST", headers: { "content-type": "application/json" },
		body: JSON.stringify({ args: ["health-check", JSON.stringify({ type, id: "test" })] }), signal: AbortSignal.timeout(2000),
	});
}

test("required checker rejects a different backend's owner socket", async () => {
	const first = await setup("required"), second = await setup("required");
	const result = await run([first.s.server.url, "--timeout-ms=0"], second.env);
	expect(result.code).toBe(1);
	expect(result.stderr).toContain("does not belong to the checked backend");
});

test("rollback guard reads persisted required mode even when backend is stopped; fails closed on corrupt state", async () => {
	const { s, env } = await setup("required");
	await s.server.stop();
	const releaseDir = join(s.root, "candidate");
	await mkdir(releaseDir);
	const guard = () => run([`--check-release=${releaseDir}`], env);
	expect((await guard()).code).toBe(1);
	await writeFile(join(releaseDir, "RELEASE.json"), JSON.stringify({ supportsDeviceAuth: false }));
	expect((await guard()).code).toBe(1);
	await writeFile(join(releaseDir, "RELEASE.json"), JSON.stringify({ supportsDeviceAuth: true }));
	expect((await guard()).code).toBe(0);
	await writeFile(join(s.dataDir, "auth.sqlite"), "corrupt");
	expect((await guard()).code).toBe(1);
});


test("standalone checker resolves canonical aliases before legacy names in each source", async () => {
 const { s, env } = await setup("required");
 const file = join(s.root, "canonical.env");
 await writeFile(file, `KEMIRI_DATA_DIR=${s.dataDir}\nAIKI_DATA_DIR=/tmp/synthetic-unselected\n`);
 const result = await run([s.server.url, "--deep", "--timeout-ms=0"], { ...env, KEMIRI_ENV_FILE: file, AIKI_ENV_FILE: join(s.root, "missing.env") });
 expect(result.code).toBe(0);
 expect(result.stderr).toContain("KEMIRI_ENV_FILE/AIKI_ENV_FILE");
 expect(result.stderr).toContain("KEMIRI_DATA_DIR/AIKI_DATA_DIR");
 expect(result.stderr).not.toContain(s.dataDir);
 expect(result.stderr.trim().split("\n")).toHaveLength(1);
 const processWins = await run([s.server.url, "--deep", "--timeout-ms=0"], { ...env, KEMIRI_ENV_FILE: file, AIKI_DATA_DIR: s.dataDir });
 expect(processWins.code).toBe(0);
});
