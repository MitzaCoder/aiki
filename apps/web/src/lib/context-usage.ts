/**
 * How a conversation's context usage reads in the Info tab: a bar of the tokens the next request would send against the
 * model's window, the thresholds where compaction starts and blocks, and how many summaries this conversation has.
 * Pure functions, so the panel only draws them.
 */
import type { ContextUsage } from "@kemiri/protocol";
import { exactTime, relativeTime } from "./relative-time.ts";

/** A token count as it reads: 840, 1.5k, 12.3k, 200k. */
export function formatTokenCount(tokens: number): string {
	if (tokens < 1000) return String(Math.round(tokens));
	const thousands = tokens / 1000;
	return `${thousands >= 100 ? Math.round(thousands) : Number(thousands.toFixed(1))}k`;
}

/** How full a window a token count is, 0–100 with one decimal; undefined when the window is unusable. */
export function usagePercent(tokens: number, window: number | null): number | undefined {
	if (window === null || !Number.isFinite(window) || window <= 0) return undefined;
	const percent = (tokens / window) * 100;
	return Math.min(100, Math.max(0, Math.round(percent * 10) / 10));
}

/** Everything the usage block draws, with the phrases it says. */
export type ContextUsageView = {
	/** The model's window is known, so a bar and thresholds make sense. */
	measured: boolean;
	/** The filled part of the bar, 0–100. */
	percent: number;
	/** Tick marks, 0–100, for the background and blocking thresholds when the server sends them. */
	backgroundPercent?: number;
	blockingPercent?: number;
	/** "12.3k / 200k": what the next request would send, against the window. */
	tokensLabel: string;
	/** "6%"; empty when the window is unknown. */
	percentLabel: string;
	/** Where the next summary starts, in tokens: "background at 70k". */
	backgroundLabel?: string;
	/** Where the next request waits for a summary, in tokens: "blocking at 100k". */
	blockingLabel?: string;
	/** "2 compactions · last 5 min ago", or "No compactions yet". */
	compactionsLabel: string;
	/** The exact time of the last compaction, for a title. */
	lastCompactionTitle?: string;
};

/**
 * Read a context usage. Before the first answer there are no tokens but there is a window, so the bar starts empty;
 * with no model there is no window, and the numbers are left out instead of drawn as zero.
 */
export function contextUsageView(usage: ContextUsage, now: number): ContextUsageView {
	const measured = usage.contextWindow !== null;
	const percent = measured ? (usagePercent(usage.contextTokens ?? 0, usage.contextWindow) ?? 0) : 0;
	const tokensLabel = measured
		? `${usage.contextTokens === null ? "—" : formatTokenCount(usage.contextTokens)} / ${formatTokenCount(
				usage.contextWindow ?? 0
			)}`
		: "—";
	const backgroundPercent =
		measured && usage.backgroundAt !== null ? usagePercent(usage.backgroundAt, usage.contextWindow) : undefined;
	const blockingPercent =
		measured && usage.blockingAt !== null ? usagePercent(usage.blockingAt, usage.contextWindow) : undefined;
	const backgroundLabel =
		usage.backgroundAt === null ? undefined : `background at ${formatTokenCount(usage.backgroundAt)}`;
	const blockingLabel = usage.blockingAt === null ? undefined : `blocking at ${formatTokenCount(usage.blockingAt)}`;
	const count = usage.compactions;
	const last =
		count === 0 || usage.lastCompactionAt === null
			? ""
			: ` · last ${relativeTime(usage.lastCompactionAt, now)}`;
	return {
		measured,
		percent,
		...(backgroundPercent === undefined ? {} : { backgroundPercent }),
		...(blockingPercent === undefined ? {} : { blockingPercent }),
		tokensLabel,
		percentLabel: measured ? `${Math.round(percent)}%` : "",
		...(backgroundLabel === undefined ? {} : { backgroundLabel }),
		...(blockingLabel === undefined ? {} : { blockingLabel }),
		compactionsLabel: count === 0 ? "No compactions yet" : `${count} compaction${count === 1 ? "" : "s"}${last}`,
		...(count === 0 || usage.lastCompactionAt === null
			? {}
			: { lastCompactionTitle: exactTime(usage.lastCompactionAt) }),
	};
}
