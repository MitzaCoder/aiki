import { createHash } from "node:crypto";
/** Zero-output Anthropic maintenance, below pi-ai's forced streaming flag.
 * Auth, OAuth identity, beta headers, session affinity and usage observation remain pi-ai's.
 * Only the final HTTP body is replaced. The JSON reply is adapted to the stream parser;
 * it is never handed to a conversation or a tool executor.
 */
import type { Context, Model, Models, ModelsSimpleStreamOptions } from "@earendil-works/pi-ai";

export function cacheWarmHeaders(headers: Headers): Record<string, string> {
    return Object.fromEntries(["anthropic-beta", "anthropic-version"].flatMap(name => headers.has(name) ? [[name, headers.get(name)!]] : []));
}
export function cacheWarmAuthFingerprint(headers: Headers): string {
    return createHash("sha256").update(JSON.stringify(["authorization", "x-api-key", "anthropic-beta", "anthropic-version", "x-app", "user-agent"].map(name => headers.get(name)))).digest("hex");
}
export type CacheWarmPayload = Record<string, unknown>;
export function supportsCacheWarm(model: Pick<Model<string>, "provider" | "api">): boolean {
	return model.provider === "anthropic" && model.api === "anthropic-messages";
}
export function zeroOutputPayload(payload: CacheWarmPayload): CacheWarmPayload | undefined {
	const thinking = payload.thinking as { type?: string } | undefined;
	const choice = payload.tool_choice as { type?: string } | undefined;
	if (thinking?.type === "enabled" || choice?.type === "any" || choice?.type === "tool" ||
		(payload.output_config as { format?: unknown } | undefined)?.format !== undefined) return undefined;
	return { ...structuredClone(payload), max_tokens: 0, stream: false };
}

export async function refreshAnthropicCache(options: {
	models: Models; model: Model<string>; context: Context; requestOptions: ModelsSimpleStreamOptions;
	payload: CacheWarmPayload; authFingerprint?: string; cacheHeaders?: Record<string, string>; signal: AbortSignal; admit: () => boolean;
}) {
	if (!supportsCacheWarm(options.model)) throw new Error("Not supported for this provider");
	const body = zeroOutputPayload(options.payload);
	if (body === undefined) throw new Error("Zero-output request not supported for this configuration");
	const transport = options.requestOptions.fetch ?? globalThis.fetch;
	const adaptedFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		options.signal.throwIfAborted();
		if (!options.admit()) throw new Error("Cache refresh invalidated");
		const headers = new Headers(new Request(input instanceof Request ? input.clone() : input, init).headers);
		if (options.cacheHeaders !== undefined) {
			for (const name of ["anthropic-beta", "anthropic-version"]) {
				const value = options.cacheHeaders[name];
				if (value === undefined) headers.delete(name); else headers.set(name, value);
			}
		}
		if (options.authFingerprint !== undefined && cacheWarmAuthFingerprint(headers) !== options.authFingerprint) throw new Error("Provider account or request headers changed");
		const response = await transport(input, { ...init, headers, body: JSON.stringify(body), signal: options.signal });
		if (!response.ok) return response; // pi-ai reports the error, with no retry.
		const message = await response.json() as { id: string; model: string; usage: Record<string, unknown>; stop_reason: string };
		const events = [
			{ type: "message_start", message: { ...message, role: "assistant", type: "message", content: [] } },
			{ type: "message_delta", delta: { stop_reason: message.stop_reason }, usage: { output_tokens: 0 } },
			{ type: "message_stop" },
		];
		return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), {
			status: response.status, headers: { ...Object.fromEntries(response.headers), "content-type": "text/event-stream" },
		});
	}) as typeof fetch;
	// Do not retain caller closures, a turn's signal, or its onPayload callback.
	const { onPayload: _payload, onResponse: _response, fetch: _fetch, signal: _signal, ...requestOptions } = options.requestOptions;
	return options.models.streamSimple(options.model, options.context, {
		...requestOptions, signal: options.signal, maxRetries: 0, timeoutMs: 30_000,
		onPayload: () => structuredClone(options.payload), fetch: adaptedFetch,
	}).result();
}
