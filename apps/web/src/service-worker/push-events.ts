/// <reference lib="webworker" />
import { markdownText } from "@aiki/protocol";
import { isNotificationFailure, notificationUrl, parseNotificationPayload } from "@aiki/client";
import type { NotificationPayload } from "@aiki/protocol";
import { PUSH_CHANGED_MESSAGE, setPushSyncNeeded } from "../lib/push-sync.ts";

/** Shared presentation and root-app click routing; never authentication or subscription creation. */
export function installPushEvents(worker: ServiceWorkerGlobalScope): void {
	const ICON = "/icons/icon-192.png";
	const BADGE = "/icons/badge-96.png";
	worker.addEventListener("push", (event) => {
		event.waitUntil(
			(async () => {
				const payload = readPushPayload(event.data);
				const url = payload === null ? "/" : notificationUrl(payload);
				const title = payload?.title ?? "Kemiri";
				const options: NotificationOptions & { renotify?: boolean; timestamp?: number } = {
					body:
						payload?.kind === "board_question"
							? markdownText(payload.body)
							: (payload?.body ?? "Open the app to see what happened."),
					icon: ICON,
					badge: BADGE,
					tag: payload?.tag ?? "aiki",
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
	async function openApp(path: string): Promise<void> {
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

	worker.addEventListener("pushsubscriptionchange", (event) => {
		event.waitUntil(
			(async () => {
				const scope = new URL(worker.registration.scope).pathname;
				await setPushSyncNeeded(scope, true);
				const windows = await worker.clients.matchAll({ type: "window", includeUncontrolled: true });
				for (const client of windows) client.postMessage({ type: PUSH_CHANGED_MESSAGE, scope });
			})(),
		);
	});
}
