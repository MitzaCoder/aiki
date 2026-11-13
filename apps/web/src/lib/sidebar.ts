/**
 * The chat's right sidebar: which tabs it has, how wide it may be, where a pointer
 * or a key puts its left edge, and what a browser remembers about it. Pure
 * functions, so the component only wires them to pointers, keys and storage.
 *
 * The sidebar sits on the right of the chat area, so its width is the distance from
 * the pointer to the window's right edge: dragging the handle left widens it, and
 * ArrowLeft does the same, as if the edge itself moved.
 */
import type { HarnessFeature } from "@kemiri/protocol";

/**
 * The tabs the sidebar can show: the project's board, main's background threads, the conversation's context, and its
 * memory.
 */
export const SIDEBAR_TABS = ["board", "background", "info", "memory"] as const;
export type SidebarTab = (typeof SIDEBAR_TABS)[number];

export const DEFAULT_SIDEBAR_TAB: SidebarTab = "info";
export const DEFAULT_SIDEBAR_WIDTH = 360;
export const MIN_SIDEBAR_WIDTH = 280;
/** The share of the window the sidebar may take when resized. */
export const MAX_SIDEBAR_WINDOW_SHARE = 0.6;
/** Arrow keys move the edge this far, or four times as far with Shift. */
export const SIDEBAR_KEY_STEP = 16;

/** Per browser, like the backend list and the theme. Bumped when the stored shape changes. */
export const SIDEBAR_STORAGE_KEY = "aiki.sidebar.v1";

export type SidebarState = {
	/** Drawn width in pixels; clamped to the window when it is restored. */
	width: number;
	open: boolean;
	tab: SidebarTab;
};

export const DEFAULT_SIDEBAR_STATE: SidebarState = {
	width: DEFAULT_SIDEBAR_WIDTH,
	open: false,
	tab: DEFAULT_SIDEBAR_TAB,
};

export function isSidebarTab(value: unknown): value is SidebarTab {
	return SIDEBAR_TABS.some((tab) => tab === value);
}

/**
 * The tabs a backend's features leave: no board, no Board; no context, no Info; no memory, no
 * Memory. Background lists main's threads, so only main's chat asks for it (`background`), and only with `threads`.
 */
export function visibleSidebarTabs(
	supports: (feature: HarnessFeature | string) => boolean,
	options: { background?: boolean } = {},
): SidebarTab[] {
	const tabs: SidebarTab[] = [];
	if (supports("board")) tabs.push("board");
	if (options.background === true && supports("threads")) tabs.push("background");
	if (supports("context")) tabs.push("info");
	if (supports("memory")) tabs.push("memory");
	return tabs;
}

/** The tab to show: the preferred one when it is still there, else the first that is. */
export function resolveSidebarTab(preferred: SidebarTab, tabs: readonly SidebarTab[]): SidebarTab | undefined {
	return tabs.includes(preferred) ? preferred : tabs[0];
}

const SIDEBAR_TAB_LABELS: Record<SidebarTab, string> = {
	board: "Board",
	background: "Background",
	info: "Info",
	memory: "Memory",
};

/** A tab's name; `labels` renames a tab (the Board tab is "Tasks" on a backend with task reports). */
export function sidebarTabLabel(tab: SidebarTab, labels: Partial<Record<SidebarTab, string>> = {}): string {
	return labels[tab] ?? SIDEBAR_TAB_LABELS[tab];
}

/** How much of each tab shows: every label, only the active tab's, or icons alone. */
export type SidebarTabLayout = "labels" | "active-label" | "icons";

/** Room one tab's icon, padding and gap need, and one character of a label at the tab's text size (a little generous). */
const TAB_CHROME_PX = 36;
const TAB_ICON_ONLY_PX = 30;
const TAB_LABEL_CHAR_PX = 7.5;
const TAB_BADGE_PX = 22;
const TAB_GAP_PX = 2;

function tabWidth(tab: SidebarTab, showLabel: boolean, badge: number | undefined): number {
	if (!showLabel) return TAB_ICON_ONLY_PX + TAB_GAP_PX;
	const badgeWidth = badge !== undefined && badge > 0 ? TAB_BADGE_PX : 0;
	return TAB_CHROME_PX + sidebarTabLabel(tab).length * TAB_LABEL_CHAR_PX + badgeWidth + TAB_GAP_PX;
}

/**
 * What the tab row shows in `available` pixels: all labels when they fit, else icons with just the active tab's
 * label, else icons alone. A badge sits inline beside a label and over the icon corner without one, so only a shown label pays for it.
 */
export function sidebarTabLayout(
	available: number,
	tabs: readonly SidebarTab[],
	active: SidebarTab,
	badges: Partial<Record<SidebarTab, number>> = {},
): SidebarTabLayout {
	const total = (showLabel: (tab: SidebarTab) => boolean): number =>
		tabs.reduce((sum, tab) => sum + tabWidth(tab, showLabel(tab), badges[tab]), 0);
	if (total(() => true) <= available) return "labels";
	if (total((tab) => tab === active) <= available) return "active-label";
	return "icons";
}

/** The name a tab answers to when its label is hidden or a badge adds to it: "Background (2)". */
export function sidebarTabName(tab: SidebarTab, badge?: number, labels: Partial<Record<SidebarTab, string>> = {}): string {
	const name = sidebarTabLabel(tab, labels);
	return badge !== undefined && badge > 0 ? `${name} (${badge})` : name;
}

/** The widest the sidebar may be dragged in a window of this width. */
export function maxSidebarWidth(viewportWidth: number): number {
	return Math.max(MIN_SIDEBAR_WIDTH, Math.round(viewportWidth * MAX_SIDEBAR_WINDOW_SHARE));
}

/** Keep a width within the window's bounds; a nonsensical width becomes the default. */
export function clampSidebarWidth(width: number, viewportWidth: number): number {
	const value = Number.isFinite(width) ? width : DEFAULT_SIDEBAR_WIDTH;
	return Math.min(Math.max(Math.round(value), MIN_SIDEBAR_WIDTH), maxSidebarWidth(viewportWidth));
}

/** The width for a handle dragged to `pointerX`: the sidebar reaches from there to the window's right edge. */
export function sidebarWidthFromPointer(pointerX: number, viewportWidth: number): number {
	return clampSidebarWidth(viewportWidth - pointerX, viewportWidth);
}

/**
 * The width after a key press on the handle, or undefined when the key is not the
 * handle's. Left widens and right narrows, because the handle is the sidebar's left
 * edge; Home and End jump to the bounds.
 */
export function sidebarWidthAfterKey(
	width: number,
	key: string,
	viewportWidth: number,
	options: { step?: number } = {},
): number | undefined {
	const step = options.step ?? SIDEBAR_KEY_STEP;
	switch (key) {
		case "ArrowLeft":
			return clampSidebarWidth(width + step, viewportWidth);
		case "ArrowRight":
			return clampSidebarWidth(width - step, viewportWidth);
		case "Home":
			return MIN_SIDEBAR_WIDTH;
		case "End":
			return maxSidebarWidth(viewportWidth);
		default:
			return undefined;
	}
}

/**
 * Whether a stored open state may open the sidebar on load. Only on a wide screen: below
 * 72rem the same state is a full-screen sheet, and a sheet that opens by itself on a phone
 * covers the chat, so it waits for a tap.
 */
export function restoreSidebarOpen(storedOpen: boolean, wide: boolean): boolean {
	return storedOpen && wide;
}

/**
 * The open state to persist: the desktop sidebar's own, even while a phone shows a sheet.
 * Opening the sheet on a phone must not change what the next desktop visit restores.
 */
export function persistedSidebarOpen(open: boolean, wide: boolean, desktopOpen: boolean): boolean {
	return wide ? open : desktopOpen;
}

/** Parse a stored sidebar state, falling back per field so a partial record still helps. */
export function parseSidebarState(raw: string | null): SidebarState {
	if (raw === null) return { ...DEFAULT_SIDEBAR_STATE };
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return { ...DEFAULT_SIDEBAR_STATE };
	}
	if (typeof parsed !== "object" || parsed === null) return { ...DEFAULT_SIDEBAR_STATE };
	const record = parsed as { width?: unknown; open?: unknown; tab?: unknown };
	// A tab that no longer exists ("workers", removed) falls back to the default like any unknown value.
	return {
		width:
			typeof record.width === "number" && Number.isFinite(record.width)
				? Math.max(MIN_SIDEBAR_WIDTH, Math.round(record.width))
				: DEFAULT_SIDEBAR_WIDTH,
		open: record.open === true,
		tab: isSidebarTab(record.tab) ? record.tab : DEFAULT_SIDEBAR_TAB,
	};
}

/** The browser's stored sidebar state; missing or unreadable storage yields the defaults. */
export function loadSidebarState(
	storage: Pick<Storage, "getItem"> | undefined = browserStorage(),
): SidebarState {
	if (storage === undefined) return { ...DEFAULT_SIDEBAR_STATE };
	try {
		return parseSidebarState(storage.getItem(SIDEBAR_STORAGE_KEY));
	} catch {
		return { ...DEFAULT_SIDEBAR_STATE };
	}
}

export function saveSidebarState(
	state: SidebarState,
	storage: Pick<Storage, "setItem"> | undefined = browserStorage(),
): void {
	if (storage === undefined) return;
	try {
		storage.setItem(SIDEBAR_STORAGE_KEY, JSON.stringify(state));
	} catch {
		// Storage can be full or disabled; the sidebar still works for this session.
	}
}

function browserStorage(): Storage | undefined {
	if (typeof window === "undefined") return undefined;
	try {
		return window.localStorage;
	} catch {
		return undefined;
	}
}
