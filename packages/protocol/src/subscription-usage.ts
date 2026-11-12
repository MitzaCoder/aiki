/**
 * Subscription usage: how much of each logged-in subscription's rate-limit windows is used, and when each resets.
 *
 * A subscription is a provider login with plan limits (Claude via `anthropic` OAuth, ChatGPT via `openai-codex`, and
 * others when they expose limits). Each has one or more windows, such as Claude's 5-hour and 7-day limits. The server
 * reads them from the provider and keeps a short history of samples per window, so a client can draw usage over time
 * and work out the pace: how fast the window is being used compared with how much of it has passed.
 */
import { type Static, Type } from "typebox";
import { RequestIdSchema } from "./common.ts";

export const UsageSampleSchema = Type.Object({
	at: Type.String({ description: "ISO 8601." }),
	usedPercent: Type.Number({ minimum: 0, description: "0 to 100; may exceed 100 when the provider allows overage." }),
});
export type UsageSample = Static<typeof UsageSampleSchema>;

export const UsageWindowSchema = Type.Object({
	id: Type.String({ minLength: 1, description: 'Stable per subscription, e.g. "five_hour", "seven_day", "seven_day_opus".' }),
	label: Type.String({ description: 'For humans, e.g. "5-hour limit", "Weekly limit", "Weekly · Opus".' }),
	usedPercent: Type.Union([Type.Number({ minimum: 0 }), Type.Null()], { description: "Null when unknown." }),
	resetsAt: Type.Union([Type.String(), Type.Null()], { description: "ISO 8601, when this window resets." }),
	windowMinutes: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()], {
		description: "The window's length, for the pace (how much of it has passed).",
	}),
	samples: Type.Array(UsageSampleSchema, { description: "Oldest first, this window's current period only." }),
});
export type UsageWindow = Static<typeof UsageWindowSchema>;

export const SubscriptionResetCreditSchema = Type.Object({
 id: Type.String(),
 program: Type.String(),
 label: Type.String(),
 remaining: Type.Integer({ minimum: 0 }),
 usable: Type.Boolean(),
 expiresAt: Type.Union([Type.String(), Type.Null()]),
 clears: Type.Array(Type.String()),
 givesBackWeekly: Type.Optional(Type.Boolean()),
 unavailableReason: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});
export type SubscriptionResetCredit = Static<typeof SubscriptionResetCreditSchema>;
export const SubscriptionResetsSchema = Type.Object({
 available: Type.Integer({ minimum: 0 }),
 credits: Type.Array(SubscriptionResetCreditSchema),
 reason: Type.Union([Type.String(), Type.Null()]),
});
export type SubscriptionResets = Static<typeof SubscriptionResetsSchema>;

export const SubscriptionUsageSchema = Type.Object({
 manualResets: Type.Optional(Type.Union([SubscriptionResetsSchema, Type.Null()], { description: "Null or absent means not reported, never zero. subscription-resets feature." })),
	providerId: Type.String({ minLength: 1 }),
	label: Type.String({ description: 'e.g. "Claude", "ChatGPT".' }),
	plan: Type.Union([Type.String(), Type.Null()], { description: 'e.g. "Max 20x", "Pro", when the provider says.' }),
	account: Type.Union([Type.String(), Type.Null()], { description: "An email or account label, when known." }),
	windows: Type.Array(UsageWindowSchema),
	source: Type.Union([Type.Literal("usage_api"), Type.Literal("response_headers"), Type.Literal("none")], {
		description: "Where the numbers came from: the provider's usage endpoint, or rate-limit headers of recent replies.",
	}),
	updatedAt: Type.Union([Type.String(), Type.Null()], { description: "When the numbers were last read." }),
	error: Type.Union([Type.String(), Type.Null()], { description: "Why the last read failed, if it did." }),
});
export type SubscriptionUsage = Static<typeof SubscriptionUsageSchema>;

// --- requests ----------------------------------------------------------------------------------------------------

/** Every subscription's usage. `refresh` reads the providers now instead of answering from the last read. */
export const SubscriptionsUsageRequestSchema = Type.Object({
	type: Type.Literal("subscriptions.usage"),
	id: RequestIdSchema,
	refresh: Type.Optional(Type.Boolean()),
});
export type SubscriptionsUsageRequest = Static<typeof SubscriptionsUsageRequestSchema>;

/** Explicit one-credit consumption. No auto-redemption; requestId is a stable idempotency key. */
export const SubscriptionsResetRequestSchema = Type.Object({
 type: Type.Literal("subscriptions.reset"),
 id: RequestIdSchema,
 providerId: Type.String(),
 creditId: Type.String(),
 program: Type.String(),
 requestId: Type.String({ format: "uuid" }),
 confirmed: Type.Literal(true),
});
export type SubscriptionsResetRequest = Static<typeof SubscriptionsResetRequestSchema>;
export const SubscriptionsResetResponseSchema = Type.Object({
 type: Type.Literal("subscriptions.reset"),
 id: RequestIdSchema,
 ok: Type.Boolean(),
 code: Type.String(),
});
export type SubscriptionsResetResponse = Static<typeof SubscriptionsResetResponseSchema>;

// --- responses ---------------------------------------------------------------------------------------------------

export const SubscriptionsUsageResponseSchema = Type.Object({
	type: Type.Literal("subscriptions.usage"),
	id: RequestIdSchema,
	subscriptions: Type.Array(SubscriptionUsageSchema),
});
export type SubscriptionsUsageResponse = Static<typeof SubscriptionsUsageResponseSchema>;

// --- server events -----------------------------------------------------------------------------------------------

/** Pushed to every connection when a read changes any subscription's numbers. */
export const SubscriptionsUsageEventSchema = Type.Object({
	type: Type.Literal("subscriptions.usage.changed"),
	subscriptions: Type.Array(SubscriptionUsageSchema),
});
export type SubscriptionsUsageEvent = Static<typeof SubscriptionsUsageEventSchema>;
