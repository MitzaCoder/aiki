/**
 * How a backend's connection reads: the badge's words and tone, and the dot's colour.
 * The badge component and the projects sidebar's rail both read these.
 */
import { describe, expect, test } from "bun:test";
import { connectionBadgeClass, connectionDotClass, connectionView } from "../src/lib/connection.ts";

describe("connection view", () => {
	test("names each state and its tone", () => {
		expect(connectionView({ status: "ready", attempt: 0 })).toEqual({
			label: "Connected",
			tone: "ok",
			title: undefined,
		});
		expect(connectionView({ status: "connecting", attempt: 0 })).toMatchObject({ label: "Connecting…", tone: "warn" });
		expect(connectionView({ status: "closed", attempt: 0 })).toMatchObject({ label: "Offline", tone: "err" });
		expect(connectionView({ status: "idle", attempt: 0 })).toMatchObject({ label: "Starting…", tone: "muted" });
	});

	test("counts reconnect attempts so a stuck backend is visible", () => {
		expect(connectionView({ status: "reconnecting", attempt: 0 }).label).toBe("Reconnecting…");
		expect(connectionView({ status: "reconnecting", attempt: 3 }).label).toBe("Reconnecting (3)…");
	});

	test("the tooltip prefers what went wrong over the server's name", () => {
		expect(connectionView({ status: "closed", attempt: 0, error: "Connection refused" }).title).toBe(
			"Connection refused",
		);
		expect(
			connectionView({ status: "ready", attempt: 0, server: { name: "aiki", version: "0.1.0" } }).title,
		).toBe("aiki");
	});

	test("every tone has a badge and a dot", () => {
		expect(connectionBadgeClass("ok")).toContain("emerald");
		expect(connectionBadgeClass("warn")).toContain("amber");
		expect(connectionBadgeClass("err")).toContain("destructive");
		expect(connectionBadgeClass("muted")).toContain("muted-foreground");
		expect(connectionDotClass("ok")).toContain("emerald");
		expect(connectionDotClass("warn")).toContain("amber");
		expect(connectionDotClass("err")).toContain("destructive");
		expect(connectionDotClass("muted")).toContain("muted-foreground");
	});
});
