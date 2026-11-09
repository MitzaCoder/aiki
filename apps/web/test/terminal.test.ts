import { describe, expect, test } from "bun:test";
import {
	KEY_BAR,
	MAX_TERMINAL_TABS,
	applyModifiers,
	arrowBytes,
	keyboardVisibleHeight,
	mixHex,
	parseTabs,
	reconcileTabs,
	sessionForPrefix,
	terminalHref,
	terminalTarget,
	xtermColors,
	type TerminalTones,
} from "../src/lib/terminal.ts";

const sessions = (...entries: [string, boolean?][]) => entries.map(([name, exited]) => ({ name, exited: exited === true, attached: false }));

describe("terminal links and targets", () => {
	test("the page's path carries the project and the worker", () => {
		expect(terminalHref("pc")).toBe("/b/pc/terminal");
		expect(terminalHref("my pc", { projectId: "p1" })).toBe("/b/my%20pc/terminal?project=p1");
		expect(terminalHref("pc", { projectId: "p1", workerId: "w-3" })).toBe("/b/pc/terminal?project=p1&worker=w-3");
	});

	test("a project's terminal starts in its folder; a worker's in its workspace", () => {
		const project = { name: "Example Core", path: "/work/core" };
		expect(terminalTarget(project)).toEqual({ prefix: "example-core", cwd: "/work/core", title: "Example Core" });
		expect(terminalTarget(project, { id: "fix-login", workspacePath: "/work/core-ws/fix-login" })).toEqual({
			prefix: "example-core-fix-login",
			cwd: "/work/core-ws/fix-login",
			title: "Example Core · fix-login",
		});
		// A worker on the shared checkout has no workspace of its own.
		expect(terminalTarget(project, { id: "w1", workspacePath: null }).cwd).toBe("/work/core");
		expect(terminalTarget(undefined)).toEqual({ prefix: "term", title: "Terminal" });
	});

	test("an existing running session is reused instead of making another", () => {
		const list = sessions(["example-core-2"], ["example-core-1", true], ["example-core-10"], ["example-core-fix-1"], ["other-1"]);
		expect(sessionForPrefix(list, "example-core")).toBe("example-core-2");
		expect(sessionForPrefix(list, "example-core-fix")).toBe("example-core-fix-1");
		// Only exited ones, or none at all: make a new one.
		expect(sessionForPrefix(sessions(["example-core-1", true]), "example-core")).toBeUndefined();
		expect(sessionForPrefix(list, "nothing")).toBeUndefined();
		// A longer prefix is not a number suffix of a shorter one.
		expect(sessionForPrefix(sessions(["example-core-fix-1"]), "example-core")).toBeUndefined();
	});
});

describe("remembered tabs", () => {
	test("reads what a browser stored and drops what is broken or unattached", () => {
		const raw = JSON.stringify({
			pc: { tabs: [{ id: "a", session: "x-1", title: "X" }, { id: "b", title: "never attached" }, 5, { id: "c", session: "x-2", title: "Y" }], active: "c" },
			bad: "nope",
		});
		expect(parseTabs(raw)).toEqual({
			pc: {
				tabs: [
					{ id: "a", session: "x-1", title: "X" },
					{ id: "c", session: "x-2", title: "Y" },
				],
				active: "c",
			},
		});
		expect(parseTabs("{not json")).toEqual({});
		expect(parseTabs(null)).toEqual({});
	});

	test("keeps at most the allowed number of tabs and a valid active one", () => {
		const many = Array.from({ length: 10 }, (_, index) => ({ id: `t${index}`, session: `s-${index}`, title: "t" }));
		const result = parseTabs(JSON.stringify({ pc: { tabs: many, active: "t9" } }));
		expect(result.pc!.tabs).toHaveLength(MAX_TERMINAL_TABS);
		expect(result.pc!.active).toBe("t0");
	});

	test("a page restores only the tabs whose session the backend still has", () => {
		const stored = { tabs: [{ id: "a", session: "gone-1", title: "gone" }, { id: "b", session: "kept-1", title: "kept" }, { id: "c", session: "dead-1", title: "dead" }], active: "a" };
		const result = reconcileTabs(stored, sessions(["kept-1"], ["dead-1", true]));
		expect(result.tabs.map((tab) => tab.id)).toEqual(["b", "c"]);
		expect(result.active).toBe("b");
	});
});

describe("the key bar", () => {
	test("has the keys a phone lacks, in order", () => {
		expect(KEY_BAR.map((key) => key.label)).toEqual(["Esc", "Tab", "Ctrl", "Alt", "←", "↓", "↑", "→", "|", "~", "/", "-"]);
		expect(KEY_BAR.find((key) => key.id === "esc")?.bytes).toBe("\x1b");
		expect(KEY_BAR.filter((key) => key.modifier !== undefined).map((key) => key.modifier)).toEqual(["ctrl", "alt"]);
	});

	test("arrows follow the cursor-key mode", () => {
		expect(arrowBytes("up", false)).toBe("\x1b[A");
		expect(arrowBytes("left", false)).toBe("\x1b[D");
		expect(arrowBytes("down", true)).toBe("\x1bOB");
		expect(arrowBytes("right", true)).toBe("\x1bOC");
	});

	test("sticky Ctrl and Alt change the next key", () => {
		const none = { ctrl: false, alt: false };
		expect(applyModifiers("c", { ...none, ctrl: true })).toBe("\x03");
		expect(applyModifiers("C", { ...none, ctrl: true })).toBe("\x03");
		expect(applyModifiers("[", { ...none, ctrl: true })).toBe("\x1b");
		expect(applyModifiers(" ", { ...none, ctrl: true })).toBe("\x00");
		expect(applyModifiers("1", { ...none, ctrl: true })).toBe("1");
		expect(applyModifiers("x", { ...none, alt: true })).toBe("\x1bx");
		expect(applyModifiers("d", { ctrl: true, alt: true })).toBe("\x1b\x04");
		// A paste or an escape sequence is not a key.
		expect(applyModifiers("hello", { ...none, ctrl: true })).toBe("hello");
		expect(applyModifiers("hello", none)).toBe("hello");
	});
});

describe("xterm colours from the theme", () => {
	const tones: TerminalTones = {
		bg: "#ffffff",
		fg: "#101010",
		fgMuted: "#606060",
		fgSubtle: "#909090",
		surface2: "#eeeeee",
		primary: "#6366f1",
		danger: "#e11d48",
		success: "#059669",
		warning: "#d97706",
		accent1: "#22d3ee",
		accent2: "#6366f1",
		accent3: "#d946ef",
		accent4: "#fb923c",
	};

	test("mixes hex colours", () => {
		expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
		expect(mixHex("#102030", "#102030", 0.7)).toBe("#102030");
	});

	test("takes the page's own background, text and cursor", () => {
		const colors = xtermColors(tones, false);
		expect(colors).toMatchObject({ background: "#ffffff", foreground: "#101010", cursor: "#6366f1", cursorAccent: "#ffffff" });
		for (const value of Object.values(colors)) expect(value).toMatch(/^#[0-9a-f]{6}$/);
	});

	test("darkens the plain colours on a light theme, lightens the bright ones on a dark one", () => {
		const light = xtermColors(tones, false);
		expect(light.red).not.toBe(tones.danger);
		expect(light.brightRed).toBe(tones.danger);
		const dark = xtermColors({ ...tones, bg: "#09090f", fg: "#ecebf5" }, true);
		expect(dark.red).toBe(tones.danger);
		expect(dark.brightRed).not.toBe(tones.danger);
		expect(dark.black).not.toBe(dark.background);
	});
});

describe("the soft keyboard", () => {
	test("the page ends where the visual viewport does while a keyboard covers the bottom", () => {
		expect(keyboardVisibleHeight(800, 800, 1)).toBeUndefined();
		expect(keyboardVisibleHeight(800, 520, 1)).toBe(520);
		// A browser bar sliding away is not a keyboard.
		expect(keyboardVisibleHeight(800, 740, 1)).toBeUndefined();
		// Pinch-zoom shrinks the visual viewport too, with a scale.
		expect(keyboardVisibleHeight(800, 400, 2)).toBeUndefined();
	});
});
