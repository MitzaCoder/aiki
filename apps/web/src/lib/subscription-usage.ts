/**
 * The usage screen's words and shapes: durations, the pace in a sentence and its tone, the summary line, and the
 * geometry of the gauge and the chart. Pure, so every label is tested; the arithmetic itself (elapsed share, pace ratio,
 * projected exhaustion) is `@mihai-harness/client`'s.
 */
import {
	projectedUsedPercent,
	type WindowPace,
} from "@mihai-harness/client";
import type { SubscriptionUsage, UsageWindow } from "@mihai-harness/protocol";
import { relativeTime } from "./relative-time.ts";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Numbers read longer ago than this are stale: the server reads every few minutes, so something stopped it. */
export const USAGE_STALE_MS = 15 * MINUTE_MS;

/**
 * How a pace should feel. `danger` only when the limit is reached or the pace runs out before the reset; being early in
 * a window and brisk is only `warn`.
 */
export type PaceTone = "calm" | "good" | "warn" | "danger" | "muted";

/** The CSS colour of a tone, from the theme's tokens. */
export const PACE_TONE_COLOR: Record<PaceTone, string> = {
	calm: "var(--accent-2)",
	good: "var(--chat-success)",
	warn: "var(--chat-warning)",
	danger: "var(--chat-danger)",
	muted: "var(--chat-fg-subtle)",
};

/** A span of time, compact: "<1m", "45m", "2h 14m", "3d 4h". Negative spans read as zero. */
export function formatDuration(ms: number): string {
	const minutes = Math.floor(Math.max(0, ms) / MINUTE_MS);
	if (minutes < 1) return "<1m";
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) {
		const rest = minutes % 60;
		return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
	}
	const days = Math.floor(hours / 24);
	const rest = hours % 24;
	return rest === 0 ? `${days}d` : `${days}d ${rest}h`;
}

export type ClockOptions = { locale?: string; timeZone?: string };

/**
 * A time of day, with the weekday when it is another day in the next six days, and the date otherwise: "16:40",
 * "Thu 09:00", "29 Oct 09:00". Past days get the date, so a weekly window's start and reset never share a weekday.
 */
export function clockTime(at: number, now: number, options: ClockOptions = {}): string {
	const { locale, timeZone } = options;
	const time = new Date(at).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", timeZone });
	const day = (ms: number) => new Date(ms).toLocaleDateString("en-CA", { timeZone });
	if (day(at) === day(now)) return time;
	if (at > now && at - now < 6 * DAY_MS) {
		return `${new Date(at).toLocaleDateString(locale, { weekday: "short", timeZone })} ${time}`;
	}
	return `${new Date(at).toLocaleDateString(locale, { day: "numeric", month: "short", timeZone })} ${time}`;
}

/** The used percent as people read it: "42%", "<1%" for a sliver, "—" when unknown. */
export function percentLabel(percent: number | null): string {
	if (percent === null) return "—";
	if (percent > 0 && percent < 1) return "<1%";
	return `${Math.round(percent)}%`;
}

/** The countdown to the reset: "resets in 2h 14m", "resetting now", "reset time unknown". */
export function resetLabel(pace: Pick<WindowPace, "resetsAt">, now: number): string {
	if (pace.resetsAt === null) return "reset time unknown";
	if (pace.resetsAt - now < MINUTE_MS) return "resetting now";
	return `resets in ${formatDuration(pace.resetsAt - now)}`;
}

export type PaceView = {
	tone: PaceTone;
	/** Short: "On pace", "Ahead of pace". */
	title: string;
	/** A sentence that says what it means. */
	detail: string;
};

/** The pace in words and its tone. */
export function paceView(pace: WindowPace, now: number, clock: ClockOptions = {}): PaceView {
	switch (pace.kind) {
		case "exhausted":
			return {
				tone: "danger",
				title: "Limit reached",
				detail:
					pace.resetsAt === null
						? "Used up; the provider gives no reset time."
						: `Used up until ${clockTime(pace.resetsAt, now, clock)}, ${formatDuration(pace.resetsAt - now)} from now.`,
			};
		case "unknown":
			return {
				tone: "muted",
				title: "Pace unknown",
				detail:
					pace.usedPercent === null
						? "No reading for this window yet."
						: pace.resetsAt === null
							? "The provider gives no reset time, so there is no pace to compare with."
							: "The provider gives no window length, so there is no pace to compare with.",
			};
		case "ahead": {
			if (pace.exhaustsAt === null || pace.resetsAt === null) {
				return { tone: "warn", title: "Ahead of pace", detail: "Used faster than the window passes." };
			}
			const when = `at this rate you hit the limit at ${clockTime(pace.exhaustsAt, now, clock)}, ${formatDuration(pace.resetsAt - pace.exhaustsAt)} before it resets`;
			if (pace.early) {
				return { tone: "warn", title: "Brisk start", detail: `Early in the window, but ${when}.` };
			}
			return { tone: "danger", title: "Ahead of pace", detail: `${capitalise(when)}.` };
		}
		case "on_pace":
			return {
				tone: "calm",
				title: "On pace",
				detail: "Used about as fast as the window passes; it lasts until the reset.",
			};
		case "behind":
			return {
				tone: "good",
				title: "Behind pace",
				detail:
					pace.projectedAtReset === null
						? "Room to spare."
						: `Room to spare — at this rate you end the window near ${percentLabel(pace.projectedAtReset)}.`,
			};
	}
}

function capitalise(text: string): string {
	return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "updated 2 min ago", "never updated". */
export function updatedLabel(updatedAt: string | null, now: number): string {
	return updatedAt === null ? "never updated" : `updated ${relativeTime(updatedAt, now)}`;
}

/** Whether a subscription's numbers are old enough to distrust (`USAGE_STALE_MS`). */
export function isStale(updatedAt: string | null, now: number): boolean {
	if (updatedAt === null) return false;
	const at = Date.parse(updatedAt);
	return Number.isFinite(at) && now - at > USAGE_STALE_MS;
}

/** Where the numbers came from, for a hint. */
export function sourceLabel(source: SubscriptionUsage["source"]): string {
	switch (source) {
		case "usage_api":
			return "From the provider's usage endpoint";
		case "response_headers":
			return "From the rate-limit headers of recent replies";
		case "none":
			return "The provider reports no limits";
	}
}

/** A provider's mark: a glyph and the theme accent it is tinted with, so it follows the theme. */
export type ProviderMark = { glyph: "claude" | "openai" | "generic"; accent: string; initial: string };

export function providerMark(providerId: string, label: string): ProviderMark {
	const initial = (label.trim().charAt(0) || providerId.charAt(0) || "?").toUpperCase();
	if (providerId === "anthropic" || /claude/i.test(label)) return { glyph: "claude", accent: "var(--accent-4)", initial };
	if (providerId.startsWith("openai") || /chatgpt|codex/i.test(label)) {
		return { glyph: "openai", accent: "var(--accent-1)", initial };
	}
	return { glyph: "generic", accent: "var(--accent-3)", initial };
}

// --- geometry -------------------------------------------------------------------------------------------------------

/** The gauge is a 270° arc open at the bottom, its angles clockwise from 12 o'clock. */
export const GAUGE_START_DEG = -135;
export const GAUGE_SWEEP_DEG = 270;

function round(value: number): number {
	return Math.round(value * 100) / 100;
}

/** A point on a circle, `deg` clockwise from 12 o'clock. */
export function polar(cx: number, cy: number, r: number, deg: number): { x: number; y: number } {
	const rad = (deg * Math.PI) / 180;
	return { x: round(cx + r * Math.sin(rad)), y: round(cy - r * Math.cos(rad)) };
}

/** The angle of a share (0..1, clamped) of the gauge. */
export function gaugeAngle(share: number): number {
	return GAUGE_START_DEG + GAUGE_SWEEP_DEG * Math.min(1, Math.max(0, share));
}

/** An SVG arc path from `fromDeg` to `toDeg`, clockwise. */
export function arcPath(cx: number, cy: number, r: number, fromDeg: number, toDeg: number): string {
	const from = polar(cx, cy, r, fromDeg);
	const to = polar(cx, cy, r, toDeg);
	const large = toDeg - fromDeg > 180 ? 1 : 0;
	return `M ${from.x} ${from.y} A ${r} ${r} 0 ${large} 1 ${to.x} ${to.y}`;
}

export type ChartPoint = { x: number; y: number };

export type UsageChart = {
	width: number;
	height: number;
	/** The samples, plus the window's start at 0 and now, as a polyline. Empty when there is nothing to draw. */
	line: string;
	/** The same line closed to the bottom, for the filled area. */
	area: string;
	points: ChartPoint[];
	/** The even pace: 0 at the window's start to 100% at its reset. */
	evenPace: { from: ChartPoint; to: ChartPoint } | null;
	/** The average rate from now to where the window ends or runs out. */
	projection: { from: ChartPoint; to: ChartPoint } | null;
	/** Where the limit (100%) is. */
	limitY: number;
	/** Where now is; null when now lies outside the window's span. */
	nowX: number | null;
};

/**
 * The chart of a window's samples across its span, in a `width` × `height` box. The span is the window's start to its
 * reset; without a known start it runs from the first sample, and without a reset it ends now.
 */
export function usageChart(
	window: UsageWindow,
	pace: WindowPace,
	now: number,
	width: number,
	height: number,
): UsageChart {
	const samples = window.samples
		.map((sample) => ({ at: Date.parse(sample.at), used: sample.usedPercent }))
		.filter((sample) => Number.isFinite(sample.at))
		.sort((a, b) => a.at - b.at);
	const start = pace.startsAt ?? samples[0]?.at ?? now - HOUR_MS;
	let end = pace.resetsAt ?? Math.max(now, samples.at(-1)?.at ?? now);
	if (end <= start) end = start + MINUTE_MS;
	const top = Math.max(100, pace.usedPercent ?? 0, ...samples.map((sample) => sample.used));

	const x = (at: number) => round(((Math.min(end, Math.max(start, at)) - start) / (end - start)) * width);
	const y = (used: number) => round(height - (Math.max(0, used) / top) * height);

	const series = samples.filter((sample) => sample.at >= start && sample.at <= end);
	if (pace.startsAt !== null && (series[0] === undefined || series[0].at > start)) series.unshift({ at: start, used: 0 });
	if (pace.usedPercent !== null && now <= end && (series.at(-1)?.at ?? Number.NEGATIVE_INFINITY) < now) {
		series.push({ at: now, used: pace.usedPercent });
	}
	const points = series.length >= 2 ? series.map((sample) => ({ x: x(sample.at), y: y(sample.used) })) : [];
	const line = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
	const area =
		points.length === 0 ? "" : `${line} L ${points.at(-1)?.x} ${height} L ${points[0]?.x} ${height} Z`;

	const evenPace =
		pace.startsAt !== null && pace.resetsAt !== null
			? { from: { x: x(pace.startsAt), y: y(0) }, to: { x: x(pace.resetsAt), y: y(100) } }
			: null;

	let projection: UsageChart["projection"] = null;
	if (pace.usedPercent !== null && pace.resetsAt !== null && now < pace.resetsAt && pace.kind !== "exhausted") {
		const until = pace.exhaustsAt ?? pace.resetsAt;
		const reached = projectedUsedPercent(pace, now, until);
		if (reached !== null) {
			projection = { from: { x: x(now), y: y(pace.usedPercent) }, to: { x: x(until), y: y(reached) } };
		}
	}

	return {
		width,
		height,
		line,
		area,
		points,
		evenPace,
		projection,
		limitY: y(100),
		nowX: now >= start && now <= end ? x(now) : null,
	};
}

/** How long a window is, for its subtitle: "5h", "7d". */
export function windowLengthLabel(windowMinutes: number | null): string | null {
	if (windowMinutes === null) return null;
	const ms = windowMinutes * MINUTE_MS;
	if (ms % DAY_MS === 0) return `${ms / DAY_MS}d`;
	return formatDuration(ms);
}
