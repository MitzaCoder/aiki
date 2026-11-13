import { normalizeEnvironment, privateSetting, warnAliasConflicts } from "./environment-aliases.ts";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { defaultProductDirectory, resolveAgentDir, resolveClaudeDir, resolveConfigDir, resolveDataDir, resolveHostname, resolvePort, type Environment } from "./data-dir.ts";
import { resolveAllowedOrigins } from "./origins.ts";
import { serverSettings } from "./server-settings.ts";

/** Load before importing server modules: durable kinds and extensions capture their identity at import time. */
export function loadServerEnv(env: Readonly<Record<string, string | undefined>> = process.env): Record<string, string | undefined> {
	const settings = normalizeEnvironment(env, false);
	const finish = (settings: Record<string, string | undefined>, file: Environment = {}) => { warnAliasConflicts(env, file); return settings; };
	if (settings.AIKI_CHILD_PROCESS === "1" && !settings.AIKI_ENV_FILE) return finish(settings);
	const file = settings.AIKI_ENV_FILE || join(settings.AIKI_CONFIG_DIR || defaultProductDirectory(env.XDG_CONFIG_HOME || join(homedir(), ".config")), "server.env");
	let source: string;
	try { source = readFileSync(file, "utf8"); }
	catch (error) {
		if (!settings.AIKI_ENV_FILE && (error as NodeJS.ErrnoException).code === "ENOENT") return finish(settings);
		throw error;
	}
	const parsed = parseEnv(source);
	for (const name of Object.keys(parsed)) if (!privateSetting(name)) throw new Error(`Server env file may only set KEMIRI_ or AIKI_ settings: ${name}`);
	const fileSettings = normalizeEnvironment(parsed, false);
	for (const [name, value] of Object.entries(settings)) if (value !== undefined) fileSettings[name] = value;
	return finish(fileSettings, parsed);
}

/** Read-only: no data directories, keys, sessions, sockets or model clients are opened. */
export function resolvedServerConfig(env: Environment = serverSettings) {
	env = normalizeEnvironment(env);
	return {
		dataDir: resolveDataDir(env), configDir: resolveConfigDir(env), agentDir: resolveAgentDir(env),
		claudeDir: resolveClaudeDir(env), hostname: resolveHostname(env), port: resolvePort(env),
		allowedOrigins: resolveAllowedOrigins(env), stateNamespace: env.AIKI_STATE_NAMESPACE || "aiki",
		projectContextDir: env.AIKI_PROJECT_CONTEXT_DIR || ".aiki", contextExtension: env.AIKI_CONTEXT_EXTENSION || "aiki-agent-context",
	};
}
