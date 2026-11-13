import { stateKind } from "./state-identity.ts";
/**
 * How long each conversation asks the provider to keep its prompt cached (pi-ai's `cacheRetention`), from the project's
 * `longPromptCache` setting: coordinators (main and background threads) wait for workers longer than the default five
 * minutes, so by default they ask for "long" (Anthropic's one-hour cache) and workers keep pi-ai's default.
 *
 * pi-durable's stream options are the Harness's, one set for every conversation, so the choice is made per request:
 * this module's extension (a `beforeRequest` hook only: no section, no tool, so no prompt changes; workers and threads
 * keep it) tags the last message object of each turn's request with its retention, and the wrapped `Models` adds it to
 * that request's options. A request that set its own keeps it (compaction summaries and the memory agent ask for
 * "none"), and an untagged one is left alone. What "long" does per provider is pi-ai's: a one-hour `cache_control` on
 * Anthropic and Bedrock, a longer one on OpenAI's own API (where its compat allows), nothing on Codex.
 */
import type { LongPromptCache } from "@kemiri/protocol";
import type { CacheRetention, Models } from "@earendil-works/pi-ai";
import { defineExtension, type Extension, GenerationTask, hook } from "@earendil-works/pi-durable";

export const CACHE_RETENTION_EXTENSION_NAME = stateKind("cache-retention");

/** The retention a conversation asks for under a project's setting; undefined leaves pi-ai's default ("short"). */
export function cacheRetentionFor(setting: LongPromptCache, isCoordinator: boolean): CacheRetention | undefined {
	return setting === "all" || (setting === "coordinators" && isCoordinator) ? "long" : undefined;
}

export class PromptCacheRetention {
	/** The last message object of each request the hook saw, to the retention its conversation asks for. */
	readonly #tags = new WeakMap<object, CacheRetention>();

	/** The extension that tags each turn's request; one per project, installed in its registry. */
	extension(retentionOf: (conversationId: number) => CacheRetention | undefined): Extension {
		return defineExtension({
			name: CACHE_RETENTION_EXTENSION_NAME,
			hooks: [
				hook(GenerationTask, {
					beforeRequest: (request, api) => {
						try {
							const last = request.messages.at(-1);
							const retention = retentionOf(Number(api.conversationId));
							if (typeof last === "object" && last !== null && retention !== undefined) this.#tags.set(last, retention);
						} catch {
							// Never in the way of the request: it goes with pi-ai's default.
						}
						return undefined;
					},
				}),
			],
		});
	}

	/** The same models, with each tagged request's retention added to its options. */
	applyTo(models: Models): Models {
		const tags = this.#tags;
		const wrapStream = (value: (...args: unknown[]) => unknown) =>
			(model: unknown, context: unknown, options?: Record<string, unknown>) => {
				let retention: CacheRetention | undefined;
				try {
					const last = (context as { messages?: unknown[] } | undefined)?.messages?.at(-1);
					retention = typeof last === "object" && last !== null ? tags.get(last) : undefined;
				} catch {
					retention = undefined;
				}
				if (retention === undefined || options?.cacheRetention !== undefined) return value.call(models, model, context, options);
				return value.call(models, model, context, { ...options, cacheRetention: retention });
			};
		return new Proxy(models, {
			get(target, property, receiver) {
				const value = Reflect.get(target, property, receiver) as unknown;
				if (typeof value !== "function") return value;
				if (property === "streamSimple") return wrapStream(value as (...args: unknown[]) => unknown);
				return (value as (...args: unknown[]) => unknown).bind(target);
			},
		});
	}
}
