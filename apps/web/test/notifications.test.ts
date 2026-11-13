/**
 * How notifications read: each kind's words, what a backend's card says in every state, the push service's answer, and
 * which project a route is looking at. The page and the service worker follow these, so they are pinned here.
 */
import { describe, expect, test } from "bun:test";
import { DEFAULT_NOTIFICATION_KINDS, NOTIFICATION_FAILURE_KINDS, type NotificationDevice } from "@kemiri/protocol";
import { NOTIFICATION_KINDS } from "@kemiri/client";
import {
	DEFAULT_KIND_INFO,
	NOTIFICATION_KIND_INFO,
	backendNotificationView,
	kindIsFailure,
	kindsSummary,
	lastDeliveryText,
	presenceFor,
	presenceProjectId,
	pushSubscriptionError,
	quietHoursDraft,
	quietHoursProblem,
	testNotificationText,
	type BackendNotificationFacts,
} from "../src/lib/notifications.ts";

function facts(overrides: Partial<BackendNotificationFacts> = {}): BackendNotificationFacts {
	return {
		supportsFeature: true,
		permission: "granted",
		subscribed: true,
		device: device(),
		keyMismatch: false,
		...overrides,
	};
}

function device(overrides: Partial<NotificationDevice> = {}): NotificationDevice {
	return {
		deviceId: "device-1",
		label: "Pixel · Chrome",
		backendKey: "harness-pc",
		preferences: { kinds: [...DEFAULT_NOTIFICATION_KINDS], mutedProjects: [], quietHours: null },
		createdAt: "2026-11-06T07:00:00.000Z",
		lastDelivery: null,
		...overrides,
	};
}

describe("push subscription errors", () => {
	test("explains the Brave setting for a push-service AbortError and keeps the raw detail", () => {
		const error = new DOMException("Registration failed - push service error", "AbortError");
		expect(pushSubscriptionError(error)).toEqual({
			message:
				"The browser's push service refused. In Brave, turn on Use Google services for push messaging under Settings → Privacy and security, restart the browser, then try again.",
			detail: error.message,
		});
	});

	test("leaves an AbortError with other text unchanged", () => {
		expect(
			pushSubscriptionError(new DOMException("Registration failed - no active Service Worker", "AbortError")),
		).toEqual({ message: "Registration failed - no active Service Worker" });
	});

	test("leaves permission denied unchanged", () => {
		expect(pushSubscriptionError(new DOMException("Permission denied", "NotAllowedError"))).toEqual({
			message: "Permission denied",
		});
	});

	test("leaves an unrelated error unchanged, even with the same message", () => {
		expect(pushSubscriptionError(new Error("Registration failed - push service error"))).toEqual({
			message: "Registration failed - push service error",
		});
		expect(pushSubscriptionError(new Error("Network unavailable"))).toEqual({ message: "Network unavailable" });
	});
});

describe("notification kinds", () => {
	test("describes every kind the protocol has", () => {
		expect(NOTIFICATION_KIND_INFO.map((info) => info.kind)).toEqual([...NOTIFICATION_KINDS]);
		for (const info of NOTIFICATION_KIND_INFO) {
			expect(info.label.length).toBeGreaterThan(0);
			expect(info.description.length).toBeGreaterThan(0);
		}
	});

	test("marks exactly the protocol's failure kinds", () => {
		for (const info of NOTIFICATION_KIND_INFO) {
			expect(kindIsFailure(info.kind)).toBe((NOTIFICATION_FAILURE_KINDS as readonly string[]).includes(info.kind));
			expect(info.failure).toBe(kindIsFailure(info.kind));
		}
	});

	test("starts with the protocol's defaults", () => {
		expect(DEFAULT_KIND_INFO.map((info) => info.kind)).toEqual([...DEFAULT_NOTIFICATION_KINDS]);
	});
});

describe("one backend's status", () => {
	test("registered, with its last delivery", () => {
		const view = backendNotificationView(
			facts({
				device: device({
					lastDelivery: { at: "2026-11-06T07:00:00.000Z", ok: true, status: 201, message: null },
				}),
			}),
		);
		expect(view.status).toBe("registered");
		expect(view.tone).toBe("ok");
		expect(view.detail).toContain("accepted");
	});

	test("no feature, blocked, unsupported, key mismatch and failed each explain themselves", () => {
		expect(backendNotificationView(facts({ supportsFeature: false })).status).toBe("no-feature");
		expect(backendNotificationView(facts({ permission: "denied" })).status).toBe("denied");
		expect(backendNotificationView(facts({ permission: "unsupported" })).status).toBe("unsupported");
		expect(backendNotificationView(facts({ keyMismatch: true })).status).toBe("key-mismatch");
		expect(backendNotificationView(facts({ legacy: true })).label).toBe("On (shared subscription)");
		expect(backendNotificationView(facts({ syncNeeded: true })).status).toBe("sync-needed");
		expect(backendNotificationView(facts({ unavailableReason: "Sign in first." })).detail).toBe("Sign in first.");
		const failed = backendNotificationView(facts({ error: "Request failed" }));
		expect(failed.status).toBe("failed");
		expect(failed.detail).toBe("Request failed");
	});

	test("uses plain labels and short repair reasons", () => {
		expect(backendNotificationView(facts()).label).toBe("On (own subscription)");
		const changedKey = backendNotificationView(facts({ keyMismatch: true }));
		expect(changedKey.label).toBe("Needs re-subscribe");
		expect(changedKey.detail).toBe("This backend's push key changed.");
		const changedSubscription = backendNotificationView(facts({ syncNeeded: true }));
		expect(changedSubscription.label).toBe("Needs sync");
		expect(changedSubscription.detail).toBe("Reopen the app while signed in.");
		for (const overrides of [
			{},
			{ legacy: true },
			{ keyMismatch: true },
			{ syncNeeded: true },
			{ supportsFeature: false },
			{ permission: "unsupported" as const },
			{ error: "Connection failed." },
		]) {
			const view = backendNotificationView(facts(overrides));
			expect(`${view.label} ${view.detail}`).not.toMatch(/\blegacy\b|\bVAPID\b|\bscope\b/i);
		}
		expect(backendNotificationView(facts({ error: "Connection failed." })).label).toBe("Unavailable");
	});

	test("off and not registered are different states", () => {
		expect(backendNotificationView(facts({ subscribed: false, device: null })).status).toBe("off");
		const pending = backendNotificationView(facts({ device: null }));
		expect(pending.status).toBe("not-registered");
		expect(pending.tone).toBe("warn");
	});
});

describe("what was delivered", () => {
	test("says when the last push went and how it was answered", () => {
		expect(lastDeliveryText(device())).toContain("nothing pushed yet");
		const accepted = lastDeliveryText(
			device({ lastDelivery: { at: "2026-11-06T07:00:00.000Z", ok: true, status: 201, message: null } }),
		);
		expect(accepted).toContain("accepted");
		expect(accepted).toContain("201");
		const refused = lastDeliveryText(
			device({ lastDelivery: { at: "2026-11-06T07:00:00.000Z", ok: false, status: 410, message: "Gone" } }),
		);
		expect(refused).toContain("failed");
		expect(refused).toContain("410");
		expect(refused).toContain("Gone");
	});
});

describe("the push service's answer", () => {
	test("reads accepted, gone and refused", () => {
		expect(testNotificationText({ ok: true, status: 201, message: null })).toContain("accepted");
		expect(testNotificationText({ ok: false, status: 410, message: "Gone" })).toContain("no longer knows");
		expect(testNotificationText({ ok: false, status: 500, message: "Server error" })).toContain("refused");
		expect(testNotificationText({ ok: false, status: null, message: null })).toContain("refused");
	});
});

describe("presence", () => {
	test("names the project of the route, including a worker and the settings", () => {
		expect(presenceProjectId("/b/harness-pc/projects/project-1")).toBe("project-1");
		expect(presenceProjectId("/b/harness-pc/projects/project-1/workers/nightly-1")).toBe("project-1");
		expect(presenceProjectId("/b/harness-pc/projects/project-1/settings")).toBe("project-1");
		expect(presenceProjectId("/b/harness-pc/projects/a%20b")).toBe("a b");
	});

	test("has no project on the other routes", () => {
		for (const pathname of ["/", "/notifications", "/connect", "/b/harness-pc"]) {
			expect(presenceProjectId(pathname)).toBeNull();
		}
	});

	test("carries the page's visibility", () => {
		expect(presenceFor("/b/p/projects/one", true)).toEqual({ visible: true, projectId: "one" });
		expect(presenceFor("/notifications", false)).toEqual({ visible: false, projectId: null });
	});
});

describe("quiet hours", () => {
	test("starts a toggle from a sensible window in the device's zone", () => {
		expect(quietHoursDraft({ quietHours: null }, "Europe/Bucharest")).toEqual({
			start: "22:00",
			end: "07:00",
			timezone: "Europe/Bucharest",
			allowFailures: true,
		});
		const stored = { start: "23:30", end: "06:00", timezone: "Europe/Bucharest", allowFailures: false };
		expect(quietHoursDraft({ quietHours: stored }, "UTC")).toEqual(stored);
	});

	test("refuses a draft that would be unusable", () => {
		const base = { start: "22:00", end: "07:00", timezone: "Europe/Bucharest", allowFailures: true };
		expect(quietHoursProblem(base)).toBeUndefined();
		expect(quietHoursProblem({ ...base, start: "9:00" })).toContain("22:00");
		expect(quietHoursProblem({ ...base, end: "22:00" })).toContain("same");
		expect(quietHoursProblem({ ...base, timezone: " " })).toContain("timezone");
	});
});

describe("the kinds summary", () => {
	test("counts what is on", () => {
		expect(kindsSummary({ kinds: [] })).toBe("No events");
		expect(kindsSummary({ kinds: [...NOTIFICATION_KINDS] })).toBe("Every event");
		expect(kindsSummary({ kinds: ["reply", "worker_failed"] })).toBe(`2 of ${NOTIFICATION_KINDS.length} events`);
	});
});
