import { markdownText } from "@mihai-harness/protocol";
/// <reference lib="webworker" />
/**
 * The app's service worker: an app shell that follows a deploy quickly, the push notifications themselves, and the
 * link a notification opens.
 *
 * Installability needs a worker with a `fetch` handler, so the app can be added to a phone's home screen. HTML is
 * fetched from the network first (the cached `200.html` shell only when the network fails), while hashed assets are
 * served from a cache named after the build, so a deploy never leaves a page running yesterday's code for long. The
 * page registers the worker (`lib/notifications.svelte.ts`) and keeps it told which backends to re-register with if
 * the push service replaces the subscription.
 */
import { isNotificationFailure, notificationUrl, parseNotificationPayload } from "@mihai-harness/client";
import type { NotificationPayload, NotificationPreferences } from "@mihai-harness/protocol";
import { dev, version } from "$app/env";
import { assets, immutable } from "$app/manifest";
const worker = self as unknown as ServiceWorkerGlobalScope;
/** The app's base, which every file in the manifest is relative to. */
const SCOPE = worker.registration.scope;

/** Hashed files from this build. A new deploy installs a new name, so nothing old is served from it. */
const ASSET_CACHE = `mihai-harness-assets-${version}`;
/** Same-origin responses fetched at runtime (`/backends.json`). Also versioned, so a deploy drops them. */
const RUNTIME_CACHE = `mihai-harness-runtime-${version}`;
/** What the page tells the worker about this device's registrations; small JSON, kept apart from both. */
const DATA_CACHE = "mihai-harness-notifications";
const DATA_URL = "/__mihai-harness/notification-registrations";
const SHELL_URL = "/200.html";
/** The adapter's fallback page is generated, not listed in `$service-worker`'s files. */

const NAVIGATION_TIMEOUT_MS = 4_000;
const ICON = "/icons/icon-192.png";
const BADGE = "/icons/badge-96.png";
/** Message types shared with `lib/notifications.svelte.ts`. */
const REGISTRATIONS_MESSAGE = "notifications-registrations";
const CHANGED_MESSAGE = "notifications-changed";

/** A backend the page registered this device with; enough to register a new subscription without the app open. */
type WorkerRegistration = {
	origin: string;
	backendKey: string;
	deviceId: string;
	label: string;
	publicKey: string;
	preferences: NotificationPreferences;
};

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
				if (!key.startsWith("mihai-harness-")) continue;
				if (key === ASSET_CACHE || key === RUNTIME_CACHE || key === DATA_CACHE) continue;
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
	if (url.pathname === "/service-worker.js") return;

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

worker.addEventListener("push", (event) => {
	event.waitUntil(
		(async () => {
			const payload = readPushPayload(event.data);
			const url = payload === null ? "/" : notificationUrl(payload);
			const title = payload?.title ?? "mihai-harness";
			const options: NotificationOptions & { renotify?: boolean; timestamp?: number } = {
				body: payload?.kind === "board_question" ? markdownText(payload.body) : payload?.body ?? "Open the app to see what happened.",
				icon: ICON,
				badge: BADGE,
				tag: payload?.tag ?? "mihai-harness",
				// A failure replaces the last notice of the same tag and buzzes again; a reply must not.
				renotify: payload !== null && isNotificationFailure(payload.kind),
				data: { url, payload },
			};
			const at = payload === null ? Number.NaN : Date.parse(payload.at);
			if (Number.isFinite(at)) options.timestamp = at;
			await worker.registration.showNotification(title, options);
		})(),
	);
});

function readPushPayload(data: PushMessageData | null): NotificationPayload | null {
	if (data === null) return null;
	try {
		return parseNotificationPayload(data.text());
	} catch {
		return null;
	}
}

worker.addEventListener("notificationclick", (event) => {
	event.notification.close();
	const data = event.notification.data as { url?: unknown } | null;
	const path = typeof data?.url === "string" && data.url.length > 0 ? data.url : "/";
	event.waitUntil(openApp(path));
});

/**
 * Open the app at `path`: an open window is focused and sent there, otherwise a new one opens. Same origin only; a
 * notification's data comes from a backend, so it never decides which site this app navigates to.
 */
export async function openApp(path: string): Promise<void> {
	const target = new URL(path, worker.location.origin);
	if (target.origin !== worker.location.origin) return;
	const windows = await worker.clients.matchAll({ type: "window", includeUncontrolled: true });
	for (const client of windows) {
		if (new URL(client.url).origin !== worker.location.origin) continue;
		try {
			await client.focus();
		} catch {
			// A browser that will not focus a window still gets the route; the click must open it either way.
		}
		try {
			await client.navigate(target.href);
		} catch {
			// A window already navigating; focus is still what the click asked for.
		}
		return;
	}
	await worker.clients.openWindow(target.href);
}

/** The event Chrome fires when the push service replaces a subscription; not in `lib.dom`. */
type SubscriptionChangeEvent = ExtendableEvent & {
	oldSubscription?: PushSubscription | null;
	newSubscription?: PushSubscription | null;
};

worker.addEventListener("pushsubscriptionchange", (event) => {
	const change = event as SubscriptionChangeEvent;
	event.waitUntil(
		(async () => {
			const registrations = await readRegistrations();
			if (registrations.length === 0) return;
			let subscription = change.newSubscription ?? null;
			if (subscription === null) {
				const key = change.oldSubscription?.options.applicationServerKey ?? registrations[0]?.publicKey;
				if (key === undefined) return;
				try {
					subscription = await worker.registration.pushManager.subscribe({
						userVisibleOnly: true,
						applicationServerKey: key,
					});
				} catch {
					return;
				}
			}
			for (const registration of registrations) await registerWith(registration, subscription);
			const windows = await worker.clients.matchAll({ type: "window", includeUncontrolled: true });
			for (const client of windows) client.postMessage({ type: CHANGED_MESSAGE });
		})(),
	);
});

/** Re-register the new subscription with one backend, over its protocol socket. */
async function registerWith(registration: WorkerRegistration, subscription: PushSubscription): Promise<void> {
	if (typeof WebSocket === "undefined") return;
	const { HarnessClient } = await import("@mihai-harness/client");
	const url = new URL("/ws", registration.origin);
	url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
	const client = new HarnessClient({
		url: url.toString(),
		clientName: "mihai-harness-service-worker",
		requestTimeoutMs: 10_000,
		reconnect: false,
	});
	try {
		await client.whenReady(10_000);
		await client.registerNotifications({
			deviceId: registration.deviceId,
			label: registration.label,
			backendKey: registration.backendKey,
			subscription: subscription.toJSON() as {
				endpoint: string;
				expirationTime?: number | null;
				keys: { p256dh: string; auth: string };
			},
			preferences: registration.preferences,
		});
	} catch {
		// The backend is down or the subscription is gone; the app registers again the next time it opens.
	} finally {
		client.close();
	}
}

worker.addEventListener("message", (event) => {
	const data = event.data as { type?: unknown; registrations?: unknown } | null;
	if (typeof data !== "object" || data === null || data.type !== REGISTRATIONS_MESSAGE) return;
	const registrations = Array.isArray(data.registrations)
		? data.registrations.filter(isWorkerRegistration)
		: [];
	event.waitUntil(writeRegistrations(registrations));
});

function isWorkerRegistration(value: unknown): value is WorkerRegistration {
	if (typeof value !== "object" || value === null) return false;
	const record = value as Record<string, unknown>;
	return (
		typeof record.origin === "string" &&
		/^https?:\/\//.test(record.origin) &&
		typeof record.backendKey === "string" &&
		record.backendKey.length > 0 &&
		typeof record.deviceId === "string" &&
		record.deviceId.length > 0 &&
		typeof record.label === "string" &&
		typeof record.publicKey === "string" &&
		record.publicKey.length > 0 &&
		typeof record.preferences === "object" &&
		record.preferences !== null
	);
}

async function writeRegistrations(registrations: WorkerRegistration[]): Promise<void> {
	const cache = await caches.open(DATA_CACHE);
	if (registrations.length === 0) {
		await cache.delete(DATA_URL);
		return;
	}
	await cache.put(
		DATA_URL,
		new Response(JSON.stringify(registrations), { headers: { "content-type": "application/json" } }),
	);
}

async function readRegistrations(): Promise<WorkerRegistration[]> {
	const cache = await caches.open(DATA_CACHE);
	const response = await cache.match(DATA_URL);
	if (response === undefined) return [];
	try {
		const parsed: unknown = await response.json();
		return Array.isArray(parsed) ? parsed.filter(isWorkerRegistration) : [];
	} catch {
		return [];
	}
}
