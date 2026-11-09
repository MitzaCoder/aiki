import { describe, expect, test } from "bun:test";
import { thinkingBars, thinkingLabel, thinkingOptions } from "../src/lib/thinking.ts";

describe("thinking dropdown", () => {
	test("model default first, then the model's levels by effort", () => {
		const options = thinkingOptions(["high", "off", "medium"], null);
		expect(options.map((option) => option.value)).toEqual(["", "off", "medium", "high"]);
		expect(options[0]?.label).toBe("Model default");
	});

	test("a stored level the model lacks stays, marked", () => {
		const options = thinkingOptions(["low"], "xhigh");
		expect(options.map((option) => option.value)).toEqual(["", "low", "xhigh"]);
		expect(options[2]?.description).toContain("does not list it");
	});

	test("labels and bars", () => {
		expect(thinkingLabel("xhigh")).toBe("Xhigh");
		expect(thinkingLabel(null)).toBe("Model default");
		expect(thinkingBars(null)).toBe(0);
		expect(thinkingBars("medium")).toBe(2);
		expect(thinkingBars("max")).toBe(4);
	});
});
