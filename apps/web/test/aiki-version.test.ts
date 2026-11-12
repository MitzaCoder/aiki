import { expect, test } from "bun:test";
import type { ReleaseUpdateState, ServerStatus } from "@aiki/protocol";
import { aikiVersionLabel, backendVersion, versionBackend, versionLabel } from "../src/lib/aiki-version.ts";

const updates: ReleaseUpdateState = { schemaVersion: 1, enabled: true, installedVersion: "v0.1.0-pilot.2", channel: "pilot", available: null, dismissedVersion: null };
const source: ServerStatus = { release: null, deploy: null, busy: { conversations: 0, workers: 0 }, startedAt: "2026-01-01T00:00:00Z" };
const installed = { ...source, updates };

test("backend identity uses installed metadata, then release tag/commit, source dev, then legacy hello", () => {
	expect(backendVersion("0.1.0-pilot.1", installed)).toBe("v0.1.0-pilot.2");
	const release = { name: "v0.1.0-pilot.2", commit: "abcdef123456", description: "Synthetic release", deployedAt: source.startedAt };
	expect(backendVersion("old", { ...source, release })).toBe("v0.1.0-pilot.2");
	expect(backendVersion("old", { ...source, release: { ...release, name: "checkout" } })).toBe("abcdef1");
	expect(backendVersion("0.1.0-pilot.2", source)).toBe("dev");
	expect(backendVersion("0.1.0-pilot.1")).toBe("v0.1.0-pilot.1");
	expect(backendVersion()).toBeUndefined();
	for (const value of ["dev", "abcdef1", "v0.1.0-pilot.2"]) expect(versionLabel(value)).toBe(value);
});

test("up-to-date label omits a matching web build, shows a differing build without pretending it is the backend", () => {
	expect(aikiVersionLabel("old", installed, "0.1.0-pilot.2")).toBe("Aiki v0.1.0-pilot.2");
	expect(aikiVersionLabel("old", installed, "0.1.0-pilot.1")).toBe("Aiki v0.1.0-pilot.2 · web v0.1.0-pilot.1");
	expect(aikiVersionLabel(undefined, undefined, "0.1.0-pilot.2")).toBe("Aiki · web v0.1.0-pilot.2");
	expect(aikiVersionLabel("old", source, "0.1.0-pilot.2")).toBe("Aiki dev · web v0.1.0-pilot.2");
});

test("update announcement respects disabled checks, version dismissal, schema and later updates", () => {
	const available = { version: "v0.1.0-pilot.3", notesUrl: "https://example.test/releases/v0.1.0-pilot.3" };
	const state = { ...updates, available };
	const label = (changes: Partial<ReleaseUpdateState> = {}) => aikiVersionLabel("old", { ...source, updates: { ...state, ...changes } }, "0.1.0-pilot.2");
	expect(label()).toBe("Aiki v0.1.0-pilot.2 → v0.1.0-pilot.3 available");
	for (const changes of [{ enabled: false }, { dismissedVersion: available.version }, { available: null }]) expect(label(changes)).toBe("Aiki v0.1.0-pilot.2");
	expect(label({ dismissedVersion: "v0.1.0-pilot.1" })).toContain("→ v0.1.0-pilot.3 available");
	expect(label({ schemaVersion: 2 as 1 })).not.toContain("available");
});

test("project backend wins even offline; home chooses first ready then configured backend", () => {
	const backends = [{ id: "one", ready: false }, { id: "two", ready: true }];
	expect(versionBackend(backends, "one")).toBe(backends[0]);
	expect(versionBackend(backends)).toBe(backends[1]);
	expect(versionBackend([backends[0]!])).toBe(backends[0]);
	expect(versionBackend([])).toBeUndefined();
});
