/**
 * The usage screen's words and shapes: durations, the pace sentence and its tone, the summary line, staleness, and the
 * geometry of the gauge and the chart. Clock times are pinned to UTC and en-GB so the sentences are stable.
 */
import { describe, expect, test } from "bun:test";
import { windowPace } from "@aiki/client";
import type { SubscriptionUsage, UsageWindow } from "@aiki/protocol";
import {
	arcPath,
	clockTime,
	formatDuration,
	gaugeAngle,
	isStale,
	paceView,
	percentLabel,
	polar,
	providerMark,
	resetLabel,
	updatedLabel,
	usageChart,
	windowLengthLabel,
} from "../src/lib/subscription-usage.ts";

const CLOCK = { locale: "en-GB", timeZone: "UTC" };
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** A 5-hour window from 10:00 to 15:00; it is noon. */
const NOW = Date.parse("2026-11-04T12:00:00Z");

function usageWindow(overrides: Partial<UsageWindow> = {}): UsageWindow {
	return {
		id: "five_hour",
		label: "5-hour limit",
		usedPercent: 40,
		resetsAt: "2026-11-04T15:00:00Z",
		windowMinutes: 300,
		samples: [],
		...overrides,
	};
}

function subscription(windows: UsageWindow[]): SubscriptionUsage {
	return {
		providerId: "anthropic",
		label: "Claude",
		plan: "Max 20x",
		account: null,
		windows,
		source: "usage_api",
		updatedAt: "2026-11-04T11:58:00Z",
		error: null,
	};
}

describe("formatDuration", () => {
	test("minutes, hours and minutes, days and hours", () => {
		expect(formatDuration(-5)).toBe("<1m");
		expect(formatDuration(30_000)).toBe("<1m");
		expect(formatDuration(45 * MINUTE)).toBe("45m");
		expect(formatDuration(2 * HOUR + 14 * MINUTE)).toBe("2h 14m");
		expect(formatDuration(3 * HOUR)).toBe("3h");
		expect(formatDuration(76 * HOUR)).toBe("3d 4h");
		expect(formatDuration(48 * HOUR)).toBe("2d");
	});
});

describe("clockTime", () => {
	test("today is a time, another day adds the weekday", () => {
		expect(clockTime(Date.parse("2026-11-04T16:40:00Z"), NOW, CLOCK)).toBe("16:40");
		expect(clockTime(Date.parse("2026-11-05T09:00:00Z"), NOW, CLOCK)).toBe("Thu 09:00");
		expect(clockTime(Date.parse("2026-10-29T09:00:00Z"), NOW, CLOCK)).toBe("29 Oct 09:00");
		expect(clockTime(Date.parse("2026-11-02T09:00:00Z"), NOW, CLOCK)).toBe("2 Nov 09:00");
		expect(clockTime(Date.parse("2026-11-11T09:00:00Z"), NOW, CLOCK)).toBe("11 Nov 09:00");
	});
});

describe("labels", () => {
	test("percent", () => {
		expect(percentLabel(null)).toBe("—");
		expect(percentLabel(0)).toBe("0%");
		expect(percentLabel(0.3)).toBe("<1%");
		expect(percentLabel(41.6)).toBe("42%");
		expect(percentLabel(104)).toBe("104%");
	});

	test("reset countdown", () => {
		expect(resetLabel({ resetsAt: NOW + 2 * HOUR + 14 * MINUTE }, NOW)).toBe("resets in 2h 14m");
		expect(resetLabel({ resetsAt: NOW + 20_000 }, NOW)).toBe("resetting now");
		expect(resetLabel({ resetsAt: NOW - HOUR }, NOW)).toBe("resetting now");
		expect(resetLabel({ resetsAt: null }, NOW)).toBe("reset time unknown");
	});

	test("updated and stale", () => {
		expect(updatedLabel("2026-11-04T11:58:00Z", NOW)).toBe("updated 2 min ago");
		expect(updatedLabel(null, NOW)).toBe("never updated");
		expect(isStale("2026-11-04T11:50:00Z", NOW)).toBe(false);
		expect(isStale("2026-11-04T11:30:00Z", NOW)).toBe(true);
		expect(isStale(null, NOW)).toBe(false);
	});

	test("window length", () => {
		expect(windowLengthLabel(300)).toBe("5h");
		expect(windowLengthLabel(7 * 24 * 60)).toBe("7d");
		expect(windowLengthLabel(null)).toBeNull();
	});

	test("provider marks follow the theme's accents", () => {
		expect(providerMark("anthropic", "Claude")).toEqual({ glyph: "claude", accent: "var(--accent-4)", initial: "C" });
		expect(providerMark("openai-codex", "ChatGPT").glyph).toBe("openai");
		expect(providerMark("zai", "GLM")).toEqual({ glyph: "generic", accent: "var(--accent-3)", initial: "G" });
	});
});

describe("paceView", () => {
	const view = (window: UsageWindow, now = NOW) => paceView(windowPace(window, now), now, CLOCK);

	test("on pace is calm", () => {
		expect(view(usageWindow({ usedPercent: 40 }))).toMatchObject({ tone: "calm", title: "On pace" });
	});

	test("ahead says when the limit is hit and how long before the reset, in red", () => {
		// 60% in 2 hours: the limit at 13:20, 1h 40m before the 15:00 reset.
		expect(view(usageWindow({ usedPercent: 60 }))).toEqual({
			tone: "danger",
			title: "Ahead of pace",
			detail: "At this rate you hit the limit at 13:20, 1h 40m before it resets.",
		});
	});

	test("ahead early in the window is only a warning", () => {
		const early = view(usageWindow({ usedPercent: 15 }), Date.parse("2026-11-04T10:20:00Z"));
		expect(early.tone).toBe("warn");
		expect(early.title).toBe("Brisk start");
		expect(early.detail).toStartWith("Early in the window, but at this rate you hit the limit at");
	});

	test("behind has room to spare", () => {
		expect(view(usageWindow({ usedPercent: 10 }))).toEqual({
			tone: "good",
			title: "Behind pace",
			detail: "Room to spare — at this rate you end the window near 25%.",
		});
	});

	test("a reached limit says when it is back", () => {
		expect(view(usageWindow({ usedPercent: 100 }))).toEqual({
			tone: "danger",
			title: "Limit reached",
			detail: "Used up until 15:00, 3h from now.",
		});
	});

	test("unknown says why", () => {
		expect(view(usageWindow({ usedPercent: null })).detail).toBe("No reading for this window yet.");
		expect(view(usageWindow({ resetsAt: null }))).toMatchObject({ tone: "muted", title: "Pace unknown" });
		expect(view(usageWindow({ windowMinutes: null })).detail).toContain("no window length");
	});
});

describe("gauge geometry", () => {
	test("angles span 270° from the bottom left, clamped", () => {
		expect(gaugeAngle(0)).toBe(-135);
		expect(gaugeAngle(0.5)).toBe(0);
		expect(gaugeAngle(1)).toBe(135);
		expect(gaugeAngle(2)).toBe(135);
	});

	test("polar points and arcs", () => {
		expect(polar(50, 50, 40, 0)).toEqual({ x: 50, y: 10 });
		expect(polar(50, 50, 40, 90)).toEqual({ x: 90, y: 50 });
		expect(arcPath(50, 50, 40, -90, 0)).toBe("M 10 50 A 40 40 0 0 1 50 10");
		expect(arcPath(50, 50, 40, -135, 135)).toContain(" 0 1 1 ");
	});
});

describe("usageChart", () => {
	const samples = [
		{ at: "2026-11-04T10:30:00Z", usedPercent: 5 },
		{ at: "2026-11-04T11:00:00Z", usedPercent: 20 },
		{ at: "2026-11-04T11:30:00Z", usedPercent: 30 },
	];

	test("spans the window, starts at 0 and ends at now", () => {
		const window = usageWindow({ usedPercent: 40, samples });
		const chart = usageChart(window, windowPace(window, NOW), NOW, 300, 100);
		expect(chart.points[0]).toEqual({ x: 0, y: 100 });
		expect(chart.points.at(-1)).toEqual({ x: 120, y: 60 });
		expect(chart.points.length).toBe(5);
		expect(chart.line).toStartWith("M 0 100 L 30 95");
		expect(chart.area).toEndWith("L 120 100 L 0 100 Z");
		expect(chart.nowX).toBe(120);
		expect(chart.limitY).toBe(0);
		expect(chart.evenPace).toEqual({ from: { x: 0, y: 100 }, to: { x: 300, y: 0 } });
	});

	test("projects to the reset when behind, and to the limit when ahead", () => {
		const behind = usageWindow({ usedPercent: 10 });
		const behindChart = usageChart(behind, windowPace(behind, NOW), NOW, 300, 100);
		expect(behindChart.projection).toEqual({ from: { x: 120, y: 90 }, to: { x: 300, y: 75 } });

		const ahead = usageWindow({ usedPercent: 60 });
		const aheadChart = usageChart(ahead, windowPace(ahead, NOW), NOW, 300, 100);
		// The limit at 13:20 is 3h 20m into the 5-hour window: x = 200.
		expect(aheadChart.projection).toEqual({ from: { x: 120, y: 40 }, to: { x: 200, y: 0 } });
	});

	test("scales above 100% when the provider allows overage", () => {
		const over = usageWindow({ usedPercent: 120, samples: [{ at: "2026-11-04T11:00:00Z", usedPercent: 110 }] });
		const chart = usageChart(over, windowPace(over, NOW), NOW, 300, 120);
		expect(chart.limitY).toBe(20);
		expect(chart.projection).toBeNull();
	});

	test("without a reset or a length, spans the samples up to now with no even pace", () => {
		const window = usageWindow({ resetsAt: null, windowMinutes: null, usedPercent: 30, samples });
		const chart = usageChart(window, windowPace(window, NOW), NOW, 300, 100);
		expect(chart.evenPace).toBeNull();
		expect(chart.projection).toBeNull();
		expect(chart.points[0]).toEqual({ x: 0, y: 95 });
		expect(chart.points.at(-1)?.x).toBe(300);
	});

	test("draws nothing without at least two points", () => {
		const window = usageWindow({ resetsAt: null, windowMinutes: null, usedPercent: null });
		expect(usageChart(window, windowPace(window, NOW), NOW, 300, 100).line).toBe("");
	});
});
