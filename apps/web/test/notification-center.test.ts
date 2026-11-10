import { afterEach, expect, test } from "bun:test";
import { applicationServerKey } from "@aiki/client";
import type { NotificationDevice } from "@aiki/protocol";
import type { BackendConnection } from "../src/lib/harness.svelte.ts";
import { installPushBrowser } from "./push-browser-mock.ts";
import { setPushSyncNeeded } from "../src/lib/push-sync.ts";

const cleanup: (() => void)[] = [];
afterEach(() => {
	for (const restore of cleanup.splice(0).reverse()) restore();
});
function syntheticKey(byte: number): string {
	return Buffer.concat([Buffer.from([4]), Buffer.alloc(64, byte)]).toString("base64url");
}
const keyA = syntheticKey(1);
const keyB = syntheticKey(2);
function subscription(key: string, endpoint: string, unsubscribe: () => void): PushSubscription {
	return {
		options: { applicationServerKey: applicationServerKey(key).buffer },
		toJSON: () => ({ endpoint, keys: { p256dh: "synthetic-point", auth: "synthetic-auth" } }),
		unsubscribe: async () => {
			unsubscribe();
			return true;
		},
	} as unknown as PushSubscription;
}
function backend(id: string, initialKey: string) {
	let key = initialKey;
	let ready = true;
	const endpoints: string[] = [];
	const device: NotificationDevice = {
		deviceId: "synthetic-device",
		label: "Synthetic browser",
		backendKey: id,
		preferences: { kinds: [], mutedProjects: [], quietHours: null },
		createdAt: "2026-01-01T00:00:00.000Z",
		lastDelivery: null,
	};
	const connection = {
		id,
		url: `https://${id}.example.test`,
		get ready() {
			return ready;
		},
		features: ["notifications"],
		connection: { status: "ready" },
		supports: () => true,
		client: {
			readNotificationsConfig: async () => key,
			readNotificationDevice: async () => null,
			registerNotifications: async (input: { subscription: { endpoint: string } }) => {
				endpoints.push(input.subscription.endpoint);
				return device;
			},
			unregisterNotifications: async () => undefined,
		},
	} as unknown as BackendConnection;
	return {
		connection,
		endpoints,
		changeKey: (next: string) => {
			key = next;
		},
		setReady: (next: boolean) => {
			ready = next;
		},
	};
}
async function centerFixture() {
	let subscribed = 0;
	const unsubscribed: string[] = [];
	const root = subscription(keyA, "https://push.example.test/root", () => unsubscribed.push("/"));
	const browser = installPushBrowser(root, (scope, options) => {
		subscribed += 1;
		const key = Buffer.from(options.applicationServerKey as Uint8Array).toString("base64url");
		return subscription(key, `https://push.example.test/scoped-${subscribed}`, () => unsubscribed.push(scope));
	});
	cleanup.push(browser);
	const { NotificationCenter } = await import("../src/lib/notifications.svelte.ts");
	return { center: new NotificationCenter(), browser, root, unsubscribed, subscribeCount: () => subscribed };
}

test("the operator: three backends, one shared key, existing root means no new registration or subscription or errors", async () => {
	const fixture = await centerFixture();
	const backends = ["alpha", "beta", "gamma"].map((id) => backend(id, keyA));
	await fixture.center.sync(backends.map((backend) => backend.connection));
	expect(fixture.subscribeCount()).toBe(0);
	expect(fixture.unsubscribed).toEqual([]);
	expect([...fixture.browser.registrations.keys()]).toEqual(["/"]);
	expect(fixture.center.subscription).toBe(fixture.root);
	for (const backend of backends) {
		expect(backend.endpoints).toEqual(["https://push.example.test/root"]);
		expect(fixture.center.backends[backend.connection.id]?.error).toBeUndefined();
		expect(fixture.center.push[backend.connection.id]?.scope).toBe("/");
	}
});

test("independent keys subscribe separately; key change waits for explicit repair and preserves the legacy group", async () => {
	const fixture = await centerFixture();
	const alpha = backend("alpha", keyA);
	const beta = backend("beta", keyB);
	const gamma = backend("gamma", keyA);
	const backends = [alpha.connection, beta.connection, gamma.connection];
	await fixture.center.sync(backends);
	const scope = fixture.center.push.beta!.scope;
	expect(scope).not.toBe("/");
	expect(fixture.subscribeCount()).toBe(1);
	beta.changeKey(syntheticKey(3));
	await fixture.center.sync(backends, { force: true });
	expect(fixture.center.viewFor(beta.connection).status).toBe("key-mismatch");
	expect(fixture.subscribeCount()).toBe(1);
	expect(fixture.unsubscribed).toEqual([]);
	await fixture.center.enableBackend(beta.connection, true);
	expect(fixture.subscribeCount()).toBe(2);
	expect(fixture.unsubscribed).toEqual([scope]);
	expect(fixture.center.push.alpha!.scope).toBe("/");
	expect(fixture.center.push.gamma!.scope).toBe("/");
	expect(fixture.center.subscription).toBe(fixture.root);
});

test("subscription-change repair registers only the marked scope and only while that backend is signed in", async () => {
	const fixture = await centerFixture();
	const alpha = backend("alpha", keyA);
	const beta = backend("beta", keyB);
	await fixture.center.sync([alpha.connection, beta.connection]);
	const alphaCalls = alpha.endpoints.length;
	const betaCalls = beta.endpoints.length;
	const scope = fixture.center.push.beta!.scope;
	beta.setReady(false);
	await setPushSyncNeeded(scope, true);
	await fixture.center.refreshSubscription();
	expect(fixture.center.push.beta!.syncNeeded).toBe(true);
	expect(beta.endpoints.length).toBe(betaCalls);
	expect(alpha.endpoints.length).toBe(alphaCalls);
	beta.setReady(true);
	await fixture.center.refreshSubscription();
	expect(fixture.center.push.beta!.syncNeeded).toBe(false);
	expect(beta.endpoints.length).toBe(betaCalls + 1);
	expect(alpha.endpoints.length).toBe(alphaCalls);
});

test("removing an independent backend deletes only its own registration and subscription", async () => {
	const fixture = await centerFixture();
	const alpha = backend("alpha", keyA);
	const beta = backend("beta", keyB);
	await fixture.center.sync([alpha.connection, beta.connection]);
	const scope = fixture.center.push.beta!.scope;
	await fixture.center.sync([alpha.connection]);
	expect(fixture.unsubscribed).toEqual([scope]);
	expect([...fixture.browser.registrations.keys()]).toEqual(["/"]);
	expect(fixture.center.push.beta).toBeUndefined();
	expect(fixture.center.subscription).toBe(fixture.root);
});

test("root is unsubscribed only when the final known legacy backend stops using it", async () => {
	const fixture = await centerFixture();
	const alpha = backend("alpha", keyA);
	const gamma = backend("gamma", keyA);
	await fixture.center.sync([alpha.connection, gamma.connection]);
	await fixture.center.disableBackend(alpha.connection);
	expect(fixture.unsubscribed).toEqual([]);
	await fixture.center.disableBackend(gamma.connection);
	expect(fixture.unsubscribed).toEqual(["/"]);
	expect(fixture.center.subscription).toBeNull();
	expect([...fixture.browser.registrations.keys()]).toEqual(["/"]);
});

test("an undiscovered offline backend prevents retiring a possibly shared legacy root", async () => {
	const fixture = await centerFixture();
	const alpha = backend("alpha", keyA);
	const gamma = backend("gamma", keyA);
	gamma.setReady(false);
	await fixture.center.sync([alpha.connection, gamma.connection]);
	await fixture.center.disableBackend(alpha.connection);
	expect(fixture.unsubscribed).toEqual([]);
	expect(fixture.center.subscription).toBe(fixture.root);
});

test("an unreadable legacy root key never triggers an implicit scope migration", async () => {
	const fixture = await centerFixture();
	Object.defineProperty(fixture.root, "options", { value: { applicationServerKey: null } });
	const alpha = backend("alpha", keyA);
	await fixture.center.sync([alpha.connection]);
	expect(fixture.subscribeCount()).toBe(0);
	expect(fixture.unsubscribed).toEqual([]);
	expect([...fixture.browser.registrations.keys()]).toEqual(["/"]);
	expect(fixture.center.subscription).toBe(fixture.root);
	expect(fixture.center.backends.alpha?.error).toContain("existing subscription was kept unchanged");
});
