/**
 * The chat header's row: when its controls show labels, when only their icons, and when the secondary ones fold into
 * the "⋯" menu. The component feeds these the row's measured width, so this is where the decision is pinned.
 */
import { describe, expect, test } from "bun:test";
import { headerActionShowsLabel, headerLayout, visibleHeaderActions, type HeaderActionWidth } from "../src/lib/chat/header.ts";

/** The coordinator chat's controls: the board (3 waiting), background threads, info, workers (1 active), memory. */
const PROJECT_ACTIONS: HeaderActionWidth[] = [
	{ label: "Tasks", badge: true, primary: true },
	{ label: "Background", badge: true },
	{ label: "Info" },
	{ label: "Workers", badge: true, primary: true },
	{ label: "Memory" },
];

/** The chat column at a 1440px window: at most 56rem wide, never wider. */
const WIDE_COLUMN = 896;
/** The same column with the 360px sidebar open on a 1440px window. */
const COLUMN_NEXT_TO_SIDEBAR = 840;
/** A 390px phone. */
const PHONE_COLUMN = 390;

describe("header layout", () => {
	test("labels everything on a wide column", () => {
		expect(headerLayout(WIDE_COLUMN, PROJECT_ACTIONS)).toBe("labels");
		expect(headerLayout(COLUMN_NEXT_TO_SIDEBAR, PROJECT_ACTIONS)).toBe("labels");
	});

	test("keeps Tasks' and Workers' labels when the sidebar leaves too little room for all of them", () => {
		expect(headerLayout(700, PROJECT_ACTIONS)).toBe("primary-labels");
		expect(headerActionShowsLabel("primary-labels", PROJECT_ACTIONS[0]!)).toBe(true);
		expect(headerActionShowsLabel("primary-labels", PROJECT_ACTIONS[1]!)).toBe(false);
	});

	test("drops every label when even those do not fit", () => {
		expect(headerLayout(560, PROJECT_ACTIONS)).toBe("icons");
	});

	test("folds the secondary controls into a menu on a phone", () => {
		expect(headerLayout(PHONE_COLUMN, PROJECT_ACTIONS)).toBe("menu");
		expect(headerLayout(320, PROJECT_ACTIONS)).toBe("menu");
	});

	test("a shorter row keeps its labels longer", () => {
		// A background thread's chat: no Background tab, so one control and one badge fewer.
		const thread = PROJECT_ACTIONS.filter((action) => action.label !== "Background");
		expect(headerLayout(700, thread)).toBe("labels");
		expect(headerLayout(560, thread)).toBe("icons");
		expect(headerLayout(PHONE_COLUMN, thread)).toBe("menu");
	});

	test("a control without a label is an icon button at every width", () => {
		// The mute bell: it takes room like an icon even where everything else is labelled.
		expect(headerActionShowsLabel("labels", { label: undefined })).toBe(false);
		expect(headerActionShowsLabel("icons", { label: "Tasks" })).toBe(false);
		expect(headerActionShowsLabel("labels", { label: "Tasks" })).toBe(true);
		expect(headerLayout(WIDE_COLUMN, [...PROJECT_ACTIONS, {}])).toBe("labels");
		expect(headerLayout(560, [...PROJECT_ACTIONS, {}])).toBe("icons");
	});
});

describe("which controls stay in the row", () => {
	test("every control is inline until they fold", () => {
		const visible = visibleHeaderActions("icons", PROJECT_ACTIONS);
		expect(visible.inline).toHaveLength(PROJECT_ACTIONS.length);
		expect(visible.menu).toHaveLength(0);
	});

	test("a phone keeps the board and the workers, and moves the rest into the menu", () => {
		const visible = visibleHeaderActions("menu", PROJECT_ACTIONS);
		expect(visible.inline.map((action) => action.label)).toEqual(["Tasks", "Workers"]);
		expect(visible.menu.map((action) => action.label)).toEqual(["Background", "Info", "Memory"]);
	});

	test("the menu keeps the actions' order, so the rows do not move around", () => {
		const actions: HeaderActionWidth[] = [{ label: "Tasks", primary: true }, { label: "Memory" }, { label: "Workers", primary: true }];
		expect(visibleHeaderActions("menu", actions).inline.map((action) => action.label)).toEqual(["Tasks", "Workers"]);
	});
});
