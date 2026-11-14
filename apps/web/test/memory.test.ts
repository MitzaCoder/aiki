import { beforeEach, afterEach } from 'bun:test';
import { setTimeFormat } from '../src/lib/time-format.ts';
beforeEach(() => setTimeFormat('24-hour'));
afterEach(() => setTimeFormat('automatic'));
/**
 * How the Memory tab reads a scope's files, search hits, history and front matter: the scope targets,
 * the archived toggle, the snippet runs, the links across scopes and the source sentence. Pure
 * functions, tested here; the panel only lays them out.
 */
import { describe, expect, test } from "bun:test";
import { ClientError } from "@kemiri/client";
import type {
	MemoryChange,
	MemoryFileSummary,
	MemoryMaintenanceSettings,
	MemoryScopeStatus,
	MemorySearchHit,
	ModelInfo,
} from "@kemiri/protocol";
import {
	DEFAULT_MEMORY_MAINTENANCE,
	DEFAULT_MEMORY_SCOPE,
	MEMORY_SCOPES,
	MEMORY_SCOPE_STORAGE_KEY,
	loadMemoryScope,
	maintenanceThinkingLevels,
	memoryChangeCompactionEntry,
	memoryChangeKindLabel,
	memoryChangeRows,
	memoryChangeUndoable,
	memoryChangeUndone,
	memoryExtractionFor,
	memoryFileRows,
	memoryLinkTarget,
	memoryLinkViews,
	memoryMaintenanceOff,
	memoryMaintenanceSummary,
	memoryMessageParts,
	memoryScopeLabel,
	memorySearchHeading,
	memorySearchRows,
	memorySearchTerm,
	memorySourceView,
	memoryStatusLabel,
	memoryStatusView,
	memoryTarget,
	memoryTopics,
	memoryUndoErrorText,
	parseAfterWrites,
	parseMemoryScope,
	parseNightlyTime,
	saveMemoryScope,
	splitMemoryFiles,
} from "../src/lib/memory.ts";

const now = Date.parse("2026-11-04T19:00:00Z");

function summary(overrides: Partial<MemoryFileSummary> = {}): MemoryFileSummary {
	return {
		scope: "global",
		fileId: "testing",
		title: "Testing",
		summary: "How this user tests.",
		tags: ["testing", "bun"],
		links: [],
		status: "active",
		supersededBy: null,
		headings: ["Unit tests"],
		created: "2026-11-01T09:00:00Z",
		updated: "2026-11-04T18:30:00Z",
		source: { projectId: "project-1", conversationId: 4, entryId: 12 },
		...overrides,
	};
}

function hit(overrides: Partial<MemorySearchHit> = {}): MemorySearchHit {
	return {
		scope: "global",
		fileId: "testing",
		title: "Testing",
		heading: "Unit tests",
		snippet: "Bun only. \u0002run\u0003 them with \u0002bun test\u0003.",
		rank: -1.5,
		...overrides,
	};
}

function change(overrides: Partial<MemoryChange> = {}): MemoryChange {
	return {
		commit: "be84355c5bed5b9bcb2f0a8e4f4b9a0f2f6c1d2e",
		message: "memory: add the testing topic\n\nFrom the review conversation.",
		at: "2026-11-04T18:30:00Z",
		files: ["testing"],
		...overrides,
	};
}

describe("scopes", () => {
	test("shows the global scope before the project's", () => {
		expect(MEMORY_SCOPES).toEqual(["global", "project"]);
		expect(memoryScopeLabel("global")).toBe("Global");
		expect(memoryScopeLabel("project")).toBe("Project");
	});

	test("opens on the project's scope until the reader picks another", () => {
		expect(DEFAULT_MEMORY_SCOPE).toBe("project");
	});

	test("addresses a project only for the project scope", () => {
		expect(memoryTarget("global", "project-1")).toEqual({ scope: "global" });
		expect(memoryTarget("project", "project-1")).toEqual({ scope: "project", projectId: "project-1" });
	});

	test("labels a file's status, archived and superseded included", () => {
		expect(memoryStatusLabel("active")).toBe("Active");
		expect(memoryStatusLabel("superseded")).toBe("Superseded");
		expect(memoryStatusLabel("archived")).toBe("Archived");
	});
});

describe("memoryFileRows", () => {
	test("reads a file as a row: when it changed, whether it is archived, its tags", () => {
		expect(memoryFileRows([summary()], now)).toEqual([
			{
				file: summary(),
				archived: false,
				updated: "30 min ago",
				updatedTitle: expect.any(String),
				tags: ["testing", "bun"],
			},
		]);
	});

	test("puts the most recently updated first, then by title", () => {
		const older = summary({ fileId: "deploy", title: "Deploy", updated: "2026-11-02T09:00:00Z" });
		const sameTimeB = summary({ fileId: "b", title: "Beta", updated: "2026-11-03T09:00:00Z" });
		const sameTimeA = summary({ fileId: "a", title: "Alpha", updated: "2026-11-03T09:00:00Z" });
		expect(memoryFileRows([older, sameTimeB, summary(), sameTimeA], now).map((row) => row.file.title)).toEqual([
			"Testing",
			"Alpha",
			"Beta",
			"Deploy",
		]);
	});

	test("keeps an unreadable timestamp last instead of throwing", () => {
		const broken = summary({ fileId: "broken", title: "Broken", updated: "not a time" });
		expect(memoryFileRows([broken, summary()], now).map((row) => row.file.title)).toEqual(["Testing", "Broken"]);
	});

	test("does not reorder the array it was given", () => {
		const files = [summary({ title: "Old", updated: "2026-11-01T09:00:00Z" }), summary()];
		memoryFileRows(files, now);
		expect(files.map((file) => file.title)).toEqual(["Old", "Testing"]);
	});
});

describe("splitMemoryFiles", () => {
	const active = summary({ fileId: "testing", title: "Testing" });
	const archived = summary({
		fileId: "old-notes",
		title: "Old notes",
		status: "archived",
		updated: "2026-11-01T09:00:00Z",
	});
	const superseded = summary({
		fileId: "old-deploy",
		title: "Old deploy",
		status: "superseded",
		updated: "2026-11-03T09:00:00Z",
	});

	test("hides archived files until the toggle asks for them", () => {
		const hidden = splitMemoryFiles([active, archived, superseded], false, now);
		expect(hidden.shown.map((row) => row.file.fileId)).toEqual(["testing", "old-deploy"]);
		expect(hidden.active).toBe(2);
		expect(hidden.archived).toBe(1);

		const shown = splitMemoryFiles([active, archived, superseded], true, now);
		expect(shown.shown.map((row) => row.file.fileId)).toEqual(["testing", "old-deploy", "old-notes"]);
	});

	test("counts archived files the toggle would hide, so the label knows the number", () => {
		expect(splitMemoryFiles([], false, now)).toEqual({ shown: [], active: 0, archived: 0 });
	});
});

describe("search", () => {
	test("names a hit's section, and a match in the file's introduction", () => {
		expect(memorySearchHeading("Unit tests")).toBe("Unit tests");
		expect(memorySearchHeading(null)).toBe("Introduction");
		expect(memorySearchHeading("   ")).toBe("Introduction");
	});

	test("labels a hit with the scope it came from, because a search covers both", () => {
		const rows = memorySearchRows([hit(), hit({ scope: "project", fileId: "deploy" })]);
		expect(rows.map((row) => row.scopeLabel)).toEqual(["Global", "Project"]);
	});

	test("splits a hit's snippet into plain and matched runs for highlighting", () => {
		const row = memorySearchRows([hit()])[0];
		expect(row?.heading).toBe("Unit tests");
		expect(row?.parts).toEqual([
			{ text: "Bun only. ", match: false },
			{ text: "run", match: true },
			{ text: " them with ", match: false },
			{ text: "bun test", match: true },
			{ text: ".", match: false },
		]);
	});

	test("keeps the server's ranking", () => {
		expect(memorySearchRows([hit({ fileId: "a" }), hit({ fileId: "b" })]).map((row) => row.hit.fileId)).toEqual([
			"a",
			"b",
		]);
	});

	test("sends nothing for a cleared query", () => {
		expect(memorySearchTerm("  bun  ")).toBe("bun");
		expect(memorySearchTerm("   ")).toBeUndefined();
		expect(memorySearchTerm("")).toBeUndefined();
	});
});

describe("history", () => {
	test("splits a commit message into its subject and the rest", () => {
		expect(memoryMessageParts("memory: add testing\n\nBecause it was missing.\n")).toEqual({
			subject: "memory: add testing",
			body: "Because it was missing.",
		});
		expect(memoryMessageParts("one line")).toEqual({ subject: "one line", body: "" });
	});

	test("reads a commit as a row with its short commit and when it landed", () => {
		const rows = memoryChangeRows([change()], now);
		expect(rows[0]).toMatchObject({
			commit: "be84355",
			subject: "memory: add the testing topic",
			body: "From the review conversation.",
			files: ["testing"],
			when: "30 min ago",
		});
		expect(rows[0]?.change.commit).toBe("be84355c5bed5b9bcb2f0a8e4f4b9a0f2f6c1d2e");
	});

	test("puts the newest commit first, whatever order the server sent", () => {
		const older = change({ commit: "1111111aaaa", at: "2026-11-01T09:00:00Z", message: "older" });
		const newest = change({ commit: "2222222bbbb", at: "2026-11-04T18:00:00Z", message: "newest" });
		expect(memoryChangeRows([older, newest], now).map((row) => row.subject)).toEqual(["newest", "older"]);
	});
});

describe("remembered scope", () => {
	function memoryStorage(initial: Record<string, string> = {}): Storage {
		const entries = new Map(Object.entries(initial));
		return {
			get length() {
				return entries.size;
			},
			clear: () => entries.clear(),
			getItem: (key: string) => entries.get(key) ?? null,
			key: (index: number) => [...entries.keys()][index] ?? null,
			removeItem: (key: string) => void entries.delete(key),
			setItem: (key: string, value: string) => void entries.set(key, value),
		};
	}

	test("round-trips the chosen scope, so a reload opens where the reader left off", () => {
		const storage = memoryStorage();
		saveMemoryScope("global", storage);
		expect(JSON.parse(storage.getItem(MEMORY_SCOPE_STORAGE_KEY) ?? "null")).toBe("global");
		expect(loadMemoryScope(storage)).toBe("global");
	});

	test("falls back to the project scope for a missing, broken or unknown value", () => {
		expect(loadMemoryScope(memoryStorage())).toBe("project");
		expect(loadMemoryScope(memoryStorage({ [MEMORY_SCOPE_STORAGE_KEY]: "not json" }))).toBe("project");
		expect(parseMemoryScope(null)).toBe("project");
		expect(parseMemoryScope(JSON.stringify("both"))).toBe("project");
		expect(parseMemoryScope(JSON.stringify(7))).toBe("project");
		expect(parseMemoryScope(JSON.stringify("global"))).toBe("global");
		expect(loadMemoryScope(undefined)).toBe("project");
	});

	test("survives storage that throws", () => {
		const broken: Storage = {
			...memoryStorage(),
			getItem: () => {
				throw new Error("denied");
			},
			setItem: () => {
				throw new Error("full");
			},
		};
		expect(loadMemoryScope(broken)).toBe("project");
		expect(() => saveMemoryScope("global", broken)).not.toThrow();
	});
});

describe("front matter links", () => {
	test("points a plain link at the file's own scope", () => {
		expect(memoryLinkTarget("deploy", "project")).toEqual({ scope: "project", fileId: "deploy" });
	});

	test("follows a scope prefix across scopes", () => {
		expect(memoryLinkTarget("global:testing", "project")).toEqual({ scope: "global", fileId: "testing" });
		expect(memoryLinkTarget("project:deploy", "global")).toEqual({ scope: "project", fileId: "deploy" });
	});

	test("points nowhere for an empty or prefix-only link", () => {
		expect(memoryLinkTarget("", "global")).toBeUndefined();
		expect(memoryLinkTarget("   ", "global")).toBeUndefined();
		expect(memoryLinkTarget("global:", "global")).toBeUndefined();
	});

	test("labels a link with its title when that scope's files are loaded, else with its ID", () => {
		const files = [summary({ fileId: "testing", title: "Testing" })];
		expect(memoryLinkViews(["testing", "missing", "global:testing"], "global", files)).toEqual([
			{ scope: "global", fileId: "testing", label: "Testing", known: true },
			{ scope: "global", fileId: "missing", label: "missing", known: false },
			{ scope: "global", fileId: "testing", label: "Testing", known: true },
		]);
		// A project file linking to the global scope cannot know that scope's titles here.
		expect(memoryLinkViews(["global:testing"], "project", files)).toEqual([
			{ scope: "global", fileId: "testing", label: "testing", known: false },
		]);
	});
});

describe("memorySourceView", () => {
	test("says which conversation and entry a memory came from", () => {
		expect(memorySourceView({ projectId: "project-1", conversationId: 4, entryId: 12 })).toEqual({
			text: "conversation #4, entry #12",
			projectId: "project-1",
			conversationId: 4,
		});
		expect(memorySourceView({ projectId: "project-1", conversationId: 4, entryId: null })?.text).toBe(
			"conversation #4",
		);
	});

	test("says the coordinator wrote it when no conversation is recorded", () => {
		expect(memorySourceView({ projectId: null, conversationId: null, entryId: null })).toEqual({
			text: "the coordinator",
			projectId: null,
			conversationId: null,
		});
	});

	test("says nothing when the file has no source", () => {
		expect(memorySourceView(null)).toBeUndefined();
	});
});

describe("change kinds", () => {
	test("says who made each change", () => {
		expect(memoryChangeKindLabel("tool")).toBe("By the coordinator");
		expect(memoryChangeKindLabel("hand")).toBe("By hand");
		expect(memoryChangeKindLabel("extraction")).toBe("Saved from a compaction");
		expect(memoryChangeKindLabel("maintenance")).toBe("Maintenance");
		expect(memoryChangeKindLabel("undo")).toBe("Undo");
	});

	test("calls a commit from before kinds a plain change", () => {
		expect(memoryChangeKindLabel(undefined)).toBe("Change");
	});

	test("offers undo only on an automatic change nothing undid yet", () => {
		expect(memoryChangeUndoable(change({ kind: "extraction", undoable: true }))).toBe(true);
		expect(memoryChangeUndoable(change({ kind: "maintenance", undoable: true }))).toBe(true);
		expect(memoryChangeUndoable(change({ kind: "tool" }))).toBe(false);
		expect(memoryChangeUndoable(change({ kind: "extraction", undoable: true, undoneBy: "abc" }))).toBe(false);
		expect(memoryChangeUndone(change({ kind: "extraction", undoneBy: "abc" }))).toBe("abc");
		expect(memoryChangeUndone(change({ kind: "extraction" }))).toBeUndefined();
	});

	test("links an extraction to the compaction entry it came from", () => {
		expect(
			memoryChangeCompactionEntry(
				change({ kind: "extraction", source: { projectId: "project-1", conversationId: 4, entryId: 88 } }),
			),
		).toBe(88);
		expect(memoryChangeCompactionEntry(change({ kind: "tool" }))).toBeUndefined();
		expect(memoryChangeCompactionEntry(change({ kind: "extraction", source: null }))).toBeUndefined();
	});

	test("reads a row with its kind, its undo state and its compaction", () => {
		const rows = memoryChangeRows(
			[change({ kind: "extraction", undoable: true, source: { projectId: "project-1", conversationId: 4, entryId: 88 } })],
			now,
		);
		expect(rows[0]).toMatchObject({
			kind: "Saved from a compaction",
			undoable: true,
			undoneBy: undefined,
			compactionEntry: 88,
		});
	});
});

describe("memoryUndoErrorText", () => {
	test("explains a conflict as nothing reverted", () => {
		const refused = new ClientError("memory_conflict", "testing changed after this commit.");
		expect(memoryUndoErrorText(refused)).toBe(
			"Not undone: later changes touched the same memories, so the newer ones win. Nothing was reverted.",
		);
	});

	test("shows what the server said for any other failure", () => {
		expect(memoryUndoErrorText(new ClientError("unknown_memory", "No memory testing."))).toBe("No memory testing.");
		expect(memoryUndoErrorText(new Error("socket closed"))).toBe("socket closed");
	});
});

describe("extractions in the transcript", () => {
	function extraction(overrides: Partial<MemoryChange> = {}): MemoryChange {
		return change({
			commit: "e1e2e3",
			kind: "extraction",
			undoable: true,
			files: ["testing", "deploy"],
			source: { projectId: "project-1", conversationId: 4, entryId: 88 },
			at: "2026-11-04T18:00:00Z",
			...overrides,
		});
	}

	const files = [summary({ fileId: "testing", title: "Testing" })];

	test("titles a commit's files from the scope's list, falling back to the ID", () => {
		expect(memoryTopics(["testing", "deploy"], files)).toEqual([
			{ fileId: "testing", title: "Testing", known: true },
			{ fileId: "deploy", title: "deploy", known: false },
		]);
	});

	test("finds the extraction a compaction entry saved, in the project's scope first", () => {
		const found = memoryExtractionFor(
			[
				{ scope: "global", changes: [extraction({ files: ["global-memory"] })], files: [] },
				{ scope: "project", changes: [extraction()], files },
			],
			88,
		);
		expect(found?.scope).toBe("project");
		expect(found?.change.commit).toBe("e1e2e3");
		expect(found?.topics).toEqual([
			{ fileId: "testing", title: "Testing", known: true },
			{ fileId: "deploy", title: "deploy", known: false },
		]);
	});

	test("finds one in the global scope too, and ignores other entries and kinds", () => {
		const globalChange = extraction({ commit: "g1", files: ["preferences"] });
		expect(
			memoryExtractionFor(
				[
					{ scope: "global", changes: [globalChange], files: [] },
					{ scope: "project", changes: [extraction({ source: { projectId: "project-1", conversationId: 4, entryId: 12 } })], files },
				],
				88,
			),
		).toMatchObject({ scope: "global", change: { commit: "g1" } });
		expect(memoryExtractionFor([{ scope: "project", changes: [change({ kind: "tool" })], files }], 88)).toBeUndefined();
		expect(memoryExtractionFor([], 88)).toBeUndefined();
	});

	test("keeps the newest extraction for one entry, and marks it undone", () => {
		const found = memoryExtractionFor(
			[
				{
					scope: "project",
					changes: [
						extraction({ commit: "old", at: "2026-11-04T18:00:00Z" }),
						extraction({ commit: "new", at: "2026-11-04T18:30:00Z", undoneBy: "undo-1", undoable: false }),
					],
					files,
				},
			],
			88,
		);
		expect(found?.change.commit).toBe("new");
		expect(found?.undoneBy).toBe("undo-1");
	});

	test("a compacted entry with no extraction shows nothing", () => {
		expect(memoryExtractionFor([{ scope: "project", changes: [extraction()], files }], 99)).toBeUndefined();
	});
});

describe("maintenance status", () => {
	function status(overrides: Partial<MemoryScopeStatus> = {}): MemoryScopeStatus {
		return {
			scope: "project",
			projectId: "project-1",
			writesSinceMaintenance: 3,
			maintaining: false,
			lastMaintenance: {
				at: "2026-11-04T03:00:00Z",
				outcome: "ok",
				commit: "be84355c",
				message: "Memory maintenance: merged the testing topics.",
			},
			nextMaintenanceAt: "2026-11-05T03:00:00Z",
			...overrides,
		};
	}

	test("says when the last run was and how it went, with the server's message behind it", () => {
		const view = memoryStatusView(status(), now);
		expect(view.last).toEqual({
			text: "16 h ago · changed memory",
			title: "Memory maintenance: merged the testing topics.",
			failed: false,
		});
		expect(view.next?.text).toBe("in 8 h");
		expect(typeof view.next?.title).toBe("string");
		expect(view.writes).toBe("3 writes since the last run");
		expect(view.off).toBe(false);
		expect(view.running).toBe(false);
	});

	test("reads one write in the singular, a failure as a failure and nothing to do as such", () => {
		const view = memoryStatusView(
			status({
				writesSinceMaintenance: 1,
				lastMaintenance: { at: "2026-11-04T03:00:00Z", outcome: "failed", commit: null, message: "the model failed" },
			}),
			now,
		);
		expect(view.writes).toBe("1 write since the last run");
		expect(view.last?.text).toBe("16 h ago · failed");
		expect(view.last?.failed).toBe(true);
		expect(
			memoryStatusView(
				status({ lastMaintenance: { at: "2026-11-04T03:00:00Z", outcome: "nothing_to_do", commit: null, message: null } }),
				now,
			).last?.text,
		).toBe("16 h ago · nothing to do");
	});

	test("says a run is in progress, and that nothing has run yet", () => {
		expect(memoryStatusView(status({ maintaining: true }), now).running).toBe(true);
		const never = memoryStatusView(status({ lastMaintenance: null }), now);
		expect(never.last).toBeUndefined();
	});

	test("is off with no next run, which is what no model means", () => {
		const view = memoryStatusView(status({ nextMaintenanceAt: null }), now);
		expect(view.off).toBe(true);
		expect(view.next).toBeUndefined();
	});
});

describe("maintenance settings", () => {
	function settings(overrides: Partial<MemoryMaintenanceSettings> = {}): MemoryMaintenanceSettings {
		return {
			model: { provider: "anthropic", modelId: "claude-sonnet-4-5" },
			thinkingLevel: "medium",
			time: "03:00",
			afterWrites: 20,
			...overrides,
		};
	}

	test("defaults to no model, 03:00 and 20 writes", () => {
		expect(DEFAULT_MEMORY_MAINTENANCE).toEqual({ model: null, thinkingLevel: null, time: "03:00", afterWrites: 20 });
		expect(memoryMaintenanceOff(DEFAULT_MEMORY_MAINTENANCE)).toBe(true);
		expect(memoryMaintenanceOff(settings())).toBe(false);
	});

	test("says when it runs, or that it is off without a model", () => {
		expect(memoryMaintenanceSummary(settings(), "Europe/Bucharest")).toBe(
			"Nightly at 03:00 (Europe/Bucharest), or after 20 writes.",
		);
		expect(memoryMaintenanceSummary(settings({ afterWrites: 1 }), "UTC")).toBe("Nightly at 03:00 (UTC), or after 1 write.");
		expect(memoryMaintenanceSummary(settings({ model: null }), "UTC")).toBe(
			"Off: maintenance doesn't run without a model.",
		);
	});

	test("takes a nightly time only as HH:MM on a 24-hour clock", () => {
		expect(parseNightlyTime("03:00")).toBe("03:00");
		expect(parseNightlyTime(" 23:59 ")).toBe("23:59");
		expect(parseNightlyTime("00:00")).toBe("00:00");
		expect(parseNightlyTime("24:00")).toBeUndefined();
		expect(parseNightlyTime("3:00")).toBeUndefined();
		expect(parseNightlyTime("03:60")).toBeUndefined();
		expect(parseNightlyTime("")).toBeUndefined();
	});

	test("takes a write count only between 1 and 1000", () => {
		expect(parseAfterWrites("20")).toBe(20);
		expect(parseAfterWrites(1)).toBe(1);
		expect(parseAfterWrites("1000")).toBe(1000);
		expect(parseAfterWrites("0")).toBeUndefined();
		expect(parseAfterWrites("1001")).toBeUndefined();
		expect(parseAfterWrites("2.5")).toBeUndefined();
		expect(parseAfterWrites("")).toBeUndefined();
		expect(parseAfterWrites("many")).toBeUndefined();
	});

	test("shows the levels the maintenance model offers, the protocol's set for an unknown model", () => {
		const models: ModelInfo[] = [
			{
				provider: "anthropic",
				modelId: "claude-sonnet-4-5",
				name: "Claude Sonnet 4.5",
				contextWindow: 200_000,
				maxOutputTokens: 8_000,
				thinkingLevels: ["off", "low", "medium"],
				configured: true,
			},
		];
		expect(maintenanceThinkingLevels(settings().model!, models)).toEqual(["off", "low", "medium"]);
		expect(maintenanceThinkingLevels({ provider: "stub", modelId: "stub" }, models)).toContain("high");
	});
});
