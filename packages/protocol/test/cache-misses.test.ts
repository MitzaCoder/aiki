import { describe, expect, it } from "bun:test";
import {
	CacheMissTracker,
	isNotableCacheMiss,
	LONG_PROMPT_CACHE_TTL_MS,
	PROMPT_CACHE_TTL_MS,
} from "../src/cache-misses.ts";
import { describePromptChange } from "../src/cache-stats.ts";

const MINUTE = 60_000;
/** Anthropic-like prices per token: input $3/M, cache write $3.75/M, cache read $0.30/M. */
const INPUT = 3e-6;
const WRITE = 3.75e-6;
const READ = 0.3e-6;

function reply(
	at: number,
	usage: { input: number; cacheRead: number; cacheWrite: number; cacheWrite1h?: number },
	model = "claude-sonnet-5",
	provider = "anthropic",
): unknown {
	return {
		role: "assistant",
		provider,
		model,
		timestamp: at,
		content: [],
		usage: {
			...usage,
			output: 100,
			totalTokens: usage.input + usage.cacheRead + usage.cacheWrite + 100,
			cost: {
				input: usage.input * INPUT,
				cacheRead: usage.cacheRead * READ,
				cacheWrite: usage.cacheWrite * WRITE,
				output: 0,
				total: 0,
			},
		},
	};
}

describe("CacheMissTracker", () => {
	it("counts nothing on the first request or on hits", () => {
		const tracker = new CacheMissTracker();
		expect(tracker.observe(reply(0, { input: 10, cacheRead: 0, cacheWrite: 50_000 }))).toBeUndefined();
		expect(tracker.observe(reply(MINUTE, { input: 10, cacheRead: 50_000, cacheWrite: 2_000 }))).toBeUndefined();
	});

	it("measures a miss against the smaller prompt and prices it at the paid rate minus the read rate", () => {
		const tracker = new CacheMissTracker();
		tracker.observe(reply(0, { input: 10, cacheRead: 40_000, cacheWrite: 10_000 }));
		const miss = tracker.observe(reply(12 * MINUTE, { input: 10, cacheRead: 0, cacheWrite: 52_000 }));
		expect(miss?.missedTokens).toBe(50_010);
		expect(miss?.reason).toBe("idle");
		expect(miss?.idleMs).toBe(12 * MINUTE);
		// Paid at the write rate (the input share is tiny), read rate learned from the earlier request.
		const paid = (10 * INPUT + 52_000 * WRITE) / 52_010;
		expect(miss?.missedCost).toBeCloseTo(50_010 * (paid - READ), 8);
		expect(isNotableCacheMiss(miss!)).toBe(true);
	});

	it("names a model switch before an idle gap, and calls the rest unexplained", () => {
		const tracker = new CacheMissTracker();
		tracker.observe(reply(0, { input: 10, cacheRead: 30_000, cacheWrite: 0 }));
		expect(tracker.observe(reply(20 * MINUTE, { input: 10, cacheRead: 0, cacheWrite: 30_000 }, "claude-opus-5-5"))?.reason).toBe(
			"model_switch",
		);
		expect(tracker.observe(reply(20 * MINUTE + 5_000, { input: 10, cacheRead: 2_000, cacheWrite: 28_500 }, "claude-opus-5-5"))?.reason).toBe(
			"unexplained",
		);
	});

	it("names changed instructions when a system entry came since the previous request", () => {
		const tracker = new CacheMissTracker();
		tracker.observeEntry({ kind: "pi.assistant", model: [reply(0, { input: 10, cacheRead: 30_000, cacheWrite: 0 })] });
		tracker.observeEntry({ kind: "pi.system", model: [] });
		const [miss] = tracker.observeEntry({
			kind: "pi.assistant",
			model: [reply(20 * MINUTE, { input: 10, cacheRead: 0, cacheWrite: 30_500 })],
		});
		expect(miss?.reason).toBe("instructions_changed");
		// Only the request right after it.
		const [next] = tracker.observeEntry({
			kind: "pi.assistant",
			model: [reply(20 * MINUTE + 1_000, { input: 10, cacheRead: 0, cacheWrite: 30_600 })],
		});
		expect(next?.reason).toBe("unexplained");
	});

	it("ignores misses at the noise floor", () => {
		const tracker = new CacheMissTracker();
		tracker.observe(reply(0, { input: 10, cacheRead: 30_000, cacheWrite: 0 }));
		expect(tracker.observe(reply(1_000, { input: 10, cacheRead: 28_986, cacheWrite: 1_100 }))).toBeUndefined();
	});

	it("starts over after a compaction or a reset entry", () => {
		const tracker = new CacheMissTracker();
		tracker.observeEntry({ kind: "pi.assistant", model: [reply(0, { input: 10, cacheRead: 80_000, cacheWrite: 0 })] });
		expect(tracker.observeEntry({ kind: "pi.compaction", model: [{ role: "user", content: "summary" }] })).toEqual([]);
		expect(
			tracker.observeEntry({ kind: "pi.assistant", model: [reply(1_000, { input: 10, cacheRead: 0, cacheWrite: 8_000 })] }),
		).toEqual([]);
		tracker.observeEntry({ kind: "pi.reset" });
		expect(
			tracker.observeEntry({ kind: "pi.assistant", model: [reply(2_000, { input: 9_000, cacheRead: 0, cacheWrite: 0 })] }),
		).toEqual([]);
	});

	it("says nothing for a provider that never reports cache use", () => {
		const tracker = new CacheMissTracker();
		tracker.observe(reply(0, { input: 30_000, cacheRead: 0, cacheWrite: 0 }));
		expect(tracker.observe(reply(1_000, { input: 31_000, cacheRead: 0, cacheWrite: 0 }))).toBeUndefined();
	});

	it("counts a request that used no cache once an earlier one did", () => {
		const tracker = new CacheMissTracker({ cacheReadPerToken: () => READ });
		tracker.observe(reply(0, { input: 10, cacheRead: 0, cacheWrite: 30_000 }));
		const miss = tracker.observe(reply(1_000, { input: 31_000, cacheRead: 0, cacheWrite: 0 }));
		expect(miss?.missedTokens).toBe(30_010);
		expect(miss?.reason).toBe("unexplained");
		expect(miss?.missedCost).toBeCloseTo(30_010 * (INPUT - READ), 8);
	});

	it("keeps the previous request across a failed one with no usage", () => {
		const tracker = new CacheMissTracker();
		tracker.observe(reply(0, { input: 10, cacheRead: 30_000, cacheWrite: 0 }));
		expect(tracker.observe(reply(1_000, { input: 0, cacheRead: 0, cacheWrite: 0 }))).toBeUndefined();
		expect(tracker.observe(reply(2_000, { input: 10, cacheRead: 0, cacheWrite: 30_000 }))?.missedTokens).toBe(30_010);
	});

	it("skips anything that is not an assistant message with usage", () => {
		const tracker = new CacheMissTracker();
		expect(tracker.observe({ role: "user", content: "hi" })).toBeUndefined();
		expect(tracker.observe(null)).toBeUndefined();
		expect(tracker.observe({ role: "assistant", content: [] })).toBeUndefined();
	});
});

describe("the one-hour cache", () => {
	/** A request that wrote its new tokens to the one-hour cache, as pi-ai's "long" retention asks Anthropic to. */
	const hour = (at: number, usage: { input: number; cacheRead: number; cacheWrite: number }) =>
		reply(at, { ...usage, cacheWrite1h: usage.cacheWrite });

	it("does not call a gap shorter than an hour idle after a one-hour write", () => {
		const tracker = new CacheMissTracker();
		tracker.observe(hour(0, { input: 10, cacheRead: 0, cacheWrite: 50_000 }));
		expect(tracker.observe(hour(20 * MINUTE, { input: 10, cacheRead: 50_000, cacheWrite: 200 }))).toBeUndefined();
		const miss = tracker.observe(hour(40 * MINUTE, { input: 10, cacheRead: 0, cacheWrite: 50_300 }));
		expect(miss).toMatchObject({ reason: "unexplained", idleMs: 20 * MINUTE, cacheTtlMs: LONG_PROMPT_CACHE_TTL_MS });
		expect(tracker.observe(hour(110 * MINUTE, { input: 10, cacheRead: 0, cacheWrite: 50_400 }))?.reason).toBe("idle");
	});

	it("keeps the previous lifetime over a request that wrote nothing, and drops it after a short write", () => {
		const tracker = new CacheMissTracker();
		tracker.observe(hour(0, { input: 10, cacheRead: 0, cacheWrite: 50_000 }));
		tracker.observe(reply(MINUTE, { input: 10, cacheRead: 50_000, cacheWrite: 0 }));
		expect(tracker.previous?.cacheTtlMs).toBe(LONG_PROMPT_CACHE_TTL_MS);
		expect(tracker.observe(reply(15 * MINUTE, { input: 10, cacheRead: 0, cacheWrite: 50_100 }))?.reason).toBe("unexplained");
		// That write was a five-minute one: the next gap of ten minutes is past it.
		const miss = tracker.observe(reply(25 * MINUTE, { input: 10, cacheRead: 0, cacheWrite: 50_200 }));
		expect(miss).toMatchObject({ reason: "idle", cacheTtlMs: PROMPT_CACHE_TTL_MS });
	});

	it("goes on from a seeded one-hour lifetime", () => {
		const tracker = new CacheMissTracker();
		tracker.seed({
			promptTokens: 50_010,
			modelKey: "anthropic/claude-sonnet-5",
			timestamp: 0,
			reportedCache: true,
			cacheTtlMs: LONG_PROMPT_CACHE_TTL_MS,
		});
		expect(tracker.observe(reply(30 * MINUTE, { input: 10, cacheRead: 0, cacheWrite: 50_100 }))?.reason).toBe("unexplained");
	});
});

describe("carrying a tracker across a restart", () => {
	it("goes on from a seeded previous request as if it had seen it", () => {
		const first = new CacheMissTracker();
		first.observe(reply(0, { input: 10, cacheRead: 0, cacheWrite: 50_000 }));
		const previous = first.previous;
		expect(previous).toEqual({
			promptTokens: 50_010,
			modelKey: "anthropic/claude-sonnet-5",
			timestamp: 0,
			reportedCache: true,
			cacheTtlMs: PROMPT_CACHE_TTL_MS,
		});

		const next = new CacheMissTracker();
		if (previous !== undefined) next.seed(previous);
		expect(next.observe(reply(10 * MINUTE, { input: 10, cacheRead: 0, cacheWrite: 50_100 }))?.reason).toBe("idle");
	});

	it("puts a miss down to changed instructions when told so", () => {
		const tracker = new CacheMissTracker();
		tracker.observe(reply(0, { input: 10, cacheRead: 0, cacheWrite: 50_000 }));
		tracker.instructionsChanged();
		expect(tracker.observe(reply(MINUTE, { input: 10, cacheRead: 0, cacheWrite: 50_100 }))?.reason).toBe("instructions_changed");
	});
});

describe("describePromptChange", () => {
	it("words every change code for people", () => {
		expect(describePromptChange("restart")).toBe("The conversation started over (a summary or a reset)");
		expect(describePromptChange("section:context")).toBe("Instructions “context” changed");
		expect(describePromptChange("tool-:bash")).toBe("Tool bash was removed");
		expect(describePromptChange("history:3/40")).toBe("Earlier message 3 of 40 differs");
		expect(describePromptChange("update:skills,tools")).toBe("Instructions “skills,tools” were updated mid-conversation");
		expect(describePromptChange("wire:system[1]")).toBe("The request sent to the provider differs at system[1]");
		expect(describePromptChange("something-new")).toBe("something-new");
	});
});
