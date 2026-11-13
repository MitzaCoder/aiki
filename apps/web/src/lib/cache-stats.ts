/**
 * How the Usage screen talks about the prompt cache statistics a backend answers with `cache.stats`: plain words for
 * the miss reasons, the wakes and the conversations, the money and the what-ifs. Pure, so it is tested on its own.
 */
import {
	type CacheMissDetail,
	type CacheStats,
	type CacheWake,
	type ConversationKind,
	describePromptChange,
	PROMPT_CACHE_TTL_MS,
	type WakeReason,
} from "@kemiri/protocol";
import { idleTime } from "./chat/cache.ts";
import { formatTokenCount } from "./context-usage.ts";

export const CACHE_STATS_RANGES = [7, 30, 90] as const;
export type CacheStatsRange = (typeof CACHE_STATS_RANGES)[number];

/** Dollars as they read in a sentence: "$0.42", "$12.30", "$284"; "$0" for nothing, "<$0.01" for crumbs. */
export function money(value: number): string {
	if (value === 0) return "$0";
	if (Math.abs(value) < 0.01) return "<$0.01";
	if (Math.abs(value) >= 100) return `$${Math.round(value).toLocaleString("en-US")}`;
	return `$${value.toFixed(2)}`;
}

export function tokens(value: number): string {
	return value >= 1_000_000 ? `${Number((value / 1_000_000).toFixed(1))}M` : formatTokenCount(value);
}

/** A share as a whole percent, "<1%" for a sliver. */
export function percent(part: number, whole: number): string {
	if (whole <= 0 || part <= 0) return "0%";
	const value = (100 * part) / whole;
	return value < 1 ? "<1%" : `${Math.round(value)}%`;
}

const CACHE_MINUTES = Math.round(PROMPT_CACHE_TTL_MS / 60_000);

export const REASONS: Record<CacheMissDetail["reason"], { label: string; detail: string }> = {
	idle: {
		label: "Waited too long",
		detail: `Nothing was sent for longer than the cache lasts (${CACHE_MINUTES} minutes, or an hour with the longer cache), so the provider dropped its copy of the conversation.`,
	},
	instructions_changed: {
		label: "Instructions changed",
		detail: "An AGENTS.md, a skill or the tools changed mid-conversation, so the copy no longer matched.",
	},
	model_switch: { label: "Model switched", detail: "Each model keeps its own copy, so a new model starts without one." },
	unexplained: {
		label: "No visible reason",
		detail: "No wait, switch or change of instructions explains it. What changed in the request says more, when it was recorded.",
	},
};

export function reasonLabel(reason: string): string {
	return REASONS[reason as CacheMissDetail["reason"]]?.label ?? reason;
}

const WAKES: Record<WakeReason, string> = {
	user: "Your messages",
	check_in: "Worker check-ins",
	worker_report: "Worker reports",
	thread_finished: "Threads finishing",
	thread_message: "Messages between threads",
	board: "Board changes",
	brief: "New workers and threads",
	schedule: "Schedules",
	coordinator: "Messages to workers",
	continue: "Work going on",
	retry: "Retries",
	unknown: "Unknown",
};

export function wakeLabel(wake: WakeReason | null): string {
	return wake === null ? "Unknown" : WAKES[wake];
}

/** What woke the agent, inside a sentence: "a worker check-in". */
export function wakePhrase(wake: WakeReason | null): string {
	switch (wake) {
		case "user":
			return "your message";
		case "check_in":
			return "a worker check-in";
		case "worker_report":
			return "a worker's report";
		case "thread_finished":
			return "a thread finishing";
		case "thread_message":
			return "a message from another thread";
		case "board":
			return "a board change";
		case "brief":
			return "its first brief";
		case "schedule":
			return "a schedule";
		case "coordinator":
			return "a message from its coordinator";
		case "continue":
			return "its own tool calls";
		case "retry":
			return "a retry";
		default:
			return "something unknown";
	}
}

const KINDS: Record<ConversationKind, string> = { main: "Main", thread: "Thread", worker: "Worker", other: "Other" };

/** Which conversation: "Main", "Worker qa-4316 · T15", "Thread nightly-sync". */
export function conversationLabel(row: {
	kind: ConversationKind;
	threadId: string | null;
	workerId: string | null;
	taskId: string | null;
}): string {
	const parts = [KINDS[row.kind]];
	if (row.kind === "thread" && row.threadId !== null) parts[0] = `Thread ${row.threadId}`;
	if (row.kind === "worker" && row.workerId !== null) parts[0] = `Worker ${row.workerId}`;
	if (row.kind === "worker" && row.threadId !== null && row.threadId !== "main") parts.push(`in ${row.threadId}`);
	if (row.taskId !== null) parts.push(row.taskId);
	return parts.join(" · ");
}

export function kindGroupLabel(kind: string): string {
	return kind === "main" ? "Main" : kind === "thread" ? "Threads" : kind === "worker" ? "Workers" : "Other";
}

/** The miss's headline: "Waited too long (12m)". */
export function missHeadline(miss: CacheMissDetail): string {
	const label = reasonLabel(miss.reason);
	return miss.reason === "idle" && miss.idleMs !== null ? `${label} (${idleTime(miss.idleMs)})` : label;
}

/** What changed in the request, one line each; plain words for a row that has none to show. */
export function changeLines(changes: string[] | null): string[] {
	if (changes === null) return ["Not recorded: this request was read back from the transcript."];
	if (changes.length === 0) return ["Nothing in the request changed: the provider dropped its copy early."];
	return changes.map(describePromptChange);
}

/** The summary under the heading. */
export function summaryLines(stats: CacheStats): { spent: string; cached: string; rebilled: string } {
	const { totals } = stats;
	const prompt = totals.inputTokens + totals.cacheReadTokens + totals.cacheWriteTokens;
	return {
		spent: `${money(totals.cost)} on ${totals.requests.toLocaleString("en-US")} request${totals.requests === 1 ? "" : "s"}`,
		cached: `${percent(totals.cacheReadTokens, prompt)} of the prompt read from the cache`,
		rebilled:
			totals.misses === 0
				? "Nothing billed again"
				: `${money(totals.missedCost)} billed again in ${totals.misses} miss${totals.misses === 1 ? "" : "es"} (${percent(totals.missedCost, totals.cost)} of the cost)`,
	};
}

/**
 * The one-hour cache what-if as a sentence, or undefined when no request could have used it. Requests that had it
 * already (coordinators by default) are left out of the what-if and only mentioned, so it never proposes what is on.
 */
export function longCacheLine(stats: CacheStats): string | undefined {
	const long = stats.longCache;
	const already = long.alreadyLong ?? 0;
	const on = `The one-hour cache was on for ${already} Claude request${already === 1 ? "" : "s"}`;
	if (long.requests === 0) return already > 0 ? `${on}.` : undefined;
	if (long.missesAvoided === 0 && long.extraWriteCost === 0) {
		return already > 0 ? `${on}; for the rest it would have changed nothing.` : "A one-hour cache would have changed nothing here.";
	}
	const verdict =
		long.net >= 0 ? `It would have saved ${money(long.net)} overall.` : `It would have cost ${money(-long.net)} more overall.`;
	const avoided =
		long.missesAvoided === 0
			? "would have avoided no miss"
			: `would have avoided ${long.missesAvoided} miss${long.missesAvoided === 1 ? "" : "es"}, saving ${money(long.saved)}`;
	const which =
		already > 0
			? `for the other ${long.requests} Claude request${long.requests === 1 ? "" : "s"}`
			: "(Claude models only)";
	const lead = already > 0 ? `${on}. ` : "";
	return `${lead}Keeping the cache for an hour instead of ${CACHE_MINUTES} minutes ${which} ${avoided}; writing it costs more, ${money(long.extraWriteCost)} extra. ${verdict}`;
}

/**
 * Wakes the harness itself causes, to have an agent look at something: the ones fewer of could save money. Your messages,
 * briefs and messages to workers are the work itself.
 */
const AVOIDABLE_WAKES: ReadonlySet<WakeReason> = new Set(["check_in", "worker_report", "board", "thread_finished", "thread_message", "retry"]);

/** The avoidable wakes worth a sentence: more than one, costing something, dearest first. */
export function wakeAdvice(stats: CacheStats, days: number): string[] {
	return stats.byWake
		.filter((wake: CacheWake) => AVOIDABLE_WAKES.has(wake.wake) && wake.wakes > 1 && wake.turnCost >= 0.01)
		.slice(0, 3)
		.map((wake) => {
			const each = wake.turnCost / wake.wakes;
			const cache = wake.misses > 0 ? `, ${money(wake.missedCost / wake.wakes)} of it the cache billed again` : "";
			return `${WAKES[wake.wake]}: ${wake.wakes} in ${days} days, about ${money(each)} each${cache}. Half as many would save about ${money(wake.turnCost / 2)}.`;
		});
}

/** The bars of the daily chart, scaled to the dearest day. */
export function dayBars(stats: CacheStats): { day: string; cost: number; missedCost: number; height: number; missedHeight: number }[] {
	const highest = Math.max(0, ...stats.days.map((day) => day.cost));
	return stats.days.map((day) => ({
		day: day.day,
		cost: day.cost,
		missedCost: day.missedCost,
		height: highest > 0 ? day.cost / highest : 0,
		missedHeight: highest > 0 ? Math.min(day.cost, day.missedCost) / highest : 0,
	}));
}
