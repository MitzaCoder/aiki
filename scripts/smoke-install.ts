#!/usr/bin/env bun
/** Linux end-to-end installer proof using real local release assets and a loopback release server. */
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const option = (name: string) => args[args.indexOf(name) + 1];
const binaryPath = resolve(option("--binary"));
const archivePath = resolve(option("--archive"));
const binaryVersion = option("--binary-version");
const bunVersion = option("--bun-version");
if (!/^v[0-9]/.test(binaryVersion) || !/^v[0-9]/.test(bunVersion)) throw new Error("Pass --binary, --archive, --binary-version and --bun-version");
const repository = resolve(import.meta.dir, "..");
const root = await mkdtemp("/tmp/aiki-installed-smoke-");
console.log(`Installer smoke root: ${root}`);
const path = join(root, "path"); await mkdir(path);
for (const tool of ["sh", "env", "setsid", "curl", "tar", "gzip", "unzip", "awk", "head", "grep", "mkdir", "mktemp", "cp", "mv", "chmod", "rm", "rmdir", "ls", "uname", "ldd", "sha256sum", "git"]) {
	const executable = Bun.which(tool);
	if (!executable) throw new Error(`Smoke requires ${tool}`);
	await symlink(executable, join(path, tool));
}
const assetName = `kemiri-${binaryVersion}-linux-x64`;
const binaryBytes = new Uint8Array(await Bun.file(binaryPath).arrayBuffer());
const binaryHash = new Bun.CryptoHasher("sha256").update(binaryBytes).digest("hex");
const routes = new Map<string, string | Uint8Array>([
	[`/${binaryVersion}/${assetName}`, binaryBytes],
	[`/${binaryVersion}/${assetName}.sha256`, `${binaryHash}  ${assetName}\n`],
	[`/${binaryVersion}/SHA256SUMS`, `${binaryHash}  ${assetName}\n`],
	[`/${bunVersion}/kemiri-${bunVersion}.tar.gz`, new Uint8Array(await Bun.file(archivePath).arrayBuffer())],
	[`/${bunVersion}/kemiri-${bunVersion}.tar.gz.sha256`, await Bun.file(archivePath + ".sha256").text()],
]);
const requests: string[] = [];
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
	const name = new URL(request.url).pathname;
	requests.push(name);
	return routes.has(name) ? new Response(routes.get(name) as BodyInit) : new Response("No binary in this older fixture release", { status: 404 });
} });
const base = `http://127.0.0.1:${server.port}`;
const deadline = setTimeout(() => { console.error("Installer smoke exceeded its deadline"); process.exitCode = 1; }, 180_000);

type Instance = { home: string; root: string; launcher: string; env: Record<string, string>; cli: (...args: string[]) => Promise<string> };
async function command(argv: string[], env: Record<string, string>): Promise<string> {
	const child = Bun.spawn([join(path, "env"), "-i", ...Object.entries(env).map(([key, value]) => `${key}=${value}`), ...argv], {
		env: {}, stdin: "ignore", stdout: "pipe", stderr: "pipe",
	});
	const timer = setTimeout(() => child.kill(), 120_000);
	try {
		const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
		if (code !== 0) throw new Error(`${argv[0]} failed (${code})\n${out}${err}`);
		return out + err;
	} finally { clearTimeout(timer); }
}
async function instance(name: string): Promise<Instance> {
	const home = join(root, name); await mkdir(home);
	const installation = join(home, "installation");
	// Avoid unrelated terminal downloads. This fake tool is never executed by the backend smoke.
	await mkdir(join(installation, "tools/bin"), { recursive: true });
	await writeFile(join(installation, ".aiki-managed"), "aiki-installer-v1\n");
	await writeFile(join(installation, "tools/bin/zellij"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
	const env = { USER: "smoke", HOME: home, PATH: path, TZ: "UTC", KEMIRI_NO_BROWSER: "1" };
	const launcher = join(home, ".local/bin/kemiri");
	console.log(`Installation paths: ${JSON.stringify({ home, installation, config: join(installation, "config"), data: join(installation, "data"), path })}`);
	return { home, root: installation, launcher, env, cli: (...args) => command([launcher, ...args], env) };
}
async function cacheBun(installation: Instance): Promise<void> {
	// A local copy stands in for the installer's checksum-pinned runtime download, never a global PATH entry.
	const runtime = join(installation.root, "runtime/bun-1.4.4/bin");
	await mkdir(runtime, { recursive: true }); await cp(process.execPath, join(runtime, "bun"));
}
async function install(installation: Instance, version: string): Promise<void> {
	console.log(await command([join(path, "sh"), join(repository, "install.sh"), "--dir", installation.root,
		"--no-service", "--version", version, "--release-base-url", base], installation.env));
}
async function checkBackend(installation: Instance, version: string): Promise<void> {
	const listener = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
	const port = listener.port!; listener.stop();
	for (const name of ["agent", "claude"]) await mkdir(join(installation.home, name), { recursive: true });
	await writeFile(join(installation.root, "config/server.env"), `KEMIRI_PORT=${port}\nKEMIRI_AGENT_DIR=${installation.home}/agent\nKEMIRI_CLAUDE_DIR=${installation.home}/claude\n`);
	const child = Bun.spawn([join(path, "setsid"), "-f", "-w", join(path, "env"), "-i",
		...Object.entries(installation.env).map(([key, value]) => `${key}=${value}`), installation.launcher, "start"],
		{ env: {}, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
	let pid: number | undefined;
	let output = "";
	const ready = Promise.withResolvers<void>();
	const errors = new Response(child.stderr).text();
	const timer = setTimeout(() => ready.reject(new Error("Backend startup timed out")), 30_000);
	const collect = (async () => {
		for await (const chunk of child.stdout) {
			output += new TextDecoder().decode(chunk);
			if (!pid && existsSync(join(installation.root, "server.pid"))) pid = Number(await readFile(join(installation.root, "server.pid"), "utf8"));
			if (/Kemiri listening on/.test(output)) ready.resolve();
		}
	})();
	void child.exited.then(code => ready.reject(new Error(`Backend exited (${code}): ${output}`)));
	try {
		await ready.promise;
		console.log(`Owned backend PID: ${pid}`);
		assert.match(await installation.cli("status"), /Running at/);
		const health = JSON.parse(await installation.cli("health-check"));
		assert.equal(health.answer.type, "server.status");
		assert.equal(health.answer.status.updates.enabled, true);
		assert.equal(health.answer.status.updates.installedVersion, version);
		assert.equal(health.answer.status.updates.channel, "pilot");
		const page = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(5000) });
		assert.equal(page.status, 200); assert.match(page.headers.get("content-type")!, /text\/html/);
		assert.match(await page.text(), /<!doctype html>/i);
		const auth = await fetch(`http://127.0.0.1:${port}/auth/status`);
		assert.equal((await auth.json() as { mode: string }).mode, "required");
		assert.match(await installation.cli("service", "install", "--print"), /aiki.*start|start/s);
		console.log(`PASS installed ${version}: status, owner health/update identity, Welcome shell, required auth and service definition`);
	} finally {
		clearTimeout(timer);
		if (!pid && existsSync(join(installation.root, "server.pid"))) pid = Number(await readFile(join(installation.root, "server.pid"), "utf8"));
		if (pid) process.kill(pid, "SIGTERM"); else child.kill();
		const shutdown = setTimeout(() => { if (pid) process.kill(pid, "SIGKILL"); }, 15_000);
		await child.exited; clearTimeout(shutdown); await collect;
		const stderr = await errors; if (stderr) console.log(stderr);
		assert.equal(existsSync(join(installation.root, "server.pid")), false);
	}
}

try {
	const binary = await instance("binary-first");
	await install(binary, binaryVersion);
	assert.equal(existsSync(join(binary.root, "runtime")), false, "Binary install downloaded Bun");
	await checkBackend(binary, binaryVersion);
	await cacheBun(binary);
	console.log(await binary.cli("update", "--version", bunVersion, "--release-base-url", base));
	await checkBackend(binary, bunVersion);
	console.log(await binary.cli("rollback"));
	await checkBackend(binary, binaryVersion);
	const bun = await instance("bun-first");
	await cacheBun(bun);
	await install(bun, bunVersion);
	await checkBackend(bun, bunVersion);
	console.log(await bun.cli("update", "--version", binaryVersion, "--release-base-url", base));
	await checkBackend(bun, binaryVersion);
	console.log(await bun.cli("rollback"));
	await checkBackend(bun, bunVersion);
	for (const installation of [binary, bun]) {
		const metadata = JSON.parse(await readFile(join(installation.root, ".aiki-install.json"), "utf8"));
		assert.equal(metadata.channel, "pilot");
	}
	assert(requests.some(name => name.endsWith("SHA256SUMS")));
	console.log("PASS: fresh binary install, both update directions and mixed-runtime rollback; saved pilot channel; no Bun on PATH");
} finally {
	clearTimeout(deadline);
	await server.stop(true);
	await rm(root, { recursive: true, force: true });
	console.log(`Removed smoke installation root: ${root}`);
}
