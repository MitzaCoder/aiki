import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** Overrides the whole data directory. */
export const DATA_DIR_ENV = "MIHAI_HARNESS_DATA_DIR";
/** TCP port for the HTTP + WebSocket server. */
export const PORT_ENV = "MIHAI_HARNESS_PORT";
/**
 * Interface the HTTP + WebSocket server binds. Loopback by default; `0.0.0.0` (or an interface address) makes it reachable
 * from other machines, which is what a box whose firewall trusts only `tailscale0` needs.
 */
export const HOST_ENV = "MIHAI_HARNESS_HOST";
/**
 * The agent directory whose AGENTS.md and skills every conversation is given, like pi's `~/.pi/agent`. Service managers
 * may start the server with a HOME that is not the user's, so this is what makes the directory a choice.
 */
export const AGENT_DIR_ENV = "MIHAI_HARNESS_AGENT_DIR";
/**
 * Overrides the harness's own config directory, which holds its SYSTEM.md and APPEND_SYSTEM.md. Deliberately not pi's
 * agent directory: these two files are the harness's, and pi's are left to pi.
 */
export const CONFIG_DIR_ENV = "MIHAI_HARNESS_CONFIG_DIR";
/**
 * Overrides Claude Code's home, whose `skills` directory the conversations are also offered. Service managers may start
 * the server with a HOME that is not the user's, so this is what makes the directory a choice.
 */
export const CLAUDE_DIR_ENV = "MIHAI_HARNESS_CLAUDE_DIR";
export const DEFAULT_PORT = 7317;
export const DEFAULT_HOSTNAME = "127.0.0.1";

export type Environment = Readonly<Record<string, string | undefined>>;

function expandHome(path: string): string {
	if (path === "~") return homedir();
	if (path.startsWith("~/")) return join(homedir(), path.slice(2));
	return path;
}

/**
 * `${MIHAI_HARNESS_DATA_DIR}` when set, else `${XDG_DATA_HOME:-~/.local/share}/mihai-harness`.
 */
export function resolveDataDir(env: Environment = process.env): string {
	const override = env[DATA_DIR_ENV];
	if (override !== undefined && override.trim().length > 0) return resolve(expandHome(override.trim()));
	const xdg = env["XDG_DATA_HOME"];
	const base = xdg !== undefined && xdg.trim().length > 0 ? resolve(expandHome(xdg.trim())) : join(homedir(), ".local", "share");
	return join(base, "mihai-harness");
}

/**
 * `${MIHAI_HARNESS_AGENT_DIR}` when set, else `~/.pi/agent` of the user the server runs as. `~` expands to that user's
 * home, which is not necessarily the one whose files the harness should read.
 */
export function resolveAgentDir(env: Environment = process.env): string {
	const override = env[AGENT_DIR_ENV];
	if (override !== undefined && override.trim().length > 0) return resolve(expandHome(override.trim()));
	return join(homedir(), ".pi", "agent");
}

/**
 * `${MIHAI_HARNESS_CONFIG_DIR}` when set, else `${XDG_CONFIG_HOME:-~/.config}/mihai-harness`: where the harness keeps its
 * own `SYSTEM.md` and `APPEND_SYSTEM.md`, separate from pi's agent directory.
 */
export function resolveConfigDir(env: Environment = process.env): string {
	const override = env[CONFIG_DIR_ENV];
	if (override !== undefined && override.trim().length > 0) return resolve(expandHome(override.trim()));
	const xdg = env["XDG_CONFIG_HOME"];
	const base = xdg !== undefined && xdg.trim().length > 0 ? resolve(expandHome(xdg.trim())) : join(homedir(), ".config");
	return join(base, "mihai-harness");
}

/**
 * `${MIHAI_HARNESS_CLAUDE_DIR}` when set, else `~/.claude` of the user the server runs as: Claude Code's home, whose
 * `skills` directory holds the personal skills, the ones synced from claude.ai, and the installed plugins' skills.
 */
export function resolveClaudeDir(env: Environment = process.env): string {
	const override = env[CLAUDE_DIR_ENV];
	if (override !== undefined && override.trim().length > 0) return resolve(expandHome(override.trim()));
	return join(homedir(), ".claude");
}

/** MIHAI_HARNESS_HOST when set, else 127.0.0.1. */
export function resolveHostname(env: Environment = process.env): string {
	const raw = env[HOST_ENV];
	return raw !== undefined && raw.trim().length > 0 ? raw.trim() : DEFAULT_HOSTNAME;
}

export function resolvePort(env: Environment = process.env): number {
	const raw = env[PORT_ENV];
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
