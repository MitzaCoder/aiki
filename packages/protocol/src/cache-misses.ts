/**
 * Prompt cache misses: when a request re-sent the conversation at the full input price instead of reading it from the
 * provider's cache. The server counts them per conversation (`ContextUsage.cacheMisses`) and the app marks each one in
 * the transcript, so both sides share these rules. Pure functions over the pi-ai assistant messages entries carry; no
 * runtime dependencies.
 *
 * Ported from the pi coding agent's `cache-stats.js`: a request misses what it shares with the previous request (the
 * smaller of the two prompts) minus what it read from the cache. A summary or a reset starts a new context, so the next
 * request has nothing to miss. A `pi.system` entry (an edited AGENTS.md, a new skill) changed the instructions at the
 * start of the prompt, so the next miss is explained by it. The harness's own one-off requests (compaction summaries, the memory agent) ask for no
 * cache and are not transcript entries, so they never count.
 *
 * How long the cache lasts is read per request from what the provider reports: a request that wrote to Anthropic's
 * one-hour cache (`usage.cacheWrite1h`, what pi-ai's "long" retention asks for) keeps its prompt for an hour, any other
 * for the default five minutes, and one that wrote nothing keeps the previous request's lifetime.
 */

/** How long a provider keeps a prompt cached after its last use: Anthropic's default, and pi-ai's "short" retention. */
export const PROMPT_CACHE_TTL_MS = 5 * 60 * 1000;

/** How long Anthropic keeps a prompt written to its one-hour cache: pi-ai's "long" retention. */
export const LONG_PROMPT_CACHE_TTL_MS = 60 * 60 * 1000;

/** Misses up to this many tokens are noise from where the provider places its cache breakpoints. */
export const CACHE_MISS_NOISE_FLOOR_TOKENS = 1024;

/** A miss worth a line in the transcript: at least this many tokens, or this many dollars. */
export const NOTABLE_CACHE_MISS_TOKENS = 20_000;
export const NOTABLE_CACHE_MISS_COST = 0.1;

/**
 * Why a request missed, from what can be seen: the model changed, the instructions changed (a `pi.system` entry since the
 * previous request), the conversation sat idle past the cache's lifetime, or none of these. An `unexplained` miss
 * suggests the start of the prompt changed between two requests without a reason, which it should not.
 */
export type CacheMissReason = "model_switch" | "instructions_changed" | "idle" | "unexplained";

export type CacheMiss = {
	/** Prompt tokens the previous request had too, billed at the full price instead of the cache-read price. */
	missedTokens: number;
	/** What that cost over reading them from the cache, in dollars. */
	missedCost: number;
	/** Milliseconds since the previous request. */
	idleMs: number;
	/** How long the cache it missed was kept: `PROMPT_CACHE_TTL_MS`, or `LONG_PROMPT_CACHE_TTL_MS` for the one-hour cache. */
	cacheTtlMs: number;
	reason: CacheMissReason;
};

type Usage = {
	input: number;
	cacheRead: number;
	cacheWrite: number;
	/** The part of `cacheWrite` written to the one-hour cache; only Anthropic reports it. */
	cacheWrite1h: number;
	cost: { input: number; cacheRead: number; cacheWrite: number };
};

type AssistantMessage = { provider: string; model: string; timestamp: number; usage: Usage };

/** What a tracker keeps of the previous request; `CacheMissTracker.previous` and `seed` carry it across a restart. */
export type PreviousRequest = {
	promptTokens: number;
	/** `provider/model`. */
	modelKey: string;
	timestamp: number;
	/** Some request so far read or wrote the cache, so a request that did neither is a full miss, not a provider without one. */
	reportedCache: boolean;
	/** How long its cache lasts; absent means the tracker's default (`ttlMs`). */
	cacheTtlMs?: number;
};

function finite(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** The fields a miss is read from, or undefined when the message is not an assistant message with usage. */
function assistantMessage(value: unknown): AssistantMessage | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const message = value as { role?: unknown; provider?: unknown; model?: unknown; timestamp?: unknown; usage?: unknown };
	if (message.role !== "assistant" || typeof message.usage !== "object" || message.usage === null) return undefined;
	const usage = message.usage as Record<string, unknown>;
	const cost = (typeof usage.cost === "object" && usage.cost !== null ? usage.cost : {}) as Record<string, unknown>;
	return {
		provider: typeof message.provider === "string" ? message.provider : "",
		model: typeof message.model === "string" ? message.model : "",
		timestamp: finite(message.timestamp),
		usage: {
			input: finite(usage.input),
			cacheRead: finite(usage.cacheRead),
			cacheWrite: finite(usage.cacheWrite),
			cacheWrite1h: finite(usage.cacheWrite1h),
			cost: { input: finite(cost.input), cacheRead: finite(cost.cacheRead), cacheWrite: finite(cost.cacheWrite) },
		},
	};
}

export function isNotableCacheMiss(miss: CacheMiss): boolean {
	return miss.missedTokens >= NOTABLE_CACHE_MISS_TOKENS || miss.missedCost >= NOTABLE_CACHE_MISS_COST;
}

export type CacheMissTrackerOptions = {
	/** How long the cache lives when a request did not write to the one-hour cache; default `PROMPT_CACHE_TTL_MS`. */
	ttlMs?: number;
	/**
	 * The model's cache-read price per token, for a request that read nothing from the cache and so shows no rate of its
	 * own. Without it, the rate an earlier request of the same model paid is used, else zero.
	 */
	cacheReadPerToken?: (provider: string, model: string) => number | undefined;
};

/**
 * Follows one conversation's requests in order. Feed it every entry (`observeEntry`) or every assistant message
 * (`observe`) oldest first; each returns the miss the request paid for, if any. Keeps only the previous request, so a
 * caller that reads entries in pages can keep one tracker and feed it the next page later.
 */
export class CacheMissTracker {
	readonly #ttlMs: number;
	readonly #cacheReadPerToken: CacheMissTrackerOptions["cacheReadPerToken"];
	/** Cache-read price per token each model was seen to charge, by `provider/model`. */
	readonly #readRates = new Map<string, number>();
	#previous: PreviousRequest | undefined;
	/** A `pi.system` entry came after the previous request. */
	#instructionsChanged = false;
	#lastCacheTouch: number | undefined;

	constructor(options: CacheMissTrackerOptions = {}) {
		this.#ttlMs = options.ttlMs ?? PROMPT_CACHE_TTL_MS;
		this.#cacheReadPerToken = options.cacheReadPerToken;
	}

	/** The previous request, when there is one: what a later tracker is seeded with to go on from here. */
	get previous(): PreviousRequest | undefined {
		return this.#previous === undefined ? undefined : { ...this.#previous };
	}

	/** Go on from a request an earlier tracker saw, as if this one had observed it. */
	seed(previous: PreviousRequest): void {
		this.#previous = { ...previous };
		this.#instructionsChanged = false;
	}

	touch(at: number): void { this.#lastCacheTouch = Math.max(this.#lastCacheTouch ?? 0, at); }

	/** The instructions changed since the previous request (what a `pi.system` entry tells `observeEntry`). */
	instructionsChanged(): void {
		this.#instructionsChanged = true;
	}

	/** The next request starts a new context (a compaction summary, a reset): it has nothing to miss. */
	reset(): void {
		this.#previous = undefined;
		this.#lastCacheTouch = undefined;
		this.#instructionsChanged = false;
	}

	/**
	 * One durable entry: a `pi.compaction` or `pi.reset` resets, a `pi.system` marks the instructions changed, a
	 * `pi.assistant` entry's messages are observed. Other kinds change nothing.
	 */
	observeEntry(entry: { kind: string; model?: readonly unknown[] }): CacheMiss[] {
		if (entry.kind === "pi.compaction" || entry.kind === "pi.reset") {
			this.reset();
			return [];
		}
		if (entry.kind === "pi.system") {
			this.instructionsChanged();
			return [];
		}
		if (entry.kind !== "pi.assistant") return [];
		const misses: CacheMiss[] = [];
		for (const message of entry.model ?? []) {
			const miss = this.observe(message);
			if (miss !== undefined) misses.push(miss);
		}
		return misses;
	}

	/**
	 * An assistant message: the miss it paid for, if any, and it becomes the previous request. Undefined for the first
	 * request, after a reset, below the noise floor, or while the provider has never reported any cache use (one without
	 * a cache).
	 */
	observe(value: unknown): CacheMiss | undefined {
		const message = assistantMessage(value);
		if (message === undefined) return undefined;
		const { usage } = message;
		const modelKey = `${message.provider}/${message.model}`;
		if (usage.cacheRead > 0) this.#readRates.set(modelKey, usage.cost.cacheRead / usage.cacheRead);
		const miss = this.#detect(message, modelKey);
		const promptTokens = usage.input + usage.cacheRead + usage.cacheWrite;
		// A request with no prompt usage (a failed one) leaves the previous request in place.
		if (promptTokens > 0) {
			this.#previous = {
				promptTokens,
				modelKey,
				timestamp: message.timestamp,
				reportedCache: (this.#previous?.reportedCache ?? false) || usage.cacheRead + usage.cacheWrite > 0,
				cacheTtlMs: this.#lifetime(usage),
			};
			this.#instructionsChanged = false;
		}
		return miss;
	}

	/**
	 * How long the prompt of a request stays cached: an hour once it wrote to the one-hour cache, the default once it
	 * wrote to the other; a request that wrote nothing (it read the whole prompt) refreshed the previous lifetime.
	 */
	#lifetime(usage: Usage): number {
		if (usage.cacheWrite1h > 0) return LONG_PROMPT_CACHE_TTL_MS;
		if (usage.cacheWrite > 0) return this.#ttlMs;
		return this.#previous?.cacheTtlMs ?? this.#ttlMs;
	}

	#detect(message: AssistantMessage, modelKey: string): CacheMiss | undefined {
		const previous = this.#previous;
		const { usage } = message;
		const promptTokens = usage.input + usage.cacheRead + usage.cacheWrite;
		// A request that used no cache counts only once some request did: with a provider that reports cache reads, that
		// is a full miss; with one that never reports any, it means nothing.
		if (previous === undefined || promptTokens <= 0) return undefined;
		if (usage.cacheRead + usage.cacheWrite === 0 && !previous.reportedCache) return undefined;
		const missedTokens = Math.min(previous.promptTokens, promptTokens) - usage.cacheRead;
		if (missedTokens <= CACHE_MISS_NOISE_FLOOR_TOKENS) return undefined;
		// Missed tokens land in the input or cache-write buckets, so this request's own cost split gives the price paid for
		// them (the cache-write premium included); the difference to the cache-read price is what the miss cost.
		const paidTokens = usage.input + usage.cacheWrite;
		const paidPerToken = paidTokens > 0 ? (usage.cost.input + usage.cost.cacheWrite) / paidTokens : 0;
		const readPerToken =
			usage.cacheRead > 0
				? usage.cost.cacheRead / usage.cacheRead
				: (this.#readRates.get(modelKey) ?? this.#cacheReadPerToken?.(message.provider, message.model) ?? 0);
		const idleMs = Math.max(0, message.timestamp - Math.max(previous.timestamp, this.#lastCacheTouch ?? 0));
		const cacheTtlMs = previous.cacheTtlMs ?? this.#ttlMs;
		const reason: CacheMissReason =
			modelKey !== previous.modelKey
				? "model_switch"
				: this.#instructionsChanged
					? "instructions_changed"
					: idleMs >= cacheTtlMs
						? "idle"
						: "unexplained";
		return { missedTokens, missedCost: missedTokens * Math.max(0, paidPerToken - readPerToken), idleMs, cacheTtlMs, reason };
	}
}
