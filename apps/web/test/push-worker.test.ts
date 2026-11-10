import { afterEach, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { installPushEvents } from "../src/service-worker/push-events.ts";
import { clearPushSyncMarker, pushSyncMarkers, pushSyncScopes, setPushSyncNeeded } from "../src/lib/push-sync.ts";
const descriptor = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
afterEach(() => {
	if (descriptor) Object.defineProperty(globalThis, "indexedDB", descriptor);
	else Reflect.deleteProperty(globalThis, "indexedDB");
});
function worker(scope: string) {
	Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: new IDBFactory() });
	const listeners = new Map<string, (event: unknown) => void>();
	const messages: unknown[] = [],
		opened: string[] = [];
	const api = {
		registration: { scope: "https://app.example.test" + scope },
		location: { origin: "https://app.example.test" },
		clients: {
			matchAll: async () => [{ postMessage: (message: unknown) => messages.push(message) }],
			openWindow: async (url: string) => opened.push(url),
		},
		addEventListener: (name: string, listener: (event: unknown) => void) => listeners.set(name, listener),
	};
	installPushEvents(api as unknown as ServiceWorkerGlobalScope);
	return { listeners, messages, opened, api };
}
test("push-only events have no fetch, cache, install, activate or claim behavior", () => {
	expect([...worker("/push/demo/").listeners.keys()]).toEqual(["push", "notificationclick", "pushsubscriptionchange"]);
});
for (const scope of ["/", "/push/demo/"])
	test(`subscription change in ${scope} only marks its scope; no subscribe, first key, socket or auth`, async () => {
		const fixture = worker(scope);
		let completed: Promise<void> | undefined;
		fixture.listeners.get("pushsubscriptionchange")!({
			waitUntil: (promise: Promise<void>) => {
				completed = promise;
			},
			newSubscription: null,
		});
		await completed;
		expect(await pushSyncScopes()).toEqual([scope]);
		expect(fixture.messages).toEqual([{ type: "notifications-changed", scope }]);
	});
test("scoped notifications open the root app route, never a backend origin or scoped app", async () => {
	const fixture = worker("/push/demo/");
	fixture.api.clients.matchAll = async () => [];
	let completed: Promise<void> | undefined;
	const click = (url: string) => {
		fixture.listeners.get("notificationclick")!({
			notification: { data: { url }, close() {} },
			waitUntil: (promise: Promise<void>) => {
				completed = promise;
			},
		});
		return completed;
	};
	await click("/b/alpha/projects/synthetic");
	expect(fixture.opened).toEqual(["https://app.example.test/b/alpha/projects/synthetic"]);
	await click("https://other.example.test/phish");
	expect(fixture.opened).toHaveLength(1);
});

test("a completed page repair never clears a newer worker subscription change", async () => {
	worker("/");
	await setPushSyncNeeded("/", true);
	const markers = await pushSyncMarkers();
	await setPushSyncNeeded("/", true);
	await clearPushSyncMarker("/", markers["/"]!);
	expect(await pushSyncScopes()).toEqual(["/"]);
	const latest = await pushSyncMarkers();
	await clearPushSyncMarker("/", latest["/"]!);
	expect(await pushSyncScopes()).toEqual([]);
});
