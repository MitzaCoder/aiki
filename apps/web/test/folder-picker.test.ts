import { describe, expect, test } from "bun:test";
import type { DirectoryEntry } from "@aiki/protocol";
import {
	completeInput,
	deleteConfirmation,
	expandHome,
	filterEntries,
	FOLDER_PICKER_STORAGE_KEY,
	isPathInput,
	keyAction,
	modifiedText,
	quickPlaces,
	readPickerMemory,
	RECENT_PICKS_LIMIT,
	repoLabel,
	rowActions,
	shortPath,
	sortEntries,
	withLastFolder,
	withoutFolder,
	withRecentPick,
	writePickerMemory,
} from "../src/lib/folder-picker.ts";

function entry(name: string, extra: Partial<DirectoryEntry> = {}): DirectoryEntry {
	return { name, path: `/h/${name}`, isRepo: false, ...extra };
}

describe("sortEntries and filterEntries", () => {
	test("repos first, then by name, numbers by value and case ignored", () => {
		const sorted = sortEntries([
			entry("zeta"),
			entry("Beta"),
			entry("app10", { isRepo: true, repoKind: "git" }),
			entry("app2", { isRepo: true, repoKind: "jj" }),
			entry("alpha"),
		]);
		expect(sorted.map((item) => item.name)).toEqual(["app2", "app10", "alpha", "Beta", "zeta"]);
	});

	test("does not change its input", () => {
		const input = [entry("b"), entry("a")];
		sortEntries(input);
		expect(input.map((item) => item.name)).toEqual(["b", "a"]);
	});

	test("filter matches anywhere in the name, ignoring case, keeping order", () => {
		const entries = [entry("alpha"), entry("Project-X"), entry("my-project"), entry("zeta")];
		expect(filterEntries(entries, "PROJ").map((item) => item.name)).toEqual(["Project-X", "my-project"]);
		expect(filterEntries(entries, "  ").map((item) => item.name)).toHaveLength(4);
		expect(filterEntries(entries, "nothing")).toEqual([]);
	});
});

describe("typed paths", () => {
	test("a path starts with / or ~, anything else filters", () => {
		expect(isPathInput("/home/me")).toBe(true);
		expect(isPathInput("~")).toBe(true);
		expect(isPathInput("~/code")).toBe(true);
		expect(isPathInput("  /srv")).toBe(true);
		expect(isPathInput("~other")).toBe(false);
		expect(isPathInput("proj")).toBe(false);
		expect(isPathInput("")).toBe(false);
	});

	test("~ expands to the home directory, everything else stays", () => {
		expect(expandHome("~", "/home/me")).toBe("/home/me");
		expect(expandHome("~/code/x", "/home/me")).toBe("/home/me/code/x");
		expect(expandHome("~/", "/home/me/")).toBe("/home/me/");
		expect(expandHome(" /srv/app ", "/home/me")).toBe("/srv/app");
	});

	test("short paths write home as ~", () => {
		expect(shortPath("/home/me", "/home/me")).toBe("~");
		expect(shortPath("/home/me/code", "/home/me")).toBe("~/code");
		expect(shortPath("/home/meme/code", "/home/me")).toBe("/home/meme/code");
		expect(shortPath("/srv", "/home/me")).toBe("/srv");
	});

	test("Tab completes the shared prefix, or the only match with a slash", () => {
		const names = (...list: string[]) => list.map((name) => entry(name));
		expect(completeInput("/h/pr", names("project-a", "project-b"))).toBe("/h/project-");
		expect(completeInput("/h/project-", names("project-a", "project-b"))).toBe("/h/project-");
		expect(completeInput("/h/al", names("alpha"))).toBe("/h/alpha/");
		expect(completeInput("~/", names("alpha", "beta"))).toBe("~/");
		expect(completeInput("/h/zz", [])).toBe("/h/zz");
	});
});

describe("rows", () => {
	test("repo labels", () => {
		expect(repoLabel(entry("a"))).toBeNull();
		expect(repoLabel(entry("a", { isRepo: true, repoKind: "jj" }))).toBe("jj");
		expect(repoLabel(entry("a", { isRepo: true, repoKind: "git" }))).toBe("git");
		expect(repoLabel(entry("a", { isRepo: true }))).toBe("repo");
	});

	test("modified time is short, with the full phrase as a title; empty for an older backend", () => {
		const now = Date.parse("2026-11-08T12:00:00.000Z");
		expect(modifiedText(entry("a", { modifiedAt: "2026-11-08T09:00:00.000Z" }), now)).toEqual({
			short: "3h",
			title: "Modified 3 h ago",
		});
		expect(modifiedText(entry("a"), now)).toEqual({ short: "", title: "" });
		expect(modifiedText(entry("a", { modifiedAt: "garbage" }), now)).toEqual({ short: "", title: "" });
	});

	test("actions: hidden without edit, disabled with a reason for a project", () => {
		expect(rowActions(entry("a"), false).available).toBe(false);
		const plain = rowActions(entry("a"), true);
		expect(plain.available && plain.rename.enabled && plain.delete.enabled).toBe(true);
		const project = rowActions(entry("a", { projectId: "p1" }), true);
		expect(project.available).toBe(true);
		expect(project.rename.enabled).toBe(false);
		expect(project.delete.reason).toContain("project");
	});

	test("the delete dialog names the folder and says only empty folders go", () => {
		const text = deleteConfirmation(entry("old"));
		expect(text.title).toContain("old");
		expect(text.message).toContain("empty");
	});
});

describe("keyAction", () => {
	const field = (text: string, rows = 3) => ({ focus: "field" as const, text, rows, index: -1 });
	const row = (index: number, rows = 3) => ({ focus: "row" as const, text: "", rows, index });

	test("arrows move between the field and the rows and stop at the ends", () => {
		expect(keyAction("ArrowDown", field(""))).toEqual({ kind: "focus-row", index: 0 });
		expect(keyAction("ArrowDown", field("", 0))).toEqual({ kind: "none" });
		expect(keyAction("ArrowDown", row(0))).toEqual({ kind: "focus-row", index: 1 });
		expect(keyAction("ArrowDown", row(2))).toEqual({ kind: "focus-row", index: 2 });
		expect(keyAction("ArrowUp", row(2))).toEqual({ kind: "focus-row", index: 1 });
		expect(keyAction("ArrowUp", row(0))).toEqual({ kind: "focus-field" });
		expect(keyAction("ArrowUp", field(""))).toEqual({ kind: "none" });
		expect(keyAction("End", row(0))).toEqual({ kind: "focus-row", index: 2 });
		expect(keyAction("Home", row(2))).toEqual({ kind: "focus-row", index: 0 });
	});

	test("Backspace goes up from an empty field or a row, never from a field with text", () => {
		expect(keyAction("Backspace", field(""))).toEqual({ kind: "go-up" });
		expect(keyAction("Backspace", field("ab"))).toEqual({ kind: "none" });
		expect(keyAction("Backspace", row(1))).toEqual({ kind: "go-up" });
	});

	test("Escape clears the text first and only then closes", () => {
		expect(keyAction("Escape", field("ab"))).toEqual({ kind: "clear" });
		expect(keyAction("Escape", field(""))).toEqual({ kind: "close" });
		expect(keyAction("Escape", row(0))).toEqual({ kind: "close" });
		expect(keyAction("x", field(""))).toEqual({ kind: "none" });
	});
});

describe("quickPlaces", () => {
	test("home, then project parents deduped and sorted, then recent picks, each path once", () => {
		const places = quickPlaces({
			home: "/home/me",
			projectPaths: ["/home/me/code/b", "/home/me/code/a", "/srv/apps/x", "/home/me/solo", "/top"],
			recent: ["/home/me/code", "/home/me/other", "/home/me"],
		});
		expect(places).toEqual([
			{ label: "Home", path: "/home/me", kind: "home" },
			{ label: "/", path: "/", kind: "project-parent" },
			{ label: "~/code", path: "/home/me/code", kind: "project-parent" },
			{ label: "/srv/apps", path: "/srv/apps", kind: "project-parent" },
			{ label: "~/other", path: "/home/me/other", kind: "recent" },
		]);
	});

	test("only home without projects or picks", () => {
		expect(quickPlaces({ home: "/h", projectPaths: [], recent: [] })).toEqual([{ label: "Home", path: "/h", kind: "home" }]);
	});
});

describe("remembered folders", () => {
	test("last folder and recent picks are per backend; recent is newest first, deduped and capped", () => {
		let memory = withLastFolder({}, "a", "/x");
		memory = withLastFolder(memory, "b", "/y");
		for (let index = 0; index < RECENT_PICKS_LIMIT + 3; index++) memory = withRecentPick(memory, "a", `/p${index}`);
		memory = withRecentPick(memory, "a", "/p5");
		expect(memory.a?.last).toBe("/x");
		expect(memory.b).toEqual({ last: "/y", recent: [] });
		expect(memory.a?.recent).toHaveLength(RECENT_PICKS_LIMIT);
		expect(memory.a?.recent[0]).toBe("/p5");
		expect(memory.a?.recent.filter((path) => path === "/p5")).toHaveLength(1);
	});

	test("a vanished folder is forgotten", () => {
		let memory = withRecentPick(withLastFolder({}, "a", "/gone"), "a", "/gone");
		memory = withRecentPick(memory, "a", "/kept");
		const next = withoutFolder(memory, "a", "/gone");
		expect(next.a).toEqual({ recent: ["/kept"] });
		expect(withoutFolder(memory, "zzz", "/gone")).toBe(memory);
	});

	test("round-trips through storage and survives damage", () => {
		const store = new Map<string, string>();
		const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value) };
		const memory = withRecentPick(withLastFolder({}, "a", "/x"), "a", "/y");
		writePickerMemory(memory, storage);
		expect(readPickerMemory(storage)).toEqual(memory);

		store.set(FOLDER_PICKER_STORAGE_KEY, "not json");
		expect(readPickerMemory(storage)).toEqual({});
		store.set(FOLDER_PICKER_STORAGE_KEY, JSON.stringify({ a: { last: 5, recent: ["relative", "/ok", 3] }, b: 7, c: [] }));
		expect(readPickerMemory(storage)).toEqual({ a: { recent: ["/ok"] }, c: { recent: [] } });
		expect(readPickerMemory(undefined)).toEqual({});
	});
});
