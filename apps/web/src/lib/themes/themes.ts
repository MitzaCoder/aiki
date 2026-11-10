/**
 * The themes the app ships, as a typed registry.
 *
 * Each theme is one CSS file next to this one (`<id>.css`) defining the same
 * small set of `--tone-*` variables for light and for dark; `base.css` derives
 * every other token from them. Adding a theme means: a CSS file, an entry here,
 * the id in `app.html`'s list (checked before the first paint), and a line in
 * `app.css`. See docs/DESIGN.md.
 */

export type ThemeId = "jarvis" | "neutral";

export type ThemeDefinition = {
	/** Also the `data-theme` attribute value and the CSS file's name. */
	id: ThemeId;
	name: string;
	description: string;
};

export const THEMES = [
	{ id: "jarvis", name: "Jarvis", description: "Violet surfaces with a cyan-to-orange gradient." },
	{ id: "neutral", name: "Neutral", description: "Plain shadcn greys." },
] as const satisfies readonly ThemeDefinition[];

export const DEFAULT_THEME: ThemeId = "jarvis";

/** Per browser, like the backend list. Bumped when stored ids or meanings change. */
export const THEME_STORAGE_KEY = "aiki.theme.v1";

export function isThemeId(value: unknown): value is ThemeId {
	return THEMES.some((theme) => theme.id === value);
}

/** The theme for a stored value: unknown or missing values fall back to the default. */
export function parseTheme(raw: string | null | undefined): ThemeId {
	return isThemeId(raw) ? raw : DEFAULT_THEME;
}

function browserStorage(): Storage | undefined {
	if (typeof window === "undefined") return undefined;
	try {
		return window.localStorage;
	} catch {
		return undefined;
	}
}

export function loadTheme(storage: Pick<Storage, "getItem"> | undefined = browserStorage()): ThemeId {
	if (storage === undefined) return DEFAULT_THEME;
	try {
		return parseTheme(storage.getItem(THEME_STORAGE_KEY));
	} catch {
		return DEFAULT_THEME;
	}
}

export function saveTheme(
	theme: ThemeId,
	storage: Pick<Storage, "setItem"> | undefined = browserStorage(),
): void {
	if (storage === undefined) return;
	try {
		storage.setItem(THEME_STORAGE_KEY, theme);
	} catch {
		// Storage can be full or disabled; the theme still applies for this session.
	}
}
