/**
 * Prompt cache statistics: what every model request cost, how much of it re-billed a prompt the provider should still
 * have cached, why, and what would have saved it. A backend logs one row per model request (`packages/server`,
 * `request-log.ts`) and answers `cache.stats` with the totals over a range; the `cache-stats` feature says it does.
 */
import { type Static, Type } from "typebox";
import { RequestIdSchema } from "./common.ts";

/**
 * What made the agent send a request:
 * - `user`: a message the user typed (main or a thread).
 * - `check_in`: the periodic check-in on running workers.
 * - `worker_report`: a worker's report or failure.
 * - `thread_finished`: a background thread posting its finish to main.
 * - `thread_message`: a message from another thread (`[from …]`).
 * - `board`: a board change: the user's edits or answer, an unblocked task, a handed-over task.
 * - `brief`: the first message of a worker or thread, from the coordinator that started it.
 * - `schedule`: the first message of a worker or thread a schedule started.
 * - `coordinator`: a later message to a worker from its coordinator.
 * - `continue`: no wake: the same turn going on after its tool calls.
 * - `retry`: the same request again after a failed one.
 * - `unknown`: none of these could be told.
 */
export const WAKE_REASONS = [
	"user",
	"check_in",
	"worker_report",
	"thread_finished",
	"thread_message",
	"board",
	"brief",
	"schedule",
	"coordinator",
	"continue",
	"retry",
	"unknown",
] as const;
export type WakeReason = (typeof WAKE_REASONS)[number];
export const WakeReasonSchema = Type.Union([
	Type.Literal("user"),
	Type.Literal("check_in"),
	Type.Literal("worker_report"),
	Type.Literal("thread_finished"),
	Type.Literal("thread_message"),
	Type.Literal("board"),
	Type.Literal("brief"),
	Type.Literal("schedule"),
	Type.Literal("coordinator"),
	Type.Literal("continue"),
	Type.Literal("retry"),
	Type.Literal("unknown"),
]);

/** Which conversation sent a request: the project's main coordinator, a background thread, a worker, or none known. */
export const ConversationKindSchema = Type.Union([
	Type.Literal("main"),
	Type.Literal("thread"),
	Type.Literal("worker"),
	Type.Literal("other"),
]);
export type ConversationKind = Static<typeof ConversationKindSchema>;

export const CacheMissReasonSchema = Type.Union([
	Type.Literal("model_switch"),
	Type.Literal("instructions_changed"),
	Type.Literal("idle"),
	Type.Literal("unexplained"),
]);

/** A row's origin: recorded as the request ran, or read back later from a transcript (no fingerprint, no retention). */
export const RequestSourceSchema = Type.Union([Type.Literal("live"), Type.Literal("backfill"), Type.Literal("keepWarm")]);
export type RequestSource = Static<typeof RequestSourceSchema>;

const Money = Type.Number({ description: "US dollars, from the provider's prices as pi-ai knows them." });

export const CacheTotalsSchema = Type.Object({
	requests: Type.Integer({ minimum: 0 }),
	inputTokens: Type.Integer({ minimum: 0, description: "Prompt tokens billed at the full price." }),
	cacheReadTokens: Type.Integer({ minimum: 0 }),
	cacheWriteTokens: Type.Integer({ minimum: 0 }),
	outputTokens: Type.Integer({ minimum: 0 }),
	cost: Money,
	misses: Type.Integer({ minimum: 0 }),
	missedTokens: Type.Integer({ minimum: 0 }),
	missedCost: Money,
});
export type CacheTotals = Static<typeof CacheTotalsSchema>;

/** Totals of one slice: a reason, a project, a kind of conversation, a model. */
export const CacheGroupSchema = Type.Object({
	key: Type.String(),
	label: Type.String(),
	requests: Type.Integer({ minimum: 0 }),
	cost: Money,
	misses: Type.Integer({ minimum: 0 }),
	missedTokens: Type.Integer({ minimum: 0 }),
	missedCost: Money,
});
export type CacheGroup = Static<typeof CacheGroupSchema>;

export const CacheDaySchema = Type.Object({
	day: Type.String({ description: "YYYY-MM-DD in the asker's time zone." }),
	requests: Type.Integer({ minimum: 0 }),
	cost: Money,
	misses: Type.Integer({ minimum: 0 }),
	missedCost: Money,
});
export type CacheDay = Static<typeof CacheDaySchema>;

/** Which conversation, as far as the backend knows it. */
const ConversationFields = {
	projectId: Type.String(),
	projectName: Type.String(),
	conversationId: Type.Integer(),
	kind: ConversationKindSchema,
	threadId: Type.Union([Type.String(), Type.Null()]),
	workerId: Type.Union([Type.String(), Type.Null()]),
	taskId: Type.Union([Type.String(), Type.Null()]),
};

export const CacheConversationSchema = Type.Object({
	...ConversationFields,
	requests: Type.Integer({ minimum: 0 }),
	cost: Money,
	misses: Type.Integer({ minimum: 0 }),
	missedTokens: Type.Integer({ minimum: 0 }),
	missedCost: Money,
	lastAt: Type.String({ description: "ISO 8601, its newest request in the range." }),
});
export type CacheConversation = Static<typeof CacheConversationSchema>;

export const CacheMissDetailSchema = Type.Object({
	at: Type.String({ description: "ISO 8601." }),
	...ConversationFields,
	provider: Type.String(),
	model: Type.String(),
	idleMs: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()], { description: "Time since the previous request." }),
	missedTokens: Type.Integer({ minimum: 0 }),
	missedCost: Money,
	reason: CacheMissReasonSchema,
	wake: Type.Union([WakeReasonSchema, Type.Null()]),
	changes: Type.Union([Type.Array(Type.String()), Type.Null()], {
		description:
			"What differed from the previous request, as `describePromptChange` codes; empty when nothing did; null when it was not compared (rows read back from transcripts, the first request after a restart of an older release).",
	}),
	source: RequestSourceSchema,
});
export type CacheMissDetail = Static<typeof CacheMissDetailSchema>;

/** One kind of wake: how often it woke an agent, what those turns cost, and how much of that was re-billed cache. */
export const CacheWakeSchema = Type.Object({
	wake: WakeReasonSchema,
	wakes: Type.Integer({ minimum: 0, description: "Requests this woke." }),
	turnCost: Type.Number({ description: "Every request from each wake until the next one, in dollars." }),
	misses: Type.Integer({ minimum: 0, description: "Misses on the woken requests." }),
	missedCost: Money,
});
export type CacheWake = Static<typeof CacheWakeSchema>;

/**
 * What a one-hour cache would have done over the range: the idle misses within an hour it would have avoided, and what
 * its dearer cache writes would have cost (pi-ai's prices: twice the input price on Anthropic). Only requests of models
 * that support the longer cache count, and of those only the ones that did not use it already (`alreadyLong`).
 */
export const LongCacheWhatIfSchema = Type.Object({
	requests: Type.Integer({ minimum: 0, description: "Requests of models that support it." }),
	missesAvoided: Type.Integer({ minimum: 0 }),
	saved: Money,
	extraWriteCost: Money,
	net: Type.Number({ description: "saved - extraWriteCost; positive means the longer cache pays." }),
	stillMissed: Type.Integer({ minimum: 0, description: "Idle misses after more than an hour, which it would not have avoided." }),
	alreadyLong: Type.Optional(
		Type.Integer({
			minimum: 0,
			description: "Requests of those models that used the one-hour cache already, left out of the rest. Absent on an older server.",
		}),
	),
});
export type LongCacheWhatIf = Static<typeof LongCacheWhatIfSchema>;

export const CacheStatsSchema = Type.Object({
	from: Type.String({ description: "ISO 8601, the start of the range." }),
	to: Type.String({ description: "ISO 8601, when the stats were read." }),
	keptDays: Type.Integer({ minimum: 1, description: "How long the backend keeps the request log." }),
	liveSince: Type.Union([Type.String(), Type.Null()], {
		description: "When the backend started logging requests as they run; older rows were read back from transcripts.",
	}),
	keepWarm: Type.Optional(Type.Object({ refreshes: Type.Integer(), cachedTokens: Type.Number(), cost: Type.Number(), failedWriteCost: Type.Number() })),
	totals: CacheTotalsSchema,
	byReason: Type.Array(CacheGroupSchema),
	byProject: Type.Array(CacheGroupSchema),
	byKind: Type.Array(CacheGroupSchema),
	byModel: Type.Array(CacheGroupSchema),
	byWake: Type.Array(CacheWakeSchema),
	days: Type.Array(CacheDaySchema, { description: "Oldest first, every day of the range." }),
	conversations: Type.Array(CacheConversationSchema, { description: "The costliest in missed cache first." }),
	misses: Type.Array(CacheMissDetailSchema, { description: "The costliest misses of the range, newest first." }),
	longCache: LongCacheWhatIfSchema,
});
export type CacheStats = Static<typeof CacheStatsSchema>;

// --- requests ----------------------------------------------------------------------------------------------------

export const CacheStatsRequestSchema = Type.Object({
	type: Type.Literal("cache.stats"),
	id: RequestIdSchema,
	days: Type.Optional(Type.Integer({ minimum: 1, maximum: 120, description: "Default 30." })),
	projectId: Type.Optional(Type.String({ minLength: 1 })),
	utcOffsetMinutes: Type.Optional(
		Type.Integer({ minimum: -14 * 60, maximum: 14 * 60, description: "The asker's offset from UTC, for `days`. Default 0." }),
	),
});
export type CacheStatsRequest = Static<typeof CacheStatsRequestSchema>;

export const CacheStatsResponseSchema = Type.Object({
	type: Type.Literal("cache.stats"),
	id: RequestIdSchema,
	stats: CacheStatsSchema,
});
export type CacheStatsResponse = Static<typeof CacheStatsResponseSchema>;

// --- wording -----------------------------------------------------------------------------------------------------

/**
 * One line for a prompt change code, as the request log writes them:
 * - `restart`: the conversation started over (a summary or a reset), so nothing earlier could be reused.
 * - `base`: the instruction text at the very start.
 * - `section:<key>`, `section+:<key>`, `section-:<key>`: a named part of the instructions changed, came or went.
 * - `tool:<name>`, `tool+:<name>`, `tool-:<name>`, `tools-order`: the tool list.
 * - `update:<keys>`: an instruction update sent mid-conversation (an edited AGENTS.md, a new skill).
 * - `history:<i>/<n>`: an earlier message (the i-th of the n the previous request had) differs.
 * - `wire:<part>`: the provider request itself, as pi-ai built it, differs there (`system[1]`, `tools`, `messages[12]`, …).
 */
export function describePromptChange(code: string): string {
	const colon = code.indexOf(":");
	const kind = colon < 0 ? code : code.slice(0, colon);
	const rest = colon < 0 ? "" : code.slice(colon + 1);
	switch (kind) {
		case "restart":
			return "The conversation started over (a summary or a reset)";
		case "base":
			return "The opening instructions changed";
		case "section":
			return `Instructions “${rest}” changed`;
		case "section+":
			return `Instructions “${rest}” were added`;
		case "section-":
			return `Instructions “${rest}” were removed`;
		case "tool":
			return `Tool ${rest} changed`;
		case "tool+":
			return `Tool ${rest} was added`;
		case "tool-":
			return `Tool ${rest} was removed`;
		case "tools-order":
			return "The tools came in a different order";
		case "update":
			return rest === "" ? "Instructions were updated mid-conversation" : `Instructions “${rest}” were updated mid-conversation`;
		case "history": {
			const [index, total] = rest.split("/");
			return `Earlier message ${index ?? "?"} of ${total ?? "?"} differs`;
		}
		case "wire":
			return `The request sent to the provider differs at ${rest}`;
		default:
			return code;
	}
}
