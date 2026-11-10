import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { resolveAgentDir, resolveClaudeDir, resolveConfigDir, resolveDataDir, resolveHostname, resolvePort, type Environment } from "./data-dir.ts";
import { resolveAllowedOrigins } from "./origins.ts";
import { serverSettings } from "./server-settings.ts";

/** Load before importing server modules: durable kinds and extensions capture their identity at import time. */
export function loadServerEnv(env: Readonly<Record<string, string | undefined>> = process.env): Record<string, string | undefined> {
	const settings = { ...env };
	if (env.AIKI_CHILD_PROCESS === "1" && !env.AIKI_ENV_FILE) return settings;
	const file = env.AIKI_ENV_FILE || join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "aiki", "server.env");
	let source: string;
	try { source = readFileSync(file, "utf8"); }
	catch (error) {
		if (!env.AIKI_ENV_FILE && (error as NodeJS.ErrnoException).code === "ENOENT") return settings;
		throw error;
	}
	for (const [name, value] of Object.entries(parseEnv(source))) {
		if (!name.startsWith("AIKI_")) throw new Error(`Server env file may only set AIKI_ settings: ${name}`);
		if (settings[name] === undefined) settings[name] = value;
	}
	return settings;
}

/** Read-only: no data directories, keys, sessions, sockets or model clients are opened. */
export function resolvedServerConfig(env: Environment = serverSettings) {
	return {
		dataDir: resolveDataDir(env), configDir: resolveConfigDir(env), agentDir: resolveAgentDir(env),
		claudeDir: resolveClaudeDir(env), hostname: resolveHostname(env), port: resolvePort(env),
		allowedOrigins: resolveAllowedOrigins(env), stateNamespace: env.AIKI_STATE_NAMESPACE || "aiki",
		projectContextDir: env.AIKI_PROJECT_CONTEXT_DIR || ".aiki", contextExtension: env.AIKI_CONTEXT_EXTENSION || "aiki-agent-context",
	};
}
