import { describe, expect, test } from "bun:test";
import {
	GENERAL_SECTIONS,
	PROJECT_SECTIONS,
	backendSettingsHref,
	generalSettingsHref,
	projectSectionAvailable,
	projectSettingsHref,
	settingsLocation,
	settingsParentHref,
} from "../src/lib/settings.ts";

describe("settings routes", () => {
	test("every section has a URL of its own", () => {
		expect(generalSettingsHref()).toBe("/settings");
		expect(generalSettingsHref("notifications")).toBe("/settings/notifications");
		expect(backendSettingsHref("harness-pc")).toBe("/settings/backends/harness-pc");
		expect(backendSettingsHref("harness-pc", "accounts")).toBe("/settings/backends/harness-pc/accounts");
		expect(projectSettingsHref("pc", "demo")).toBe("/b/pc/projects/demo/settings");
		expect(projectSettingsHref("pc", "demo", "schedules")).toBe("/b/pc/projects/demo/settings/schedules");
		expect(new Set(GENERAL_SECTIONS.map((s) => s.id)).size).toBe(GENERAL_SECTIONS.length);
		expect(new Set(PROJECT_SECTIONS.map((s) => s.id)).size).toBe(PROJECT_SECTIONS.length);
	});

	test("reads a general path", () => {
		expect(settingsLocation("/settings")).toEqual({ scope: "general", section: undefined, parts: [] });
		expect(settingsLocation("/settings/appearance")).toEqual({ scope: "general", section: "appearance", parts: [] });
		expect(settingsLocation("/settings/backends/a%20b/accounts")).toEqual({
			scope: "general",
			section: "backends",
			parts: ["a%20b", "accounts"],
		});
		expect(settingsLocation("/settings/nonsense")?.section).toBeUndefined();
	});

	test("reads a project path, decoding the IDs", () => {
		expect(settingsLocation("/b/pc/projects/demo/settings")).toEqual({
			scope: "project",
			backendId: "pc",
			projectId: "demo",
			section: undefined,
			parts: [],
		});
		const found = settingsLocation("/b/a%2Fb/projects/c%20d/settings/coordinator");
		expect(found).toMatchObject({ scope: "project", backendId: "a/b", projectId: "c d", section: "coordinator" });
	});

	test("anything else is not settings", () => {
		expect(settingsLocation("/")).toBeUndefined();
		expect(settingsLocation("/notifications")).toBeUndefined();
		expect(settingsLocation("/b/pc/projects/demo")).toBeUndefined();
		expect(settingsLocation("/b/pc/projects/demo/workers/w1")).toBeUndefined();
	});

	test("the back button goes one level up", () => {
		expect(settingsParentHref("/settings")).toBeUndefined();
		expect(settingsParentHref("/settings/appearance")).toBe("/settings");
		expect(settingsParentHref("/settings/backends")).toBe("/settings");
		expect(settingsParentHref("/settings/backends/pc")).toBe("/settings/backends");
		expect(settingsParentHref("/settings/backends/pc/accounts")).toBe("/settings/backends/pc");
		expect(settingsParentHref("/b/pc/projects/demo/settings")).toBeUndefined();
		expect(settingsParentHref("/b/pc/projects/demo/settings/storage")).toBe("/b/pc/projects/demo/settings");
		expect(settingsParentHref("/b/pc/projects/demo")).toBeUndefined();
	});

	test("a project's sections follow what the backend offers", () => {
		const all = { supports: () => true, links: true, longPromptCache: true };
		for (const section of PROJECT_SECTIONS) expect(projectSectionAvailable(section.id, all)).toBe(true);
		const bare = { supports: () => false, links: false, longPromptCache: false };
		expect(PROJECT_SECTIONS.filter((s) => projectSectionAvailable(s.id, bare)).map((s) => s.id)).toEqual(["general"]);
		const noStorage = { ...all, supports: (feature: string) => feature !== "storage" };
		expect(projectSectionAvailable("storage", noStorage)).toBe(false);
		expect(projectSectionAvailable("cache", noStorage)).toBe(true);
	});
});
