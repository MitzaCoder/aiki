/**
 * The backends the app publishes beside itself: `/backends.json`, built from `deploy/backends.json`. A browser that has
 * never been set up offers them as one-tap adds instead of asking for addresses the user rarely remembers.
 *
 * The file is optional. Absent, unreachable, malformed or empty means nothing is suggested, and the app is only the
 * manual form it always was.
 *
 * Also the address helpers the add form uses: a bare name expands against the domain the published backends live under
 * (or the app's own host), and an empty name fills itself in from the URL's first label. No domain is written in code.
 */
import { normalizeBackendUrl } from "./backends.ts";

/** One suggested backend: the name to give it here and its origin. */
export type PublishedBackend = { name: string; url: string };

/** Where the build publishes the list, beside the app. */
export const PUBLISHED_BACKENDS_PATH = "/backends.json";

/** A sanity cap, so a runaway file cannot fill the first-run screen. */
export const MAX_PUBLISHED_BACKENDS = 32;

const MAX_NAME_LENGTH = 64;
const MAX_URL_LENGTH = 512;

/**
 * Read the published list strictly enough to be useful: a JSON array of `{ name, url }`, where the URL is an origin a
 * backend could really live at (HTTPS, or loopback HTTP while developing). Anything else is dropped, not guessed at.
 */
export function parsePublishedBackends(raw: unknown): PublishedBackend[] {
	if (!Array.isArray(raw)) return [];
	const backends: PublishedBackend[] = [];
	for (const item of raw) {
		if (typeof item !== "object" || item === null) continue;
		const record = item as { name?: unknown; url?: unknown };
		if (typeof record.name !== "string" || typeof record.url !== "string") continue;
		const name = record.name.trim();
		if (name.length === 0 || name.length > MAX_NAME_LENGTH) continue;
		if (record.url.length > MAX_URL_LENGTH) continue;
		let url: string;
		try {
			url = normalizeBackendUrl(record.url);
		} catch {
			continue;
		}
		if (backends.some((backend) => backend.url === url || backend.name === name)) continue;
		backends.push({ name, url });
		if (backends.length === MAX_PUBLISHED_BACKENDS) break;
	}
	return backends;
}

/** Parse the published file's text; text that is not JSON suggests nothing. */
export function parsePublishedBackendsJson(text: string): PublishedBackend[] {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		return [];
	}
	return parsePublishedBackends(raw);
}

/**
 * Fetch the published list once. A missing file (404), a network failure or a malformed body all yield an empty list:
 * the app must work on a host that publishes no suggestions.
 */
export async function fetchPublishedBackends(
	fetchImpl: typeof fetch | undefined = typeof fetch === "function" ? fetch : undefined,
): Promise<PublishedBackend[]> {
	if (fetchImpl === undefined) return [];
	try {
		const response = await fetchImpl(PUBLISHED_BACKENDS_PATH, {
			cache: "no-cache",
			headers: { accept: "application/json" },
		});
		if (!response.ok) return [];
		return parsePublishedBackendsJson(await response.text());
	} catch {
		return [];
	}
}

/** The published backends this browser does not have yet, compared by URL. */
export function missingPublished(
	entries: readonly PublishedBackend[],
	addedUrls: readonly string[],
): PublishedBackend[] {
	return entries.filter((entry) => !addedUrls.includes(entry.url));
}

/**
 * The domain a bare backend name expands under: the parent of the published backends' hosts (most common wins), else
 * the parent of the app's own host. `harness-pc.example.test` beside the app on `harness.example.test` both
 * give `example.test`. Undefined when neither host has a label to strip (`localhost`, an IP).
 */
export function baseDomainFrom(
	entries: readonly PublishedBackend[],
	appOrigin?: string,
): string | undefined {
	const counts = new Map<string, number>();
	for (const entry of entries) {
		const suffix = hostSuffix(entry.url);
		if (suffix === undefined) continue;
		counts.set(suffix, (counts.get(suffix) ?? 0) + 1);
	}
	let best: string | undefined;
	let bestCount = 0;
	for (const [suffix, count] of counts) {
		if (count > bestCount) {
			best = suffix;
			bestCount = count;
		}
	}
	if (best !== undefined) return best;
	return appOrigin === undefined ? undefined : hostSuffix(appOrigin);
}

function hostSuffix(url: string): string | undefined {
	let hostname: string;
	try {
		hostname = new URL(url).hostname;
	} catch {
		return undefined;
	}
	const bare = hostname.replace(/^\[|\]$/g, "");
	// An address or `localhost` has no domain to put a name under.
	if (bare === "localhost" || isIpHost(bare)) return undefined;
	const labels = bare.split(".");
	if (labels.length < 3) return undefined;
	const suffix = labels.slice(1).join(".");
	return suffix.length === 0 ? undefined : suffix;
}

function isIpHost(hostname: string): boolean {
	return /^\d+(?:\.\d+){3}$/.test(hostname) || hostname.includes(":");
}

/** The name to give a backend when the user does not choose one: the URL host's first label. */
export function nameFromBackendUrl(url: string): string {
	let hostname: string;
	try {
		hostname = new URL(url).hostname;
	} catch {
		return "";
	}
	const bare = hostname.replace(/^\[|\]$/g, "");
	if (bare === "localhost" || bare === "::1") return "localhost";
	if (isIpHost(bare)) return bare;
	const first = bare.split(".")[0] ?? "";
	return first.length > 0 ? first : "backend";
}

/** What a bare name needs to expand: the published list and the app's own origin. */
export type AddressContext = {
	entries?: readonly PublishedBackend[];
	appOrigin?: string;
};

/**
 * Turn what the user typed in the URL field into something `normalizeBackendUrl` can accept:
 *
 * - a published backend's name (`harness-pc`) is exactly that backend's URL;
 * - a bare label (`harness-desk`) becomes `https://harness-desk.<domain the published backends live under>`;
 * - a host (`harness-desk.example.test`) gets `https://` in front;
 * - loopback (`localhost:7317`, `127.0.0.1:7317`) keeps plain HTTP, as the rest of the app accepts for development;
 * - anything else is passed through for the normalizer to judge.
 */
export function expandBackendAddress(input: string, context: AddressContext = {}): string {
	const trimmed = input.trim();
	if (trimmed.length === 0) return "";
	const { entries = [], appOrigin } = context;
	const named = entries.find((entry) => entry.name.toLowerCase() === trimmed.toLowerCase());
	if (named !== undefined) return named.url;
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
	if (/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(trimmed)) return `http://${trimmed}`;
	if (/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(trimmed)) {
		const base = baseDomainFrom(entries, appOrigin);
		if (base !== undefined) return `https://${trimmed}.${base}`;
	}
	return `https://${trimmed}`;
}
