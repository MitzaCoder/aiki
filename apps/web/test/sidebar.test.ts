/**
 * The right sidebar's geometry and persistence: the handle's pointer and keyboard
 * arithmetic, the width bounds, and what a browser remembers. The component only
 * wires these to events, so this is where the behaviour is pinned.
 */
import { describe, expect, test } from "bun:test";
import {
	DEFAULT_SIDEBAR_TAB,
	DEFAULT_SIDEBAR_WIDTH,
	MIN_SIDEBAR_WIDTH,
	SIDEBAR_STORAGE_KEY,
	clampSidebarWidth,
	loadSidebarState,
	maxSidebarWidth,
	parseSidebarState,
	persistedSidebarOpen,
	isSidebarTab,
	resolveSidebarTab,
	restoreSidebarOpen,
	saveSidebarState,
	sidebarTabLabel,
	sidebarTabLayout,
	sidebarTabName,
	sidebarWidthAfterKey,
	sidebarWidthFromPointer,
	visibleSidebarTabs,
} from "../src/lib/sidebar.ts";

const VIEWPORT = 1600;

describe("sidebar width", () => {
	test("starts at 360px and never leaves 280px to 60% of the window", () => {
		expect(DEFAULT_SIDEBAR_WIDTH).toBe(360);
		expect(MIN_SIDEBAR_WIDTH).toBe(280);
		expect(maxSidebarWidth(VIEWPORT)).toBe(960);
		expect(clampSidebarWidth(360, VIEWPORT)).toBe(360);
		expect(clampSidebarWidth(10, VIEWPORT)).toBe(280);
		expect(clampSidebarWidth(10_000, VIEWPORT)).toBe(960);
		expect(clampSidebarWidth(Number.NaN, VIEWPORT)).toBe(DEFAULT_SIDEBAR_WIDTH);
	});

	test("keeps the minimum usable inside a window narrower than the share allows", () => {
		// 60% of 400px is 240px, less than the 280px the sidebar needs to be usable.
		expect(maxSidebarWidth(400)).toBe(MIN_SIDEBAR_WIDTH);
		expect(clampSidebarWidth(360, 400)).toBe(MIN_SIDEBAR_WIDTH);
	});

	test("follows the handle: the sidebar reaches from the pointer to the right edge", () => {
		expect(sidebarWidthFromPointer(VIEWPORT - 420, VIEWPORT)).toBe(420);
		expect(sidebarWidthFromPointer(10, VIEWPORT)).toBe(960);
		expect(sidebarWidthFromPointer(VIEWPORT, VIEWPORT)).toBe(MIN_SIDEBAR_WIDTH);
	});

	test("moves with the arrow keys, and jumps with Home and End", () => {
		expect(sidebarWidthAfterKey(400, "ArrowLeft", VIEWPORT)).toBe(416);
		expect(sidebarWidthAfterKey(400, "ArrowRight", VIEWPORT)).toBe(384);
		expect(sidebarWidthAfterKey(400, "ArrowLeft", VIEWPORT, { step: 64 })).toBe(464);
		expect(sidebarWidthAfterKey(MIN_SIDEBAR_WIDTH, "ArrowRight", VIEWPORT)).toBe(MIN_SIDEBAR_WIDTH);
		expect(sidebarWidthAfterKey(960, "ArrowLeft", VIEWPORT)).toBe(960);
		expect(sidebarWidthAfterKey(400, "Home", VIEWPORT)).toBe(MIN_SIDEBAR_WIDTH);
		expect(sidebarWidthAfterKey(400, "End", VIEWPORT)).toBe(960);
		expect(sidebarWidthAfterKey(400, "a", VIEWPORT)).toBeUndefined();
	});
});

describe("sidebar tabs", () => {
	test("hides the tab whose feature the backend lacks, and none at all when it has none", () => {
		const all = new Set(["context", "memory"]);
		expect(visibleSidebarTabs((feature) => all.has(feature))).toEqual(["info", "memory"]);
		expect(visibleSidebarTabs((feature) => feature === "context")).toEqual(["info"]);
		// The workers feature no longer has a tab: workers open from their task.
		expect(visibleSidebarTabs((feature) => feature === "workers")).toEqual([]);
		expect(visibleSidebarTabs((feature) => feature === "memory")).toEqual(["memory"]);
		const withBoard = new Set(["board", "context", "memory"]);
		expect(visibleSidebarTabs((feature) => withBoard.has(feature))).toEqual(["board", "info", "memory"]);
		expect(visibleSidebarTabs((feature) => feature === "board")).toEqual(["board"]);
		expect(visibleSidebarTabs((feature) => feature === "context" || feature === "memory")).toEqual([
			"info",
			"memory",
		]);
		expect(visibleSidebarTabs(() => false)).toEqual([]);
		const withThreads = new Set(["board", "threads", "context", "memory"]);
		expect(visibleSidebarTabs((feature) => withThreads.has(feature), { background: true })).toEqual([
			"board",
			"background",
			"info",
			"memory",
		]);
		// Only main's chat lists background threads; a thread's page and a worker's do not.
		expect(visibleSidebarTabs((feature) => withThreads.has(feature))).not.toContain("background");
		expect(visibleSidebarTabs((feature) => feature === "board", { background: true })).toEqual(["board"]);
	});

	test("falls back to a tab that is still there", () => {
		expect(resolveSidebarTab("memory", ["info", "memory"])).toBe("memory");
		expect(resolveSidebarTab("background", ["info"])).toBe("info");
		expect(resolveSidebarTab("info", [])).toBeUndefined();
		expect(DEFAULT_SIDEBAR_TAB).toBe("info");
		expect(sidebarTabLabel("board")).toBe("Board");
		expect(sidebarTabLabel("info")).toBe("Info");
		expect(sidebarTabLabel("memory")).toBe("Memory");
		expect(sidebarTabLabel("board", { board: "Tasks" })).toBe("Tasks");
		expect(sidebarTabLabel("info", { board: "Tasks" })).toBe("Info");
		expect(sidebarTabName("board", 2, { board: "Tasks" })).toBe("Tasks (2)");
	});

	test("restores an open sidebar only on a wide screen, never a sheet", () => {
		expect(restoreSidebarOpen(true, true)).toBe(true);
		expect(restoreSidebarOpen(true, false)).toBe(false);
		expect(restoreSidebarOpen(false, true)).toBe(false);
		expect(restoreSidebarOpen(false, false)).toBe(false);
	});

	test("persists the desktop open state even while a phone shows a sheet", () => {
		// Wide: the sidebar's own state is the stored one.
		expect(persistedSidebarOpen(true, true, false)).toBe(true);
		expect(persistedSidebarOpen(false, true, true)).toBe(false);
		// Narrow: opening or closing the sheet leaves the desktop preference alone.
		expect(persistedSidebarOpen(true, false, false)).toBe(false);
		expect(persistedSidebarOpen(false, false, true)).toBe(true);
	});
});

describe("stored sidebar state", () => {
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

	test("a saved Workers tab, which no longer exists, falls back to the default tab and keeps the rest", () => {
		const storage = memoryStorage();
		storage.setItem(SIDEBAR_STORAGE_KEY, JSON.stringify({ width: 500, open: true, tab: "workers" }));
		const state = loadSidebarState(storage);
		expect(state).toEqual({ width: 500, open: true, tab: DEFAULT_SIDEBAR_TAB });
		// And it resolves to a tab the backend shows, whatever the default is.
		expect(resolveSidebarTab(state.tab, ["board", "memory"])).toBe("board");
		expect(isSidebarTab("workers")).toBe(false);
	});

	test("round-trips width, open state and tab", () => {
		const storage = memoryStorage();
		saveSidebarState({ width: 512, open: true, tab: "memory" }, storage);
		expect(JSON.parse(storage.getItem(SIDEBAR_STORAGE_KEY) ?? "null")).toEqual({
			width: 512,
			open: true,
			tab: "memory",
		});
		expect(loadSidebarState(storage)).toEqual({ width: 512, open: true, tab: "memory" });
	});

	test("falls back to the defaults for missing, broken or partial values", () => {
		expect(loadSidebarState(memoryStorage())).toEqual({ width: DEFAULT_SIDEBAR_WIDTH, open: false, tab: "info" });
		expect(loadSidebarState(memoryStorage({ [SIDEBAR_STORAGE_KEY]: "not json" }))).toEqual({
			width: DEFAULT_SIDEBAR_WIDTH,
			open: false,
			tab: "info",
		});
		expect(parseSidebarState(JSON.stringify({ width: "wide", open: "yes", tab: "context" }))).toEqual({
			width: DEFAULT_SIDEBAR_WIDTH,
			open: false,
			tab: "info",
		});
		expect(parseSidebarState(JSON.stringify({ width: 20, open: true }))).toEqual({
			width: MIN_SIDEBAR_WIDTH,
			open: true,
			tab: "info",
		});
		expect(loadSidebarState(undefined)).toEqual({ width: DEFAULT_SIDEBAR_WIDTH, open: false, tab: "info" });
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
		expect(loadSidebarState(broken)).toEqual({ width: DEFAULT_SIDEBAR_WIDTH, open: false, tab: "info" });
		expect(() => saveSidebarState({ width: 400, open: true, tab: "info" }, broken)).not.toThrow();
	});
});

describe("sidebar tab layout", () => {
	const all = ["board", "background", "info", "memory"] as const;

	test("shows every label when the row has room", () => {
		expect(sidebarTabLayout(470, all, "info")).toBe("labels");
		expect(sidebarTabLayout(1000, all, "board")).toBe("labels");
	});

	test("keeps only the active label, then icons alone, as the row narrows", () => {
		expect(sidebarTabLayout(250, all, "info")).toBe("active-label");
		expect(sidebarTabLayout(150, all, "info")).toBe("icons");
		expect(sidebarTabLayout(0, all, "info")).toBe("icons");
	});

	test("a longer active label needs more room than a shorter one", () => {
		const widths = [150, 180, 210, 240, 270, 300, 330];
		const ranks = { icons: 0, "active-label": 1, labels: 2 } as const;
		for (const width of widths) {
			expect(ranks[sidebarTabLayout(width, all, "background")]).toBeLessThanOrEqual(ranks[sidebarTabLayout(width, all, "info")]);
		}
	});

	test("grows with the room, never back", () => {
		const ranks = { icons: 0, "active-label": 1, labels: 2 } as const;
		let last = 0;
		for (let width = 0; width <= 600; width += 10) {
			const rank = ranks[sidebarTabLayout(width, all, "memory")];
			expect(rank).toBeGreaterThanOrEqual(last);
			last = rank;
		}
	});

	test("a badge costs room only beside a shown label", () => {
		const badges = { board: 2, background: 3, info: 1 };
		expect(sidebarTabLayout(420, all, "info", badges)).toBe("labels");
		expect(sidebarTabLayout(380, all, "info", badges)).toBe("active-label");
		expect(sidebarTabLayout(380, all, "info")).toBe("labels");
		// Icons alone take 128px whatever the badges.
		expect(sidebarTabLayout(128, all, "info", badges)).toBe("icons");
	});

	test("fewer tabs fit with labels at the narrowest width", () => {
		expect(sidebarTabLayout(199, ["info", "memory"], "info")).toBe("labels");
	});

	test("names a tab with its count, for the tooltip and the screen reader", () => {
		expect(sidebarTabName("background")).toBe("Background");
		expect(sidebarTabName("background", 0)).toBe("Background");
		expect(sidebarTabName("background", 2)).toBe("Background (2)");
	});
});
