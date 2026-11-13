/**
 * This browser's notifications: independent push subscriptions, one device identity, and a registration on every backend that
 * offers them. Svelte runes live here; the wording and the decision rules are in `notifications.ts`, and the wire
 * helpers in `@kemiri/client`.
 *
 * The root app-shell worker preserves legacy push; separate scoped workers handle independent keys. Workers only
 * mark subscription changes for signed-in page repair. Presence still holds pushes while the app is open
 * (interaction is `interaction.ts`).
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
} from "@kemiri/client";
import type { NotificationDevice, NotificationKind } from "@kemiri/protocol";
import type { BackendConnection } from "./harness.svelte.ts";
import {
	backendNotificationView,
	presenceFor,
	pushSubscriptionError,
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

import {
	backendPushScope,
	equalPushKey,
	loadPushSubscriptions,
	MAX_PUSH_SCOPES,
	PUSH_SUBSCRIPTIONS_STORAGE,
	pushSubscriptionDecision,
	removedPushBackendIds,
	type BackendPushSubscription,
} from "./push-subscriptions.ts";
import {
	clearPushSyncMarker,
	PUSH_CHANGED_MESSAGE,
	pushSyncMarkers,
	pushSyncScopes,
	setPushSyncNeeded,
} from "./push-sync.ts";
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
	/** Persisted per-backend scope, key and enablement; no auth material. */
	push = $state<Record<string, BackendPushSubscription>>({});
	#registrations = new Map<string, ServiceWorkerRegistration>();
	#subscriptions = new Map<string, PushSubscription | null>();
	#startPromise: Promise<void> | undefined;
	#syncTail: Promise<void> = Promise.resolve();
	/** A request is running: enabling, disabling or saving preferences. */
	busy = $state(false);
	error = $state<string | undefined>(undefined);
	errorDetail = $state<string | undefined>(undefined);

	#loaded = false;
	#storageReadable = true;
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
		if (typeof localStorage !== "undefined") {
			try {
				this.push = loadPushSubscriptions(localStorage);
			} catch {
				this.#storageReadable = false;
				this.error =
					"Saved push settings are unreadable. Existing subscriptions were left untouched; restore browser storage before retrying.";
			}
		}
	}

	/** Keep app-shell registration and legacy root subscription untouched. */
	start(): Promise<void> {
		return (this.#startPromise ??= this.#start());
	}
	async #start(): Promise<void> {
		this.load();
		if (this.permission === "unsupported") return;
		try {
			this.registration = await navigator.serviceWorker.register("/service-worker.js", {
				scope: "/",
				type: "module",
				updateViaCache: "none",
			});
			this.subscription = await this.registration.pushManager.getSubscription();
			this.#registrations.set("/", this.registration);
			this.#subscriptions.set("/", this.subscription);
			navigator.serviceWorker.addEventListener("message", (event) => {
				if (event.data?.type === PUSH_CHANGED_MESSAGE) void this.refreshSubscription();
			});
		} catch (error) {
			this.error = messageOf(error);
		}
	}
	/** Repair only worker-marked scopes, using the page's existing signed-in clients. */
	async refreshSubscription(): Promise<void> {
		const scopes = await pushSyncScopes();
		await this.sync(this.#backends, { force: true, scopes });
	}
	get enabled(): boolean {
		return (
			this.permission === "granted" &&
			(this.subscription !== null || Object.values(this.push).some((record) => record.enabled))
		);
	}
	#persist(): void {
		localStorage.setItem(PUSH_SUBSCRIPTIONS_STORAGE, JSON.stringify(this.push));
	}
	#setPush(id: string, record: BackendPushSubscription): void {
		this.push = { ...this.push, [id]: record };
		this.#persist();
	}
	#subscriptionFor(id: string): PushSubscription | null {
		const record = this.push[id];
		return record?.enabled ? (this.#subscriptions.get(record.scope) ?? null) : null;
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

	/** One backend's card, including explicit repair and legacy state. */
	viewFor(backend: BackendConnection): BackendNotificationView {
		const entry = this.backends[backend.id];
		const record = this.push[backend.id];
		return backendNotificationView({
			supportsFeature: entry?.supported ?? backend.supports("notifications"),
			permission: this.permission,
			subscribed: this.#subscriptionFor(backend.id) !== null,
			device: entry?.device ?? null,
			keyMismatch: this.keyMismatchFor(entry),
			syncNeeded: record?.syncNeeded ?? false,
			legacy: record?.scope === "/",
			unavailableReason: backend.ready
				? undefined
				: (backend.connection.error ?? "Connect and sign in to this backend to enable or sync push."),
			...(entry?.error === undefined ? {} : { error: entry.error }),
		});
	}
	/** Detect only this backend's key change, never disagreement with unrelated backends. */
	keyMismatchFor(entry: BackendNotification | undefined): boolean {
		const record = entry && this.push[entry.backendId];
		const actual = entry && this.#subscriptionFor(entry.backendId);
		const actualKey = actual ? subscriptionServerKey(actual) : undefined;
		return (
			record !== undefined &&
			entry?.publicKey !== undefined &&
			(!equalPushKey(record.publicKey, entry.publicKey) ||
				(actualKey !== undefined && !equalPushKey(actualKey, entry.publicKey)))
		);
	}
	/** Read the legacy root subscription key without changing its registration or subscription. */
	subscriptionKey(): string | undefined {
		return this.subscription === null ? undefined : subscriptionServerKey(this.subscription);
	}
	/** Serialize startup/reconnect discovery and worker-change repair. */
	sync(
		backends: readonly BackendConnection[],
		options: { force?: boolean; scopes?: readonly string[] } = {},
	): Promise<void> {
		const task = this.#syncTail
			.then(() => this.#sync(backends, options))
			.catch((error) => {
				this.error = messageOf(error);
			});
		this.#syncTail = task;
		return task;
	}
	async #sync(
		backends: readonly BackendConnection[],
		options: { force?: boolean; scopes?: readonly string[] },
	): Promise<void> {
		await this.start();
		this.#backends = backends;
		if (this.permission === "unsupported" || !this.#storageReadable) return;
		await this.#removeMissing(backends);
		const markers = await pushSyncMarkers();
		const changed = Object.keys(markers);
		for (const [id, record] of Object.entries(this.push)) {
			if (record.enabled && changed.includes(record.scope)) this.#setPush(id, { ...record, syncNeeded: true });
		}
		for (const backend of backends) {
			if (options.scopes && !options.scopes.includes(this.push[backend.id]?.scope ?? "")) continue;
			const signature = `${backend.authSessionId ?? "anonymous"}|${backend.ready}|${(backend.features ?? []).join(",")}`;
			if (!options.force && !this.push[backend.id]?.syncNeeded && this.#synced.get(backend.id) === signature) continue;
			this.#synced.set(backend.id, signature);
			if (backend.ready) await this.#syncOne(backend);
		}
		for (const scope of changed) {
			if (!Object.values(this.push).some((record) => record.enabled && record.scope === scope && record.syncNeeded))
				await clearPushSyncMarker(scope, markers[scope]!);
		}
	}
	async #syncOne(backend: BackendConnection): Promise<void> {
		const current = this.backends[backend.id];
		this.#set(backend.id, {
			backendId: backend.id,
			device: current?.device ?? null,
			supported: backend.supports("notifications"),
			testing: false,
		});
		if (!backend.supports("notifications")) return;
		try {
			const publicKey = await backend.client.readNotificationsConfig();
			this.#set(backend.id, { ...this.#entry(backend.id), publicKey });
			let record = this.push[backend.id];
			if (!record && this.subscription !== null && this.subscriptionKey() === undefined) {
				throw new Error(
					"This browser cannot read the existing push key. Its existing subscription was kept unchanged. " +
						"Enable this backend explicitly to use a separate subscription.",
				);
			}
			const decision = pushSubscriptionDecision({ publicKey, rootKey: this.subscriptionKey(), stored: record });
			if (!record && decision === "root") {
				record = { origin: backend.url, scope: "/", publicKey, enabled: true };
				this.#setPush(backend.id, record);
			} else if (!record && this.enabled) {
				record = {
					origin: backend.url,
					scope: await backendPushScope(backend.id, backend.url),
					publicKey,
					enabled: true,
				};
				this.#setPush(backend.id, record);
			}
			// A different advertised key never rotates a subscription implicitly.
			if (record?.enabled && !this.keyMismatchFor(this.backends[backend.id])) {
				await this.#ensureSubscription(record);
				await this.#register(backend);
			} else if (record && !record.enabled) {
				// An explicit off made while offline retries its authenticated row removal on reconnect.
				await backend.client.unregisterNotifications(this.deviceId);
				this.#set(backend.id, { ...this.#entry(backend.id), device: null });
			} else {
				const device = await backend.client.readNotificationDevice(this.deviceId);
				this.#set(backend.id, { ...this.#entry(backend.id), device });
			}
		} catch (error) {
			if (error instanceof ClientError && error.code === "unknown_request")
				this.#set(backend.id, { ...this.#entry(backend.id), supported: false, device: null });
			else this.#set(backend.id, { ...this.#entry(backend.id), error: pushSubscriptionError(error).message });
		}
	}
	async #ensureSubscription(record: BackendPushSubscription): Promise<void> {
		if (this.permission !== "granted") return;
		let registration = this.#registrations.get(record.scope);
		if (!registration) {
			if (record.scope === "/" && !this.registration)
				throw new Error("Notifications could not start. Reopen the app to retry.");
			const existing = await navigator.serviceWorker.getRegistration(record.scope);
			if (existing && new URL(existing.scope).pathname === record.scope) registration = existing;
			else {
				const scoped = (await navigator.serviceWorker.getRegistrations()).filter((value) =>
					new URL(value.scope).pathname.startsWith("/push/"),
				);
				if (scoped.length >= MAX_PUSH_SCOPES)
					throw new Error(
						`Push is already on for ${MAX_PUSH_SCOPES} backends in this browser. Disable one before enabling another.`,
					);
				registration = await navigator.serviceWorker.register("/push-worker.js", {
					scope: record.scope,
					updateViaCache: "none",
				});
			}
			this.#registrations.set(record.scope, registration);
		}
		// subscribe requires an active worker; registration.ready refers only to the root document's controller.
		if (!registration.active)
			await new Promise<void>((resolve, reject) => {
				const worker = registration!.installing ?? registration!.waiting;
				if (!worker) {
					reject(new Error("Notifications are not ready. Reopen the app to retry."));
					return;
				}
				const timer = setTimeout(
					() => reject(new Error("Notifications took too long to start. Reopen the app to retry.")),
					10_000,
				);
				worker.addEventListener("statechange", () => {
					if (worker.state === "activated") {
						clearTimeout(timer);
						resolve();
					}
					if (worker.state === "redundant") {
						clearTimeout(timer);
						reject(new Error("Notifications could not start. Reopen the app to retry."));
					}
				});
			});
		let subscription = await registration.pushManager.getSubscription();
		this.#subscriptions.set(record.scope, subscription);
		if (subscription && !samePublicKey(subscriptionServerKey(subscription) ?? "", record.publicKey))
			throw new Error("The saved subscription has a different key. Re-subscribe this backend.");
		if (!subscription)
			subscription = await registration.pushManager.subscribe({
				userVisibleOnly: true,
				applicationServerKey: applicationServerKey(record.publicKey),
			});
		this.#subscriptions.set(record.scope, subscription);
		if (record.scope === "/") this.subscription = subscription;
	}
	/** Origin-wide permission remains the first await in the user's enable gesture. */
	async enable(backends: readonly BackendConnection[]): Promise<void> {
		this.busy = true;
		this.error = undefined;
		this.errorDetail = undefined;
		try {
			this.load();
			if (!this.#storageReadable)
				throw new Error("Saved push settings are unreadable. Existing subscriptions were left untouched.");
			if (this.permission === "unsupported") throw new Error("This browser cannot receive push notifications.");
			this.permission = await Notification.requestPermission();
			if (this.permission !== "granted")
				throw new Error("Notifications were not allowed. Check this site's browser permissions.");
			await this.sync(backends, { force: true });
			const available = backends.filter(
				(backend) => backend.ready && this.backends[backend.id]?.publicKey !== undefined,
			);
			if (!available.length) throw new Error("No backend offers notifications yet.");
			for (const backend of available) await this.#enableOne(backend, false);
		} catch (error) {
			const failure = pushSubscriptionError(error);
			this.error = failure.message;
			this.errorDetail = failure.detail;
		} finally {
			this.busy = false;
		}
	}
	/** Explicitly enable or replace one backend's subscription without releasing another backend's scope. */
	async enableBackend(backend: BackendConnection, replace = false): Promise<void> {
		this.busy = true;
		try {
			if (!this.#storageReadable)
				throw new Error("Saved push settings are unreadable. Existing subscriptions were left untouched.");
			this.permission = await Notification.requestPermission();
			if (this.permission !== "granted") return;
			await this.sync(this.#backends, { force: true });
			await this.#enableOne(backend, replace);
		} catch (error) {
			const failure = pushSubscriptionError(error);
			this.error = failure.message;
			this.errorDetail = failure.detail;
		} finally {
			this.busy = false;
		}
	}
	async #enableOne(backend: BackendConnection, replace: boolean): Promise<void> {
		const publicKey = this.backends[backend.id]?.publicKey;
		if (!backend.ready || !publicKey) return;
		const old = this.push[backend.id];
		if (old && this.keyMismatchFor(this.backends[backend.id]) && !replace) return;
		if (replace && old) await this.#releaseScope(old.scope, backend.id);
		// Keep first-time shared-key enablement compatible. Never move an existing legacy row on load.
		const sharedKeyGroup =
			this.#backends.filter((other) => equalPushKey(this.backends[other.id]?.publicKey ?? "", publicKey)).length > 1;
		const scope = replace
			? await backendPushScope(backend.id, backend.url)
			: (old?.scope ??
				((this.subscription === null && sharedKeyGroup) || equalPushKey(this.subscriptionKey() ?? "", publicKey)
					? "/"
					: await backendPushScope(backend.id, backend.url)));
		const record = { origin: backend.url, scope, publicKey, enabled: true };
		this.#setPush(backend.id, record);
		await this.#ensureSubscription(record);
		await this.#register(backend);
	}
	async #releaseScope(scope: string, exceptId: string): Promise<void> {
		if (Object.entries(this.push).some(([id, record]) => id !== exceptId && record.enabled && record.scope === scope))
			return;
		// An offline backend from before this upgrade may still use root. Discovery must finish before retiring it.
		if (
			scope === "/" &&
			this.#backends.some((backend) => backend.id !== exceptId && this.push[backend.id] === undefined)
		)
			return;
		const registration = this.#registrations.get(scope) ?? (await navigator.serviceWorker.getRegistration(scope));
		if (registration && new URL(registration.scope).pathname === scope) {
			await (await registration.pushManager.getSubscription())?.unsubscribe();
			if (scope !== "/") await registration.unregister();
		}
		this.#subscriptions.delete(scope);
		this.#registrations.delete(scope);
		if (scope === "/") {
			this.subscription = null;
			if (this.registration) this.#registrations.set("/", this.registration);
		}
		await setPushSyncNeeded(scope, false);
	}
	/** Stop one backend locally and remove its row when reachable; release root only after its last user. */
	async disableBackend(backend: BackendConnection): Promise<void> {
		const record = this.push[backend.id];
		if (!record) return;
		if (backend.ready) {
			try {
				await backend.client.unregisterNotifications(this.deviceId);
			} catch (error) {
				this.error = `Push is off in this browser, but this backend could not be updated: ${messageOf(error)}`;
			}
		}
		this.#setPush(backend.id, { ...record, enabled: false, syncNeeded: false });
		await this.#releaseScope(record.scope, backend.id);
		this.#set(backend.id, { ...this.#entry(backend.id), device: null, test: undefined });
	}
	async #removeMissing(backends: readonly BackendConnection[]): Promise<void> {
		for (const id of removedPushBackendIds(this.push, backends)) {
			const record = this.push[id]!;
			await this.#releaseScope(record.scope, id);
			const { [id]: _record, ...push } = this.push;
			this.push = push;
			const { [id]: _entry, ...entries } = this.backends;
			this.backends = entries;
			this.#synced.delete(id);
			this.#persist();
		}
		// Dormant registrations are bounded by the configured, enabled map, not elapsed time.
		const scopes = new Set(
			Object.values(this.push)
				.filter((record) => record.enabled)
				.map((record) => record.scope),
		);
		for (const registration of await navigator.serviceWorker.getRegistrations()) {
			const scope = new URL(registration.scope).pathname;
			if (!scope.startsWith("/push/") || scopes.has(scope)) continue;
			await (await registration.pushManager.getSubscription())?.unsubscribe();
			await registration.unregister();
			await setPushSyncNeeded(scope, false);
		}
	}
	/** Register (or update) this device on one backend. */
	async #register(backend: BackendConnection): Promise<void> {
		const subscription = this.#subscriptionFor(backend.id);
		if (subscription === null || this.keyMismatchFor(this.backends[backend.id])) return;
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
			const record = this.push[backend.id];
			if (record) this.#setPush(backend.id, { ...record, syncNeeded: false });
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
	}

	/** Explicit device-wide off, preserving other browsers and the root app shell. */
	async disable(backends: readonly BackendConnection[]): Promise<void> {
		this.busy = true;
		this.error = undefined;
		this.errorDetail = undefined;
		try {
			for (const backend of backends) await this.disableBackend(backend);
		} catch (error) {
			this.error = messageOf(error);
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
		if (backend !== undefined && backend.ready && this.#subscriptionFor(backend.id) !== null) {
			await this.#register(backend);
		}
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
