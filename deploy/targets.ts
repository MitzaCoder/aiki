#!/usr/bin/env bun
/**
 * The remote backend targets of a deploy, read from `deploy/targets.json` and printed one per line for the bash scripts
 * (deploy.sh, rollback.sh): `name|label|ssh|tailnet|unit|bun|identity|optional|port|shell`, with an empty field where a target has
 * none. `|` separates because bash's `read` drops empty fields between tabs but not between pipes.
 *
 *   bun deploy/targets.ts                     # the targets, after the environment overrides
 *   bun deploy/targets.ts --file=<path>       # another list (also DEPLOY_TARGETS_FILE)
 *   bun deploy/targets.ts --name=laptop          # just one
 *
 * A target is `{ name, label?, ssh, tailnet?, unit, bun?, identity?, optional?, port?, enabled? }`:
 *   - `name`     short id: the `--target` of rollback.sh, the pending-state file and the suffix of the overrides below.
 *   - `label`    how log lines call it ("VM backend: ..."); default: the name.
 *   - `ssh`      what `ssh` is given: `user@host`, or a host alias from ~/.ssh/config.
 *   - `tailnet`  the host the deploy requests over HTTP afterwards (a warning only); empty or absent skips that check.
 *   - `unit`     `user` (a systemd --user unit that deploy installs from tools/) or `system` (a system unit that belongs to
 *                nix-config, which deploy only restarts).
 *   - `bun`      the remote `bun` for a `system` unit, as the remote shell reads it (`bun`, or `$HOME/.local/bin/bun`).
 *   - `identity` a private key for this target, passed as `-i <key> -o IdentitiesOnly=yes` (`~` is this host's home).
 *   - `optional` an intermittent target (a laptop): when it does not answer a quick probe it is skipped and left pending,
 *                not failed, and the watcher catches it up once it answers.
 *   - `port`     the backend's port there; default: DEPLOY_PORT, else 7317.
 *   - `shell`    the target user's login shell when it is not bash (`fish` on the Laptop): ssh runs a command through it, so
 *                every command is then wrapped as `bash -c '...'`. Absent or `bash` sends commands as they are.
 *   - `enabled`  false leaves it out.
 *
 * Environment overrides, for a target named `laptop` (any name, upper-cased with `_` for other characters):
 *   DEPLOY_LAPTOP_SSH_TARGET, DEPLOY_LAPTOP_TAILNET_HOST (set but empty skips the tailnet check), DEPLOY_LAPTOP_BUN,
 *   DEPLOY_LAPTOP_IDENTITY, DEPLOY_LAPTOP_OPTIONAL (1/0), DEPLOY_LAPTOP_PORT, DEPLOY_LAPTOP_SHELL, DEPLOY_LAPTOP_ENABLED (0 leaves it out).
 * The target named `vm` also answers the names from before the list existed: DEPLOY_SSH_TARGET and DEPLOY_TAILNET_HOST.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type Unit = "user" | "system";

export type Target = {
	name: string;
	label: string;
	ssh: string;
	tailnet: string;
	unit: Unit;
	bun: string;
	identity: string;
	optional: boolean;
	port: string;
	shell: string;
};

type Environment = Record<string, string | undefined>;

const NAME = /^[a-z][a-z0-9-]*$/;
/** `|` is the output separator and a newline the record separator: neither may appear in a value. */
const FORBIDDEN = /[|\n\r]/;
/** Prefer stable local config; retain the old in-tree path during migration, never the example list. */
export function resolveTargetsFile(env: Environment = process.env, deployDir = import.meta.dir): string | undefined {
	if (env.DEPLOY_TARGETS_FILE) return env.DEPLOY_TARGETS_FILE;
	const local = join(env.DEPLOY_CONFIG_DIR || join(deployDir, "local"), "targets.json");
	if (existsSync(local)) return local;
	const legacy = join(deployDir, "targets.json");
	return existsSync(legacy) ? legacy : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(entry: Record<string, unknown>, field: string, where: string): string {
	const value = entry[field];
	if (value === undefined || value === null) return "";
	if (typeof value !== "string") throw new Error(`${where}: "${field}" must be a string`);
	if (FORBIDDEN.test(value)) throw new Error(`${where}: "${field}" must not contain "|" or a newline`);
	return value;
}

function flag(raw: string | undefined): boolean | undefined {
	if (raw === undefined || raw === "") return undefined;
	return !["0", "false", "no", "off"].includes(raw.toLowerCase());
}

/** `DEPLOY_<NAME>_<FIELD>`: the name upper-cased, every other character an underscore. */
export function overrideVariable(name: string, field: string): string {
	return `DEPLOY_${name.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_${field}`;
}

/** The targets in a list, validated and with the environment's overrides applied; disabled ones are left out. */
export function parseTargets(source: string, env: Environment = process.env, where = "targets"): Target[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(source);
	} catch (error) {
		throw new Error(`${where}: not JSON: ${error instanceof Error ? error.message : String(error)}`);
	}
	const list = isRecord(parsed) ? parsed.targets : parsed;
	if (!Array.isArray(list)) throw new Error(`${where}: expected { "targets": [...] }`);
	const targets: Target[] = [];
	for (const [index, entry] of list.entries()) {
		const at = `${where}[${index}]`;
		if (!isRecord(entry)) throw new Error(`${at}: expected an object`);
		const name = text(entry, "name", at);
		if (!NAME.test(name)) throw new Error(`${at}: "name" must be lowercase letters, digits and "-", starting with a letter`);
		if (targets.some((target) => target.name === name) || name === "host" || name === "web") {
			throw new Error(`${at}: the name "${name}" is taken`);
		}
		const override = (field: string): string | undefined => env[overrideVariable(name, field)];
		const unit = text(entry, "unit", at);
		if (unit !== "user" && unit !== "system") throw new Error(`${at}: "unit" must be "user" or "system"`);
		if (entry.optional !== undefined && typeof entry.optional !== "boolean") throw new Error(`${at}: "optional" must be true or false`);
		if (entry.enabled !== undefined && typeof entry.enabled !== "boolean") throw new Error(`${at}: "enabled" must be true or false`);
		const enabled = flag(override("ENABLED")) ?? entry.enabled ?? true;
		if (!enabled) continue;

		// Before the list existed, the VM was DEPLOY_SSH_TARGET and DEPLOY_TAILNET_HOST; those names still work for it.
		const legacy = (variable: string): string | undefined => (name === "vm" ? env[variable] : undefined);
		const ssh = override("SSH_TARGET") || legacy("DEPLOY_SSH_TARGET") || text(entry, "ssh", at);
		if (ssh === "") throw new Error(`${at}: "ssh" is required`);
		// Set but empty means "skip the tailnet check", unlike an unset variable.
		const tailnet = override("TAILNET_HOST") ?? legacy("DEPLOY_TAILNET_HOST") ?? text(entry, "tailnet", at);
		const label = text(entry, "label", at) || name;
		const port = override("PORT") ?? text(entry, "port", at);
		if (FORBIDDEN.test(ssh) || FORBIDDEN.test(tailnet) || FORBIDDEN.test(port)) throw new Error(`${at}: a value has "|" or a newline`);
		targets.push({
			name,
			label,
			ssh,
			tailnet,
			unit,
			bun: override("BUN") ?? text(entry, "bun", at),
			identity: (override("IDENTITY") ?? text(entry, "identity", at)).replace(/^~(?=\/|$)/, homedir()),
			optional: flag(override("OPTIONAL")) ?? entry.optional ?? false,
			port,
			shell: override("SHELL") ?? text(entry, "shell", at),
		});
	}
	return targets;
}

/** One target as the line bash reads. */
export function formatTarget(target: Target): string {
	return [
		target.name,
		target.label,
		target.ssh,
		target.tailnet,
		target.unit,
		target.bun,
		target.identity,
		target.optional ? "optional" : "",
		target.port,
		target.shell,
	].join("|");
}

if (import.meta.main) {
	try {
		let file = resolveTargetsFile();
		let only: string | null = null;
		for (const argument of process.argv.slice(2)) {
			if (argument.startsWith("--file=")) file = argument.slice("--file=".length);
			else if (argument.startsWith("--name=")) only = argument.slice("--name=".length);
			else throw new Error(`unknown option ${argument}`);
		}
		const targets = (file === undefined ? [] : parseTargets(readFileSync(file, "utf8"), process.env, file)).filter((target) => only === null || target.name === only);
		for (const target of targets) console.log(formatTarget(target));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}
