/** The Usage screen's prompt cache section: money, labels, what changed, and the what-if sentences. */
import { describe, expect, test } from "bun:test";
import type { CacheMissDetail, CacheStats } from "@kemiri/protocol";
import {
	changeLines,
	conversationLabel,
	dayBars,
	longCacheLine,
	missHeadline,
	money,
	percent,
	summaryLines,
	tokens,
	wakeAdvice,
	wakePhrase,
} from "../src/lib/cache-stats.ts";

function stats(overrides: Partial<CacheStats> = {}): CacheStats {
	return {
		from: "2026-11-01T00:00:00.000Z",
		to: "2026-11-06T00:00:00.000Z",
		keptDays: 90,
		liveSince: null,
		totals: {
			requests: 5396,
			inputTokens: 20_000_000,
			cacheReadTokens: 620_000_000,
			cacheWriteTokens: 8_500_000,
			outputTokens: 2_000_000,
			cost: 284.4,
			misses: 91,
			missedTokens: 14_900_000,
			missedCost: 69.41,
		},
		byReason: [],
		byProject: [],
		byKind: [],
		byModel: [],
		byWake: [
			{ wake: "check_in", wakes: 98, turnCost: 35.52, misses: 36, missedCost: 29.96 },
			{ wake: "user", wakes: 71, turnCost: 43.52, misses: 18, missedCost: 12.77 },
			{ wake: "worker_report", wakes: 166, turnCost: 28.77, misses: 7, missedCost: 6.83 },
		],
		days: [
			{ day: "2026-11-05", requests: 3, cost: 2, misses: 1, missedCost: 0.5 },
			{ day: "2026-11-06", requests: 1, cost: 4, misses: 0, missedCost: 0 },
		],
		conversations: [],
		misses: [],
		longCache: { requests: 1238, missesAvoided: 61, saved: 55.57, extraWriteCost: 10.77, net: 44.8, stillMissed: 2 },
		...overrides,
	};
}

const miss: CacheMissDetail = {
	at: "2026-11-06T12:27:00.000Z",
	projectId: "p",
	projectName: "Project",
	conversationId: 1,
	kind: "worker",
	threadId: "nightly",
	workerId: "qa-4316",
	taskId: "T15",
	provider: "anthropic",
	model: "claude-opus-5-5",
	idleMs: 10 * 60_000,
	missedTokens: 273_000,
	missedCost: 1.31,
	reason: "idle",
	wake: "check_in",
	changes: [],
	source: "live",
};

describe("cache stats wording", () => {
	test("reads money, tokens and shares the way a sentence does", () => {
		expect(money(0)).toBe("$0");
		expect(money(0.004)).toBe("<$0.01");
		expect(money(1.314)).toBe("$1.31");
		expect(money(284.4)).toBe("$284");
		expect(tokens(14_900_000)).toBe("14.9M");
		expect(tokens(273_000)).toBe("273k");
		expect(percent(1, 300)).toBe("<1%");
		expect(percent(0, 0)).toBe("0%");
	});

	test("sums up spend, reuse and what was billed again", () => {
		expect(summaryLines(stats())).toEqual({
			spent: "$284 on 5,396 requests",
			cached: "96% of the prompt read from the cache",
			rebilled: "$69.41 billed again in 91 misses (24% of the cost)",
		});
		expect(summaryLines(stats({ totals: { ...stats().totals, misses: 0 } })).rebilled).toBe("Nothing billed again");
	});

	test("names the conversation and the miss", () => {
		expect(conversationLabel(miss)).toBe("Worker qa-4316 · in nightly · T15");
		expect(conversationLabel({ kind: "main", threadId: "main", workerId: null, taskId: null })).toBe("Main");
		expect(missHeadline(miss)).toBe("Waited too long (10m)");
		expect(missHeadline({ ...miss, reason: "unexplained" })).toBe("No visible reason");
		expect(wakePhrase("check_in")).toBe("a worker check-in");
	});

	test("says what changed, or why it cannot", () => {
		expect(changeLines(null)).toEqual(["Not recorded: this request was read back from the transcript."]);
		expect(changeLines([])).toEqual(["Nothing in the request changed: the provider dropped its copy early."]);
		expect(changeLines(["section:context", "tool+:write"])).toEqual(["Instructions “context” changed", "Tool write was added"]);
	});

	test("puts the what-ifs in sentences", () => {
		expect(longCacheLine(stats())).toBe(
			"Keeping the cache for an hour instead of 5 minutes (Claude models only) would have avoided 61 misses, saving $55.57; writing it costs more, $10.77 extra. It would have saved $44.80 overall.",
		);
		expect(longCacheLine(stats({ longCache: { requests: 0, missesAvoided: 0, saved: 0, extraWriteCost: 0, net: 0, stillMissed: 0 } }))).toBeUndefined();
		// What is on already is said, not proposed; the what-if covers the rest.
		expect(
			longCacheLine(stats({ longCache: { requests: 0, missesAvoided: 0, saved: 0, extraWriteCost: 0, net: 0, stillMissed: 0, alreadyLong: 640 } })),
		).toBe("The one-hour cache was on for 640 Claude requests.");
		expect(
			longCacheLine(stats({ longCache: { requests: 577, missesAvoided: 4, saved: 3.95, extraWriteCost: 2.55, net: 1.4, stillMissed: 0, alreadyLong: 640 } })),
		).toBe(
			"The one-hour cache was on for 640 Claude requests. Keeping the cache for an hour instead of 5 minutes for the other 577 Claude requests would have avoided 4 misses, saving $3.95; writing it costs more, $2.55 extra. It would have saved $1.40 overall.",
		);
		// Only wakes the harness causes are advice material, dearest first; the user's own messages are the work.
		expect(wakeAdvice(stats(), 30)).toEqual([
			"Worker check-ins: 98 in 30 days, about $0.36 each, $0.31 of it the cache billed again. Half as many would save about $17.76.",
			"Worker reports: 166 in 30 days, about $0.17 each, $0.04 of it the cache billed again. Half as many would save about $14.38.",
		]);
	});

	test("scales the daily bars to the dearest day", () => {
		expect(dayBars(stats())).toEqual([
			{ day: "2026-11-05", cost: 2, missedCost: 0.5, height: 0.5, missedHeight: 0.125 },
			{ day: "2026-11-06", cost: 4, missedCost: 0, height: 1, missedHeight: 0 },
		]);
	});
});
