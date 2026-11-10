import { afterEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const cli = resolve(import.meta.dir, "aiki.ts");
async function setup() {
	const home = await mkdtemp(join(tmpdir(), "aiki-cli-")); roots.push(home);
	const root = join(home, "Aiki's files");
	const config = join(root, "config");
	const launcher = join(home, ".local/bin/aiki");
	await mkdir(root, { recursive: true });
	await writeFile(join(root, ".aiki-managed"), "aiki-installer-v1\n");
	async function run(...args: string[]) {
		const child = Bun.spawn([process.execPath, cli, ...args], {
			env: { HOME: home, PATH: process.env.PATH, AIKI_INSTALL_DIR: root, AIKI_DATA_DIR: join(home, "foreign-data"), AIKI_CONFIG_DIR: join(home, "foreign-config"), AIKI_ENV_FILE: join(home, "foreign.env") },
			stdout: "pipe", stderr: "pipe",
		});
		const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
		return { code, out, err };
	}
	async function release(version: string) {
		const path = join(root, "releases", version);
		await mkdir(join(path, "packages/server/src"), { recursive: true });
		await writeFile(join(path, ".ready"), version);
		await writeFile(join(path, "packages/server/src/main.ts"), `await Bun.write(process.env.AIKI_DATA_DIR + '/observed.json', JSON.stringify({data:process.env.AIKI_DATA_DIR, config:process.env.AIKI_CONFIG_DIR, host:process.env.AIKI_HOST}));`);
		return run("activate", root, config, version, launcher);
	}
	return { root, home, config, launcher, run, release };
}

test("activation is idempotent; update/rollback retain one previous code release", async () => {
	const fixture = await setup();
	expect((await fixture.release("v0.1.0")).code).toBe(0);
	expect((await fixture.release("v0.1.0")).code).toBe(0);
	expect(existsSync(join(fixture.root, "previous"))).toBe(false);
	expect((await fixture.release("v0.2.0")).code).toBe(0);
	expect((await fixture.run("version")).out).toContain("v0.2.0");
	expect((await fixture.run("rollback")).code).toBe(0);
	expect((await fixture.run("version")).out).toContain("v0.1.0");
	expect((await fixture.release("v0.3.0")).code).toBe(0);
	expect(existsSync(join(fixture.root, "releases/v0.2.0"))).toBe(false);
});

test("installed start ignores inherited backend data/config/env-file paths", async () => {
	const fixture = await setup(); await fixture.release("v0.1.0");
	const started = await fixture.run("start");
	expect(started.err).toBe(""); expect(started.code).toBe(0);
	expect(JSON.parse(await readFile(join(fixture.root, "data/observed.json"), "utf8"))).toEqual({ data: join(fixture.root, "data"), config: fixture.config, host: "127.0.0.1" });
	expect(existsSync(join(fixture.home, "foreign-data"))).toBe(false);
	expect(existsSync(join(fixture.root, "server.pid"))).toBe(false);
});

test("running process blocks activation and rollback without changing selected code", async () => {
	const fixture = await setup(); await fixture.release("v0.1.0");
	await writeFile(join(fixture.root, "server.pid"), String(process.pid));
	expect((await fixture.release("v0.2.0")).err).toContain("Aiki is running");
	expect((await fixture.run("rollback")).code).toBe(1);
	expect((await fixture.run("version")).out).toContain("v0.1.0");
});

test("uninstall preserves data/config, then reinstall and purge remove only installation state", async () => {
	const fixture = await setup(); await fixture.release("v0.1.0");
	await mkdir(join(fixture.root, "data")); await mkdir(fixture.config);
	await writeFile(join(fixture.root, "data/keep"), "synthetic conversation");
	await writeFile(join(fixture.config, "keep"), "synthetic configuration");
	await writeFile(join(fixture.home, "repository"), "keep repository");
	expect((await fixture.run("uninstall", fixture.root, "0")).code).toBe(0);
	expect(existsSync(fixture.launcher)).toBe(false);
	expect(existsSync(join(fixture.root, "data/keep"))).toBe(true);
	expect(existsSync(join(fixture.config, "keep"))).toBe(true);
	expect((await fixture.release("v0.2.0")).code).toBe(0);
	expect((await fixture.run("uninstall", fixture.root, "1")).code).toBe(0);
	expect(existsSync(join(fixture.root, "data"))).toBe(false);
	expect(existsSync(fixture.config)).toBe(false);
	expect(existsSync(join(fixture.home, "repository"))).toBe(true);
});
