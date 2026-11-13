import { existsSync, readdirSync, realpathSync } from "node:fs";
import { environmentSetting } from "./environment-aliases.ts";
import { serverSettings } from "./server-settings.ts";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** Overrides the whole data directory. */
export const DATA_DIR_ENV = "AIKI_DATA_DIR";
/** TCP port for the HTTP + WebSocket server. */
export const PORT_ENV = "AIKI_PORT";
/**
	* Interface the HTTP + WebSocket server binds. Loopback by default; `0.0.0.0` (or an interface address) makes it reachable
	* from other machines, which is what a box whose firewall trusts only `tailscale0` needs.
	*/
export const HOST_ENV = "AIKI_HOST";
/**
	* The agent directory whose AGENTS.md and skills every conversation is given, like pi's `~/.pi/agent`. Service managers
	* may start the server with a HOME that is not the user's, so this is what makes the directory a choice.
	*/
export const AGENT_DIR_ENV = "AIKI_AGENT_DIR";
/**
	* Overrides the harness's own config directory, which holds its SYSTEM.md and APPEND_SYSTEM.md. Deliberately not pi's
	* agent directory: these two files are the harness's, and pi's are left to pi.
	*/
export const CONFIG_DIR_ENV = "AIKI_CONFIG_DIR";
/**
	* Overrides Claude Code's home, whose `skills` directory the conversations are also offered. Service managers may start
	* the server with a HOME that is not the user's, so this is what makes the directory a choice.
	*/
export const CLAUDE_DIR_ENV = "AIKI_CLAUDE_DIR";
export const DEFAULT_PORT = 7317;
export const DEFAULT_HOSTNAME = "127.0.0.1";

export type Environment = Readonly<Record<string, string | undefined>>;

function expandHome(path: string): string {
	if (path === "~") return homedir();
	if (path.startsWith("~/")) return join(homedir(), path.slice(2));
	return path;
}

/**
	* `${AIKI_DATA_DIR}` when set, else `${XDG_DATA_HOME:-~/.local/share}/aiki`.
	*/
export function resolveDataDir(env: Environment = serverSettings): string {
	const override = environmentSetting(env, DATA_DIR_ENV);
	if (override !== undefined && override.trim().length > 0) return resolve(expandHome(override.trim()));
	const xdg = env["XDG_DATA_HOME"];
	const base = xdg !== undefined && xdg.trim().length > 0 ? resolve(expandHome(xdg.trim())) : join(homedir(), ".local", "share");
	return defaultProductDirectory(base);
}

/**
	* `${AIKI_AGENT_DIR}` when set, else `~/.pi/agent` of the user the server runs as. `~` expands to that user's
	* home, which is not necessarily the one whose files the harness should read.
	*/
export function resolveAgentDir(env: Environment = serverSettings): string {
	const override = environmentSetting(env, AGENT_DIR_ENV);
	if (override !== undefined && override.trim().length > 0) return resolve(expandHome(override.trim()));
	return join(homedir(), ".pi", "agent");
}

/**
	* `${AIKI_CONFIG_DIR}` when set, else `${XDG_CONFIG_HOME:-~/.config}/aiki`: where the harness keeps its
	* own `SYSTEM.md` and `APPEND_SYSTEM.md`, separate from pi's agent directory.
	*/
export function resolveConfigDir(env: Environment = serverSettings): string {
	const override = environmentSetting(env, CONFIG_DIR_ENV);
	if (override !== undefined && override.trim().length > 0) return resolve(expandHome(override.trim()));
	const xdg = env["XDG_CONFIG_HOME"];
	const base = xdg !== undefined && xdg.trim().length > 0 ? resolve(expandHome(xdg.trim())) : join(homedir(), ".config");
	return defaultProductDirectory(base);
}

/**
	* `${AIKI_CLAUDE_DIR}` when set, else `~/.claude` of the user the server runs as: Claude Code's home, whose
	* `skills` directory holds the personal skills, the ones synced from claude.ai, and the installed plugins' skills.
	*/
export function resolveClaudeDir(env: Environment = serverSettings): string {
	const override = environmentSetting(env, CLAUDE_DIR_ENV);
	if (override !== undefined && override.trim().length > 0) return resolve(expandHome(override.trim()));
	return join(homedir(), ".claude");
}

/** AIKI_HOST when set, else 127.0.0.1. */
export function resolveHostname(env: Environment = serverSettings): string {
	const raw = environmentSetting(env, HOST_ENV);
	return raw !== undefined && raw.trim().length > 0 ? raw.trim() : DEFAULT_HOSTNAME;
}

export function resolvePort(env: Environment = serverSettings): number {
	const raw = environmentSetting(env, PORT_ENV);
	if (raw === undefined || raw.trim().length === 0) return DEFAULT_PORT;
	const port = Number(raw);
	if (!Number.isInteger(port) || port < 0 || port > 65_535) {
		throw new Error(`${PORT_ENV} must be an integer between 0 and 65535, got "${raw}"`);
	}
	return port;
}

/** The data directory and its subdirectories, private to the user. Idempotent. */
export async function ensureDataDir(dataDir: string): Promise<void> {
	await mkdir(dataDir, { recursive: true, mode: 0o700 });
	await mkdir(join(dataDir, "projects"), { recursive: true, mode: 0o700 });
}

/** No copying or migration: a pre-existing legacy default remains the same backend. */
export function defaultProductDirectory(base: string): string {
	const canonical = join(base, "kemiri"), legacy = join(base, "aiki");
	const populated = (path: string) => existsSync(path) && readdirSync(path).length > 0;
	if (populated(canonical) && populated(legacy) && realpathSync(canonical) !== realpathSync(legacy)) {
		throw new Error("Both kemiri and aiki default directories contain data; choose an explicit KEMIRI_DATA_DIR or KEMIRI_CONFIG_DIR (or KEMIRI_ENV_FILE).");
	}
	if (existsSync(legacy) && (!existsSync(canonical) || (!populated(canonical) && populated(legacy)))) return legacy;
	return canonical;
}
