/** Each conversation's cache retention: what the setting asks for, added to the tagged request's options only. */
import { describe, expect, it } from "bun:test";
import type { Models } from "@earendil-works/pi-ai";
import { cacheRetentionFor, PromptCacheRetention } from "../src/cache-retention.ts";

describe("cacheRetentionFor", () => {
	it("asks coordinators for the long cache by default, everyone or nobody when told", () => {
		expect(cacheRetentionFor("coordinators", true)).toBe("long");
		expect(cacheRetentionFor("coordinators", false)).toBeUndefined();
		expect(cacheRetentionFor("all", false)).toBe("long");
		expect(cacheRetentionFor("off", true)).toBeUndefined();
	});
});

describe("PromptCacheRetention", () => {
	it("adds the retention to tagged requests and leaves a request's own choice and untagged requests alone", () => {
		const retention = new PromptCacheRetention();
		const extension = retention.extension((conversationId) => (conversationId === 1 ? "long" : undefined));
		const beforeRequest = (extension.hooks?.[0] as { handlers: { beforeRequest: (request: unknown, api: unknown) => unknown } })
			.handlers.beforeRequest;
		const seen: unknown[] = [];
		const models = {
			streamSimple: (_model: unknown, _context: unknown, options?: { cacheRetention?: unknown }) => {
				seen.push(options?.cacheRetention);
				return {};
			},
		} as unknown as Models;
		const wrapped = retention.applyTo(models);
		const send = (conversationId: number | undefined, options?: Record<string, unknown>) => {
			const messages = [{ role: "user", content: "Hi", timestamp: 1 }];
			if (conversationId !== undefined) beforeRequest({ messages }, { conversationId });
			(wrapped.streamSimple as unknown as (...args: unknown[]) => unknown)({}, { messages }, options);
		};
		send(1);
		send(2);
		send(undefined);
		// A compaction summary of the same messages asks for no cache, and keeps that.
		send(1, { cacheRetention: "none" });
		expect(seen).toEqual(["long", undefined, undefined, "none"]);
	});
});
