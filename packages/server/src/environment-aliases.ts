type Environment = Readonly<Record<string, string | undefined>>;
const warned = new Set<string>();

/** Normalize one source layer; never mix file and process precedence by spelling. */
export function normalizeEnvironment(env: Environment, warn = true): Record<string, string | undefined> {
	const result = { ...env };
	for (const name of Object.keys(env)) {
		if (!name.startsWith("KEMIRI_") || env[name] === undefined) continue;
		result[name.replace(/^KEMIRI_/, "AIKI_")] = env[name];
	}
	for (const name of Object.keys(result)) if (name.startsWith("AIKI_")) result[name.replace(/^AIKI_/, "KEMIRI_")] = result[name];
	if (env.AIKI_CHILD_PROCESS === "1" || env.KEMIRI_CHILD_PROCESS === "1") result.AIKI_CHILD_PROCESS = result.KEMIRI_CHILD_PROCESS = "1";
	if (warn) warnAliasConflicts(env);
	return result;
}

/** One names-only stderr warning, never values or machine-readable stdout. */
export function warnAliasConflicts(...layers: Environment[]): void {
	const conflicts: string[] = [];
	for (const env of layers) for (const name of Object.keys(env)) {
		if (!name.startsWith("KEMIRI_") || env[name] === undefined) continue;
		const legacy = name.replace(/^KEMIRI_/, "AIKI_");
		if (env[legacy] !== undefined && env[legacy] !== env[name] && !warned.has(name)) {
			warned.add(name); conflicts.push(`${name}/${legacy}`);
		}
	}
	if (conflicts.length) console.error(`Conflicting setting aliases (KEMIRI wins): ${conflicts.join(", ")}`);
}

export function environmentSetting(env: Environment, legacy: string): string | undefined {
	if (legacy === "AIKI_CHILD_PROCESS" && (env.AIKI_CHILD_PROCESS === "1" || env.KEMIRI_CHILD_PROCESS === "1")) return "1";
	return env[legacy.replace(/^AIKI_/, "KEMIRI_")] ?? env[legacy];
}

export function privateSetting(name: string): boolean {
	return name.startsWith("AIKI_") || name.startsWith("KEMIRI_");
}
