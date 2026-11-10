#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const BUN_VERSION = "1.4.4";
type Installation = { root: string; config: string; data: string; launcher: string; version: string };
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
	const child = Bun.spawn(command, { stdin: "ignore", stdout: "inherit", stderr: "inherit", ...options });
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

async function main(args: string[]): Promise<void> {
	const [command = "help", ...rest] = args;
	if (command === "activate") {
		const [root, config, version, launcher] = rest;
		if (!root || !config || !version || !launcher) throw new Error("Incomplete activation");
		const old = existsSync(join(root, ".aiki-install.json")) ? metadata(root) : undefined;
		if (old?.version !== version) requireStopped(root);
		if (old && old.version !== version && existsSync(join(root, "current"))) atomicLink(root, "previous", `releases/${old.version}`);
		atomicLink(root, "current", `releases/${version}`);
		const installation: Installation = { root, config: old?.config ?? config, data: old?.data ?? join(root, "data"), version, launcher };
		writeFileSync(join(root, ".aiki-install.json"), JSON.stringify(installation, null, 2));
		mkdirSync(installation.config, { recursive: true });
		const configFile = join(installation.config, "server.env");
		if (!existsSync(configFile)) writeFileSync(configFile, "# Local Aiki server settings\n", { mode: 0o600, flag: "wx" });
		mkdirSync(dirname(launcher), { recursive: true });
		writeFileSync(launcher, `#!/bin/sh\n# Aiki launcher: ${root}\nexport AIKI_INSTALL_DIR=${shellQuote(root)}\nexport PATH=${shellQuote(join(root, "tools/bin"))}:"$PATH"\nexec ${shellQuote(join(root, `runtime/bun-${BUN_VERSION}/bin/bun`))} "$AIKI_INSTALL_DIR/current/scripts/aiki.ts" "$@"\n`, { mode: 0o755 });
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
	// An installed launcher must not inherit another backend's storage/config paths.
	process.env.AIKI_CONFIG_DIR = installation.config;
	process.env.AIKI_DATA_DIR = installation.data;
	const envFile = join(installation.config, "server.env");
	// Activation creates this file, so main never falls back to another HOME/XDG env file.
	process.env.AIKI_ENV_FILE = envFile;
	const { loadServerEnv } = await import("../packages/server/src/server-env.ts");
	loadServerEnv();
	const port = process.env.AIKI_PORT || "7317";
	if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error("AIKI_PORT must be 1–65535");
	const url = `http://127.0.0.1:${port}`;
	switch (command) {
		case "start": {
			requireStopped(root);
			try { writeFileSync(join(root, "server.pid"), String(process.pid), { mode: 0o600, flag: "wx" }); }
			catch { throw new Error("server.pid already exists. If a previous process crashed, confirm it is stopped before removing this stale file."); }
			process.on("exit", () => { try { rmSync(join(root, "server.pid")); } catch { /* already removed */ } });
			process.env.AIKI_HOST = "127.0.0.1";
			process.env.AIKI_WEB_DIR = join(root, "current/apps/web/build");
			console.log(`Aiki data: ${process.env.AIKI_DATA_DIR}\nAiki config: ${process.env.AIKI_CONFIG_DIR}`);
			// Resolve the selected release now; a running process never changes imports underneath itself.
			const entry = join(realpathSync(join(root, "current")), "packages/server/src/main.ts");
			await import(entry); break;
		}
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
			if (link.origin !== url) throw new Error("Pairing URL uses a different port. Set AIKI_PORT to the running server port.");
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
			await run(["sh", join(root, "current/install.sh"), "--dir", root, "--no-service", ...rest]); break;
		}
		case "rollback": {
			requireStopped(root);
			if (!existsSync(join(root, "previous"))) throw new Error("No previous release retained");
			const previous = realpathSync(join(root, "previous"));
			const current = realpathSync(join(root, "current"));
			atomicLink(root, "current", previous); atomicLink(root, "previous", current);
			installation.version = readFileSync(join(previous, ".ready"), "utf8").trim();
			writeFileSync(join(root, ".aiki-install.json"), JSON.stringify(installation, null, 2));
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
		default: console.log("Usage: aiki start|open|pair|status|update|rollback|version|doctor|service install|remove\nSee docs/INSTALL.md. Stop Aiki before updating or rolling back.");
	}
}
if (import.meta.main) {
	try { await main(process.argv.slice(2)); }
	catch (error) { console.error(`aiki: ${error instanceof Error ? error.message : error}`); process.exitCode = 1; }
}
