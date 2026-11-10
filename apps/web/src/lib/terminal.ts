/**
 * What the terminal page decides without a screen: where a terminal opens, which sessions a page restores, the phone's
 * key bar and its sticky modifiers, and the xterm colours derived from the active theme's tones. Pure, so the
 * components only wire these to events and the behaviour is pinned in `test/terminal.test.ts`.
 */
import { terminalPrefix } from "@aiki/protocol";
import type { TerminalSessionInfo } from "@aiki/protocol";

/** Per browser, like the backend list: the tabs each backend's terminal page has open. */
export const TERMINAL_TABS_STORAGE_KEY = "aiki.terminal-tabs.v1";
/** Tabs one page keeps attached; the backend allows eight per connection. */
export const MAX_TERMINAL_TABS = 6;

/** Path of a backend's terminal page, optionally for a project or one of its workers. */
export function terminalHref(backendId: string, target: { projectId?: string; workerId?: string } = {}): string {
	const query = new URLSearchParams();
	if (target.projectId !== undefined) query.set("project", target.projectId);
	if (target.workerId !== undefined) query.set("worker", target.workerId);
	const text = query.toString();
	return `/b/${encodeURIComponent(backendId)}/terminal${text === "" ? "" : `?${text}`}`;
}

/** Where a terminal opens and what its sessions are called. */
export type TerminalTarget = {
	/** The prefix of its new session's name (`example-core`, `example-core-fix-login`). */
	prefix: string;
	/** The folder its first shell starts in; the backend's home when absent. */
	cwd?: string;
	/** What the tab says. */
	title: string;
};

/**
 * The target for a project's terminal, or for one of its workers (its workspace; a shared-checkout worker, which has
 * none, gets the project's folder).
 */
export function terminalTarget(
	project: { name: string; path: string } | undefined,
	worker?: { id: string; workspacePath: string | null },
): TerminalTarget {
	if (project === undefined) return { prefix: "term", title: "Terminal" };
	const base = terminalPrefix(project.name);
	if (worker === undefined) return { prefix: base, cwd: project.path, title: project.name };
	return {
		prefix: terminalPrefix(`${base}-${worker.id}`),
		cwd: worker.workspacePath ?? project.path,
		title: `${project.name} · ${worker.id}`,
	};
}

/** The name a session made from `prefix` has: `<prefix>-<n>`. */
function isFromPrefix(session: string, prefix: string): boolean {
	return session.startsWith(`${prefix}-`) && /^\d+$/.test(session.slice(prefix.length + 1));
}

/**
 * The running session a page should show for `prefix` instead of making another: the lowest-numbered one that is not
 * exited, or none. Exited sessions (resurrectable) are not picked: opening a terminal should not re-run old commands.
 */
export function sessionForPrefix(sessions: readonly TerminalSessionInfo[], prefix: string): string | undefined {
	const matching = sessions
		.filter((session) => !session.exited && isFromPrefix(session.name, prefix))
		.map((session) => session.name)
		.sort((a, b) => Number(a.slice(prefix.length + 1)) - Number(b.slice(prefix.length + 1)));
	return matching[0];
}

// --- tabs, as one browser remembers them -------------------------------------------------------------------------

export type TerminalTab = {
	/** Local: identifies the tab while its session is not named yet. */
	id: string;
	/** The session the tab shows, once attached (or from before a reload). */
	session?: string;
	title: string;
	/** For a tab not attached yet: where a new session starts and what it is called. */
	prefix?: string;
	cwd?: string;
};

export type TerminalTabs = { tabs: TerminalTab[]; active: string | null };

export const EMPTY_TABS: TerminalTabs = { tabs: [], active: null };

function isTab(value: unknown): value is TerminalTab {
	if (typeof value !== "object" || value === null) return false;
	const tab = value as Record<string, unknown>;
	return typeof tab.id === "string" && typeof tab.title === "string" && (tab.session === undefined || typeof tab.session === "string");
}

/** Every backend's tabs from storage; anything unreadable is dropped. */
export function parseTabs(raw: string | null | undefined): Record<string, TerminalTabs> {
	if (raw === null || raw === undefined) return {};
	try {
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null) return {};
		const result: Record<string, TerminalTabs> = {};
		for (const [backendId, value] of Object.entries(parsed)) {
			if (typeof value !== "object" || value === null) continue;
			const entry = value as { tabs?: unknown; active?: unknown };
			// Only attached sessions are kept: a tab that never got a name has nothing to come back to.
			const tabs = Array.isArray(entry.tabs) ? entry.tabs.filter(isTab).filter((tab) => tab.session !== undefined).slice(0, MAX_TERMINAL_TABS) : [];
			const active = typeof entry.active === "string" && tabs.some((tab) => tab.id === entry.active) ? entry.active : (tabs[0]?.id ?? null);
			result[backendId] = { tabs: tabs.map(({ id, session, title }) => ({ id, ...(session === undefined ? {} : { session }), title })), active };
		}
		return result;
	} catch {
		return {};
	}
}

/** The tabs a page restores: those whose session the backend still has (an exited one is resurrected on attach). */
export function reconcileTabs(stored: TerminalTabs, sessions: readonly TerminalSessionInfo[]): TerminalTabs {
	const tabs = stored.tabs.filter((tab) => tab.session !== undefined && sessions.some((session) => session.name === tab.session));
	const active = tabs.some((tab) => tab.id === stored.active) ? stored.active : (tabs[0]?.id ?? null);
	return { tabs, active };
}

/** A short unique id for a tab. */
export function newTabId(): string {
	return Math.random().toString(36).slice(2, 10);
}

// --- the soft keyboard -------------------------------------------------------------------------------------------

/** The least a soft keyboard covers; anything smaller is a browser bar sliding away, not a keyboard. */
export const SOFT_KEYBOARD_MIN_HEIGHT = 120;

/**
 * The height the page should take while a soft keyboard is up, or undefined when none is. The keyboard shrinks the visual
 * viewport and leaves the layout viewport as it was (Android Chrome, iOS Safari), so the page ends where the visual one
 * does. A pinch-zoom also shrinks it, but changes the scale, so it is not mistaken for a keyboard.
 */
export function keyboardVisibleHeight(layoutHeight: number, visualHeight: number, scale: number): number | undefined {
	if (scale > 1.01) return undefined;
	return layoutHeight - visualHeight > SOFT_KEYBOARD_MIN_HEIGHT ? visualHeight : undefined;
}

// --- the phone's key bar -----------------------------------------------------------------------------------------

export type KeyBarKey = {
	id: string;
	/** What the button shows. */
	label: string;
	/** What it is called to a screen reader. */
	name: string;
	/** The bytes it types. Absent for a modifier and for the arrows (which depend on the cursor-key mode). */
	bytes?: string;
	modifier?: "ctrl" | "alt";
	arrow?: "up" | "down" | "left" | "right";
};

/**
 * Two rows, so every key is wide enough to hit with a thumb on a 390px phone: the keys a soft keyboard lacks, then the
 * symbols that are two taps away on it (the second row also holds the clipboard buttons).
 */
export const KEY_BAR_ROWS: readonly (readonly KeyBarKey[])[] = [
	[
		{ id: "esc", label: "Esc", name: "Escape", bytes: "\x1b" },
		{ id: "tab", label: "Tab", name: "Tab", bytes: "\t" },
		{ id: "ctrl", label: "Ctrl", name: "Control", modifier: "ctrl" },
		{ id: "alt", label: "Alt", name: "Alt", modifier: "alt" },
		{ id: "left", label: "←", name: "Left arrow", arrow: "left" },
		{ id: "down", label: "↓", name: "Down arrow", arrow: "down" },
		{ id: "up", label: "↑", name: "Up arrow", arrow: "up" },
		{ id: "right", label: "→", name: "Right arrow", arrow: "right" },
	],
	[
		{ id: "pipe", label: "|", name: "Pipe", bytes: "|" },
		{ id: "tilde", label: "~", name: "Tilde", bytes: "~" },
		{ id: "slash", label: "/", name: "Slash", bytes: "/" },
		{ id: "dash", label: "-", name: "Dash", bytes: "-" },
	],
];

/** Every key of the bar, in order. */
export const KEY_BAR: readonly KeyBarKey[] = KEY_BAR_ROWS.flat();

/** The bytes an arrow key types; programs that switch on application cursor keys expect `ESC O` instead of `ESC [`. */
export function arrowBytes(direction: NonNullable<KeyBarKey["arrow"]>, applicationMode: boolean): string {
	const letter = { up: "A", down: "B", right: "C", left: "D" }[direction];
	return `${applicationMode ? "\x1bO" : "\x1b["}${letter}`;
}

export type Modifiers = { ctrl: boolean; alt: boolean };

/**
 * Apply the key bar's sticky modifiers to what a key typed: Ctrl turns one letter or `@[\]^_` into its control byte
 * (`c` becomes `\x03`), Alt prefixes ESC. Anything longer than one character (a paste, an escape sequence) is left as it
 * is, apart from Alt's prefix.
 */
export function applyModifiers(data: string, modifiers: Modifiers): string {
	let result = data;
	if (modifiers.ctrl && data.length === 1) {
		const code = data.toUpperCase().charCodeAt(0);
		if (code >= 0x40 && code <= 0x5f) result = String.fromCharCode(code - 0x40);
		else if (data === " ") result = "\x00";
		else if (data === "?") result = "\x7f";
	}
	return modifiers.alt ? `\x1b${result}` : result;
}

// --- colours -----------------------------------------------------------------------------------------------------

/** The active theme's tones, as `#rrggbb`. */
export type TerminalTones = {
	bg: string;
	fg: string;
	fgMuted: string;
	fgSubtle: string;
	surface2: string;
	primary: string;
	danger: string;
	success: string;
	warning: string;
	accent1: string;
	accent2: string;
	accent3: string;
	accent4: string;
};

function channels(hex: string): [number, number, number] {
	const value = hex.replace("#", "");
	return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)];
}

function toHex(values: readonly number[]): string {
	return `#${values.map((value) => Math.round(Math.max(0, Math.min(255, value))).toString(16).padStart(2, "0")).join("")}`;
}

/** `a` moved `amount` (0 to 1) of the way to `b`, both `#rrggbb`. */
export function mixHex(a: string, b: string, amount: number): string {
	const from = channels(a);
	const to = channels(b);
	return toHex(from.map((value, index) => value + (to[index]! - value) * amount));
}

/** The colours xterm.js takes, shaped like its `ITheme`. */
export type XtermColors = {
	background: string;
	foreground: string;
	cursor: string;
	cursorAccent: string;
	selectionBackground: string;
	selectionInactiveBackground: string;
	black: string;
	red: string;
	green: string;
	yellow: string;
	blue: string;
	magenta: string;
	cyan: string;
	white: string;
	brightBlack: string;
	brightRed: string;
	brightGreen: string;
	brightYellow: string;
	brightBlue: string;
	brightMagenta: string;
	brightCyan: string;
	brightWhite: string;
};

/**
 * An xterm palette from the app's tones: the page's own background and text, the primary colour for the cursor and the
 * selection, and the status tones as red, green and yellow, the accents as blue, magenta and cyan. Dark themes lighten
 * the bright colours, light themes darken the plain ones so they stay readable on a pale background.
 */
export function xtermColors(tones: TerminalTones, dark: boolean): XtermColors {
	const plain = (color: string): string => (dark ? color : mixHex(color, "#000000", 0.18));
	const bright = (color: string): string => (dark ? mixHex(color, "#ffffff", 0.22) : color);
	const cyan = tones.accent1;
	return {
		background: tones.bg,
		foreground: tones.fg,
		cursor: tones.primary,
		cursorAccent: tones.bg,
		selectionBackground: mixHex(tones.bg, tones.primary, dark ? 0.45 : 0.3),
		selectionInactiveBackground: mixHex(tones.bg, tones.primary, dark ? 0.25 : 0.16),
		black: dark ? mixHex(tones.bg, tones.fg, 0.22) : mixHex(tones.fg, tones.bg, 0.1),
		red: plain(tones.danger),
		green: plain(tones.success),
		yellow: plain(tones.warning),
		blue: plain(tones.accent2),
		magenta: plain(tones.accent3),
		cyan: plain(cyan),
		white: dark ? tones.fgMuted : mixHex(tones.bg, tones.fg, 0.45),
		brightBlack: tones.fgSubtle,
		brightRed: bright(tones.danger),
		brightGreen: bright(tones.success),
		brightYellow: bright(tones.warning),
		brightBlue: bright(tones.accent2),
		brightMagenta: bright(tones.accent3),
		brightCyan: bright(cyan),
		brightWhite: dark ? tones.fg : mixHex(tones.bg, tones.fg, 0.3),
	};
}
