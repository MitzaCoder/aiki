/**
 * Read-only commands the server runs on its host for itself (not for an agent): `git` and `jj` to fill in a project's
 * link settings, `gh` and `acli` for the live state of tickets and pull requests. A command never throws: a missing
 * tool, a timeout or a failure comes back as a result the caller can tell apart.
 */
import { execFile } from "node:child_process";

export type CommandResult = {
	/** 0 on success; null when the command did not run to an exit (missing, timed out, killed). */
	exitCode: number | null;
	stdout: string;
	stderr: string;
	/** The tool is not installed (not on the server's PATH). */
	missing: boolean;
};

export type RunCommand = (
	command: string,
	args: readonly string[],
	options: { cwd?: string; timeoutMs: number },
) => Promise<CommandResult>;

/** Runs without a shell, with prompts, colours and update checks off, so a tool never waits on a terminal. */
export const runHostCommand: RunCommand = (command, args, options) =>
	new Promise((resolve) => {
		execFile(
			command,
			[...args],
			{
				...(options.cwd === undefined ? {} : { cwd: options.cwd }),
				timeout: options.timeoutMs,
				maxBuffer: 8 * 1024 * 1024,
				encoding: "utf8",
				env: { ...process.env, GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1", NO_COLOR: "1", TERM: "dumb" },
			},
			(error, stdout, stderr) => {
				if (error === null) {
					resolve({ exitCode: 0, stdout, stderr, missing: false });
					return;
				}
				const code = (error as NodeJS.ErrnoException).code;
				resolve({
					exitCode: typeof code === "number" ? code : null,
					stdout: stdout ?? "",
					stderr: stderr ?? "",
					missing: code === "ENOENT",
				});
			},
		);
	});
