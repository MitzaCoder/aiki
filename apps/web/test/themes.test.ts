/**
 * The theme registry is the single list of themes; the app's CSS, `app.html` and
 * the picker all follow it. These checks keep the four in step.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
	DEFAULT_THEME,
	THEMES,
	THEME_STORAGE_KEY,
	isThemeId,
	loadTheme,
	parseTheme,
	saveTheme,
} from "../src/lib/themes/themes.ts";

const web = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(`${web}${path}`, "utf8");

function fakeStorage(initial: Record<string, string> = {}) {
	const data = new Map(Object.entries(initial));
	return {
		data,
		getItem: (key: string) => data.get(key) ?? null,
		setItem: (key: string, value: string) => void data.set(key, value),
	};
}

describe("theme registry", () => {
	test("has a default that is one of the themes", () => {
		expect(isThemeId(DEFAULT_THEME)).toBe(true);
		expect(THEMES.length).toBeGreaterThan(1);
	});

	test("falls back to the default for anything unknown", () => {
		expect(parseTheme("jarvis")).toBe("jarvis");
		expect(parseTheme("solarized")).toBe(DEFAULT_THEME);
		expect(parseTheme(null)).toBe(DEFAULT_THEME);
		expect(parseTheme(undefined)).toBe(DEFAULT_THEME);
		expect(isThemeId("jarvis")).toBe(true);
		expect(isThemeId("")).toBe(false);
	});

	test("remembers the choice in storage, and survives storage that throws", () => {
		const storage = fakeStorage();
		expect(loadTheme(storage)).toBe(DEFAULT_THEME);
		saveTheme("neutral", storage);
		expect(storage.data.get(THEME_STORAGE_KEY)).toBe("neutral");
		expect(loadTheme(storage)).toBe("neutral");

		const broken = {
			getItem: () => {
				throw new Error("denied");
			},
			setItem: () => {
				throw new Error("denied");
			},
		};
		expect(loadTheme(broken)).toBe(DEFAULT_THEME);
		expect(() => saveTheme("jarvis", broken)).not.toThrow();
	});
});

describe("theme files", () => {
	for (const { id } of THEMES) {
		test(`${id} defines light and dark tones and is imported`, () => {
			const css = read(`src/lib/themes/${id}.css`);
			expect(css).toContain(`:root[data-theme='${id}']`);
			expect(css).toContain(`:root[data-theme='${id}'].dark`);
			for (const tone of ["--tone-bg", "--tone-fg", "--tone-accent-2", "--tone-primary"]) {
				expect(css).toContain(tone);
			}
			expect(read("src/app.css")).toContain(`./lib/themes/${id}.css`);
		});
	}

	test("app.html lists every theme before the first paint, with the same storage key", () => {
		const html = read("src/app.html");
		expect(html).toContain(THEME_STORAGE_KEY);
		const listed = /const THEMES = \[([^\]]*)\]/.exec(html)?.[1] ?? "";
		const ids = [...listed.matchAll(/'([^']+)'/g)].map((match) => match[1]);
		expect(ids).toEqual(THEMES.map((theme) => theme.id));
	});
});
