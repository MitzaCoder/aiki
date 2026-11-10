#!/usr/bin/env bun
/**
 * Record how the last deploy attempt treated one backend, as `<deploy root>/deploy-status.json`.
 *
 * The server serves it as `server.status.deploy` and the app shows it, so the user learns that the commit they moved
 * `main` to never started, without reading the deploy log. The file lives beside `releases/` and `current`, so it
 * survives a rollback and always describes the newest attempt.
 *
 *   bun deploy/deploy-status.ts ok <commit> "<description>" --out=~/.local/share/aiki-deploy/deploy-status.json
 *   bun deploy/deploy-status.ts rolled_back <commit> "<description>" "<message>" --out=<path>
 *   bun deploy/deploy-status.ts failed <commit> "<description>" "<message>" --out=-
 *   bun deploy/deploy-status.ts ok <commit> "<description>" --backend-unchanged --out=<path>
 *
 *   bun deploy/deploy-status.ts pending <commit> "<description>" "<why>" --out=<path>
 *
 * `pending` does not replace the record: it adds `pending` ({ commit, description, message, since }) to the one already
 * in the file, for a backend that is behind a commit it will get shortly (a laptop that came back online and is being
 * caught up). The next real record (ok, failed, rolled_back) replaces the whole file, so it ends the pending note. With
 * no record to add it to, nothing is written.
 *
 * The last argument is the failure detail, empty or missing for `ok`. With `--out=-` the JSON goes to stdout instead,
 * which is how deploy.sh hands it to a target it cannot run this script on. `--backend-unchanged` (ok only) records that
 * the commit changes nothing the backend runs, so it was not restarted and keeps its older release. The write is atomic: a temporary file in
 * the same directory, then a rename, so the server never reads half a document.
 */
/**
 * States, as `DeployStatusSchema` in packages/protocol/src/server-status.ts defines them. Copied as it is to each
 * backend (deploy/backend.sh) so it stands alone: it must not import the protocol package.
 */
const STATE_NAMES = ["ok", "failed", "rolled_back"] as const;
type StateName = (typeof STATE_NAMES)[number];
/** `pending` is a note on the existing record, not a state of its own. */
const ARGUMENT_STATES = [...STATE_NAMES, "pending"] as const;

/** `fs` is Node's, not the repository's: this file must run from a bare tools/ directory. */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Nothing imported, but top-level await needs module scope. */
export {};

type Options = {
	state: StateName | "pending";
	commit: string;
	description: string;
	message: string | null;
	out: string;
	backendUnchanged: boolean;
};

function parseOptions(argv: readonly string[]): Options {
	const positional: string[] = [];
	let out: string | null = null;
	let backendUnchanged = false;
	for (const argument of argv) {
		if (argument === "--backend-unchanged") {
			backendUnchanged = true;
			continue;
		}
		if (argument.startsWith("--out=")) {
			out = argument.slice("--out=".length);
			continue;
		}
		if (argument.startsWith("--")) throw new Error(`unknown option ${argument}`);
		positional.push(argument);
	}
	const [state, commit, description = "", message = ""] = positional;
	if (state === undefined || !(ARGUMENT_STATES as readonly string[]).includes(state)) {
		throw new Error(`first argument must be one of ${ARGUMENT_STATES.join(", ")}`);
	}
	if (!commit) throw new Error("the commit is required");
	if (out === null) throw new Error("--out=<path> (or --out=-) is required");
	if (backendUnchanged && state !== "ok") throw new Error("--backend-unchanged only goes with ok");
	if (state === "pending" && out === "-") throw new Error("pending adds to a file: --out=<path>");
	return {
		state: state as Options["state"],
		commit,
		description,
		message: message ? message : null,
		out,
		backendUnchanged,
	};
}

const { state, commit, description, message, out, backendUnchanged } = parseOptions(process.argv.slice(2));

/** The record in the file now, or null when there is none or it does not parse. */
function earlierRecord(path: string): Record<string, unknown> | null {
	if (!existsSync(path)) return null;
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

let record: Record<string, unknown> = {
	state,
	commit,
	description,
	message,
	at: new Date().toISOString(),
	...(backendUnchanged ? { backendUnchanged: true } : {}),
};
if (state === "pending") {
	const earlier = earlierRecord(out);
	if (earlier === null) {
		console.log(`${out}: no record to add a pending note to; left alone`);
		process.exit(0);
	}
	record = { ...earlier, pending: { commit, description, message: message ?? "", since: new Date().toISOString() } };
}
const body = `${JSON.stringify(record, null, "\t")}\n`;

if (out === "-") {
	process.stdout.write(body);
} else {
	// Same directory, so the rename is atomic and the server never reads a partial document.
	const temporary = `${out}.tmp.${process.pid}`;
	mkdirSync(dirname(out), { recursive: true });
	try {
		writeFileSync(temporary, body);
		renameSync(temporary, out);
	} catch (error) {
		rmSync(temporary, { force: true });
		throw error;
	}
	const unchanged = backendUnchanged ? " (backend unchanged, not restarted)" : "";
	console.log(`${out}: ${state === "pending" ? "pending" : state} ${commit.slice(0, 12)}${unchanged}${message ? ` (${message})` : ""}`);
}
