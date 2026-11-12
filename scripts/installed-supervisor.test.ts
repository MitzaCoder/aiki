import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSelfUpdate, writeSelfUpdate } from "../packages/server/src/self-update.ts";
import type { SelfUpdateState } from "../packages/protocol/src/server-status.ts";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0)) await close(); });
async function until(predicate: () => boolean | Promise<boolean>) {
	for (let i = 0; i < 150; i++) { if (await predicate()) return; await Bun.sleep(50); }
	throw new Error("Timed out waiting for the isolated supervisor");
}
async function fixture(broken: boolean) {
	const home = await mkdtemp(join(tmpdir(), "aiki-supervisor-test-"));
	const root = join(home, "install"); const data = join(root, "data");
	await mkdir(data, { recursive: true });
	const baseline = "v0.1.0-pilot.2", target = "v0.1.0-pilot.3";
	for (const version of [baseline, target]) {
		const path = join(root, "releases", version); await mkdir(path, { recursive: true });
		await writeFile(join(path, ".ready"), version);
		await writeFile(join(path, "entry.ts"), broken && version === target ? "process.exit(42)" : `
import {writeFileSync,rmSync} from 'node:fs';
const root=process.env.AIKI_INSTALL_DIR!;
writeFileSync(root+'/server.pid',String(process.pid));
const server=Bun.serve({unix:root+'/data/auth.sock',fetch:()=>Response.json({answer:{type:'server.status',status:{updates:{installedVersion:${JSON.stringify(version)}}}}})});
process.on('SIGTERM',()=>{server.stop(true);rmSync(root+'/server.pid',{force:true});rmSync(root+'/data/auth.sock',{force:true});process.exit(0)});
`);
	}
	const launcher = join(home, "aiki");
	await writeFile(launcher, `#!/bin/sh\nexec '${process.execPath}' "$AIKI_INSTALL_DIR/current/entry.ts"\n`, { mode: 0o755 });
	await symlink(`releases/${baseline}`, join(root, "current"));
	const installation = { root, data, config: join(root, "config"), launcher, version: baseline, channel: "pilot" };
	await writeFile(join(root, ".aiki-install.json"), JSON.stringify(installation));
	const child = Bun.spawn([process.execPath, "-e", `import {superviseInstallation} from ${JSON.stringify(join(import.meta.dir, "installed-supervisor.ts"))}; await superviseInstallation(${JSON.stringify(installation)}, {});`], {
		env: { HOME: home, PATH: process.env.PATH }, stdin: "ignore", stdout: "pipe", stderr: "pipe",
	});
	cleanups.push(async () => { child.kill("SIGTERM"); await child.exited; await rm(home, { recursive: true, force: true }); });
	await until(() => Bun.file(join(root, "server.pid")).exists());
	const originalPid = await readFile(join(root, "server.pid"), "utf8");
	const state: SelfUpdateState = { schemaVersion: 1, enabled: true, disabledReason: null, phase: "restarting", attempt: "synthetic-attempt", fromVersion: baseline, toVersion: target, notesUrl: "https://example.test/notes", agents: 0, message: "Updating…" };
	writeSelfUpdate(root, state);
	return { root, child, originalPid, baseline, target };
}
for (const broken of [false, true]) test(`foreground supervisor ${broken ? "rolls back a dead-on-start release" : "keeps its PID through a healthy switch"}`, async () => {
	const setup = await fixture(broken);
	await until(() => ["succeeded", "rolled_back", "failed"].includes(readSelfUpdate(setup.root)?.phase ?? ""));
	const outcome = readSelfUpdate(setup.root)!;
	expect(outcome.phase).toBe(broken ? "rolled_back" : "succeeded");
	expect(setup.child.exitCode).toBe(null);
	expect(await readFile(join(setup.root, "server.pid"), "utf8")).not.toBe(setup.originalPid);
	const installed = JSON.parse(await readFile(join(setup.root, ".aiki-install.json"), "utf8"));
	expect(installed.version).toBe(broken ? setup.baseline : setup.target);
	expect(installed.channel).toBe("pilot");
}, 15_000);
