import { describe, expect, test } from "bun:test";
import {
	backendPushScope,
	loadPushSubscriptions,
	pushSubscriptionDecision,
	removedPushBackendIds,
	type BackendPushSubscription,
} from "../src/lib/push-subscriptions.ts";
const legacy: BackendPushSubscription = {
	origin: "https://alpha.example.test",
	scope: "/",
	publicKey: "key-a",
	enabled: true,
};
const scoped = { ...legacy, scope: "/push/" + "a".repeat(64) + "/" };
describe("per-backend subscription decisions", () => {
	test("only matching backends can join an existing root subscription", () => {
		expect(pushSubscriptionDecision({ publicKey: "key-a=", rootKey: "key-a" })).toBe("root");
		expect(pushSubscriptionDecision({ publicKey: "key-b", rootKey: "key-a" })).toBe("scoped");
		expect(pushSubscriptionDecision({ publicKey: "key-a" })).toBe("scoped");
	});
	test("the operator: three backends, one shared key, an existing root subscription need no new subscription or error", () => {
		for (const _backend of ["alpha", "beta", "gamma"])
			expect(pushSubscriptionDecision({ publicKey: "key-a", rootKey: "key-a" })).toBe("root");
	});
	test("stored scoped routes never silently migrate back to root", () => {
		expect(pushSubscriptionDecision({ publicKey: "key-a", rootKey: "key-a", stored: scoped })).toBe("scoped");
	});
	test("a changed backend key requires explicit repair, even when it now matches root", () => {
		expect(pushSubscriptionDecision({ publicKey: "key-b", rootKey: "key-b", stored: scoped })).toBe("key-changed");
		expect(pushSubscriptionDecision({ publicKey: "key-b", stored: legacy })).toBe("key-changed");
	});
	test("sync-needed affects only the marked backend, without changing its key", () => {
		expect(pushSubscriptionDecision({ publicKey: "key-a", stored: { ...scoped, syncNeeded: true } })).toBe(
			"sync-needed",
		);
		expect(pushSubscriptionDecision({ publicKey: "key-a", stored: legacy })).toBe("root");
		expect(pushSubscriptionDecision({ publicKey: "key-b", stored: { ...scoped, syncNeeded: true } })).toBe(
			"key-changed",
		);
	});
	test("explicit off survives reconnects and a root subscription", () => {
		expect(
			pushSubscriptionDecision({ publicKey: "key-a", rootKey: "key-a", stored: { ...legacy, enabled: false } }),
		).toBe("off");
	});
	test("removal includes origin replacement, but leaves unrelated backends alone", () => {
		expect(
			removedPushBackendIds({ alpha: legacy, beta: scoped, gamma: legacy }, [
				{ id: "alpha", url: legacy.origin },
				{ id: "gamma", url: "https://replacement.example.test" },
			]),
		).toEqual(["beta", "gamma"]);
	});
	test("scopes are opaque, stable, independent by ID and origin", async () => {
		const scope = await backendPushScope("alpha", legacy.origin);
		expect(scope).toMatch(/^\/push\/[a-f0-9]{64}\/$/);
		expect(await backendPushScope("alpha", legacy.origin)).toBe(scope);
		expect(await backendPushScope("beta", legacy.origin)).not.toBe(scope);
		expect(await backendPushScope("alpha", "https://beta.example.test")).not.toBe(scope);
	});
	test("persisted metadata rejects corrupt records instead of silently re-subscribing", () => {
		expect(loadPushSubscriptions({ getItem: () => JSON.stringify({ alpha: legacy, beta: scoped }) })).toEqual({
			alpha: legacy,
			beta: scoped,
		});
		expect(() => loadPushSubscriptions({ getItem: () => "{broken" })).toThrow();
		expect(() =>
			loadPushSubscriptions({ getItem: () => JSON.stringify({ alpha: { ...legacy, scope: "/unrelated/" } }) }),
		).toThrow();
	});
});
