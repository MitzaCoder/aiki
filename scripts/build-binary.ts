#!/usr/bin/env bun
/** Compile a neutral release tree, never local web output, credentials or deploy configuration. */
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { BUN_VERSION } from "./aiki.ts";

const args = process.argv.slice(2);
function option(name: string): string | undefined {
	const index = args.indexOf(name);
	if (index < 0) return undefined;
	if (!args[index + 1] || args[index + 1]!.startsWith("--")) throw new Error(`${name} needs a value`);
	return args[index + 1];
}
const version = option("--version");
const legacyVersionProbe = args.includes("--legacy-version-probe");
if (!version || !/^v[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?$/.test(version)) throw new Error("Usage: bun scripts/build-binary.ts --version v0.1.0 [--target bun-linux-x64-baseline] [--out DIR] [--archive PATH] [--smoke]");
if (Bun.version !== BUN_VERSION) throw new Error(`Use pinned Bun ${BUN_VERSION}`);
const targets = ["bun-linux-x64-baseline", "bun-linux-arm64", "bun-darwin-arm64"] as const;
const target = option("--target") ?? (process.platform === "darwin" ? "bun-darwin-arm64" : process.arch === "arm64" ? "bun-linux-arm64" : "bun-linux-x64-baseline");
if (!targets.includes(target as typeof targets[number])) throw new Error(`Unsupported target: ${target}`);
const output = resolve(option("--out") ?? ".preview/releases");
const staging = await mkdtemp(join(tmpdir(), "aiki-binary-build-"));
async function run(command: string[], cwd: string): Promise<void> {
	const child = Bun.spawn(command, { cwd, env: process.env, stdin: "ignore", stdout: "inherit", stderr: "inherit" });
	const timer = setTimeout(() => child.kill(), 300_000);
	try { if (await child.exited !== 0) throw new Error(`${command[0]} failed`); }
	finally { clearTimeout(timer); }
}
try {
	let archive = option("--archive");
	if (!archive) {
		await run([process.execPath, join(import.meta.dir, "build-release.ts"), "--version", version, "--out", output], resolve(import.meta.dir, ".."));
		archive = join(output, `aiki-${version}.tar.gz`);
	}
	// --archive is a trusted, locally built source/web input, not an unverified download interface.
	await run(["tar", "-xzf", resolve(archive), "-C", staging], staging);
	const tree = join(staging, "aiki");
	await run([process.execPath, "install", "--frozen-lockfile"], tree);
	const server = join(tree, "packages/server");
	const resources: string[] = [];
	const asset = (name: string, path: string) => {
		resources.push(`import ${name} from ${JSON.stringify(path)} with { type: "file" };`);
		return name;
	};
	const dependencyAsset = (owner: string, specifier: string) => Bun.resolveSync(specifier, dirname(Bun.resolveSync(owner, server)));
	asset("installer", join(tree, "install.sh"));
	const quickjs = asset("quickjsWasm", dependencyAsset("@earendil-works/pi-codemode", "quickjs-wasi/quickjs.wasm"));
	const photon = asset("photonWasm", dependencyAsset("@earendil-works/pi-durable/images/node", "@silvia-odwyer/photon/photon_rs_bg.wasm"));
	for (const kind of ["codemode", "photon"]) {
		const worker = await Bun.build({ entrypoints: [join(server, `src/binary-${kind}-worker.ts`)], target: "bun", format: "esm", minify: true });
		if (!worker.success) throw new AggregateError(worker.logs, `Cannot bundle ${kind} worker`);
		const file = join(staging, `binary-${kind}-worker.js`);
		await writeFile(file, await worker.outputs[0]!.arrayBuffer().then(buffer => new Uint8Array(buffer)));
		asset(`${kind}Worker`, file);
	}
	const skills: string[] = [];
	for (const name of (await readdir(join(server, "skills/html-artifacts"))).sort()) {
		skills.push(`${JSON.stringify(name)}: ${asset(`skill${skills.length}`, join(server, "skills/html-artifacts", name))}`);
	}
	const web: string[] = [];
	async function embedWeb(directory: string, prefix = ""): Promise<void> {
		for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
			if (entry.isSymbolicLink()) throw new Error("Web assets must not be symlinks");
			const name = `${prefix}/${entry.name}`;
			if (entry.isDirectory()) await embedWeb(join(directory, entry.name), name);
			else if (entry.isFile() && name !== "/backends.json") web.push(`${JSON.stringify(name)}: ${asset(`web${web.length}`, join(directory, entry.name))}`);
		}
	}
	await embedWeb(join(tree, "apps/web/build"));
	if (!web.some(line => line.startsWith('"/200.html":'))) throw new Error("Missing built web UI fallback");
	const release = JSON.parse(await readFile(join(tree, "RELEASE.json"), "utf8"));
	if (release.name !== version) throw new Error("Archive version does not match binary version");
	resources.push(`export const packagedResources = { legacyVersionProbe: ${legacyVersionProbe}, installer, quickjsWasm: ${quickjs}, photonWasm: ${photon}, codemodeWorker, photonWorker, web: {${web.join(",")}}, skills: {${skills.join(",")}}, release: ${JSON.stringify(release)} };`);
	await mkdir(output, { recursive: true });
	const smoke = args.includes("--smoke");
	const name = `${legacyVersionProbe ? "aiki" : "kemiri"}-${version}-${target.replace("bun-", "").replace("-baseline", "")}${smoke ? "-smoke" : ""}`;
	const file = join(output, name);
	const build = await Bun.build({
		entrypoints: [join(server, smoke ? "scripts/binary-smoke-entry.ts" : "src/binary-main.ts")],
		minify: true,
		compile: { target: target as typeof targets[number], outfile: file, autoloadDotenv: false, autoloadBunfig: false, autoloadTsconfig: false, autoloadPackageJson: false },
		plugins: [{ name: "aiki-packaged-resources", setup(builder) {
			builder.onLoad({ filter: /[/\\]packaged-resources\.ts$/ }, () => ({ contents: resources.join("\n"), loader: "ts" }));
		} }],
	});
	if (!build.success) throw new AggregateError(build.logs, "Binary build failed");
	await writeFile(file + ".licenses.txt", await readFile(join(server, "PDF-LICENSES.txt")));
	const binary = Bun.file(file);
	const digest = new Bun.CryptoHasher("sha256").update(await binary.arrayBuffer()).digest("hex");
	await writeFile(file + ".sha256", `${digest}  ${basename(file)}\n`);
	console.log(JSON.stringify({ binary: file, bytes: binary.size, sha256: digest, webFiles: web.length }));
} finally { await rm(staging, { recursive: true, force: true }); }
