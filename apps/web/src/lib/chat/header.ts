/**
 * The chat header's row of controls: whether they show their labels, only their icons, or fold the secondary ones
 * into a "⋯" menu. Pure, so the component only feeds it the row's measured width.
 *
 * The row sits in the chat column, which shrinks when the right sidebar opens, so what fits is a question about the
 * row's own width rather than the window's: the project's name has to stay readable whatever else is on screen.
 */

/** A control the header can show, as the layout needs to know it. */
export type HeaderActionWidth = {
	/** The visible label; a control without one is an icon button at every width. */
	label?: string;
	/** A count on the button: one beside a label costs room, one over an icon's corner costs none. */
	badge?: boolean;
	/** Tasks and Workers stay in the row when the rest fold into the menu. */
	primary?: boolean;
};

/** Every label; only Tasks' and Workers' labels beside the other icons; icons alone; a menu for the rest. */
export type HeaderLayout = "labels" | "primary-labels" | "icons" | "menu";

/** Room the project's name keeps before anything else may take it: about a dozen letters and its padding. */
const NAME_MIN_WIDTH = 104;
/** The projects drawer's button, in the row below `lg` where the sidebar is a drawer. */
const DRAWER_BUTTON_WIDTH = 32;
/** A ghost icon button (`size="icon-sm"`, 2rem). */
const ICON_BUTTON_WIDTH = 32;
/** A labelled one (`size="sm"`): its icon, the gap and both paddings. */
const LABEL_CHROME_WIDTH = 44;
/** One character of a label at the header's text size, a little generous. */
const LABEL_CHARACTER_WIDTH = 7.2;
/** A count inline beside its label, which an icon does not pay for: it sits over the corner. */
const INLINE_BADGE_WIDTH = 24;
/** The connection badge; "Reconnecting (2)…" is its longest label. */
const CONNECTION_BADGE_WIDTH = 88;
/** The mute bell and the settings gear, which keep their icons at every width. */
const UTILITY_BUTTONS = 2;
/** The menu's own "⋯" button, in the row when the secondary controls are folded away. */
const MENU_BUTTON_WIDTH = ICON_BUTTON_WIDTH;
const GAP_WIDTH = 4;

/** What one action costs in a row that shows its label, count and all. */
function labelledWidth(action: HeaderActionWidth): number {
	if (action.label === undefined) return ICON_BUTTON_WIDTH;
	const badge = action.badge === true ? INLINE_BADGE_WIDTH : 0;
	return LABEL_CHROME_WIDTH + action.label.length * LABEL_CHARACTER_WIDTH + badge;
}

/** What one action costs when only the primary ones keep their label. */
function primaryLabelledWidth(action: HeaderActionWidth): number {
	return action.primary === true ? labelledWidth(action) : ICON_BUTTON_WIDTH;
}

/**
 * What the header row shows in `available` pixels: every label when they fit beside the project's name, else icons
 * on the primary ones only, else icons, else Tasks and Workers and a "⋯" that holds the rest.
 */
export function headerLayout(available: number, actions: readonly HeaderActionWidth[]): HeaderLayout {
	const gap = (count: number): number => Math.max(count - 1, 0) * GAP_WIDTH;
	// The name and the drawer button always sit in the row; the rest shares what is left of it.
	const room = available - NAME_MIN_WIDTH - DRAWER_BUTTON_WIDTH;
	const trailing = UTILITY_BUTTONS * ICON_BUTTON_WIDTH + CONNECTION_BADGE_WIDTH;
	const items = actions.length + UTILITY_BUTTONS + 1;
	const labelled = actions.reduce((sum, action) => sum + labelledWidth(action), 0) + trailing + gap(items);
	if (labelled <= room) return "labels";
	const primaryLabelled = actions.reduce((sum, action) => sum + primaryLabelledWidth(action), 0) + trailing + gap(items);
	if (primaryLabelled <= room) return "primary-labels";
	const icons = actions.length * ICON_BUTTON_WIDTH + trailing + gap(items);
	if (icons <= room) return "icons";
	return "menu";
}

/**
 * The controls that stay in the row in `layout`: the primary ones fold last, so a phone keeps the board and its
 * workers one tap away while everything else moves into the menu.
 */
export function visibleHeaderActions<T extends HeaderActionWidth>(
	layout: HeaderLayout,
	actions: readonly T[],
): { inline: T[]; menu: T[] } {
	if (layout !== "menu") return { inline: [...actions], menu: [] };
	return {
		inline: actions.filter((action) => action.primary === true),
		menu: actions.filter((action) => action.primary !== true),
	};
}

/** Whether `layout` shows `action`'s label beside its icon. */
export function headerActionShowsLabel(layout: HeaderLayout, action: HeaderActionWidth): boolean {
	if (action.label === undefined) return false;
	return layout === "labels" || (layout === "primary-labels" && action.primary === true);
}
