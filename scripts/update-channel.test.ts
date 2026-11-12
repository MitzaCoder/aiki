import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { updateSelection } from "./aiki.ts";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const feed = [{ tag_name: "v0.1.0-pilot.2", draft: false, prerelease: true }, { tag_name: "v0.0.9", draft: false, prerelease: false }];

test("explicit version wins without network; channel override validates and old installs infer their channel", async () => {
	const offline = (async () => { throw new Error("must not fetch"); }) as unknown as typeof fetch;
	expect(await updateSelection(["--version", "v0.1.0-pilot.1", "--channel", "stable"], { version: "v0.1.0-pilot.1" }, offline)).toEqual({ version: "v0.1.0-pilot.1", channel: "stable" });
	const fake = (async () => Response.json(feed)) as unknown as typeof fetch;
	expect((await updateSelection([], { version: "v0.1.0-pilot.1" }, fake)).version).toBe("v0.1.0-pilot.2");
	expect((await updateSelection([], { version: "v0.0.8" }, fake)).version).toBe("v0.0.9");
	await expect(updateSelection(["--channel", "nightly"], { version: "v0.1.0" }, offline)).rejects.toThrow("pilot or stable");
	await expect(updateSelection(["--version"], { version: "v0.1.0" }, offline)).rejects.toThrow("needs a value");
});

test("real installed update follows fake release server, persists switches, explicit versions win and rollback still swaps", async () => {
	const home = await mkdtemp(join(tmpdir(), "aiki-channel-")); roots.push(home);
	const root = join(home, "install"), config = join(root, "config"), launcher = join(home, ".local/bin/aiki");
	await mkdir(join(root, "runtime/bun-1.4.4/bin"), { recursive: true });
	await symlink(process.execPath, join(root, "runtime/bun-1.4.4/bin/bun"));
	await writeFile(join(root, ".aiki-managed"), "aiki-installer-v1\n");
	await mkdir(join(root, "tools/bin"), { recursive: true });
	await writeFile(join(root, "tools/bin/zellij"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
	const cli = resolve(import.meta.dir, "aiki.ts");
	const serverFile = join(home, "feed.ts"), ready = join(home, "feed.json");
	await writeFile(serverFile, `const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:()=>Response.json(${JSON.stringify(feed)})});await Bun.write(${JSON.stringify(ready)},JSON.stringify({port:server.port}));console.log('ready');setTimeout(()=>{server.stop(true);process.exit()},30000);`);
	// The fake feed has no ambient backend configuration, and only serves synthetic releases.
	const server = Bun.spawn(["env", "-i", `HOME=${home}`, "USER=test", `PATH=${process.env.PATH}`, `AIKI_DATA_DIR=${join(home, "data")}`, `AIKI_CONFIG_DIR=${config}`, process.execPath, serverFile], { stdout: "pipe", stderr: "pipe" });
	await server.stdout.getReader().read();
	console.log(`Fake release server: ${home}; data: ${join(home, "data")}; config: ${config}`);
	const preload = join(home, "redirect.ts");
	await writeFile(preload, `const original=globalThis.fetch;globalThis.fetch=async(url,init)=>{if(String(url).startsWith('https://api.github.com/repos/MitzaCoder/aiki/releases')){const {port}=await Bun.file(${JSON.stringify(ready)}).json();return original('http://127.0.0.1:'+port,init)}throw Error('Unexpected network request: '+url)};`);
	const env = { HOME: home, USER: "test", PATH: process.env.PATH, AIKI_INSTALL_DIR: root };
	async function run(...args: string[]) {
		const child = Bun.spawn([process.execPath, "--preload", preload, cli, ...args], { env, stdout: "pipe", stderr: "pipe" });
		const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
		expect({ code, err }).toEqual({ code: 0, err: "" }); return out;
	}
	async function prepare(version: string) {
		const path = join(root, "releases", version);
		await mkdir(path, { recursive: true });
		await writeFile(join(path, ".ready"), version);
		await symlink(resolve(import.meta.dir), join(path, "scripts"));
		await writeFile(join(path, "install.sh"), await readFile(resolve(import.meta.dir, "../install.sh")));
	}
	const metadata = async () => JSON.parse(await readFile(join(root, ".aiki-install.json"), "utf8"));
	try {
		await prepare("v0.1.0-pilot.1"); await run("activate", root, config, "v0.1.0-pilot.1", launcher);
		expect((await metadata()).channel).toBe("pilot");
		await prepare("v0.1.0-pilot.2"); await run("update");
		expect((await metadata()).version).toBe("v0.1.0-pilot.2");
		await prepare("v0.0.9"); await run("update", "--channel", "stable");
		expect((await metadata()).channel).toBe("stable"); expect((await metadata()).version).toBe("v0.0.9");
		await run("rollback"); expect((await metadata()).version).toBe("v0.1.0-pilot.2"); expect((await metadata()).channel).toBe("stable");
		await run("update"); expect((await metadata()).version).toBe("v0.0.9");
		await run("update", "--channel", "pilot", "--version", "v0.1.0-pilot.2");
		expect((await metadata()).version).toBe("v0.1.0-pilot.2"); expect((await metadata()).channel).toBe("pilot");
	} finally { server.kill(); await server.exited; }
}, 15_000);
