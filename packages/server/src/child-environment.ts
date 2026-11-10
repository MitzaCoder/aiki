/**
 * Environment for every host command (agent tools, terminals and the backend's own command-line helpers).
 * No installation setting is a child setting. The sole AIKI_* allowlisted value is a marker we create, not copy:
 * a nested entry point skips automatic server.env discovery, but still accepts an explicitly supplied env file.
 * HOME/PATH/XDG, locale, SSH/provider/tooling variables and worker-selected HARNESS_ANDROID_DEVICE stay intact.
 */
export function childEnvironment(
	env: Readonly<Record<string, string | undefined>> = process.env,
): Record<string, string> {
	const child: Record<string, string> = {};
	for (const [name, value] of Object.entries(env)) {
		if (value !== undefined && !name.startsWith("AIKI_")) child[name] = value;
	}
	child.AIKI_CHILD_PROCESS = "1";
	return child;
}
