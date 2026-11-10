/**
 * Whether code in the chat wraps or scrolls sideways, and which edges of a scrolling block have more to show. Pure,
 * so the components and the tests agree.
 */

/** Per browser, like the theme and the sidebar. Bumped when the stored shape changes. */
export const CODE_WRAP_STORAGE_KEY = "aiki.code-wrap.v1";

/** What the reader chose with a Wrap toggle; `undefined` until they chose once. */
export type CodeWrapPreference = "wrap" | "scroll" | undefined;

export function parseCodeWrap(raw: string | null | undefined): CodeWrapPreference {
	return raw === "wrap" || raw === "scroll" ? raw : undefined;
}

export function loadCodeWrap(storage: Pick<Storage, "getItem"> | undefined): CodeWrapPreference {
	try {
		return parseCodeWrap(storage?.getItem(CODE_WRAP_STORAGE_KEY));
	} catch {
		return undefined;
	}
}

export function saveCodeWrap(storage: Pick<Storage, "setItem"> | undefined, preference: Exclude<CodeWrapPreference, undefined>): void {
	try {
		storage?.setItem(CODE_WRAP_STORAGE_KEY, preference);
	} catch {
		// Private mode or a full quota: the choice then lasts until the page closes.
	}
}

/**
 * One preference for every block. A block that has a default of its own (a bash command wraps) follows it until the
 * reader has chosen; a fenced block scrolls until then.
 */
export function effectiveWrap(preference: CodeWrapPreference, defaultWrap: boolean): boolean {
	return preference === undefined ? defaultWrap : preference === "wrap";
}

/** The edges of a sideways scroller that have more content behind them. `slack` forgives sub-pixel rounding. */
export function scrollFade(
	scrollLeft: number,
	clientWidth: number,
	scrollWidth: number,
	slack = 1,
): { start: boolean; end: boolean } {
	return {
		start: scrollLeft > slack,
		end: scrollLeft + clientWidth < scrollWidth - slack,
	};
}
