import { expect, test } from "bun:test";
import type { ReleaseUpdateState } from "@kemiri/protocol";
import { UPDATE_INSTRUCTIONS, visibleReleaseUpdate } from "../src/lib/release-updates.ts";

const updates: ReleaseUpdateState = { schemaVersion: 1, enabled: true, installedVersion: "v0.1.0-pilot.1", channel: "pilot", available: { version: "v0.1.0-pilot.2", notesUrl: "https://github.com/MitzaCoder/aiki/releases/tag/v0.1.0-pilot.2" }, dismissedVersion: null };
test("only an enabled, known, newer, undismissed release shows a banner", () => {
	expect(visibleReleaseUpdate(undefined)).toBe(false);
	expect(visibleReleaseUpdate({ ...updates, enabled: false })).toBe(false);
	expect(visibleReleaseUpdate({ ...updates, available: null })).toBe(false);
	expect(visibleReleaseUpdate({ ...updates, dismissedVersion: updates.available!.version })).toBe(false);
	expect(visibleReleaseUpdate({ ...updates, dismissedVersion: "v0.1.0-pilot.1" })).toBe(true);
	expect(visibleReleaseUpdate(updates)).toBe(true);
	expect(UPDATE_INSTRUCTIONS).toBe("Stop Kemiri, then kemiri update, then start it.");
});
