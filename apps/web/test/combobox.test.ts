import { describe, expect, test } from "bun:test";
import { filterOptions, matchesQuery, moveActive, selectable, type ComboOption } from "../src/lib/combobox.ts";

const options: ComboOption[] = [
	{ value: "", label: "Model default" },
	{ value: "a/1", label: "Claude Sonnet", description: "sonnet-4-5", group: "a", groupLabel: "Anthropic" },
	{ value: "a/2", label: "Claude Haiku", description: "haiku-4-5", group: "a", groupLabel: "Anthropic", disabled: true },
	{ value: "o/1", label: "GPT-5", description: "gpt-5", group: "o", groupLabel: "OpenAI", keywords: "o" },
];

describe("combobox filter", () => {
	test("no query keeps everything, the unnamed group first", () => {
		const groups = filterOptions(options);
		expect(groups.map((group) => group.label)).toEqual([undefined, "Anthropic", "OpenAI"]);
		expect(groups[1]?.options).toHaveLength(2);
	});

	test("every word must match some part of the row, in any case", () => {
		expect(matchesQuery(options[1]!, "claude son")).toBe(true);
		expect(matchesQuery(options[1]!, "claude gpt")).toBe(false);
		expect(matchesQuery(options[1]!, "anthropic")).toBe(true);
		expect(filterOptions(options, "OPENAI").map((group) => group.id)).toEqual(["o"]);
		expect(filterOptions(options, "zzz")).toEqual([]);
	});

	test("the keyboard skips disabled rows", () => {
		expect(selectable(filterOptions(options)).map((option) => option.value)).toEqual(["", "a/1", "o/1"]);
	});

	test("moving wraps and starts at an end", () => {
		expect(moveActive(-1, 3, "next")).toBe(0);
		expect(moveActive(2, 3, "next")).toBe(0);
		expect(moveActive(-1, 3, "previous")).toBe(2);
		expect(moveActive(0, 3, "previous")).toBe(2);
		expect(moveActive(1, 3, "last")).toBe(2);
		expect(moveActive(1, 0, "next")).toBe(-1);
	});
});
