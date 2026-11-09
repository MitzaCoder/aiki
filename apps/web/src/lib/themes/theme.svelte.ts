/**
 * The chosen theme, in runes, plus writing it to the document.
 *
 * `app.html` already applied the stored theme before the first paint; `load()`
 * only reads it back for the picker, so nothing flashes on the way in.
 */
import { DEFAULT_THEME, loadTheme, saveTheme, type ThemeId } from "./themes.ts";

class ThemeChoice {
	current = $state<ThemeId>(DEFAULT_THEME);

	#loaded = false;
	#storage: Pick<Storage, "getItem" | "setItem"> | undefined = undefined;

	/** Read the browser's stored theme once, keeping the storage for later writes. */
	load(): void {
		if (this.#loaded) return;
		this.#loaded = true;
		try {
			this.#storage = window.localStorage;
		} catch {
			this.#storage = undefined;
		}
		this.current = loadTheme(this.#storage);
		this.apply();
	}

	set(id: ThemeId): void {
		this.current = id;
		saveTheme(id, this.#storage);
		this.apply();
	}

	apply(): void {
		if (typeof document === "undefined") return;
		document.documentElement.dataset.theme = this.current;
	}
}

export const theme = new ThemeChoice();
