/**
 * Browser origin allow-list for the WebSocket endpoint.
 *
 * There is no login: a browser page that can open `/ws` can drive the harness. The server therefore upgrades a socket
 * only when the request has no `Origin` header (native clients, tests, health checks) or when its origin is listed in
 * `MIHAI_HARNESS_ALLOWED_ORIGINS`. With the variable unset, no browser origin is allowed and non-browser clients keep
 * working.
 */

export const ALLOWED_ORIGINS_ENV = "MIHAI_HARNESS_ALLOWED_ORIGINS";

export type Environment = Readonly<Record<string, string | undefined>>;

/** An origin as the browser sends it: scheme, host and port, lower-cased, with no path or trailing slash. */
export function normalizeOrigin(value: string): string | undefined {
	try {
		const url = new URL(value.trim());
		if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
		if (url.username.length > 0 || url.password.length > 0) return undefined;
		return url.origin;
	} catch {
		return undefined;
	}
}

/** Parse a comma-separated list. An invalid entry is a configuration error, not something to silently ignore. */
export function parseAllowedOrigins(raw: string): string[] {
	const origins: string[] = [];
	for (const part of raw.split(",")) {
		const trimmed = part.trim();
		if (trimmed.length === 0) continue;
		const origin = normalizeOrigin(trimmed);
		if (origin === undefined) throw new Error(`${ALLOWED_ORIGINS_ENV} contains an invalid origin: "${trimmed}"`);
		if (!origins.includes(origin)) origins.push(origin);
	}
	return origins;
}

/** The allowed origins from the environment; an unset or empty variable allows none. */
export function resolveAllowedOrigins(env: Environment = process.env): string[] {
	const raw = env[ALLOWED_ORIGINS_ENV];
	return raw === undefined || raw.trim().length === 0 ? [] : parseAllowedOrigins(raw);
}

/** Whether a WebSocket request may be upgraded. Requests without an Origin are not from a browser. */
export function isOriginAllowed(origin: string | null, allowed: readonly string[]): boolean {
	if (origin === null) return true;
	const normalized = normalizeOrigin(origin);
	return normalized !== undefined && allowed.includes(normalized);
}
