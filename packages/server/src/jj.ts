/**
 * The little jj the harness needs itself: workspace isolation for workers. Everything else (merging, reviewing,
 * resolving conflicts) is the coordinator's work through the usual tools.
 */
import { childEnvironment } from "./child-environment.ts";
import { execFile } from "node:child_process";
import { rm, stat } from "node:fs/promises";
import { join } from "node:path";

export class JjError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "JjError";
	}
}

function run(args: readonly string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		execFile(
			"jj",
			[...args],
			{ cwd, env: childEnvironment(), timeout: 60_000, maxBuffer: 4 * 1024 * 1024, encoding: "utf8" },
			(error, stdout, stderr) => {
				if (error === null) {
					resolve({ stdout, stderr });
					return;
				}
				const code = (error as NodeJS.ErrnoException).code;
				if (code === "ENOENT") {
					reject(new JjError("jj is not installed on this machine, so workspace isolation is unavailable"));
					return;
				}
				const detail = stderr.trim() || stdout.trim() || error.message;
				reject(new JjError(`jj ${args.join(" ")} failed in ${cwd}: ${detail}`));
			},
		);
	});
}

async function exists(path: string): Promise<boolean> {
	return stat(path).then(
		() => true,
		() => false,
	);
}

/** The repository's root, or undefined when `path` is not inside a jj repository. */
export async function jjRoot(path: string): Promise<string | undefined> {
	try {
		const { stdout } = await run(["root"], path);
		return stdout.trim().length > 0 ? stdout.trim() : undefined;
	} catch (error) {
		if (error instanceof JjError) return undefined;
		throw error;
	}
}

/** Create the workspace unless it is already registered and checked out, so a rerun after a crash is harmless. */
export async function ensureJjWorkspace(options: {
	repo: string;
	/** Workspace name inside the repository; unique per repository. */
	name: string;
	/** Absolute directory of the new working copy, outside the repository. */
	path: string;
	/** Where the new working copy starts; `@` is the checkout the coordinator sees, uncommitted edits included. */
	revision?: string;
}): Promise<void> {
	const { repo, name, path } = options;
	const listed = await run(["workspace", "list"], repo);
	const registered = listed.stdout
		.split("\n")
		.some((line) => line.startsWith(`${name}:`));

	if (registered) {
		if (await exists(path)) return;
		// Registered but its directory is gone: drop the stale name and recreate it.
		await run(["workspace", "forget", name], repo);
	} else if (await exists(path)) {
		await rm(path, { recursive: true, force: true });
	}

	await run(["workspace", "add", path, "--name", name, "--revision", options.revision ?? "@"], repo);
}

/** Forget the workspace in the repository and delete its directory. Missing pieces are fine. */
export async function removeJjWorkspace(options: { repo: string; name: string; path: string }): Promise<void> {
	const { repo, name, path } = options;
	const listed = await run(["workspace", "list"], repo).catch(() => undefined);
	const registered =
		listed !== undefined && listed.stdout.split("\n").some((line) => line.startsWith(`${name}:`));
	if (registered) await run(["workspace", "forget", name], repo);
	await rm(path, { recursive: true, force: true });
}

/** The default directory of a project's worker workspaces, kept out of the repository. */
export function workspacePath(workspacesDir: string, workerId: string): string {
	return join(workspacesDir, workerId);
}
