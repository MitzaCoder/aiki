import { installPushEvents } from "./push-events.ts";
/// <reference lib="webworker" />
/**
 * The app's service worker: an app shell that follows a deploy quickly, the push notifications themselves, and the
 * link a notification opens.
 *
 * Installability needs a worker with a `fetch` handler, so the app can be added to a phone's home screen. HTML is
 * fetched from the network first (the cached `200.html` shell only when the network fails), while hashed assets are
 * served from a cache named after the build, so a deploy never leaves a page running yesterday's code for long. The
 * page registers the worker (`lib/notifications.svelte.ts`). Legacy root push remains supported; subscription changes
 * only mark the scope for repair by a signed-in page.
 */
import { dev, version } from "$app/env";
import { assets, immutable } from "$app/manifest";
const worker = self as unknown as ServiceWorkerGlobalScope;
/** The app's base, which every file in the manifest is relative to. */
const SCOPE = worker.registration.scope;

/** Hashed files from this build. A new deploy installs a new name, so nothing old is served from it. */
const ASSET_CACHE = `aiki-assets-${version}`;
/** Same-origin responses fetched at runtime (`/backends.json`). Also versioned, so a deploy drops them. */
const RUNTIME_CACHE = `aiki-runtime-${version}`;
const SHELL_URL = "/200.html";
/** The adapter's fallback page is generated, not listed in `$service-worker`'s files. */

const NAVIGATION_TIMEOUT_MS = 4_000;
worker.addEventListener("install", (event) => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(ASSET_CACHE);
			const precache = [...immutable, ...assets].map((entry) => new URL(entry.path, SCOPE).href);
			await Promise.all(
				precache.map(async (url) => {
					try {
						await cache.add(new Request(url, { cache: "reload" }));
					} catch {
						// One missing file must not fail the whole install; the page still works online.
					}
				}),
			);
			// The SPA shell: every navigation offline lands on it, and the app reads the route from the URL.
			if (!dev) {
				try {
					await cache.add(new Request(SHELL_URL, { cache: "reload" }));
				} catch {
					// A build without the fallback page stays online-only.
				}
			}
			await worker.skipWaiting();
		})(),
	);
});

worker.addEventListener("activate", (event) => {
	event.waitUntil(
		(async () => {
			for (const key of await caches.keys()) {
				if (!key.startsWith("aiki-")) continue;
				if (key === ASSET_CACHE || key === RUNTIME_CACHE) continue;
				await caches.delete(key);
			}
			await worker.clients.claim();
		})(),
	);
});

worker.addEventListener("fetch", (event) => {
	const request = event.request;
	// Nothing in development: Vite's HMR and module graph must not be served from a cache.
	if (dev || request.method !== "GET") return;
	let url: URL;
	try {
		url = new URL(request.url);
	} catch {
		return;
	}
	if (url.origin !== worker.location.origin) return;
	if (url.pathname === "/service-worker.js" || url.pathname === "/push-worker.js") return;

	if (request.mode === "navigate") {
		event.respondWith(navigation(request));
		return;
	}
	if (url.pathname.startsWith("/_app/immutable/")) {
		event.respondWith(cacheFirst(request, ASSET_CACHE));
		return;
	}
	event.respondWith(networkFirst(request));
});

/** Network first, so a deploy is seen at the next load; the cached shell only covers a failed or slow network. */
async function navigation(request: Request): Promise<Response> {
	try {
		const response = await fetchWithin(request, NAVIGATION_TIMEOUT_MS);
		if (response.ok) return response;
		return (await shell()) ?? response;
	} catch {
		return (await shell()) ?? Response.error();
	}
}

async function shell(): Promise<Response | undefined> {
	const cache = await caches.open(ASSET_CACHE);
	return (await cache.match(SHELL_URL)) ?? undefined;
}

async function cacheFirst(request: Request, cacheName: string): Promise<Response> {
	const cache = await caches.open(cacheName);
	const cached = await cache.match(request);
	if (cached !== undefined) return cached;
	const response = await fetch(request);
	if (response.ok) await cache.put(request, response.clone());
	return response;
}

async function networkFirst(request: Request): Promise<Response> {
	const cache = await caches.open(RUNTIME_CACHE);
	try {
		const response = await fetch(request);
		if (response.ok) await cache.put(request, response.clone());
		return response;
	} catch (error) {
		const cached = await cache.match(request);
		if (cached !== undefined) return cached;
		throw error;
	}
}

function fetchWithin(request: Request, timeoutMs: number): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	return fetch(request, { signal: controller.signal }).finally(() => clearTimeout(timer));
}


installPushEvents(worker);
