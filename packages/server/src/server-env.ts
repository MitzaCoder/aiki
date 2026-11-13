import { normalizeEnvironment, privateSetting } from "./environment-aliases.ts";
import { migrateServerEnv } from "./migrate-server-env.ts";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { defaultProductDirectory, resolveAgentDir, resolveClaudeDir, resolveConfigDir, resolveDataDir, resolveHostname, resolvePort, type Environment } from "./data-dir.ts";
import { resolveAllowedOrigins } from "./origins.ts";
import { serverSettings } from "./server-settings.ts";

/** Load before importing server modules: durable kinds and extensions capture their identity at import time. */
export function loadServerEnv(env: Readonly<Record<string, string | undefined>> = process.env): Record<string, string | undefined> {
	const settings = normalizeEnvironment(env);
	if (settings.KEMIRI_CHILD_PROCESS === "1" && !settings.KEMIRI_ENV_FILE) return settings;
	const file = settings.KEMIRI_ENV_FILE || join(settings.KEMIRI_CONFIG_DIR || defaultProductDirectory(env.XDG_CONFIG_HOME || join(homedir(), ".config")), "server.env");
	let source: string;
	try { source = readFileSync(file, "utf8"); }
	catch (error) {
		if (!settings.KEMIRI_ENV_FILE && (error as NodeJS.ErrnoException).code === "ENOENT") return settings;
		throw error;
	}
	const original = parseEnv(source);
	for (const name of Object.keys(original)) if (!privateSetting(name)) throw new Error(`Server env file may only set KEMIRI_ settings: ${name}`);
	const parsed = parseEnv(migrateServerEnv(file, source));
	for (const name of Object.keys(parsed)) if (!privateSetting(name)) throw new Error(`Server env file may only set KEMIRI_ settings: ${name}`);
	const fileSettings = normalizeEnvironment(parsed);
	for (const [name, value] of Object.entries(settings)) if (value !== undefined) fileSettings[name] = value;
	return fileSettings;
}

/** Read-only: no data directories, keys, sessions, sockets or model clients are opened. */
export function resolvedServerConfig(env: Environment = serverSettings) {
	env = normalizeEnvironment(env);
	return {
		dataDir: resolveDataDir(env), configDir: resolveConfigDir(env), agentDir: resolveAgentDir(env),
		claudeDir: resolveClaudeDir(env), hostname: resolveHostname(env), port: resolvePort(env),
		allowedOrigins: resolveAllowedOrigins(env), stateNamespace: env.KEMIRI_STATE_NAMESPACE || "aiki",
		projectContextDir: env.KEMIRI_PROJECT_CONTEXT_DIR || ".aiki", contextExtension: env.KEMIRI_CONTEXT_EXTENSION || "aiki-agent-context",
	};
}
