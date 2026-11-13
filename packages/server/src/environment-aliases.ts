type Environment = Readonly<Record<string, string | undefined>>;

/** Legacy process settings are ignored, not aliases for current settings. */
export function normalizeEnvironment(env: Environment): Record<string, string | undefined> {
	return Object.fromEntries(Object.entries(env).filter(([name]) => !name.startsWith("AIKI_")));
}

export function environmentSetting(env: Environment, name: string): string | undefined {
	return name.startsWith("AIKI_") ? undefined : env[name];
}

/** Both prefixes stay private, including unrecognized and retired settings. */
export function privateSetting(name: string): boolean {
	return name.startsWith("AIKI_") || name.startsWith("KEMIRI_");
}
