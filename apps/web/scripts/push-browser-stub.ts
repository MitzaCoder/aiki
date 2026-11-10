/** Synthetic push service only. Real service-worker registrations and authenticated backend RPCs remain untouched. */
import type { DeviceCredentialRecord } from "../src/lib/device-credentials.ts";
export type PushFixture = {
	origin: string;
	backends: { id: string; name: string; url: string }[];
	operatorBackends: { id: string; name: string; url: string }[];
	credentials: DeviceCredentialRecord[];
	publicKeys: string[];
	pushOrigin: string;
	subscriptionKeys: { p256dh: string; auth: string };
};
/** Serialize a page preload that stubs only permission and PushManager for the synthetic fixture. */
export function pushBrowserStub(fixture: PushFixture): string {
	return `(${install.toString()})(${JSON.stringify(fixture)})`;
}
function install(fixture: PushFixture) {
	Object.defineProperty(Notification, "permission", { get: () => "granted" });
	Notification.requestPermission = async () => "granted";
	type Saved = Record<string, { key: string; endpoint: string }>;
	const read = (): Saved => JSON.parse(localStorage.getItem("demo-push-subscriptions") ?? "{}");
	const save = (subscriptions: Saved) => localStorage.setItem("demo-push-subscriptions", JSON.stringify(subscriptions));
	const managers = new WeakMap<PushManager, string>();
	const descriptor = Object.getOwnPropertyDescriptor(ServiceWorkerRegistration.prototype, "pushManager")!;
	Object.defineProperty(ServiceWorkerRegistration.prototype, "pushManager", {
		get() {
			const manager = descriptor.get!.call(this);
			managers.set(manager, this.scope);
			return manager;
		},
	});
	const subscription = (scope: string, saved: Saved[string] | undefined): PushSubscription | null =>
		saved
			? ({
					endpoint: saved.endpoint,
					options: {
						applicationServerKey: Uint8Array.from(atob(saved.key.replace(/-/g, "+").replace(/_/g, "/")), (char) =>
							char.charCodeAt(0),
						).buffer,
					},
					toJSON: () => ({ endpoint: saved.endpoint, keys: fixture.subscriptionKeys, expirationTime: null }),
					async unsubscribe() {
						const subscriptions = read();
						delete subscriptions[scope];
						save(subscriptions);
						localStorage.setItem(
							"demo-unsubscribes",
							String(Number(localStorage.getItem("demo-unsubscribes") ?? 0) + 1),
						);
						return true;
					},
				} as unknown as PushSubscription)
			: null;
	PushManager.prototype.getSubscription = async function () {
		const scope = managers.get(this)!;
		return subscription(scope, read()[scope]);
	};
	PushManager.prototype.subscribe = async function (options) {
		const scope = managers.get(this)!;
		const subscriptions = read();
		if (subscriptions[scope]) return subscription(scope, subscriptions[scope])!;
		const key = btoa(String.fromCharCode(...new Uint8Array(options!.applicationServerKey as ArrayBuffer)))
			.replace(/\+/g, "-")
			.replace(/\//g, "_")
			.replace(/=+$/, "");
		const count = Number(localStorage.getItem("demo-subscribes") ?? 0) + 1;
		localStorage.setItem("demo-subscribes", String(count));
		subscriptions[scope] = { key, endpoint: fixture.pushOrigin + "/subscription/" + count };
		save(subscriptions);
		return subscription(scope, subscriptions[scope])!;
	};
}
