import { afterEach, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repository = resolve(import.meta.dir, "..");
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const digest = (bytes: Uint8Array | string) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

async function fixture() {
	const home = await mkdtemp(join(tmpdir(), "aiki-binary-install-test-"));
	const root = join(home, "install");
	const bin = join(home, "path");
	await mkdir(bin);
	await mkdir(join(root, "tools/bin"), { recursive: true });
	await writeFile(join(root, ".aiki-managed"), "aiki-installer-v1\n");
	await writeFile(join(root, "tools/bin/zellij"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
	await writeFile(join(bin, "uname"), "#!/bin/sh\ncase $1 in -s) echo Linux;; -m) echo x86_64;; esac\n", { mode: 0o755 });
	await writeFile(join(bin, "ldd"), "#!/bin/sh\necho 'synthetic glibc'\n", { mode: 0o755 });
	const assets = new Map<string, Uint8Array | string>();
	const requests: string[] = [];
	const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
		const path = new URL(request.url).pathname;
		requests.push(path);
		return assets.has(path) ? new Response(assets.get(path) as BodyInit) : new Response("No fixture asset", { status: 404 });
	} });
	cleanup.push(async () => { await server.stop(true); await rm(home, { recursive: true, force: true }); });
	const base = `http://127.0.0.1:${server.port}/releases`;
	const launcher = join(home, ".local/bin/aiki");
	async function command(argv: string[]) {
		const child = Bun.spawn(argv, { env: { USER: "test", HOME: home, PATH: `${bin}:${process.env.PATH}` }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
		const timer = setTimeout(() => child.kill(), 30_000);
		try {
			const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
			return { code, message: out + err };
		} finally { clearTimeout(timer); }
	}
	const install = (...args: string[]) => command(["sh", join(repository, "install.sh"), "--dir", root, "--no-service", "--release-base-url", base, ...args]);
	const cli = (...args: string[]) => command([launcher, ...args]);
	const metadata = async () => JSON.parse(await readFile(join(root, ".aiki-install.json"), "utf8"));
	async function binary(version: string, corrupt = "") {
		// An executable stand-in delegates lifecycle behavior to the real CLI. Real compiled execution has its own E2E smoke.
		const bytes = `#!/bin/sh\nif [ "$1" = --version ]; then echo 'Aiki ${version}'; exit 0; fi\nif [ "$1" = activate ]; then cp ${quote(join(repository, "install.sh"))} "$2/releases/\${7:-$4}/install.sh"; fi\nexec ${quote(process.execPath)} ${quote(join(repository, "scripts/aiki.ts"))} "$@"\n`;
		const name = `aiki-${version}-linux-x64`;
		assets.set(`/releases/${version}/${name}`, bytes);
		assets.set(`/releases/${version}/${name}.sha256`, `${corrupt === "sidecar" ? "0".repeat(64) : digest(bytes)}  ${name}\n`);
		const notices = "Synthetic unpdf licence notice\n";
		assets.set(`/releases/${version}/${name}.licenses.txt`, notices);
		// Additional assets/manifest rows must not be mistaken for the selected executable.
		assets.set(`/releases/${version}/SHA256SUMS`, `${corrupt === "manifest" ? "0".repeat(64) : digest(bytes)}  ${name}\n${digest(notices)}  ${name}.licenses.txt\n`);
	}
	async function bunRelease(version: string) {
		const tree = join(home, `source-${version}`, "aiki");
		await mkdir(join(tree, "scripts"), { recursive: true });
		for (const file of ["install.sh", "scripts/aiki.ts", "scripts/installed-supervisor.ts", "packages/server/src/self-update.ts", "packages/server/src/errors.ts", "packages/protocol/src/release-versions.ts",
			"packages/server/src/child-environment.ts", "packages/server/src/packaged-resources.ts", "packages/server/src/server-env.ts",
			"packages/server/src/server-settings.ts", "packages/server/src/data-dir.ts", "packages/server/src/origins.ts"]) {
			await mkdir(resolve(tree, file, ".."), { recursive: true });
			await cp(join(repository, file), join(tree, file));
		}
		await writeFile(join(tree, "package.json"), '{"name":"synthetic-release","private":true,"dependencies":{"synthetic-dependency":"file:./fixture-package"}}\n');
		await mkdir(join(tree, "fixture-package"));
		await writeFile(join(tree, "fixture-package/package.json"), '{"name":"synthetic-dependency","version":"1.0.0"}\n');
		const installed = Bun.spawnSync([process.execPath, "install"], { cwd: tree, env: { HOME: home, PATH: process.env.PATH } });
		if (installed.exitCode) throw new Error(installed.stderr.toString());
		await rm(join(tree, "node_modules"), { recursive: true, force: true });
		await mkdir(join(tree, "apps/web/build"), { recursive: true });
		await writeFile(join(tree, "apps/web/build/200.html"), "synthetic web");
		const archive = join(home, `${version}.tar.gz`);
		const tar = Bun.spawnSync(["tar", "-czf", archive, "aiki"], { cwd: resolve(tree, ".."), env: { PATH: process.env.PATH } });
		if (tar.exitCode) throw new Error(tar.stderr.toString());
		const bytes = new Uint8Array(await Bun.file(archive).arrayBuffer());
		assets.set(`/releases/${version}/aiki-${version}.tar.gz`, bytes);
		assets.set(`/releases/${version}/aiki-${version}.tar.gz.sha256`, `${digest(bytes)}  aiki-${version}.tar.gz\n`);
		await mkdir(join(root, "runtime/bun-1.4.4/bin"), { recursive: true });
		await symlink(process.execPath, join(root, "runtime/bun-1.4.4/bin/bun"));
	}
	return { root, install, cli, metadata, binary, bunRelease, requests, assets, base };
}

test("stage-only verifies beside a running release without changing links or metadata", async () => {
	const setup = await fixture();
	await setup.binary("v0.1.0-pilot.1"); await setup.binary("v0.1.0-pilot.2");
	expect((await setup.install("--version", "v0.1.0-pilot.1")).code).toBe(0);
	await writeFile(join(setup.root, "server.pid"), String(process.pid));
	const before = await setup.metadata();
	const staged = await setup.install("--version", "v0.1.0-pilot.2", "--stage-only");
	expect(staged.code).toBe(0); expect(staged.message).toContain("Staged");
	expect(await setup.metadata()).toEqual(before);
	expect(await readlink(join(setup.root, "current"))).toContain("v0.1.0-pilot.1");
	expect(existsSync(join(setup.root, "releases/v0.1.0-pilot.2/.ready"))).toBe(true);
	expect(existsSync(join(setup.root, "previous"))).toBe(false);
});

test("fresh binary install tolerates licence assets and validates both checksums without preparing Bun", async () => {
	const setup = await fixture(); const version = "v0.1.0-pilot.1";
	await setup.binary(version);
	const installed = await setup.install("--version", version);
	expect(installed.code).toBe(0); expect(installed.message).toContain("activated");
	expect(setup.assets.has(`/releases/${version}/aiki-${version}-linux-x64.licenses.txt`)).toBe(true);
	expect(existsSync(join(setup.root, "current/aiki"))).toBe(true);
	expect(existsSync(join(setup.root, "runtime"))).toBe(false);
	expect((await setup.cli("version")).message).toContain(version);
	expect((await setup.metadata()).channel).toBe("pilot");
	expect(setup.requests).toContain(`/releases/${version}/SHA256SUMS`);
	expect(setup.requests.some(path => path.endsWith(".tar.gz"))).toBe(false);
});

test("Bun to binary update and rollback preserve the saved pilot channel", async () => {
	const setup = await fixture();
	await setup.bunRelease("v0.1.0-pilot.1"); await setup.binary("v0.2.0");
	expect(await setup.install("--version", "v0.1.0-pilot.1", "--runtime", "bun")).toMatchObject({ code: 0 });
	expect(existsSync(join(setup.root, "current/aiki"))).toBe(false);
	const updated = await setup.cli("update", "--version", "v0.2.0", "--release-base-url", setup.base);
	expect(updated.message).toContain("activated"); expect(updated.code).toBe(0);
	expect(existsSync(join(setup.root, "current/aiki"))).toBe(true);
	expect((await setup.metadata()).channel).toBe("pilot");
	expect((await setup.cli("rollback")).code).toBe(0);
	expect(await readlink(join(setup.root, "current"))).toContain("v0.1.0-pilot.1");
	expect(existsSync(join(setup.root, "current/aiki"))).toBe(false);
	expect((await setup.cli("version")).message).toContain("v0.1.0-pilot.1");
	expect((await setup.metadata()).channel).toBe("pilot");
});

test("explicit runtime changes at the same version retain both immutable variants for rollback", async () => {
	const setup = await fixture(); const version = "v0.1.0-pilot.1";
	await setup.binary(version); await setup.bunRelease(version);
	expect((await setup.install("--version", version)).code).toBe(0);
	expect((await setup.cli("update", "--version", version, "--runtime", "bun", "--release-base-url", setup.base)).code).toBe(0);
	expect(await readlink(join(setup.root, "current"))).toContain(`${version}-bun`);
	expect((await setup.metadata()).version).toBe(version);
	expect((await setup.cli("rollback")).code).toBe(0);
	expect(existsSync(join(setup.root, "current/aiki"))).toBe(true);
	expect((await setup.metadata()).channel).toBe("pilot");
});

for (const corrupt of ["sidecar", "manifest"]) test(`a mismatched binary ${corrupt} activates nothing`, async () => {
	const setup = await fixture(); await setup.binary("v0.1.0", corrupt);
	const result = await setup.install("--version", "v0.1.0");
	expect(result.code).toBe(1); expect(result.message).toContain("binary checksum mismatch");
	expect(existsSync(join(setup.root, "current"))).toBe(false);
	expect(existsSync(join(setup.root, ".aiki-install.json"))).toBe(false);
	expect(existsSync(join(setup.root, "releases/v0.1.0"))).toBe(false);
	expect(existsSync(join(setup.root, "runtime"))).toBe(false);
});

test("a missing manifest or a failed update leaves the selected release unchanged", async () => {
	const setup = await fixture(); await setup.binary("v0.1.0-pilot.1");
	expect((await setup.install("--version", "v0.1.0-pilot.1")).code).toBe(0);
	await setup.binary("v0.2.0"); setup.assets.delete("/releases/v0.2.0/SHA256SUMS");
	expect((await setup.cli("update", "--version", "v0.2.0", "--release-base-url", setup.base)).code).not.toBe(0);
	expect((await setup.metadata()).version).toBe("v0.1.0-pilot.1");
	expect(existsSync(join(setup.root, "previous"))).toBe(false);
	expect((await setup.cli("version")).message).toContain("v0.1.0-pilot.1");
});

test("a missing binary falls back to Bun, while --runtime bun skips an available binary", async () => {
	const setup = await fixture(); await setup.bunRelease("v0.1.0");
	expect((await setup.install("--version", "v0.1.0")).message).toContain("pinned Bun fallback");
	expect(existsSync(join(setup.root, "current/scripts/aiki.ts"))).toBe(true);
	await setup.binary("v0.2.0");
	// Reuse this tiny source archive under another synthetic version.
	for (const suffix of [".tar.gz", ".tar.gz.sha256"]) setup.assets.set(`/releases/v0.2.0/aiki-v0.2.0${suffix}`, setup.assets.get(`/releases/v0.1.0/aiki-v0.1.0${suffix}`)!);
	setup.requests.length = 0;
	expect((await setup.install("--version", "v0.2.0", "--runtime", "bun")).code).toBe(0);
	expect(existsSync(join(setup.root, "current/aiki"))).toBe(false);
	expect(setup.requests.some(path => path.endsWith("linux-x64"))).toBe(false);
});
