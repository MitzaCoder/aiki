#!/usr/bin/env bun
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { defaultProductDirectory } from "../packages/server/src/data-dir.ts";
import { normalizeEnvironment } from "../packages/server/src/environment-aliases.ts";
import { childEnvironment } from "../packages/server/src/child-environment.ts";
import { packagedResources } from "../packages/server/src/packaged-resources.ts";
import { mkdtempSync } from "node:fs";
import { superviseInstallation, selectRetainedRelease } from "./installed-supervisor.ts";

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
Description=Kemiri local installation (loopback only)
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
		throw new Error("Not a Kemiri-managed installation");
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
	if (existsSync(join(root, "supervisor.pid"))) {
		const pid = Number(readFileSync(join(root, "supervisor.pid"), "utf8"));
		let alive = false;
		if (Number.isSafeInteger(pid) && pid > 0) try { process.kill(pid, 0); alive = true; } catch { /* Stale supervisor. */ }
		if (alive && !(normalizeEnvironment(process.env).KEMIRI_UPDATE_CHILD === "1" && process.ppid === pid)) throw new Error("Kemiri is running. Stop its supervisor before changing releases.");
	}
	if (running(root)) throw new Error("Kemiri is running. Stop the foreground process (Ctrl-C) or your user service before changing releases.");
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
	if (action !== "install" && action !== "remove") throw new Error("Usage: kemiri service install|remove [--print]");
	if (print) { console.log(serviceDefinition(installation, process.platform, process.env.PATH || "/usr/bin:/bin")); return; }
	const path = existsSync(join(installation.root, ".service-path")) ? readFileSync(join(installation.root, ".service-path"), "utf8") : servicePath();
	const ownFile = existsSync(join(installation.root, ".service-path")) && readFileSync(join(installation.root, ".service-path"), "utf8") === path;
	if (existsSync(path) && !ownFile) throw new Error("Another local Kemiri service exists; refusing to overwrite/remove it");
	if (action === "remove" && !ownFile) { console.log("No service installed by this installation."); return; }
	if (action === "install") {
		const manager = process.platform === "darwin" ? "launchctl" : "systemctl";
		if (!Bun.which(manager)) throw new Error(`No ${manager} user service manager. Continue with kemiri start.`);
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
			await run(["systemctl", "--user", action === "install" ? "enable" : "disable", "--now", basename(path)]);
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

function installationLaunchers(_root: string, recorded: string): string[] {
	return [...new Set([basename(recorded) === "aiki" ? join(dirname(recorded), "kemiri") : recorded, join(homedir(), ".local/bin/kemiri")])];
}
function ownsLauncher(path: string, root: string): boolean {
	try { return readFileSync(path, "utf8").includes(`# Aiki launcher: ${root}\n`); } catch { return false; }
}
function requireOwnedLauncher(path: string, root: string): void {
	try { lstatSync(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
	if (!ownsLauncher(path, root)) throw new Error(`Unrelated launcher exists at ${path}; refusing to overwrite it`);
}
export function launcherDefinition(root: string): string {
	return `#!/bin/sh
# Aiki launcher: ${root}
# Kemiri launcher: ${root}
export KEMIRI_INSTALL_DIR=${shellQuote(root)}
export PATH=${shellQuote(join(root, "tools/bin"))}:"$PATH"
for binary in "$KEMIRI_INSTALL_DIR/current/kemiri" "$KEMIRI_INSTALL_DIR/current/aiki"; do
	if [ -x "$binary" ]; then
		if [ "\${1-}" = --version ]; then
			if identity=$("$binary" --kemiri-version 2>/dev/null); then
				case "$identity" in "Kemiri "*) printf '%s\n' "$identity"; exit 0 ;; esac
			fi
		fi
		exec "$binary" "$@"
	fi
done
exec ${shellQuote(join(root, `runtime/bun-${BUN_VERSION}/bin/bun`))} "$KEMIRI_INSTALL_DIR/current/scripts/aiki.ts" "$@"
`;
}

/** The launcher uses the same installation metadata for both runtimes; --version always probes the executable itself. */
export function installedCliRequested(args: string[]): boolean {
	return ! ["--version", "--kemiri-version"].includes(args[0] ?? "") && (Boolean(normalizeEnvironment(process.env).KEMIRI_INSTALL_DIR) || args[0] === "activate" || args[0] === "uninstall");
}

async function installedServerEntry(root: string, settings: Readonly<Record<string, string | undefined>>, args: string[]): Promise<void> {
	const { runServerEntry } = packagedResources.release
		? await import("../packages/server/src/main.ts")
		: await import(join(realpathSync(join(root, "current")), "packages/server/src/main.ts"));
	await runServerEntry(settings, args);
}

export async function runInstalledCli(args: string[]): Promise<void> {
	const [requested = "help", ...rest] = args;
	const command = requested === "--version" || requested === "--kemiri-version" ? "version" : requested;
	if (command === "activate") {
		const [root, config, version, launcher, selectedChannel, releaseName = version] = rest;
		if (!root || !config || !version || !launcher) throw new Error("Incomplete activation");
		if (selectedChannel && selectedChannel !== "pilot" && selectedChannel !== "stable") throw new Error("Invalid update channel");
		if (![version, `${version}-bun`, `${version}-binary`].includes(releaseName)) throw new Error("Invalid release directory");
		const old = existsSync(join(root, ".aiki-install.json")) ? metadata(root) : undefined;
		const launchers = installationLaunchers(root, old?.launcher ?? launcher);
		for (const path of launchers) requireOwnedLauncher(path, root);
		const changed = old?.version !== version || (old.release ?? old.version) !== releaseName;
		if (changed) requireStopped(root);
		if (old && changed && existsSync(join(root, "current"))) atomicLink(root, "previous", `releases/${old.release ?? old.version}`);
		atomicLink(root, "current", `releases/${releaseName}`);
		const installation: Installation = { root, config: old?.config ?? config, data: old?.data ?? join(root, "data"), version, launcher: launchers[0]!, ...(releaseName !== version ? { release: releaseName } : {}),
			channel: (selectedChannel as UpdateChannel | undefined) || old?.channel || releaseChannel(version) };
		atomicText(join(root, ".aiki-install.json"), JSON.stringify(installation, null, 2));
		mkdirSync(installation.config, { recursive: true });
		const configFile = join(installation.config, "server.env");
		if (!existsSync(configFile)) writeFileSync(configFile, "# Local Kemiri server settings\n", { mode: 0o600, flag: "wx" });
		for (const path of launchers) {
			mkdirSync(dirname(path), { recursive: true });
			atomicText(path, launcherDefinition(root), 0o755);
		}
		// Remove only launchers this installation owns; never touch an unrelated aiki command.
		for (const path of new Set([join(homedir(), ".local/bin/aiki"), ...(old?.launcher && basename(old.launcher) === "aiki" ? [old.launcher] : [])])) {
			if (ownsLauncher(path, root)) rmSync(path, { force: true });
		}
		if (old && old.launcher !== installation.launcher && existsSync(join(root, ".service-path"))) {
			const path = readFileSync(join(root, ".service-path"), "utf8");
			const definition = readFileSync(path, "utf8");
			atomicText(path, definition.replaceAll(old.launcher, installation.launcher));
		}
		// Retain just current and previous; do not collect data/config or unknown top-level paths.
		const { readdirSync } = await import("node:fs");
		const keep = new Set([realpathSync(join(root, "current")), existsSync(join(root, "previous")) ? realpathSync(join(root, "previous")) : ""]);
		for (const release of readdirSync(join(root, "releases"))) {
			const path = join(root, "releases", release);
			if (!keep.has(path)) rmSync(path, { recursive: true, force: true });
		}
		console.log(`Kemiri ${version} activated.`); return;
	}
	const root = resolve(command === "uninstall" ? rest[0]! : normalizeEnvironment(process.env).KEMIRI_INSTALL_DIR || defaultProductDirectory(process.env.XDG_DATA_HOME || join(homedir(), ".local/share")));
	const installation = metadata(root);
	// Use T82's one environment boundary and private loader, not mutable process settings.
	const { loadServerEnv, resolvedServerConfig } = await import("../packages/server/src/server-env.ts");
	const settings = loadServerEnv({
		...childEnvironment(),
		KEMIRI_ENV_FILE: join(installation.config, "server.env"),
		KEMIRI_DATA_DIR: installation.data,
		KEMIRI_INSTALL_DIR: root,
		KEMIRI_UPDATE_SUPERVISED: normalizeEnvironment(process.env).KEMIRI_UPDATE_CHILD === "1" ? "1" : undefined,
		KEMIRI_CONFIG_DIR: installation.config,
		KEMIRI_HOST: "127.0.0.1",
		KEMIRI_WEB_DIR: packagedResources.web ? "embedded" : join(root, "current/apps/web/build"),
		...(!installation.version.startsWith("ref-") ? {
			KEMIRI_INSTALLED_VERSION: installation.version,
			KEMIRI_UPDATE_CHANNEL: installation.channel || releaseChannel(installation.version),
		} : {}),
		...(normalizeEnvironment(process.env).KEMIRI_PORT ? { KEMIRI_PORT: normalizeEnvironment(process.env).KEMIRI_PORT } : {}),
	});
	const port = settings.KEMIRI_PORT || "7317";
	if (command !== "auth" && command !== "pair" && (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)) throw new Error("KEMIRI_PORT must be 1–65535");
	const url = `http://127.0.0.1:${port}`;
	switch (command) {
		case "start": {
			if (normalizeEnvironment(process.env).KEMIRI_UPDATE_CHILD !== "1") { await superviseInstallation(installation, settings); break; }
			requireStopped(root);
			try { writeFileSync(join(root, "server.pid"), String(process.pid), { mode: 0o600, flag: "wx" }); }
			catch { throw new Error("server.pid already exists. If a previous process crashed, confirm it is stopped before removing this stale file."); }
			process.on("exit", () => { try { rmSync(join(root, "server.pid")); } catch { /* already removed */ } });
			const effective = resolvedServerConfig(settings);
			console.log(`Kemiri data: ${effective.dataDir}\nKemiri config: ${effective.configDir}`);
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
			if (normalizeEnvironment(process.env).KEMIRI_NO_BROWSER === "1") break;
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
				if (!response.ok || (await response.json() as { local?: boolean }).local !== true) throw new Error("Not a Kemiri local server");
				console.log(`Running at ${url}; selected release ${installation.version}`);
			} catch { console.log(`Not responding at ${url}. Run kemiri start or inspect your user service.`); process.exitCode = 1; }
			break;
		}
		case "version": console.log(`Kemiri ${installation.version}\nBun ${Bun.version} (pinned ${BUN_VERSION})`); break;
		case "doctor": {
			console.log(`Kemiri ${installation.version}; Bun ${Bun.version}; ${process.platform}/${process.arch}\nData: ${installation.data}\nConfig: ${installation.config}\nLocal URL: ${url} (loopback only; use kemiri pair for device sign-in)`);
			for (const [tool, hint] of [["git", "repository operations"], ["jj", "isolated workers"], ["tailscale", "future phone access"], ["zellij", "persistent app terminals"], ["ffprobe", "optional video metadata"]]) {
				console.log(`${tool}: ${Bun.which(tool!) || `missing — needed for ${hint}`}`);
				if (Bun.which(tool!)) try { await run([tool!, tool === "tailscale" ? "version" : tool === "ffprobe" ? "-version" : "--version"]); }
				catch { console.log(`${tool}: version check failed; setup can continue.`); }
			}
			try { const listener = Bun.listen({ hostname: "127.0.0.1", port: Number(port), socket: { data() {} } }); listener.stop(); console.log(`Port ${port}: free`); }
			catch { console.log(`Port ${port}: in use; kemiri status checks whether it is Kemiri. Set KEMIRI_PORT for another port.`); }
			console.log("Tailscale alone is not authentication. Do not expose this server to the network."); break;
		}
		case "stage-update":
		case "update": {
			if (command === "update") requireStopped(root);
			console.log("Back up your data first: rollback changes code, not database migrations. Restart manually after update.");
			const selection = await updateSelection(rest, installation);
			// A host shell cannot read Bun\'s embedded filesystem. Unpack only this script into an owned 0700 directory.
			const temporary = packagedResources.installer ? mkdtempSync(join(root, ".update-")) : undefined;
			try {
				const installer = temporary ? join(temporary, "install.sh") : join(root, "current/install.sh");
				if (temporary) writeFileSync(installer, await Bun.file(packagedResources.installer!).arrayBuffer().then(bytes => new Uint8Array(bytes)), { mode: 0o600 });
				await run(["sh", installer, "--dir", root, "--no-service", ...rest,
					"--version", selection.version, "--channel", selection.channel, ...(command === "stage-update" ? ["--stage-only"] : [])]);
			} finally { if (temporary) rmSync(temporary, { recursive: true, force: true }); }
			break;
		}
		case "rollback": {
			requireStopped(root);
			if (!existsSync(join(root, "previous"))) throw new Error("No previous release retained");
			const previous = realpathSync(join(root, "previous"));
			const current = realpathSync(join(root, "current"));
			selectRetainedRelease(installation, previous, current);
			console.log(`Selected ${installation.version}. Data was not rolled back. Run kemiri start.`); break;
		}
		case "service": await service(installation, rest[0] || "", rest.includes("--print")); break;
		case "uninstall": {
			if (existsSync(join(root, ".service-path"))) await service(installation, "remove", false);
			requireStopped(root);
			for (const path of [...installationLaunchers(root, installation.launcher), join(homedir(), ".local/bin/aiki")]) {
				if (existsSync(path) && ownsLauncher(path, root)) rmSync(path);
			}
			for (const path of ["current", "previous", "releases", "runtime", "tools", "server.pid", "service.log"]) rmSync(join(root, path), { recursive: true, force: true });
			if (rest[1] === "1") {
				rmSync(installation.data, { recursive: true, force: true });
				rmSync(installation.config, { recursive: true, force: true });
				rmSync(join(root, ".aiki-install.json"), { force: true });
				rmSync(join(root, ".aiki-managed"), { force: true });
			}
			console.log(rest[1] === "1" ? "Uninstalled and purged Kemiri data/config. Repositories were not touched." : "Uninstalled. Data and config kept. Re-run the installer to reinstall."); break;
		}
		default: console.log("Usage: kemiri start|open|pair|auth|status|update|rollback|version|doctor|service install|remove\nSee docs/INSTALL.md. Stop Kemiri before updating or rolling back.");
	}
}
if (import.meta.main) {
	try { await runInstalledCli(process.argv.slice(2)); }
	catch (error) { console.error(`kemiri: ${error instanceof Error ? error.message : error}`); process.exitCode = 1; }
}
