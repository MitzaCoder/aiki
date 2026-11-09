/**
 * Backend configuration: the list a browser keeps in localStorage, and the URLs routes use. Pure helpers, no runes,
 * so they can be tested and imported anywhere in the app.
 */
import { threadAnchor } from "@mihai-harness/client";

/** One configured harness backend: a stable ID for routes, a display name, and its origin. */
export type BackendConfig = {
	id: string;
	name: string;
	url: string;
};

/** Bumped if the stored shape ever changes incompatibly. */
export const BACKENDS_STORAGE_KEY = "mihai-harness.backends.v1";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * Normalise what the user typed. Backends are HTTPS origins; plain HTTP is accepted only for loopback so a local server
 * can be used during development.
 */
export function normalizeBackendUrl(input: string): string {
	const trimmed = input.trim();
	if (trimmed.length === 0) throw new Error("Enter the backend's URL.");
	let url: URL;
	try {
		url = new URL(trimmed);
	} catch {
		throw new Error(`"${trimmed}" is not a URL. Use an origin like https://harness-pc.example.test.`);
	}
	if (url.protocol !== "https:" && !(url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname))) {
		throw new Error(
			"Use an HTTPS origin. Plain HTTP is only accepted for localhost while developing; a backend is any HTTPS URL.",
		);
	}
	if (url.username.length > 0 || url.password.length > 0) {
		throw new Error("A backend URL must not contain a username or password.");
	}
	if (url.pathname !== "/" || url.search.length > 0 || url.hash.length > 0) {
		throw new Error("Enter only the origin, without a path, query or fragment.");
	}
	return url.origin;
}

/** Where the app opens the protocol socket for a backend. */
export function backendWebSocketUrl(url: string): string {
	const socket = new URL("/ws", `${url}/`);
	socket.protocol = socket.protocol === "https:" ? "wss:" : "ws:";
	return socket.toString();
}

/** A route-safe ID for a backend name, made unique among the IDs already taken. */
export function backendIdFromName(name: string, taken: Iterable<string>): string {
	const used = new Set(taken);
	const base =
		name
			.toLowerCase()
			.normalize("NFKD")
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 32) || "backend";
	let candidate = base;
	for (let suffix = 2; used.has(candidate); suffix += 1) candidate = `${base}-${suffix}`;
	return candidate;
}

/** Parse a stored list, dropping entries that are not valid backends. */
export function parseBackends(raw: string | null): BackendConfig[] {
	if (raw === null) return [];
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return [];
	}
	if (!Array.isArray(parsed)) return [];
	const backends: BackendConfig[] = [];
	for (const item of parsed) {
		if (typeof item !== "object" || item === null) continue;
		const record = item as { id?: unknown; name?: unknown; url?: unknown };
		if (typeof record.id !== "string" || typeof record.name !== "string" || typeof record.url !== "string") {
			continue;
		}
		const id = record.id.trim();
		const name = record.name.trim();
		if (id.length === 0 || name.length === 0) continue;
		let url: string;
		try {
			url = normalizeBackendUrl(record.url);
		} catch {
			continue;
		}
		if (backends.some((backend) => backend.id === id || backend.url === url)) continue;
		backends.push({ id, name, url });
	}
	return backends;
}

/** The browser's stored backends; an unavailable storage yields an empty list. */
export function loadBackends(storage: Pick<Storage, "getItem"> | undefined = browserStorage()): BackendConfig[] {
	if (storage === undefined) return [];
	try {
		return parseBackends(storage.getItem(BACKENDS_STORAGE_KEY));
	} catch {
		return [];
	}
}

export function saveBackends(
	backends: readonly BackendConfig[],
	storage: Pick<Storage, "setItem"> | undefined = browserStorage(),
): void {
	if (storage === undefined) return;
	try {
		storage.setItem(BACKENDS_STORAGE_KEY, JSON.stringify(backends));
	} catch {
		// Storage can be full or disabled; the app keeps working for this session.
	}
}

function browserStorage(): Storage | undefined {
	if (typeof window === "undefined") return undefined;
	try {
		return window.localStorage;
	} catch {
		return undefined;
	}
}

/** Path of a project on a backend. */
export function projectHref(backendId: string, projectId: string): string {
	return `/b/${encodeURIComponent(backendId)}/projects/${encodeURIComponent(projectId)}`;
}

/** Path of a project's settings (the list of sections; `settings.ts` has the sections' own paths). */
export function settingsHref(backendId: string, projectId: string): string {
	return `${projectHref(backendId, projectId)}/settings`;
}

/** Path of one worker's read-only transcript; a background thread's worker sits under its thread. */
export function workerHref(backendId: string, projectId: string, workerId: string, threadId?: string): string {
	const base = threadId === undefined ? projectHref(backendId, projectId) : threadHref(backendId, projectId, threadId);
	return `${base}/workers/${encodeURIComponent(workerId)}`;
}

/** Path of a background thread's own chat. */
export function threadHref(backendId: string, projectId: string, threadId: string): string {
	return `${projectHref(backendId, projectId)}/threads/${encodeURIComponent(threadId)}`;
}

/** Main's chat scrolled to a background thread's newest card, highlighted. */
export function threadCardHref(backendId: string, projectId: string, threadId: string): string {
	return `${projectHref(backendId, projectId)}#${threadAnchor(threadId)}`;
}
