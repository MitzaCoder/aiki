/**
 * The projects sidebar's logic: what a row says about its project, which replies count
 * as unread, what the browser remembers, and which route a path belongs to. The
 * component only wires these to markup, so this is where the behaviour is pinned.
 */
import { describe, expect, test } from "bun:test";
import {
	DEFAULT_PROJECTS_NAV_STATE,
	PROJECTS_NAV_STORAGE_KEY,
	activeProjects,
	archivedHeading,
	archivedProjects,
	isArchived,
	PROJECTS_SEEN_STORAGE_KEY,
	currentProject,
	loadProjectSeens,
	loadProjectsNavState,
	parseProjectSeens,
	parseProjectsNavState,
	projectInitial,
	projectRow,
	projectSeenKey,
	projectSeenStamp,
	projectStatus,
	projectUnread,
	sameSeen,
	saveProjectSeens,
	saveProjectsNavState,
	seenIsNewer,
	timeAgo,
	type ProjectSeen,
} from "../src/lib/projects.ts";
import type { ProjectActivity, ProjectSummary } from "@mihai-harness/protocol";

const NOW = Date.parse("2026-11-05T12:00:00.000Z");

function activity(overrides: Partial<ProjectActivity> = {}): ProjectActivity {
	return { coordinator: "idle", runningWorkers: 0, lastReplyAt: null, lastReplyEntryId: null, ...overrides };
}

function project(overrides: Partial<ProjectSummary> = {}): ProjectSummary {
	return {
		id: "demo",
		name: "demo",
		path: "/home/user/Projects/demo",
		coordinator: { model: { provider: "anthropic", modelId: "claude-sonnet-4-5" }, thinkingLevel: null },
		workerModels: [],
		checkIns: { enabled: true, intervalMinutes: 10 },
		state: "open",
		...overrides,
	};
}

const HOUR_AGO = "2026-11-05T11:00:00.000Z";

describe("project status", () => {
	test("a failed open wins over everything else", () => {
		const status = projectStatus(
			project({ state: "failed", failure: "jj: not a repository", activity: activity({ coordinator: "working" }) }),
			NOW,
		);
		expect(status.tone).toBe("error");
		expect(status.label).toBe("Open failed");
		expect(status.title).toBe("jj: not a repository");
	});

	test("a project without a coordinator model is called out", () => {
		const status = projectStatus(project({ coordinator: { model: null, thinkingLevel: null } }), NOW);
		expect(status.tone).toBe("warn");
		expect(status.label).toBe("No model");
	});

	test("servers without activity fall back to the open state", () => {
		expect(projectStatus(project({ state: "open" }), NOW)).toMatchObject({ tone: "ok", label: "Open" });
		expect(projectStatus(project({ state: "closed" }), NOW)).toMatchObject({ tone: "muted", label: "Closed" });
	});

	test("a working coordinator says so, with its workers", () => {
		const status = projectStatus(
			project({ activity: activity({ coordinator: "working", runningWorkers: 2, lastReplyAt: HOUR_AGO }) }),
			NOW,
		);
		expect(status.tone).toBe("busy");
		expect(status.label).toBe("Working");
		expect(status.detail).toBe("2 workers");
	});

	test("a running tool call takes over the label and shows how long it has run, ticking", () => {
		const startedAt = "2026-11-05T11:57:00.000Z";
		const status = projectStatus(
			project({
				activity: activity({ coordinator: "working", runningWorkers: 1, runningTool: { name: "bash", startedAt } }),
			}),
			NOW,
		);
		expect(status.tone).toBe("busy");
		expect(status.label).toBe("Running bash");
		expect(status.detail).toBe("3m");
		expect(status.title).toContain("running bash");
		expect(status.title).toContain("1 worker");

		// A minute later, ticking the same way the sidebar's own clock would.
		const later = projectStatus(
			project({ activity: activity({ coordinator: "working", runningTool: { name: "bash", startedAt } }) }),
			NOW + 60_000,
		);
		expect(later.detail).toBe("4m");
	});

	test("a failed run, running workers and idle each read differently", () => {
		const failed = projectStatus(
			project({ activity: activity({ coordinator: "failed", lastReplyAt: HOUR_AGO, lastReplyEntryId: 4 }) }),
			NOW,
		);
		expect(failed).toMatchObject({ tone: "error", label: "Run failed", detail: "1h ago" });

		expect(
			projectStatus(project({ activity: activity({ runningWorkers: 1 }) }), NOW),
		).toMatchObject({ tone: "busy", label: "1 worker" });

		expect(
			projectStatus(project({ activity: activity({ runningWorkers: 3 }) }), NOW),
		).toMatchObject({ tone: "busy", label: "3 workers" });

		expect(
			projectStatus(project({ activity: activity({ lastReplyAt: HOUR_AGO }) }), NOW),
		).toMatchObject({ tone: "muted", label: "Idle", detail: "1h ago" });

		expect(projectStatus(project({ activity: activity() }), NOW)).toMatchObject({
			tone: "muted",
			label: "Not started",
		});
	});

	test("a closed project still shows its workers, but stays closed", () => {
		const status = projectStatus(
			project({ state: "closed", activity: activity({ runningWorkers: 2, lastReplyAt: HOUR_AGO }) }),
			NOW,
		);
		expect(status).toMatchObject({ tone: "muted", label: "Closed", detail: "2 workers" });
	});
});

describe("relative times", () => {
	test("reads as just now, minutes, hours and days", () => {
		expect(timeAgo(new Date(NOW - 5_000).toISOString(), NOW)).toBe("just now");
		expect(timeAgo(new Date(NOW - 4 * 60_000).toISOString(), NOW)).toBe("4m ago");
		expect(timeAgo(HOUR_AGO, NOW)).toBe("1h ago");
		expect(timeAgo(new Date(NOW - 3 * 24 * 3_600_000).toISOString(), NOW)).toBe("3d ago");
	});

	test("empty for nothing, and for a time it cannot read", () => {
		expect(timeAgo(null, NOW)).toBe("");
		expect(timeAgo(undefined, NOW)).toBe("");
		expect(timeAgo("yesterday", NOW)).toBe("");
		// A clock that is behind the server's does not read as the future.
		expect(timeAgo(new Date(NOW + 60_000).toISOString(), NOW)).toBe("just now");
	});
});

describe("unread replies", () => {
	const replied = activity({ lastReplyAt: HOUR_AGO, lastReplyEntryId: 12 });

	test("compares entry IDs when both sides have one", () => {
		expect(projectUnread(replied, { lastReplyEntryId: 12, lastReplyAt: HOUR_AGO })).toBe(false);
		expect(projectUnread(replied, { lastReplyEntryId: 11, lastReplyAt: HOUR_AGO })).toBe(true);
		// A later mark than the activity (a stale push) is still read.
		expect(projectUnread(replied, { lastReplyEntryId: 20, lastReplyAt: HOUR_AGO })).toBe(false);
	});

	test("falls back to reply times when an entry ID is missing", () => {
		expect(projectUnread(replied, { lastReplyEntryId: null, lastReplyAt: HOUR_AGO })).toBe(false);
		expect(projectUnread(replied, { lastReplyEntryId: null, lastReplyAt: "2026-11-05T10:00:00.000Z" })).toBe(true);
		expect(projectUnread(activity({ lastReplyAt: HOUR_AGO }), { lastReplyEntryId: null, lastReplyAt: HOUR_AGO })).toBe(
			false,
		);
	});

	test("a project this browser never opened is unread once it has answered", () => {
		expect(projectUnread(replied, undefined)).toBe(true);
		// But a project that has not answered is never unread, however new it is here.
		expect(projectUnread(activity(), undefined)).toBe(false);
		expect(projectUnread(undefined, undefined)).toBe(false);
	});

	test("an unreadable stored time does not hide a reply", () => {
		expect(projectUnread(replied, { lastReplyEntryId: null, lastReplyAt: "not a time" })).toBe(true);
		expect(
			projectUnread(activity({ lastReplyAt: "not a time", lastReplyEntryId: 2 }), {
				lastReplyEntryId: null,
				lastReplyAt: HOUR_AGO,
			}),
		).toBe(false);
	});

	test("a stamp is only what a project's reply reached, and marks move forward", () => {
		expect(projectSeenStamp(undefined)).toBeUndefined();
		expect(projectSeenStamp(activity())).toBeUndefined();
		expect(projectSeenStamp(replied)).toEqual({ lastReplyEntryId: 12, lastReplyAt: HOUR_AGO });

		const older: ProjectSeen = { lastReplyEntryId: 11, lastReplyAt: HOUR_AGO };
		const newer: ProjectSeen = { lastReplyEntryId: 12, lastReplyAt: HOUR_AGO };
		expect(seenIsNewer(newer, undefined)).toBe(true);
		expect(seenIsNewer(newer, newer)).toBe(false);
		expect(seenIsNewer(newer, older)).toBe(true);
		expect(seenIsNewer(older, newer)).toBe(false);
		expect(sameSeen(older, older)).toBe(true);
		expect(sameSeen(older, newer)).toBe(false);
		expect(sameSeen(undefined, undefined)).toBe(true);
		expect(sameSeen(older, undefined)).toBe(false);
	});

	test("a row is a status plus its unread mark", () => {
		const row = projectRow(
			project({ activity: replied }),
			{ lastReplyEntryId: 11, lastReplyAt: HOUR_AGO },
			NOW,
		);
		expect(row).toMatchObject({ label: "Idle", unread: true });
	});
});

describe("keys and initials", () => {
	test("a key escapes both IDs, so a slash cannot collide", () => {
		expect(projectSeenKey("harness-pc", "demo")).toBe("harness-pc/demo");
		expect(projectSeenKey("a/b", "c d")).toBe("a%2Fb/c%20d");
	});

	test("an initial is the first letter, upper case", () => {
		expect(projectInitial("demo")).toBe("D");
		expect(projectInitial("  jarvis")).toBe("J");
		expect(projectInitial("")).toBe("?");
		expect(projectInitial("   ")).toBe("?");
	});
});

describe("the route a path belongs to", () => {
	test("reads the project from the chat, settings and worker routes", () => {
		expect(currentProject("/b/harness-pc/projects/demo")).toEqual({
			backendId: "harness-pc",
			projectId: "demo",
		});
		expect(currentProject("/b/harness-pc/projects/demo/settings")).toEqual({
			backendId: "harness-pc",
			projectId: "demo",
		});
		expect(currentProject("/b/harness-pc/projects/demo/workers/w1")).toEqual({
			backendId: "harness-pc",
			projectId: "demo",
		});
	});

	test("decodes escaped IDs", () => {
		expect(currentProject("/b/a%2Fb/projects/c%20d")).toEqual({ backendId: "a/b", projectId: "c d" });
	});

	test("no project for the backends page or a foreign path", () => {
		expect(currentProject("/")).toBeUndefined();
		expect(currentProject("/b/harness-pc")).toBeUndefined();
		expect(currentProject("/b/harness-pc/projects")).toBeUndefined();
		expect(currentProject("/other/harness-pc/projects/demo")).toBeUndefined();
	});
});

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

describe("what the browser remembers", () => {
	test("the collapsed rail round-trips", () => {
		const storage = memoryStorage();
		saveProjectsNavState({ collapsed: true }, storage);
		expect(JSON.parse(storage.getItem(PROJECTS_NAV_STORAGE_KEY) ?? "null")).toEqual({ collapsed: true });
		expect(parseProjectsNavState(storage.getItem(PROJECTS_NAV_STORAGE_KEY))).toEqual({ collapsed: true });
	});

	test("a missing, broken or partial nav state is the expanded sidebar", () => {
		expect(parseProjectsNavState(null)).toEqual(DEFAULT_PROJECTS_NAV_STATE);
		expect(parseProjectsNavState("not json")).toEqual({ collapsed: false });
		expect(parseProjectsNavState(JSON.stringify({ collapsed: "yes" }))).toEqual({ collapsed: false });
		expect(parseProjectsNavState(JSON.stringify([true]))).toEqual({ collapsed: false });
		expect(DEFAULT_PROJECTS_NAV_STATE.collapsed).toBe(false);
	});

	test("seen stamps round-trip per project", () => {
		const storage = memoryStorage();
		const seens = {
			[projectSeenKey("harness-pc", "demo")]: { lastReplyEntryId: 12, lastReplyAt: HOUR_AGO },
			[projectSeenKey("harness-vm", "jarvis")]: { lastReplyEntryId: null, lastReplyAt: HOUR_AGO },
		};
		saveProjectSeens(seens, storage);
		expect(parseProjectSeens(storage.getItem(PROJECTS_SEEN_STORAGE_KEY))).toEqual(seens);
	});

	test("drops stamps that are not stamps", () => {
		const raw = JSON.stringify({
			ok: { lastReplyEntryId: 3, lastReplyAt: HOUR_AGO },
			atOnly: { lastReplyEntryId: null, lastReplyAt: HOUR_AGO },
			empty: { lastReplyEntryId: null, lastReplyAt: null },
			badId: { lastReplyEntryId: 0, lastReplyAt: HOUR_AGO },
			badTime: { lastReplyEntryId: 2, lastReplyAt: 7 },
			notAnObject: "3",
		});
		expect(parseProjectSeens(raw)).toEqual({
			ok: { lastReplyEntryId: 3, lastReplyAt: HOUR_AGO },
			atOnly: { lastReplyEntryId: null, lastReplyAt: HOUR_AGO },
		});
		expect(parseProjectSeens("not json")).toEqual({});
		expect(parseProjectSeens(JSON.stringify([1, 2]))).toEqual({});
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
		expect(loadProjectsNavState(broken)).toEqual(DEFAULT_PROJECTS_NAV_STATE);
		expect(loadProjectSeens(broken)).toEqual({});
		expect(() => saveProjectsNavState({ collapsed: true }, broken)).not.toThrow();
		expect(() => saveProjectSeens({}, broken)).not.toThrow();
	});
});

describe("archived projects", () => {
	const kept = project({ id: "kept", name: "Kept" });
	const old = project({ id: "old", name: "Old", archived: true });
	const explicitlyNot = project({ id: "back", name: "Back", archived: false });
	const all = [kept, old, explicitlyNot];

	test("a summary without the flag, as an older backend sends it, is not archived", () => {
		expect(isArchived(kept)).toBe(false);
		expect(isArchived(explicitlyNot)).toBe(false);
		expect(isArchived(old)).toBe(true);
	});

	test("the drawer lists the projects that are not archived, in order", () => {
		expect(activeProjects(all).map((entry) => entry.id)).toEqual(["kept", "back"]);
		expect(activeProjects([old])).toEqual([]);
		expect(activeProjects([])).toEqual([]);
	});

	test("the Archived list holds only the archived ones, in order", () => {
		expect(archivedProjects(all).map((entry) => entry.id)).toEqual(["old"]);
		expect(archivedProjects([kept])).toEqual([]);
	});

	test("every project is in exactly one of the two lists", () => {
		expect(activeProjects(all).length + archivedProjects(all).length).toBe(all.length);
	});

	test("the toggle shows how many are archived", () => {
		expect(archivedHeading(2)).toBe("Archived (2)");
	});
});
