import { describe, expect, test } from "bun:test";
import { compactRelativeTime, elapsedFor } from "../src/lib/relative-time.ts";

describe("compactRelativeTime", () => {
	const START = "2026-11-05T12:00:00.000Z";
	const at = (iso: string) => Date.parse(iso);

	test("one unit, no suffix", () => {
		expect(compactRelativeTime(START, at("2026-11-05T12:00:30.000Z"))).toBe("now");
		expect(compactRelativeTime(START, at("2026-11-05T12:24:00.000Z"))).toBe("24m");
		expect(compactRelativeTime(START, at("2026-11-05T15:10:00.000Z"))).toBe("3h");
		expect(compactRelativeTime(START, at("2026-11-07T12:00:00.000Z"))).toBe("2d");
		expect(compactRelativeTime("not a date", at(START))).toBe("");
	});
});

describe("elapsedFor", () => {
	const START = "2026-11-05T12:00:00.000Z";
	const now = (at: string) => Date.parse(at);

	test("seconds, then minutes, then hours and minutes", () => {
		expect(elapsedFor(START, now(START))).toBe("0s");
		expect(elapsedFor(START, now("2026-11-05T12:00:45.000Z"))).toBe("45s");
		expect(elapsedFor(START, now("2026-11-05T12:03:00.000Z"))).toBe("3m");
		expect(elapsedFor(START, now("2026-11-05T13:04:00.000Z"))).toBe("1h 4m");
		expect(elapsedFor(START, now("2026-11-05T14:00:00.000Z"))).toBe("2h");
	});

	test("empty for a time it cannot read", () => {
		expect(elapsedFor("not a date", now(START))).toBe("");
	});
});
