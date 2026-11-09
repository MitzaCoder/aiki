/** The "wrap code" choice and the edge fade of a scrolling code block. */
import { describe, expect, test } from "bun:test";
import { CODE_WRAP_STORAGE_KEY, effectiveWrap, loadCodeWrap, parseCodeWrap, saveCodeWrap, scrollFade } from "../src/lib/code-wrap.ts";

function memory(initial: Record<string, string> = {}): Pick<Storage, "getItem" | "setItem"> & { data: Record<string, string> } {
	const data = { ...initial };
	return { data, getItem: (key) => data[key] ?? null, setItem: (key, value) => void (data[key] = value) };
}

describe("wrap preference", () => {
	test("reads only the two known values", () => {
		expect(parseCodeWrap("wrap")).toBe("wrap");
		expect(parseCodeWrap("scroll")).toBe("scroll");
		expect(parseCodeWrap("yes")).toBeUndefined();
		expect(parseCodeWrap(null)).toBeUndefined();
	});

	test("is remembered", () => {
		const storage = memory();
		expect(loadCodeWrap(storage)).toBeUndefined();
		saveCodeWrap(storage, "wrap");
		expect(storage.data[CODE_WRAP_STORAGE_KEY]).toBe("wrap");
		expect(loadCodeWrap(storage)).toBe("wrap");
	});

	test("survives storage that throws", () => {
		const broken = {
			getItem: () => {
				throw new Error("denied");
			},
			setItem: () => {
				throw new Error("denied");
			},
		};
		expect(loadCodeWrap(broken)).toBeUndefined();
		expect(() => saveCodeWrap(broken, "scroll")).not.toThrow();
	});

	test("a block's own default holds until the reader chooses", () => {
		expect(effectiveWrap(undefined, true)).toBe(true);
		expect(effectiveWrap(undefined, false)).toBe(false);
		expect(effectiveWrap("scroll", true)).toBe(false);
		expect(effectiveWrap("wrap", false)).toBe(true);
	});
});

describe("scroll fade", () => {
	test("right at the start, left at the end, both between, none when it fits", () => {
		expect(scrollFade(0, 400, 900)).toEqual({ start: false, end: true });
		expect(scrollFade(200, 400, 900)).toEqual({ start: true, end: true });
		expect(scrollFade(500, 400, 900)).toEqual({ start: true, end: false });
		expect(scrollFade(0, 400, 400)).toEqual({ start: false, end: false });
	});

	test("forgives a pixel of rounding", () => {
		expect(scrollFade(0.5, 400, 400.5)).toEqual({ start: false, end: false });
		expect(scrollFade(499.6, 400, 900)).toEqual({ start: true, end: false });
	});
});
