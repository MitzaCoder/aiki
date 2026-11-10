/** The prompt cache in the transcript and the Info tab: which turns get a miss line, and how lines and totals read. */
import { describe, expect, test } from "bun:test";
import type { CacheMiss, EntryRecord } from "@aiki/protocol";
import { cacheMissDetail, cacheMissLine, cacheMissTotalsView, idleTime, turnUsageTitle } from "../src/lib/chat/cache.ts";
import { buildTranscript } from "../src/lib/transcript.ts";

const MINUTE = 60_000;

function userEntry(id: number, timestamp: number): EntryRecord {
	return { id, conversationId: 1, kind: "pi.user", model: [{ role: "user", content: "Go on.", timestamp }] };
}

function replyEntry(id: number, timestamp: number, usage: { input: number; cacheRead: number; cacheWrite: number }): EntryRecord {
	return {
		id,
		conversationId: 1,
		kind: "pi.assistant",
		model: [
			{
				role: "assistant",
				provider: "anthropic",
				model: "claude-sonnet-5",
				timestamp,
				content: [{ type: "text", text: "Done." }],
				usage: {
					...usage,
					output: 50,
					cost: {
						input: usage.input * 3e-6,
						cacheRead: usage.cacheRead * 0.3e-6,
						cacheWrite: usage.cacheWrite * 3.75e-6,
						output: 0,
						total: usage.input * 3e-6 + usage.cacheRead * 0.3e-6 + usage.cacheWrite * 3.75e-6,
					},
				},
			},
		],
	};
}

describe("cache misses in the transcript", () => {
	test("a turn after a long idle gap carries its miss; a hit and a small miss carry none", () => {
		const items = buildTranscript(
			[
				userEntry(1, 0),
				replyEntry(2, 1_000, { input: 10, cacheRead: 0, cacheWrite: 80_000 }),
				userEntry(3, 2 * MINUTE),
				replyEntry(4, 2 * MINUTE, { input: 10, cacheRead: 80_000, cacheWrite: 300 }),
				userEntry(5, 3 * MINUTE),
				replyEntry(6, 3 * MINUTE, { input: 10, cacheRead: 75_000, cacheWrite: 5_400 }),
				userEntry(7, 20 * MINUTE),
				replyEntry(8, 20 * MINUTE, { input: 10, cacheRead: 0, cacheWrite: 80_500 }),
			],
			undefined,
		);
		const turns = items.filter((item) => item.kind === "turn");
		expect(turns.map((turn) => turn.cacheMisses?.length ?? 0)).toEqual([0, 0, 0, 1]);
		const miss = turns[3]?.cacheMisses?.[0];
		expect(miss?.reason).toBe("idle");
		expect(miss?.missedTokens).toBe(80_410);
		expect(turns[1]?.usage).toMatchObject({ input: 10, cacheRead: 80_000, cacheWrite: 300, output: 50 });
	});

	test("a compaction starts over, so the first reply after it has nothing to miss", () => {
		const items = buildTranscript(
			[
				replyEntry(1, 0, { input: 10, cacheRead: 0, cacheWrite: 80_000 }),
				{ id: 2, conversationId: 1, kind: "pi.compaction", model: [{ role: "user", content: "Summary.", timestamp: 1 }] },
				replyEntry(3, 1_000, { input: 10, cacheRead: 0, cacheWrite: 9_000 }),
			],
			undefined,
		);
		expect(items.filter((item) => item.kind === "turn").every((turn) => turn.cacheMisses === undefined)).toBe(true);
	});
});

describe("cache wording", () => {
	const miss = (reason: CacheMiss["reason"], idleMs = 30_000, cacheTtlMs = 5 * MINUTE): CacheMiss => ({
		missedTokens: 84_213,
		missedCost: 0.4212,
		idleMs,
		cacheTtlMs,
		reason,
	});

	test("lines name the cause", () => {
		expect(cacheMissLine(miss("idle", 12 * MINUTE))).toBe("Cache miss after 12m idle: 84.2k tokens re-billed (~$0.42)");
		expect(cacheMissLine(miss("model_switch"))).toBe("Cache miss after switching models: 84.2k tokens re-billed (~$0.42)");
		expect(cacheMissLine(miss("instructions_changed"))).toContain("after the instructions changed");
		expect(cacheMissLine({ ...miss("unexplained"), missedCost: 0.004 })).toBe("Cache miss: 84.2k tokens re-billed");
		expect(cacheMissDetail(miss("unexplained"))).toContain("shouldn't happen");
		expect(cacheMissDetail(miss("idle", 12 * MINUTE))).toContain("idle for 12m");
	});

	test("details say how long the cache lasted", () => {
		expect(cacheMissDetail(miss("idle", 12 * MINUTE))).toContain("The cache lasts about 5 minutes;");
		expect(cacheMissDetail(miss("idle", 75 * MINUTE, 60 * MINUTE))).toContain("The cache lasts about an hour; the conversation was idle for 1h 15m.");
		// Twenty minutes under the one-hour cache is no idle miss: it says so, and why that is odd.
		const early = cacheMissDetail(miss("unexplained", 20 * MINUTE, 60 * MINUTE));
		expect(early).toContain("It came 20m after the previous request, while the cache should still have had it (it lasts about an hour)");
	});

	test("idle times read in minutes, then hours", () => {
		expect(idleTime(20_000)).toBe("1m");
		expect(idleTime(12 * MINUTE)).toBe("12m");
		expect(idleTime(60 * MINUTE)).toBe("1h");
		expect(idleTime(95 * MINUTE)).toBe("1h 35m");
	});

	test("the footer's tooltip spells out the cache", () => {
		const title = turnUsageTitle({ input: 1_200, output: 300, cacheRead: 84_000, cacheWrite: 2_000, cost: 0.1 });
		expect(title).toContain("84,000 read from the cache");
		expect(title).toContain("2,000 written to the cache");
		expect(title).toContain("96% of the prompt came from the cache");
	});

	test("totals stay quiet when every miss is explained, and warn when some are not", () => {
		const base = {
			misses: 3,
			missedTokens: 150_000,
			missedCost: 0.6,
			unexplained: 0,
			unexplainedTokens: 0,
			unexplainedCost: 0,
			lastUnexplainedAt: null,
		};
		expect(cacheMissTotalsView(undefined)).toBeUndefined();
		expect(cacheMissTotalsView({ ...base, misses: 0 })).toBeUndefined();
		expect(cacheMissTotalsView(base)).toMatchObject({ warning: false, label: "3 cache misses, each after idle time or a change" });
		const unexplained = cacheMissTotalsView({
			...base,
			unexplained: 1,
			unexplainedTokens: 31_000,
			unexplainedCost: 0.09,
			lastUnexplainedAt: "2026-11-06T10:00:00.000Z",
		});
		expect(unexplained?.warning).toBe(true);
		expect(unexplained?.label).toBe("1 cache miss with no clear cause · 31k tokens (~$0.09)");
	});
});
