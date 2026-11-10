/**
 * How the transcript and the Info tab talk about the provider's prompt cache: the line under a reply that paid for a
 * miss, the footer's cached count, and a conversation's totals. Detection itself is the protocol's `CacheMissTracker`,
 * shared with the server; this only words its results.
 */
import { type CacheMiss, type CacheMissTotals } from "@aiki/protocol";
import { formatTokenCount as tokens } from "../context-usage.ts";
import { exactTime } from "../relative-time.ts";
import type { TurnUsage } from "../transcript.ts";

/** Dollars, only once they reach a cent: " (~$0.42)", else "". */
function aboutCost(cost: number): string {
	return cost >= 0.01 ? ` (~$${cost.toFixed(2)})` : "";
}

/** An idle gap as it reads: 12m, 1h 20m, 3h. */
export function idleTime(ms: number): string {
	const minutes = Math.max(1, Math.round(ms / 60_000));
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	const rest = minutes % 60;
	return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/** How long a cache lasts, in a sentence: "5 minutes", "an hour". */
export function cacheLifetime(ms: number): string {
	const minutes = Math.round(ms / 60_000);
	if (minutes === 60) return "an hour";
	return minutes % 60 === 0 ? `${minutes / 60} hours` : `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

/** The line under a reply: "Cache miss after 12m idle: 84k tokens re-billed (~$0.42)". */
export function cacheMissLine(miss: CacheMiss): string {
	const cause =
		miss.reason === "model_switch"
			? " after switching models"
			: miss.reason === "instructions_changed"
				? " after the instructions changed"
				: miss.reason === "idle"
					? ` after ${idleTime(miss.idleMs)} idle`
					: "";
	return `Cache miss${cause}: ${tokens(miss.missedTokens)} tokens re-billed${aboutCost(miss.missedCost)}`;
}

/** The line's tooltip: what happened, in full numbers, and why. */
export function cacheMissDetail(miss: CacheMiss): string {
	const cost = miss.missedCost >= 0.01 ? `, about $${miss.missedCost.toFixed(2)} more than reading them from it` : "";
	const what = `${miss.missedTokens.toLocaleString("en-US")} tokens the provider had cached were billed again at the full price${cost}.`;
	const why =
		miss.reason === "model_switch"
			? "Each model has its own cache, so a different model starts without one."
			: miss.reason === "instructions_changed"
				? "The instructions at the start of the prompt changed (an edited AGENTS.md, a new skill)."
				: miss.reason === "idle"
					? `The cache lasts about ${cacheLifetime(miss.cacheTtlMs)}; the conversation was idle for ${idleTime(miss.idleMs)}.`
					: miss.idleMs >= 60_000
						? `It came ${idleTime(miss.idleMs)} after the previous request, while the cache should still have had it (it lasts about ${cacheLifetime(miss.cacheTtlMs)}), and no model switch or change of instructions explains it: the start of the prompt changed between two requests, which shouldn't happen, or the provider dropped its copy early.`
						: "No idle gap, model switch or change of instructions explains it: the start of the prompt changed between two requests, which shouldn't happen.";
	return `${what} ${why}`;
}

/** The footer's tooltip for the token counts: each kind in full. */
export function turnUsageTitle(usage: TurnUsage): string {
	const lines = [
		`${usage.input.toLocaleString("en-US")} new input tokens`,
		...(usage.cacheRead > 0 ? [`${usage.cacheRead.toLocaleString("en-US")} read from the cache`] : []),
		...(usage.cacheWrite > 0 ? [`${usage.cacheWrite.toLocaleString("en-US")} written to the cache`] : []),
		`${usage.output.toLocaleString("en-US")} output tokens`,
	];
	const prompt = usage.input + usage.cacheRead + usage.cacheWrite;
	if (usage.cacheRead > 0 && prompt > 0) lines.push(`${Math.round((usage.cacheRead / prompt) * 100)}% of the prompt came from the cache`);
	return lines.join("\n");
}

/** A conversation's misses for the Info tab, or undefined when there were none. */
export type CacheMissTotalsView = {
	/** "2 cache misses with no clear cause · 31k tokens (~$0.09)", or "3 cache misses, each after idle time or a change". */
	label: string;
	title: string;
	/** Some misses have no explanation: worth a look. */
	warning: boolean;
};

export function cacheMissTotalsView(totals: CacheMissTotals | undefined): CacheMissTotalsView | undefined {
	if (totals === undefined || totals.misses === 0) return undefined;
	const plural = (count: number) => `${count} cache miss${count === 1 ? "" : "es"}`;
	const all = `${plural(totals.misses)} so far: ${tokens(totals.missedTokens)} tokens re-billed${aboutCost(totals.missedCost)}.`;
	if (totals.unexplained === 0) {
		return {
			label: `${plural(totals.misses)}, each after idle time or a change`,
			title: `${all} Each came after the conversation sat idle, the model was switched, or the instructions changed.`,
			warning: false,
		};
	}
	return {
		label: `${plural(totals.unexplained)} with no clear cause · ${tokens(totals.unexplainedTokens)} tokens${aboutCost(totals.unexplainedCost)}`,
		title:
			`${all} ${totals.unexplained} of them had no idle gap, model switch or change of instructions: the start of the prompt changed between two requests, which shouldn't happen.` +
			(totals.lastUnexplainedAt === null ? "" : ` Last one: ${exactTime(totals.lastUnexplainedAt)}.`),
		warning: true,
	};
}
