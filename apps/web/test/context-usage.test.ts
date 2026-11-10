/**
 * How the Info tab reads context usage: the bar against the model's window, the thresholds where compaction starts and
 * blocks, and the compaction count. Pure functions, tested here.
 */
import { describe, expect, test } from "bun:test";
import type { ContextUsage } from "@aiki/protocol";
import { contextUsageView, formatTokenCount, usagePercent } from "../src/lib/context-usage.ts";

function usage(overrides: Partial<ContextUsage> = {}): ContextUsage {
	return {
		contextTokens: 40_000,
		contextWindow: 200_000,
		backgroundAt: 70_000,
		blockingAt: 100_000,
		compactions: 0,
		lastCompactionAt: null,
		compacting: false,
		...overrides,
	};
}

const NOW = Date.parse("2026-11-05T12:00:00.000Z");

describe("formatTokenCount", () => {
	test("reads small counts exactly and large ones in k", () => {
		expect(formatTokenCount(0)).toBe("0");
		expect(formatTokenCount(840)).toBe("840");
		expect(formatTokenCount(1_000)).toBe("1k");
		expect(formatTokenCount(1_500)).toBe("1.5k");
		expect(formatTokenCount(12_340)).toBe("12.3k");
		expect(formatTokenCount(70_000)).toBe("70k");
		expect(formatTokenCount(200_000)).toBe("200k");
		expect(formatTokenCount(1_234_567)).toBe("1235k");
	});
});

describe("usagePercent", () => {
	test("is the filled fraction of the window, clamped", () => {
		expect(usagePercent(50_000, 200_000)).toBe(25);
		expect(usagePercent(1, 3)).toBe(33.3);
		expect(usagePercent(0, 200_000)).toBe(0);
		expect(usagePercent(250_000, 200_000)).toBe(100);
	});

	test("has no answer without a usable window", () => {
		expect(usagePercent(1_000, null)).toBeUndefined();
		expect(usagePercent(1_000, 0)).toBeUndefined();
	});
});

describe("contextUsageView", () => {
	test("fills the bar and marks both thresholds inside the window", () => {
		const view = contextUsageView(usage(), NOW);
		expect(view.measured).toBe(true);
		expect(view.percent).toBe(20);
		expect(view.percentLabel).toBe("20%");
		expect(view.tokensLabel).toBe("40k / 200k");
		expect(view.backgroundPercent).toBe(35);
		expect(view.blockingPercent).toBe(50);
		expect(view.backgroundLabel).toBe("background at 70k");
		expect(view.blockingLabel).toBe("blocking at 100k");
	});

	test("starts the bar empty before the first answer", () => {
		const view = contextUsageView(usage({ contextTokens: null }), NOW);
		expect(view.measured).toBe(true);
		expect(view.percent).toBe(0);
		expect(view.tokensLabel).toBe("— / 200k");
	});

	test("leaves the numbers out when no model is set", () => {
		const view = contextUsageView(
			usage({ contextWindow: null, contextTokens: null, backgroundAt: null, blockingAt: null }),
			NOW,
		);
		expect(view.measured).toBe(false);
		expect(view.tokensLabel).toBe("—");
		expect(view.percentLabel).toBe("");
		expect(view.backgroundPercent).toBeUndefined();
		expect(view.blockingPercent).toBeUndefined();
		expect(view.backgroundLabel).toBeUndefined();
		expect(view.blockingLabel).toBeUndefined();
	});

	test("counts compactions and says when the last one was", () => {
		expect(contextUsageView(usage(), NOW).compactionsLabel).toBe("No compactions yet");
		expect(contextUsageView(usage({ compactions: 1 }), NOW).compactionsLabel).toBe("1 compaction");
		const view = contextUsageView(
			usage({ compactions: 3, lastCompactionAt: "2026-11-05T11:55:00.000Z" }),
			NOW,
		);
		expect(view.compactionsLabel).toBe("3 compactions · last 5 min ago");
		expect(view.lastCompactionTitle).toBeDefined();
	});

	test("a compaction count without a time still reads as a count", () => {
		const view = contextUsageView(usage({ compactions: 2, lastCompactionAt: null }), NOW);
		expect(view.compactionsLabel).toBe("2 compactions");
		expect(view.lastCompactionTitle).toBeUndefined();
	});
});
