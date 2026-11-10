/**
 * The pace of a subscription's rate-limit window: how much of it is used compared with how much of it has passed.
 *
 * The protocol carries the facts (used percent, when the window resets, how long it is). What is shared here is the
 * arithmetic every consumer has to do the same way: the window's elapsed share, the pace ratio (used share ÷ elapsed
 * share), when the limit is reached if usage keeps its average rate so far, and which window is the tightest. All of it
 * is pure and takes `now`, so a screen recomputes it as its clock ticks.
 */
import type { SubscriptionUsage, UsageWindow } from "@aiki/protocol";

/** Above this ratio a window is used faster than it passes: "ahead of pace". */
export const AHEAD_OF_PACE_RATIO = 1.15;
/** Below this ratio a window is used slower than it passes: "behind pace", with room to spare. */
export const BEHIND_PACE_RATIO = 0.85;
/** Before this share of the window has passed, a few requests swing the ratio wildly, so the pace is only a hint. */
export const SETTLED_PACE_SHARE = 0.1;

const MINUTE_MS = 60_000;

export type PaceKind = "unknown" | "behind" | "on_pace" | "ahead" | "exhausted";

/**
 * One window's pace at a moment.
 *
 * - `unknown`: the used percent is unknown, or the window's start is (no reset time or no length).
 * - `exhausted`: the limit is reached; nothing more until it resets.
 * - `ahead` / `on_pace` / `behind`: the ratio against `AHEAD_OF_PACE_RATIO` and `BEHIND_PACE_RATIO`.
 */
export type WindowPace = {
	kind: PaceKind;
	usedPercent: number | null;
	/** Epoch ms; null when the window's length or reset time is unknown. */
	startsAt: number | null;
	/** Epoch ms; null when unknown. */
	resetsAt: number | null;
	/** How much of the window has passed, 0 to 1. Null when its start is unknown. */
	elapsedShare: number | null;
	/** Used share ÷ elapsed share: 1 is the even pace, 2 is twice as fast. Null when either is unknown or none has passed. */
	ratio: number | null;
	/** The average rate so far, in percent per millisecond. */
	percentPerMs: number | null;
	/** Where the window ends at that rate, in percent; above 100 means it runs out first. */
	projectedAtReset: number | null;
	/** When the limit is reached at that rate, if that is before the reset (epoch ms); otherwise null. */
	exhaustsAt: number | null;
	/** Whether too little of the window has passed for the ratio to mean much (`SETTLED_PACE_SHARE`). */
	early: boolean;
};

function parseTime(at: string | null): number | null {
	if (at === null) return null;
	const ms = Date.parse(at);
	return Number.isFinite(ms) ? ms : null;
}

/** When the window's current period began (epoch ms): its reset minus its length. Null when either is unknown. */
export function windowStart(window: Pick<UsageWindow, "resetsAt" | "windowMinutes">): number | null {
	const resetsAt = parseTime(window.resetsAt);
	if (resetsAt === null || window.windowMinutes === null || window.windowMinutes <= 0) return null;
	return resetsAt - window.windowMinutes * MINUTE_MS;
}

/** How much of the window has passed at `now`, clamped to 0..1. Null when the window's start is unknown. */
export function windowElapsedShare(window: Pick<UsageWindow, "resetsAt" | "windowMinutes">, now: number): number | null {
	const start = windowStart(window);
	if (start === null || window.windowMinutes === null) return null;
	const share = (now - start) / (window.windowMinutes * MINUTE_MS);
	return Math.min(1, Math.max(0, share));
}

/** The window's pace at `now`. */
export function windowPace(window: UsageWindow, now: number): WindowPace {
	const usedPercent = window.usedPercent;
	const startsAt = windowStart(window);
	const resetsAt = parseTime(window.resetsAt);
	const elapsedShare = windowElapsedShare(window, now);
	const pace: WindowPace = {
		kind: "unknown",
		usedPercent,
		startsAt,
		resetsAt,
		elapsedShare,
		ratio: null,
		percentPerMs: null,
		projectedAtReset: null,
		exhaustsAt: null,
		early: elapsedShare !== null && elapsedShare < SETTLED_PACE_SHARE,
	};
	if (usedPercent === null) return pace;
	if (usedPercent >= 100) return { ...pace, kind: "exhausted" };
	if (elapsedShare === null || startsAt === null || resetsAt === null || elapsedShare <= 0) return pace;

	const ratio = usedPercent / 100 / elapsedShare;
	const passedMs = Math.min(now, resetsAt) - startsAt;
	const percentPerMs = passedMs > 0 ? usedPercent / passedMs : null;
	let exhaustsAt: number | null = null;
	if (percentPerMs !== null && percentPerMs > 0 && now < resetsAt) {
		const at = now + (100 - usedPercent) / percentPerMs;
		if (at < resetsAt) exhaustsAt = at;
	}
	const kind: PaceKind = ratio > AHEAD_OF_PACE_RATIO ? "ahead" : ratio < BEHIND_PACE_RATIO ? "behind" : "on_pace";
	return { ...pace, kind, ratio, percentPerMs, projectedAtReset: ratio * 100, exhaustsAt };
}

/**
 * The used percent the pace projects at `at` (epoch ms), from `now` at the average rate so far, capped at 100 because a
 * window stops there. Null when the rate is unknown.
 */
export function projectedUsedPercent(pace: WindowPace, now: number, at: number): number | null {
	if (pace.usedPercent === null || pace.percentPerMs === null) return null;
	return Math.min(100, pace.usedPercent + pace.percentPerMs * Math.max(0, at - now));
}

export type TightestWindow = {
	subscription: SubscriptionUsage;
	window: UsageWindow;
	pace: WindowPace;
};

/**
 * How close a window is to running out: an exhausted window first, then where the pace ends the window, then the used
 * percent. Early in a window the pace is noisy, so only the used percent counts there.
 */
function pressure(pace: WindowPace): number {
	if (pace.usedPercent === null) return Number.NEGATIVE_INFINITY;
	if (pace.kind === "exhausted") return 1_000 + pace.usedPercent;
	if (pace.projectedAtReset !== null && !pace.early) return Math.max(pace.usedPercent, pace.projectedAtReset);
	return pace.usedPercent;
}

/**
 * The window closest to running out across every subscription at `now`, or undefined when none has a known used percent.
 * Equal pressure goes to the one that runs out sooner, then to the earlier one in the list.
 */
export function tightestWindow(subscriptions: readonly SubscriptionUsage[], now: number): TightestWindow | undefined {
	let best: (TightestWindow & { pressure: number }) | undefined;
	for (const subscription of subscriptions) {
		for (const window of subscription.windows) {
			const pace = windowPace(window, now);
			const value = pressure(pace);
			if (value === Number.NEGATIVE_INFINITY) continue;
			const sooner =
				best !== undefined &&
				value === best.pressure &&
				pace.exhaustsAt !== null &&
				(best.pace.exhaustsAt === null || pace.exhaustsAt < best.pace.exhaustsAt);
			if (best === undefined || value > best.pressure || sooner) best = { subscription, window, pace, pressure: value };
		}
	}
	if (best === undefined) return undefined;
	return { subscription: best.subscription, window: best.window, pace: best.pace };
}
