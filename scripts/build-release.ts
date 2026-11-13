#!/usr/bin/env bun
/** Build in a clean staging tree, never from personal build output or deploy/local. */
import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve, sep } from "node:path";
import { BUN_VERSION } from "./aiki.ts";

const args = process.argv.slice(2);
function option(name: string): string | undefined {
	const index = args.indexOf(name);
	if (index < 0) return undefined;
	if (!args[index + 1] || args[index + 1]!.startsWith("--")) throw new Error(`${name} needs a value`);
	return args[index + 1];
}
const version = option("--version");
if (!version || !/^v[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?$/.test(version)) throw new Error("Usage: bun scripts/build-release.ts --version v0.1.0 [--source DIR] [--out DIR]");
if (Bun.version !== BUN_VERSION) throw new Error(`Build releases using pinned Bun ${BUN_VERSION}, not ${Bun.version}`);
const source = resolve(option("--source") || join(import.meta.dir, ".."));
const output = resolve(option("--out") || ".preview/releases");
const staging = await mkdtemp(join(tmpdir(), "aiki-release-"));
const tree = join(staging, "aiki");
async function run(command: string[], cwd: string, env: Record<string, string | undefined> = process.env): Promise<void> {
	const child = Bun.spawn(command, { cwd, env, stdout: "inherit", stderr: "inherit", stdin: "ignore" });
	const timer = setTimeout(() => child.kill(), 300_000);
	try { if (await child.exited !== 0) throw new Error(`${command.join(" ")} failed`); }
	finally { clearTimeout(timer); }
}
let trackedSourcePaths: string[] = [];
const omitted = new Set(["node_modules", ".svelte-kit", "build", "test", ".env", ".env.local", ".npmrc", ".netrc"]);
async function copyPublic(path: string, target: string): Promise<void> {
	// Restrict even the allow-listed directories to tracked source, not ignored/untracked local files.
	const sourcePath = relative(source, path).split(sep).join("/");
	if (!trackedSourcePaths.some((tracked) => tracked === sourcePath || tracked.startsWith(sourcePath + "/"))) return;
	// Only directories/files: no symlinks, local dotfiles or generated state enter the archive.
	const { lstat } = await import("node:fs/promises");
	const stat = await lstat(path);
	if (stat.isSymbolicLink()) throw new Error(`Unexpected symlink: ${path}`);
	if (stat.isDirectory()) {
		await mkdir(target, { recursive: true });
		for (const entry of await readdir(path)) {
			if (omitted.has(entry) || entry.startsWith(".")) continue;
			await copyPublic(join(path, entry), join(target, entry));
		}
	} else if (stat.isFile()) {
		await mkdir(resolve(target, ".."), { recursive: true });
		await cp(path, target);
	}
}
try {
	const listing = Bun.spawn(["git", "-C", source, "ls-files", "-z"], { stdout: "pipe", stderr: "inherit" });
	const tracked = await new Response(listing.stdout).text();
	if (await listing.exited !== 0) throw new Error("--source must be a Git checkout; only tracked files are packaged");
	trackedSourcePaths = tracked.split("\0").filter(Boolean);
	await mkdir(tree);
	// Explicit allow-list: Android, deployment targets, local config and conversation data are never copied.
	for (const path of ["package.json", "bun.lock", "tsconfig.json", "LICENSE", "README.md", "install.sh", "scripts/aiki.ts", "scripts/kemiri.ts", "scripts/installed-supervisor.ts", "packages/protocol", "packages/client", "packages/server", "apps/web"]) {
		await copyPublic(join(source, path), join(tree, path));
	}
	if (existsSync(join(source, "docs/INSTALL.md"))) await copyPublic(join(source, "docs/INSTALL.md"), join(tree, "docs/INSTALL.md"));
	await writeFile(join(staging, "backends.json"), "[]\n");
	const clean = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(AIKI|KEMIRI)_/.test(name)));
	const env = { ...clean, AIKI_PUBLISHED_BACKENDS_FILE: join(staging, "backends.json"), AIKI_LEGACY_STORAGE_PREFIX: "", DEPLOY_CONFIG_DIR: join(staging, "no-local-config") };
	await run([process.execPath, "install", "--frozen-lockfile"], tree, env);
	await run([process.execPath, "run", "build"], join(tree, "apps/web"), env);
	await rm(join(tree, "apps/web/build/backends.json"), { force: true });
	await writeFile(join(tree, "RELEASE.json"), JSON.stringify({ name: version, commit: process.env.GITHUB_SHA || version, description: `Kemiri ${version}`, deployedAt: new Date().toISOString(), bun: BUN_VERSION }, null, 2) + "\n");
	// Installed dependencies are platform-specific; the friend installs exactly bun.lock instead.
	async function removeDependencies(path: string): Promise<void> {
		for (const entry of await readdir(path, { withFileTypes: true })) {
			if (entry.name === "node_modules" || entry.name === ".svelte-kit") await rm(join(path, entry.name), { recursive: true, force: true });
			else if (entry.isDirectory()) await removeDependencies(join(path, entry.name));
		}
	}
	await removeDependencies(tree);
	await mkdir(output, { recursive: true });
	const archive = join(output, `aiki-${version}.tar.gz`);
	await run(["tar", "-czf", archive, "aiki"], staging);
	const digest = new Bun.CryptoHasher("sha256").update(await Bun.file(archive).arrayBuffer()).digest("hex");
	await writeFile(archive + ".sha256", `${digest}  ${basename(archive)}\n`);
	const canonical = join(output, `kemiri-${version}.tar.gz`);
	await cp(archive, canonical);
	await writeFile(canonical + ".sha256", `${digest}  ${basename(canonical)}\n`);
	console.log(`Release ready: ${archive}\nSHA256: ${digest}`);
} finally { await rm(staging, { recursive: true, force: true }); }
