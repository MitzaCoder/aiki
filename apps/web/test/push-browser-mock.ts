import { IDBFactory } from "fake-indexeddb";
/** Only the browser APIs unavailable in Bun; real protocol clients/servers can still be used. */
export function installPushBrowser(
	rootSubscription: PushSubscription | null,
	subscribe?: (scope: string, options: PushSubscriptionOptionsInit) => PushSubscription,
) {
	const saved = new Map<string, PropertyDescriptor | undefined>();
	const storage = new Map<string, string>();
	const registrations = new Map<string, ServiceWorkerRegistration>();
	const register = async (_script: string, options: { scope: string }) => {
		let registration = registrations.get(options.scope);
		if (!registration) {
			let subscription = options.scope === "/" ? rootSubscription : null;
			registration = {
				scope: `https://app.example.test${options.scope}`,
				active: {},
				pushManager: {
					getSubscription: async () => subscription,
					subscribe: async (options: PushSubscriptionOptionsInit) => {
						if (!subscribe) throw new Error("Unexpected re-subscribe");
						subscription = subscribe(new URL(registration!.scope).pathname, options);
						return subscription;
					},
				},
				unregister: async () => {
					registrations.delete(options.scope);
					return true;
				},
			} as unknown as ServiceWorkerRegistration;
			registrations.set(options.scope, registration);
		}
		return registration;
	};
	const globals: Record<string, unknown> = {
		$state: (value: unknown) => value,
		window: { Notification: {}, PushManager: {} },
		Notification: { permission: "granted", requestPermission: async () => "granted" },
		indexedDB: new IDBFactory(),
		localStorage: {
			getItem: (key: string) => storage.get(key) ?? null,
			setItem: (key: string, value: string) => storage.set(key, value),
		},
		navigator: {
			serviceWorker: {
				register,
				getRegistrations: async () => [...registrations.values()],
				getRegistration: async (scope: string) => registrations.get(scope),
				addEventListener() {},
			},
		},
	};
	for (const [key, value] of Object.entries(globals)) {
		saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
		Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
	}
	const restore = () => {
		for (const [key, descriptor] of saved) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else Reflect.deleteProperty(globalThis, key);
		}
	};
	return Object.assign(restore, { registrations, storage });
}
