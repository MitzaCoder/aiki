/**
 * This browser's notifications: one push subscription, one device identity, and a registration on every backend that
 * offers them. Svelte runes live here; the wording and the decision rules are in `notifications.ts`, and the wire
 * helpers in `@aiki/client`.
 *
 * The service worker (`src/service-worker.ts`) shows what arrives and opens the app on a click. This store keeps it fed:
 * the registrations it needs to re-register after `pushsubscriptionchange`, and this device's presence on every backend
 * so the backend holds a push while the app is open (interaction is `interaction.ts`).
 */
import {
	applicationServerKey,
	ClientError,
	deviceIdFromStorage,
	deviceLabel,
	deviceTimezone,
	isProjectMuted,
	NOTIFICATION_DEFAULTS_VERSION,
	loadDeviceSettings,
	newDeviceId,
	preferencesForBackend,
	samePublicKey,
	saveDeviceSettings,
	subscriptionServerKey,
	withKind,
	withMutedProject,
	type DeviceNotificationSettings,
	type QuietHours,
} from "@aiki/client";
import type { NotificationDevice, NotificationKind } from "@aiki/protocol";
import type { BackendConnection } from "./harness.svelte.ts";
import {
	backendNotificationView,
	presenceFor,
	publicKeyMismatch,
	testNotificationText,
	type BackendNotificationView,
	type PushPermission,
} from "./notifications.ts";

/** What this app knows about one backend's registration. */
export type BackendNotification = {
	backendId: string;
	/** The backend's push key, once it answered. */
	publicKey?: string;
	device: NotificationDevice | null;
	/** The last failure, cleared by the next answer that works. */
	error?: string;
	/** Whether the backend's release advertises the feature at all. */
	supported: boolean;
	/** The push service's answer to the last test. */
	test?: { ok: boolean; status: number | null; message: string | null; text: string };
	testing: boolean;
};

/** What the service worker keeps, so it can register a new subscription with no app open. */
type WorkerRegistration = {
	origin: string;
	backendKey: string;
	deviceId: string;
	label: string;
	publicKey: string;
	preferences: ReturnType<typeof preferencesForBackend>;
};

/** What the service worker needs to re-register after `pushsubscriptionchange`. */
export const WORKER_REGISTRATIONS_MESSAGE = "notifications-registrations";

/** What the service worker says after it registered a new subscription. */
export const SUBSCRIPTION_CHANGED_MESSAGE = "notifications-changed";

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function permissionNow(): PushPermission {
	if (typeof window === "undefined") return "unsupported";
	if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
		return "unsupported";
	}
	return Notification.permission;
}

/** Whether this browser can subscribe at all. */
export function pushSupported(): boolean {
	return permissionNow() !== "unsupported";
}

export class NotificationCenter {
	settings = $state<DeviceNotificationSettings>({
		deviceId: "",
		kinds: [],
		defaultsVersion: NOTIFICATION_DEFAULTS_VERSION,
		quietHours: null,
		mutedProjects: {},
	});
	permission = $state<PushPermission>("unsupported");
	registration = $state<ServiceWorkerRegistration | undefined>(undefined);
	subscription = $state<PushSubscription | null>(null);
	/** One entry per backend this app has asked, keyed by the app's id for it. */
	backends = $state<Record<string, BackendNotification>>({});
	/** Every backend signs with the same key; a mismatch means one of them is wrong. */
	keyMismatch = $state(false);
	/** A request is running: enabling, disabling or saving preferences. */
	busy = $state(false);
	error = $state<string | undefined>(undefined);

	#loaded = false;
	#started = false;
	/** The connection signature last synced, so a reconnect (not every render) asks again. */
	#synced = new Map<string, string>();
	/** The presence last sent per backend, so a route change sends once. */
	#presence = new Map<string, string>();
	/** The backends this store last saw, for presence calls that do not pass them again. */
	#backends: readonly BackendConnection[] = [];

	/** Read this browser's device identity and what it wants. Safe to call from every screen. */
	load(): void {
		if (this.#loaded) return;
		this.#loaded = true;
		this.settings = loadDeviceSettings();
		// Quiet hours follow the device: after a trip, 22:00 is 22:00 where the phone is, not where it was set.
		const timezone = deviceTimezone();
		if (this.settings.quietHours !== null && this.settings.quietHours.timezone !== timezone) {
			this.settings = {
				...this.settings,
				quietHours: { ...this.settings.quietHours, timezone },
			};
			saveDeviceSettings(this.settings);
		}
		this.permission = permissionNow();
	}

	/** Register the service worker and read the subscription. Idempotent; called at startup. */
	async start(): Promise<void> {
		this.load();
		if (this.#started) return;
		this.#started = true;
		if (this.permission === "unsupported") return;
		try {
			// A module worker: SvelteKit builds the service worker as an ES module and registers it that way itself.
			this.registration = await navigator.serviceWorker.register("/service-worker.js", {
				scope: "/",
				type: "module",
				// A stale worker is a stale app; the browser must check the script, not its HTTP cache.
				updateViaCache: "none",
			});
			this.subscription = await this.registration.pushManager.getSubscription();
			await this.postWorkerRegistrations();
			navigator.serviceWorker.addEventListener("message", (event) => {
				const data = event.data as { type?: unknown } | null;
				if (typeof data === "object" && data !== null && data.type === SUBSCRIPTION_CHANGED_MESSAGE) {
					void this.refreshSubscription();
				}
			});
		} catch (error) {
			this.error = messageOf(error);
		}
	}

	/** Re-read the browser's subscription, after the service worker replaced it. */
	async refreshSubscription(): Promise<void> {
		if (this.registration === undefined) return;
		try {
			this.subscription = await this.registration.pushManager.getSubscription();
			await this.postWorkerRegistrations();
		} catch (error) {
			this.error = messageOf(error);
		}
	}

	get enabled(): boolean {
		return this.subscription !== null && this.permission === "granted";
	}

	/** The device ID, made up the first time it is needed. */
	get deviceId(): string {
		if (this.settings.deviceId.length > 0) return this.settings.deviceId;
		const stored = deviceIdFromStorage();
		const deviceId = stored.length > 0 ? stored : newDeviceId();
		this.settings = { ...this.settings, deviceId };
		saveDeviceSettings(this.settings);
		return deviceId;
	}

	get label(): string {
		return deviceLabel();
	}

	get timezone(): string {
		return deviceTimezone();
	}

	/** One backend's card, from what this store knows and the page's current facts. */
	viewFor(backend: BackendConnection): BackendNotificationView {
		const entry = this.backends[backend.id];
		return backendNotificationView({
			supportsFeature: entry?.supported ?? backend.supports("notifications"),
			permission: this.permission,
			subscribed: this.subscription !== null,
			device: entry?.device ?? null,
			keyMismatch: entry !== undefined && this.keyMismatchFor(entry),
			...(entry?.error === undefined ? {} : { error: entry.error }),
		});
	}

	keyMismatchFor(entry: BackendNotification): boolean {
		if (!this.keyMismatch || entry.publicKey === undefined) return false;
		const keys = Object.values(this.backends)
			.map((value) => value.publicKey)
			.filter((key): key is string => key !== undefined);
		const own = this.subscriptionKey();
		return publicKeyMismatch(keys) || (own !== undefined && !samePublicKey(own, entry.publicKey));
	}

	/** The key this browser's subscription was made with, when it has one. */
	subscriptionKey(): string | undefined {
		return this.subscription === null ? undefined : subscriptionServerKey(this.subscription);
	}

	/**
	 * Ask every reachable backend what it offers, and register this device wherever it is missing. Runs on connect, on
	 * a reconnect and when the Notifications page opens, so a backend added later is registered without a click.
	 */
	async sync(backends: readonly BackendConnection[], options: { force?: boolean } = {}): Promise<void> {
		this.load();
		this.#backends = backends;
		for (const backend of backends) {
			const signature = `${backend.authSessionId ?? "anonymous"}|${backend.ready ? "ready" : backend.connection.status}|${(backend.features ?? []).join(",")}`;
			if (!options.force && this.#synced.get(backend.id) === signature) continue;
			this.#synced.set(backend.id, signature);
			if (!backend.ready) continue;
			await this.#syncOne(backend);
		}
		this.#checkKeys();
	}

	async #syncOne(backend: BackendConnection): Promise<void> {
		const current = this.backends[backend.id];
		const next: BackendNotification = {
			backendId: backend.id,
			device: current?.device ?? null,
			supported: backend.supports("notifications"),
			testing: current?.testing ?? false,
		};
		this.#set(backend.id, next);
		if (!next.supported) return;
		let publicKey: string;
		try {
			publicKey = await backend.client.readNotificationsConfig();
		} catch (error) {
			if (error instanceof ClientError && error.code === "unknown_request") {
				this.#set(backend.id, { ...next, supported: false, device: null });
				return;
			}
			this.#set(backend.id, { ...next, error: messageOf(error) });
			return;
		}
		this.#set(backend.id, { ...next, publicKey });
		try {
			const device = await backend.client.readNotificationDevice(this.deviceId);
			this.#set(backend.id, { ...this.#entry(backend.id), device });
		} catch (error) {
			this.#set(backend.id, { ...this.#entry(backend.id), error: messageOf(error) });
			return;
		}
		const keyMatches =
			this.subscription === null ||
			samePublicKey(subscriptionServerKey(this.subscription) ?? publicKey, publicKey);
		// Register again on every connect, not only when the backend has no device: preferences changed while it was
		// unreachable reach it here, and registering is the protocol's upsert.
		if (this.subscription !== null && keyMatches) await this.#register(backend);
		await this.postWorkerRegistrations();
	}

	/**
	 * Turn notifications on for this device: ask for permission (from the click that called this), subscribe once, and
	 * register with every backend that offers them. A browser with a subscription made with another key is left as is:
	 * the mismatch is the backend's problem to explain, not something to silently re-subscribe around.
	 */
	async enable(backends: readonly BackendConnection[]): Promise<void> {
		this.busy = true;
		this.error = undefined;
		try {
			this.load();
			if (this.permission === "unsupported") {
				this.error = "This browser cannot receive push notifications.";
				return;
			}
			// First, and before any other await: Chrome only shows the prompt while the click's user activation lasts.
			const permission = await Notification.requestPermission();
			this.permission = permission;
			if (permission !== "granted") {
				this.error =
					permission === "denied"
						? "The browser blocked notifications for this site. Allow them in its site settings, then try again."
						: "Notifications were not allowed.";
				return;
			}
			await this.start();
			await this.sync(backends, { force: true });
			const support = backends.find(
				(backend) =>
					backend.ready &&
					this.backends[backend.id]?.supported === true &&
					this.backends[backend.id]?.publicKey !== undefined,
			);
			const key = support === undefined ? undefined : this.backends[support.id]?.publicKey;
			if (key === undefined) {
				this.error = "No backend offers notifications yet. Add a backend running a release with them.";
				return;
			}
			const registration =
				this.registration ??
				(await navigator.serviceWorker.register("/service-worker.js", {
					scope: "/",
					type: "module",
					updateViaCache: "none",
				}));
			this.registration = registration;
			let subscription = await registration.pushManager.getSubscription();
			if (subscription === null) {
				subscription = await registration.pushManager.subscribe({
					userVisibleOnly: true,
					applicationServerKey: applicationServerKey(key),
				});
			} else {
				const made = subscriptionServerKey(subscription);
				if (made !== undefined && !samePublicKey(made, key)) {
					this.keyMismatch = true;
					this.error =
						"This browser subscribed with a different backend key. Every backend must share one VAPID pair; fix that before enabling.";
				}
			}
			this.subscription = subscription;
			this.#checkKeys();
			await this.registerAll(backends);
		} catch (error) {
			this.error = messageOf(error);
		} finally {
			this.busy = false;
		}
	}

	/** Register (or update) this device on one backend. */
	async #register(backend: BackendConnection): Promise<void> {
		const subscription = this.subscription;
		if (subscription === null) return;
		try {
			const device = await backend.client.registerNotifications({
				deviceId: this.deviceId,
				label: this.label,
				backendKey: backend.id,
				subscription: subscription.toJSON() as {
					endpoint: string;
					expirationTime?: number | null;
					keys: { p256dh: string; auth: string };
				},
				preferences: preferencesForBackend(this.settings, backend.id),
			});
			this.#set(backend.id, { ...this.#entry(backend.id), device, error: undefined, supported: true });
		} catch (error) {
			this.#set(backend.id, { ...this.#entry(backend.id), error: messageOf(error) });
		}
	}

	async registerAll(backends: readonly BackendConnection[]): Promise<void> {
		for (const backend of backends) {
			const entry = this.backends[backend.id];
			if (!backend.ready || entry?.supported !== true || entry.publicKey === undefined) continue;
			await this.#register(backend);
		}
		await this.postWorkerRegistrations();
	}

	/** Stop notifications on this device: unsubscribe, and forget the device on every backend. */
	async disable(backends: readonly BackendConnection[]): Promise<void> {
		this.busy = true;
		this.error = undefined;
		try {
			for (const backend of backends) {
				if (!backend.ready || this.backends[backend.id]?.supported === false) continue;
				try {
					await backend.client.unregisterNotifications(this.deviceId);
					this.#set(backend.id, { ...this.#entry(backend.id), device: null, error: undefined, test: undefined });
				} catch (error) {
					this.#set(backend.id, { ...this.#entry(backend.id), error: messageOf(error) });
				}
			}
			const subscription = this.subscription;
			if (subscription !== null) {
				try {
					await subscription.unsubscribe();
				} catch {
					// The push service may already have dropped it.
				}
			}
			this.subscription = null;
			await this.postWorkerRegistrations();
		} finally {
			this.busy = false;
		}
	}

	/** Turn one kind on or off, and tell every backend. */
	async setKind(backends: readonly BackendConnection[], kind: NotificationKind, on: boolean): Promise<void> {
		await this.#save({ kinds: withKind(this.settings.kinds, kind, on) }, backends);
	}

	/** Restore the kinds a new device starts with. */
	async resetKinds(backends: readonly BackendConnection[], defaults: readonly NotificationKind[]): Promise<void> {
		await this.#save({ kinds: [...defaults] }, backends);
	}

	/** Save this device's quiet hours, or turn them off with null. */
	async setQuietHours(backends: readonly BackendConnection[], quietHours: QuietHours | null): Promise<void> {
		await this.#save({ quietHours }, backends);
	}

	/** Mute or unmute one project, on the backend that owns it only. */
	async setProjectMuted(
		backends: readonly BackendConnection[],
		backendId: string,
		projectId: string,
		muted: boolean,
	): Promise<void> {
		this.settings = withMutedProject(this.settings, backendId, projectId, muted);
		saveDeviceSettings(this.settings);
		const backend = backends.find((entry) => entry.id === backendId);
		if (backend !== undefined && backend.ready && this.subscription !== null) {
			await this.#register(backend);
		}
		await this.postWorkerRegistrations();
	}

	isMuted(backendId: string, projectId: string): boolean {
		return isProjectMuted(this.settings, backendId, projectId);
	}

	async toggleProject(backends: readonly BackendConnection[], backendId: string, projectId: string): Promise<void> {
		await this.setProjectMuted(backends, backendId, projectId, !this.isMuted(backendId, projectId));
	}

	async #save(patch: Partial<DeviceNotificationSettings>, backends: readonly BackendConnection[]): Promise<void> {
		this.settings = { ...this.settings, ...patch };
		saveDeviceSettings(this.settings);
		this.busy = true;
		try {
			await this.registerAll(backends);
		} finally {
			this.busy = false;
		}
	}

	/** Push a test notification through one backend and keep its answer. */
	async test(backend: BackendConnection): Promise<void> {
		this.#set(backend.id, { ...this.#entry(backend.id), testing: true });
		try {
			const result = await backend.client.sendTestNotification(this.deviceId);
			this.#set(backend.id, {
				...this.#entry(backend.id),
				testing: false,
				test: { ...result, text: testNotificationText(result) },
			});
			// The push may have failed because the push service dropped the subscription; read what the backend saw.
			const device = await backend.client.readNotificationDevice(this.deviceId);
			this.#set(backend.id, { ...this.#entry(backend.id), device });
		} catch (error) {
			this.#set(backend.id, { ...this.#entry(backend.id), testing: false, error: messageOf(error) });
		}
	}

	/**
	 * Tell every connected backend whether this page is visible (an open app makes the backend hold notifications for 15 s,
	 * see `interaction.ts`). Called on connect, on a route change and on `visibilitychange`. It does not depend on this
	 * browser having push on: a tab that is not a notification device is still the user using the app. The same presence
	 * twice is not resent.
	 */
	async reportPresence(
		backends: readonly BackendConnection[],
		pathname: string,
		options: { visible?: boolean } = {},
	): Promise<void> {
		const visible = options.visible ?? (typeof document === "undefined" || document.visibilityState === "visible");
		const presence = presenceFor(pathname, visible);
		for (const backend of backends) {
			if (!backend.ready || !backend.supports("notifications")) continue;
			const signature = `${presence.visible}|${presence.projectId ?? ""}`;
			if (this.#presence.get(backend.id) === signature) continue;
			this.#presence.set(backend.id, signature);
			try {
				await backend.client.setNotificationsPresence({ deviceId: this.deviceId, ...presence });
			} catch {
				// A backend older than the request, or a dropped socket: the next report tries again.
				this.#presence.delete(backend.id);
			}
		}
	}

	/** Forget what was sent, so a reconnect reports presence again (the server forgot it when the socket closed). */
	forgetPresence(backendId?: string): void {
		if (backendId === undefined) this.#presence.clear();
		else this.#presence.delete(backendId);
	}

	/** Send the service worker what it needs to re-register a subscription with no app open. */
	async postWorkerRegistrations(): Promise<void> {
		if (this.registration === undefined) return;
		const deviceId = this.settings.deviceId;
		const registrations: WorkerRegistration[] = [];
		if (deviceId.length > 0 && this.subscription !== null) {
			for (const backend of this.#backends) {
				const entry = this.backends[backend.id];
				if (entry === undefined || entry.device === null || entry.publicKey === undefined) continue;
				registrations.push({
					origin: backend.url,
					backendKey: backend.id,
					deviceId,
					label: this.label,
					publicKey: entry.publicKey,
					preferences: preferencesForBackend(this.settings, backend.id),
				});
			}
		}
		const worker = navigator.serviceWorker.controller ?? this.registration.active;
		worker?.postMessage({ type: WORKER_REGISTRATIONS_MESSAGE, registrations });
	}

	#checkKeys(): void {
		const keys = Object.values(this.backends)
			.map((entry) => entry.publicKey)
			.filter((key): key is string => key !== undefined);
		const own = this.subscriptionKey();
		this.keyMismatch = publicKeyMismatch(keys) || (own !== undefined && keys.some((key) => !samePublicKey(own, key)));
	}

	#entry(backendId: string): BackendNotification {
		return (
			this.backends[backendId] ?? {
				backendId,
				device: null,
				supported: true,
				testing: false,
			}
		);
	}

	#set(backendId: string, entry: BackendNotification): void {
		this.backends = { ...this.backends, [backendId]: entry };
	}
}

export const notifications = new NotificationCenter();
