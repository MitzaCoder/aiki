#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { childEnvironment } from "../packages/server/src/child-environment.ts";
import { packagedResources } from "../packages/server/src/packaged-resources.ts";
import { mkdtempSync } from "node:fs";

import { fetchChannelRelease, releaseChannel, type UpdateChannel } from "../packages/protocol/src/release-versions.ts";

export const BUN_VERSION = "1.4.4";
type Installation = { root: string; config: string; data: string; launcher: string; version: string; channel?: UpdateChannel; release?: string };

/** Resolve before invoking the checksum-verifying installer. Explicit versions always win. */
export async function updateSelection(args: string[], installation: Pick<Installation, "version" | "channel">, transport: typeof fetch = fetch): Promise<{ version: string; channel: UpdateChannel }> {
	let version: string | undefined;
	let channel = installation.channel || releaseChannel(installation.version);
	for (let i = 0; i < args.length; i++) {
		const option = args[i];
		if (option === "--channel" || option === "--version") {
			const value = args[++i];
			if (!value || value.startsWith("--")) throw new Error(`${option} needs a value`);
			if (option === "--version") version = value;
			else if (value === "pilot" || value === "stable") channel = value;
			else throw new Error("--channel must be pilot or stable");
		}
	}
	return { version: version ?? (args.includes("--ref") ? installation.version : (await fetchChannelRelease(channel, transport)).version), channel };
}
const shellQuote = (path: string) => `'${path.replaceAll("'", "'\\''")}'`;
const xml = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

/** Paths are data, not shell source. systemd has its own quoting and percent expansion. */
export function serviceDefinition(installation: Installation, platform: string, path: string): string {
	const launcher = installation.launcher;
	if (/[\r\n\0]/.test(launcher + path)) throw new Error("Service paths cannot contain control characters");
	if (platform === "darwin") return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>io.github.mitzacoder.aiki.local</string>
<key>ProgramArguments</key><array><string>${xml(launcher)}</string><string>start</string></array>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(path)}</string></dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>StandardOutPath</key><string>${xml(join(installation.root, "service.log"))}</string>
<key>StandardErrorPath</key><string>${xml(join(installation.root, "service.log"))}</string>
</dict></plist>\n`;
	const quote = (text: string) => '"' + text.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("%", "%%").replaceAll("$", () => "$$") + '"';
	return `[Unit]
Description=Aiki local installation (loopback only)
After=network.target
[Service]
Type=simple
ExecStart=${quote(launcher)} start
Environment=${quote("PATH=" + path)}
Restart=on-failure
RestartSec=3
KillMode=mixed
TimeoutStopSec=30
[Install]
WantedBy=default.target\n`;
}

function metadata(root: string): Installation {
	const installation = JSON.parse(readFileSync(join(root, ".aiki-install.json"), "utf8")) as Installation;
	if (installation.root !== root || readFileSync(join(root, ".aiki-managed"), "utf8").trim() !== "aiki-installer-v1") {
		throw new Error("Not an Aiki-managed installation");
	}
	return installation;
}
function atomicLink(root: string, name: string, target: string): void {
	const temporary = join(root, `.${name}-${process.pid}`);
	rmSync(temporary, { force: true });
	symlinkSync(target, temporary);
	renameSync(temporary, join(root, name));
}
function atomicText(path: string, text: string, mode = 0o600): void {
	const temporary = `${path}.incoming-${process.pid}`;
	try {
		writeFileSync(temporary, text, { mode, flag: "wx" });
		renameSync(temporary, path);
	} finally { rmSync(temporary, { force: true }); }
}
function running(root: string): boolean {
	try {
		const pid = Number(readFileSync(join(root, "server.pid"), "utf8"));
		if (!Number.isSafeInteger(pid) || pid <= 0) return false;
		process.kill(pid, 0); return true;
	} catch { return false; }
}
function requireStopped(root: string): void {
	if (running(root)) throw new Error("Aiki is running. Stop the foreground process (Ctrl-C) or your user service before changing releases.");
}
async function run(command: string[], options: { env?: Record<string, string | undefined> } = {}): Promise<void> {
	const child = Bun.spawn(command, { stdin: "ignore", stdout: "inherit", stderr: "inherit", env: childEnvironment(options.env) });
	const timer = setTimeout(() => child.kill(), 300_000);
	try { if (await child.exited !== 0) throw new Error(`${command[0]} failed`); }
	finally { clearTimeout(timer); }
}
function servicePath(platform = process.platform): string {
	return platform === "darwin"
		? join(homedir(), "Library/LaunchAgents/io.github.mitzacoder.aiki.local.plist")
		: join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "systemd/user/aiki-local.service");
}
async function service(installation: Installation, action: string, print: boolean): Promise<void> {
	if (action !== "install" && action !== "remove") throw new Error("Usage: aiki service install|remove [--print]");
	if (print) { console.log(serviceDefinition(installation, process.platform, process.env.PATH || "/usr/bin:/bin")); return; }
	const path = servicePath();
	const ownFile = existsSync(join(installation.root, ".service-path")) && readFileSync(join(installation.root, ".service-path"), "utf8") === path;
	if (existsSync(path) && !ownFile) throw new Error("Another local Aiki service exists; refusing to overwrite/remove it");
	if (action === "remove" && !ownFile) { console.log("No service installed by this installation."); return; }
	if (action === "install") {
		const manager = process.platform === "darwin" ? "launchctl" : "systemctl";
		if (!Bun.which(manager)) throw new Error(`No ${manager} user service manager. Continue with aiki start.`);
		requireStopped(installation.root);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, serviceDefinition(installation, process.platform, process.env.PATH || "/usr/bin:/bin"), { mode: 0o600 });
		writeFileSync(join(installation.root, ".service-path"), path);
	}
	try {
		if (process.platform === "darwin") {
			await run(["launchctl", action === "install" ? "bootstrap" : "bootout", `gui/${process.getuid!()}`, path]);
		} else {
			if (action === "install") await run(["systemctl", "--user", "daemon-reload"]);
			await run(["systemctl", "--user", action === "install" ? "enable" : "disable", "--now", "aiki-local.service"]);
		}
	} catch (error) {
		// No session bus / no GUI login is common. Do not strand a failed unit or block uninstall of a stopped app.
		if (running(installation.root)) throw error;
		rmSync(path, { force: true }); rmSync(join(installation.root, ".service-path"), { force: true });
		if (action === "install") throw error;
		console.log("Service manager unavailable; removed this stopped installation's service definition.");
		return;
	}
	if (action === "remove") {
		rmSync(path, { force: true }); rmSync(join(installation.root, ".service-path"), { force: true });
		if (process.platform !== "darwin") await run(["systemctl", "--user", "daemon-reload"]);
	}
	console.log(`User service ${action === "install" ? "installed" : "removed"}.`);
}

/** The launcher uses the same installation metadata for both runtimes; --version always probes the executable itself. */
export function installedCliRequested(args: string[]): boolean {
	return args[0] !== "--version" && (Boolean(process.env.AIKI_INSTALL_DIR) || args[0] === "activate" || args[0] === "uninstall");
}

async function installedServerEntry(root: string, settings: Readonly<Record<string, string | undefined>>, args: string[]): Promise<void> {
	const { runServerEntry } = packagedResources.release
		? await import("../packages/server/src/main.ts")
		: await import(join(realpathSync(join(root, "current")), "packages/server/src/main.ts"));
	await runServerEntry(settings, args);
}

export async function runInstalledCli(args: string[]): Promise<void> {
	const [command = "help", ...rest] = args;
	if (command === "activate") {
		const [root, config, version, launcher, selectedChannel, releaseName = version] = rest;
		if (!root || !config || !version || !launcher) throw new Error("Incomplete activation");
		if (selectedChannel && selectedChannel !== "pilot" && selectedChannel !== "stable") throw new Error("Invalid update channel");
		if (![version, `${version}-bun`, `${version}-binary`].includes(releaseName)) throw new Error("Invalid release directory");
		const old = existsSync(join(root, ".aiki-install.json")) ? metadata(root) : undefined;
		const changed = old?.version !== version || (old.release ?? old.version) !== releaseName;
		if (changed) requireStopped(root);
		if (old && changed && existsSync(join(root, "current"))) atomicLink(root, "previous", `releases/${old.release ?? old.version}`);
		atomicLink(root, "current", `releases/${releaseName}`);
		const installation: Installation = { root, config: old?.config ?? config, data: old?.data ?? join(root, "data"), version, launcher, ...(releaseName !== version ? { release: releaseName } : {}),
			channel: (selectedChannel as UpdateChannel | undefined) || old?.channel || releaseChannel(version) };
		atomicText(join(root, ".aiki-install.json"), JSON.stringify(installation, null, 2));
		mkdirSync(installation.config, { recursive: true });
		const configFile = join(installation.config, "server.env");
		if (!existsSync(configFile)) writeFileSync(configFile, "# Local Aiki server settings\n", { mode: 0o600, flag: "wx" });
		mkdirSync(dirname(launcher), { recursive: true });
		atomicText(launcher, `#!/bin/sh\n# Aiki launcher: ${root}\nexport AIKI_INSTALL_DIR=${shellQuote(root)}\nexport PATH=${shellQuote(join(root, "tools/bin"))}:"$PATH"\nif [ -x "$AIKI_INSTALL_DIR/current/aiki" ]; then\n  exec "$AIKI_INSTALL_DIR/current/aiki" "$@"\nfi\nexec ${shellQuote(join(root, `runtime/bun-${BUN_VERSION}/bin/bun`))} "$AIKI_INSTALL_DIR/current/scripts/aiki.ts" "$@"\n`, 0o755);
		// Retain just current and previous; do not collect data/config or unknown top-level paths.
		const { readdirSync } = await import("node:fs");
		const keep = new Set([realpathSync(join(root, "current")), existsSync(join(root, "previous")) ? realpathSync(join(root, "previous")) : ""]);
		for (const release of readdirSync(join(root, "releases"))) {
			const path = join(root, "releases", release);
			if (!keep.has(path)) rmSync(path, { recursive: true, force: true });
		}
		console.log(`Aiki ${version} activated.`); return;
	}
	const root = resolve(command === "uninstall" ? rest[0]! : process.env.AIKI_INSTALL_DIR || join(homedir(), ".local/share/aiki"));
	const installation = metadata(root);
	// Use T82's one environment boundary and private loader, not mutable process settings.
	const { loadServerEnv, resolvedServerConfig } = await import("../packages/server/src/server-env.ts");
	const settings = loadServerEnv({
		...childEnvironment(),
		AIKI_ENV_FILE: join(installation.config, "server.env"),
		AIKI_DATA_DIR: installation.data,
		AIKI_CONFIG_DIR: installation.config,
		AIKI_HOST: "127.0.0.1",
		AIKI_WEB_DIR: packagedResources.web ? "embedded" : join(root, "current/apps/web/build"),
		...(!installation.version.startsWith("ref-") ? {
			AIKI_INSTALLED_VERSION: installation.version,
			AIKI_UPDATE_CHANNEL: installation.channel || releaseChannel(installation.version),
		} : {}),
		...(process.env.AIKI_PORT ? { AIKI_PORT: process.env.AIKI_PORT } : {}),
	});
	const port = settings.AIKI_PORT || "7317";
	if (command !== "auth" && command !== "pair" && (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)) throw new Error("AIKI_PORT must be 1–65535");
	const url = `http://127.0.0.1:${port}`;
	switch (command) {
		case "start": {
			requireStopped(root);
			try { writeFileSync(join(root, "server.pid"), String(process.pid), { mode: 0o600, flag: "wx" }); }
			catch { throw new Error("server.pid already exists. If a previous process crashed, confirm it is stopped before removing this stale file."); }
			process.on("exit", () => { try { rmSync(join(root, "server.pid")); } catch { /* already removed */ } });
			const effective = resolvedServerConfig(settings);
			console.log(`Aiki data: ${effective.dataDir}\nAiki config: ${effective.configDir}`);
			// Resolve the selected release now; a running process never changes imports underneath itself.
			await installedServerEntry(root, settings, []); break;
		}
		case "auth": {
			// Explicit env-file/data settings identify this installation even in an agent child shell.
			await installedServerEntry(root, settings, ["auth", ...rest]); break;
		}
		case "health-check":
			await installedServerEntry(root, settings, ["auth", "health-check", JSON.stringify({ type: "server.status", id: "installed-health" })]); break;
		case "open":
			console.log(url);
			if (process.env.AIKI_NO_BROWSER === "1") break;
			if (process.platform === "darwin") await run(["open", url]);
			else if (Bun.which("xdg-open")) await run(["xdg-open", url]);
			else console.log("Open this URL in a browser on this machine.");
			break;
		case "pair": {
			// Delegate enrollment to the existing owner-only socket; no HTTP management or new auth protocol.
			const response = await fetch("http://localhost/", {
				unix: join(installation.data, "auth.sock"), method: "POST",
				headers: { "content-type": "application/json" }, body: JSON.stringify({ args: ["pair", "--local"] }),
				signal: AbortSignal.timeout(10000),
			});
			const grant = await response.json() as { url?: string; expiresAt?: string; error?: { code: string } };
			if (!response.ok || !grant.url) throw new Error(`Pairing failed: ${grant.error?.code || "invalid owner response"}`);
			const link = new URL(grant.url);
			if (link.protocol !== "http:" || link.hostname !== "127.0.0.1" || link.pathname !== "/pair") throw new Error("Owner socket returned an invalid local pairing URL.");
			console.log(JSON.stringify({ url: grant.url, code: link.hash.slice("#bootstrap=".length), expiresAt: grant.expiresAt }, null, 2));
			break;
		}
		case "status": {
			try {
				const response = await fetch(`${url}/aiki-local.json`, { signal: AbortSignal.timeout(2000) });
				if (!response.ok || (await response.json() as { local?: boolean }).local !== true) throw new Error("Not an Aiki local server");
				console.log(`Running at ${url}; selected release ${installation.version}`);
			} catch { console.log(`Not responding at ${url}. Run aiki start or inspect your user service.`); process.exitCode = 1; }
			break;
		}
		case "version": console.log(`Aiki ${installation.version}\nBun ${Bun.version} (pinned ${BUN_VERSION})`); break;
		case "doctor": {
			console.log(`Aiki ${installation.version}; Bun ${Bun.version}; ${process.platform}/${process.arch}\nData: ${installation.data}\nConfig: ${installation.config}\nLocal URL: ${url} (loopback only; use aiki pair for device sign-in)`);
			for (const [tool, hint] of [["git", "repository operations"], ["jj", "isolated workers"], ["tailscale", "future phone access"], ["zellij", "persistent app terminals"], ["ffprobe", "optional video metadata"]]) {
				console.log(`${tool}: ${Bun.which(tool!) || `missing — needed for ${hint}`}`);
				if (Bun.which(tool!)) try { await run([tool!, tool === "tailscale" ? "version" : tool === "ffprobe" ? "-version" : "--version"]); }
				catch { console.log(`${tool}: version check failed; setup can continue.`); }
			}
			try { const listener = Bun.listen({ hostname: "127.0.0.1", port: Number(port), socket: { data() {} } }); listener.stop(); console.log(`Port ${port}: free`); }
			catch { console.log(`Port ${port}: in use; aiki status checks whether it is Aiki. Set AIKI_PORT for another port.`); }
			console.log("Tailscale alone is not authentication. Do not expose this server to the network."); break;
		}
		case "update": {
			requireStopped(root);
			console.log("Back up your data first: rollback changes code, not database migrations. Restart manually after update.");
			const selection = await updateSelection(rest, installation);
			// A host shell cannot read Bun\'s embedded filesystem. Unpack only this script into an owned 0700 directory.
			const temporary = packagedResources.installer ? mkdtempSync(join(root, ".update-")) : undefined;
			try {
				const installer = temporary ? join(temporary, "install.sh") : join(root, "current/install.sh");
				if (temporary) writeFileSync(installer, await Bun.file(packagedResources.installer!).arrayBuffer().then(bytes => new Uint8Array(bytes)), { mode: 0o600 });
				await run(["sh", installer, "--dir", root, "--no-service", ...rest,
					"--version", selection.version, "--channel", selection.channel]);
			} finally { if (temporary) rmSync(temporary, { recursive: true, force: true }); }
			break;
		}
		case "rollback": {
			requireStopped(root);
			if (!existsSync(join(root, "previous"))) throw new Error("No previous release retained");
			const previous = realpathSync(join(root, "previous"));
			const current = realpathSync(join(root, "current"));
			atomicLink(root, "current", previous); atomicLink(root, "previous", current);
			installation.version = readFileSync(join(previous, ".ready"), "utf8").trim();
			if (basename(previous) === installation.version) delete installation.release;
			else installation.release = basename(previous);
			atomicText(join(root, ".aiki-install.json"), JSON.stringify(installation, null, 2));
			console.log(`Selected ${installation.version}. Data was not rolled back. Run aiki start.`); break;
		}
		case "service": await service(installation, rest[0] || "", rest.includes("--print")); break;
		case "uninstall": {
			if (existsSync(join(root, ".service-path"))) await service(installation, "remove", false);
			requireStopped(root);
			if (existsSync(installation.launcher) && readFileSync(installation.launcher, "utf8").includes(`# Aiki launcher: ${root}\n`)) rmSync(installation.launcher);
			for (const path of ["current", "previous", "releases", "runtime", "tools", "server.pid", "service.log"]) rmSync(join(root, path), { recursive: true, force: true });
			if (rest[1] === "1") {
				rmSync(installation.data, { recursive: true, force: true });
				rmSync(installation.config, { recursive: true, force: true });
				rmSync(join(root, ".aiki-install.json"), { force: true });
				rmSync(join(root, ".aiki-managed"), { force: true });
			}
			console.log(rest[1] === "1" ? "Uninstalled and purged Aiki data/config. Repositories were not touched." : "Uninstalled. Data and config kept. Re-run the installer to reinstall."); break;
		}
		default: console.log("Usage: aiki start|open|pair|auth|status|update|rollback|version|doctor|service install|remove\nSee docs/INSTALL.md. Stop Aiki before updating or rolling back.");
	}
}
if (import.meta.main) {
	try { await runInstalledCli(process.argv.slice(2)); }
	catch (error) { console.error(`aiki: ${error instanceof Error ? error.message : error}`); process.exitCode = 1; }
}
