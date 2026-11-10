/** Private server configuration. The entry point captures it before importing identity-bearing modules. */
export let serverSettings: Readonly<Record<string, string | undefined>> = process.env;

/**
 * The executable installs an immutable snapshot once, then removes its settings from process.env.
 * Library users retain process-env defaults. Every spawn must still pass childEnvironment explicitly:
 * Bun's implicit spawn environment can use the original native environment, ignoring these deletions.
 */
export function configureServerSettings(settings: Readonly<Record<string, string | undefined>>): void {
	serverSettings = Object.freeze({ ...settings });
	for (const name of Object.keys(process.env)) if (name.startsWith("AIKI_")) delete process.env[name];
	// A nested server must not rediscover this installation's private file via the inherited HOME/XDG dirs.
	process.env.AIKI_CHILD_PROCESS = "1";
}
