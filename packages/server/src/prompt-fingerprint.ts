/**
 * Prompt fingerprints: a hash of every part of a model request, so the request log can name what changed when a
 * request missed the provider's prompt cache. Pure functions; `request-log.ts` keeps one fingerprint per conversation
 * and compares each request with the one before.
 *
 * Two views of the same request:
 * - The messages pi-durable hands to pi-ai (`Models.streamSimple`): the leading system message carries the instructions
 *   as named sections and the tools it adds; later system messages are instruction updates sent mid-conversation; the
 *   rest is the transcript.
 * - The provider payload pi-ai built from them (`onPayload`): whatever the provider is actually sent, top-level part by
 *   part (`system`, `tools`, `messages`, `input`, `instructions`, …), with `cache_control` markers left out because they
 *   move to the newest message on every request by design.
 *
 * A change is a code `describePromptChange` (protocol) words for people.
 */

/** pi-durable's prefix for the summary message a compaction puts at the start of the transcript. */
const SUMMARY_PREFIX = "The conversation history before this point was compacted";

export type PromptFingerprint = {
	/** The leading system message's own text. */
	base: string;
	/** The leading system message's sections, by key. */
	sections: Record<string, string>;
	/** The tools the leading system message adds, in order, as `name` → hash. */
	tools: [string, string][];
	/** Every later message (instruction updates included), in order. */
	messages: string[];
	/** The provider payload's top-level parts: one hash, or one per element for a list. Absent when pi-ai gave none. */
	wire?: Record<string, string | string[]>;
};

type MessageLike = {
	role?: unknown;
	content?: unknown;
	sections?: unknown;
	toolsAdded?: unknown;
	toolsRemoved?: unknown;
};

export function hashText(text: string): string {
	return Bun.hash(text).toString(36);
}

function hashJson(value: unknown): string {
	return hashText(JSON.stringify(value) ?? "undefined");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A message's text: the string, or its text blocks joined. */
export function messageText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((block) => (isRecord(block) && block.type === "text" && typeof block.text === "string" ? block.text : ""))
		.join("");
}

/**
 * A message without what changes on every request without changing the prompt: its timestamp (pi-ai does not send it)
 * and, for an assistant message, its usage and timing.
 */
function stableMessage(message: unknown): unknown {
	if (!isRecord(message)) return message;
	const { timestamp: _timestamp, usage: _usage, durationMs: _durationMs, diagnostics: _diagnostics, ...rest } = message;
	return rest;
}

/** The fingerprint of the messages pi-durable sends; `payload` adds the provider payload when pi-ai showed it. */
export function fingerprintRequest(messages: readonly unknown[], payload?: unknown): PromptFingerprint {
	const [first, ...rest] = messages;
	const leading = isRecord(first) && first.role === "system" ? (first as MessageLike) : undefined;
	const sections: Record<string, string> = {};
	const tools: [string, string][] = [];
	if (leading !== undefined) {
		if (isRecord(leading.sections)) {
			for (const [key, text] of Object.entries(leading.sections)) {
				if (typeof text === "string") sections[key] = hashText(text);
			}
		}
		if (Array.isArray(leading.toolsAdded)) {
			for (const tool of leading.toolsAdded) {
				const name = isRecord(tool) && typeof tool.name === "string" ? tool.name : "?";
				tools.push([name, hashJson(tool)]);
			}
		}
	}
	const later = leading === undefined ? messages : rest;
	const fingerprint: PromptFingerprint = {
		base: leading === undefined ? "" : hashJson(leading.content),
		sections,
		tools,
		messages: later.map((message) => hashJson(stableMessage(message))),
	};
	const wire = payload === undefined ? undefined : fingerprintPayload(payload);
	if (wire !== undefined) fingerprint.wire = wire;
	return fingerprint;
}

/** `value` without `cache_control` anywhere in it. */
function withoutCacheMarkers(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(withoutCacheMarkers);
	if (!isRecord(value)) return value;
	const out: Record<string, unknown> = {};
	for (const [key, inner] of Object.entries(value)) {
		if (key === "cache_control") continue;
		out[key] = withoutCacheMarkers(inner);
	}
	return out;
}

/** The provider payload's top-level parts; undefined when it is not a JSON object (a provider SDK's own type). */
export function fingerprintPayload(payload: unknown): Record<string, string | string[]> | undefined {
	if (!isRecord(payload)) return undefined;
	const parts: Record<string, string | string[]> = {};
	try {
		for (const [key, value] of Object.entries(payload)) {
			if (value === undefined) continue;
			const clean = withoutCacheMarkers(value);
			parts[key] = Array.isArray(clean) ? clean.map(hashJson) : hashJson(clean);
		}
	} catch {
		return undefined;
	}
	return parts;
}

/** Whether the request starts over: its first transcript message is not the previous request's (a summary or a reset). */
export function startsOver(previous: PromptFingerprint, current: PromptFingerprint): boolean {
	if (previous.messages.length === 0) return false;
	return current.messages[0] !== previous.messages[0];
}

/** Whether a transcript message is the summary a compaction put first. */
export function isSummaryMessage(message: unknown): boolean {
	return isRecord(message) && message.role === "user" && messageText(message.content).startsWith(SUMMARY_PREFIX);
}

function diffKeyed(kind: string, previous: [string, string][], current: [string, string][]): string[] {
	const changes: string[] = [];
	const before = new Map(previous);
	const after = new Map(current);
	for (const [key, hash] of current) {
		const old = before.get(key);
		if (old === undefined) changes.push(`${kind}+:${key}`);
		else if (old !== hash) changes.push(`${kind}:${key}`);
	}
	for (const [key] of previous) if (!after.has(key)) changes.push(`${kind}-:${key}`);
	return changes;
}

/** The first index where two lists differ within the shorter one's length, or -1. */
function firstDifference(previous: readonly string[], current: readonly string[]): number {
	const length = Math.min(previous.length, current.length);
	for (let index = 0; index < length; index += 1) if (previous[index] !== current[index]) return index;
	return -1;
}

/**
 * What differs between two requests of one conversation, as `describePromptChange` codes; empty when this request only
 * added messages after the previous one's. `updates` are the section keys of the instruction updates this request added
 * (system messages after the previous request's last message).
 */
export function diffFingerprints(previous: PromptFingerprint, current: PromptFingerprint, updates: string[] = []): string[] {
	const changes: string[] = [];
	const restarted = startsOver(previous, current);
	if (restarted) changes.push("restart");
	if (previous.base !== current.base) changes.push("base");
	changes.push(...diffKeyed("section", Object.entries(previous.sections), Object.entries(current.sections)));
	const toolChanges = diffKeyed("tool", previous.tools, current.tools);
	changes.push(...toolChanges);
	if (
		toolChanges.length === 0 &&
		previous.tools.map(([name]) => name).join("\n") !== current.tools.map(([name]) => name).join("\n")
	) {
		changes.push("tools-order");
	}
	if (!restarted) {
		const index = firstDifference(previous.messages, current.messages);
		if (index >= 0) changes.push(`history:${index + 1}/${previous.messages.length}`);
		else if (current.messages.length < previous.messages.length) {
			changes.push(`history:${current.messages.length + 1}/${previous.messages.length}`);
		}
	}
	if (updates.length > 0) changes.push(`update:${updates.join(",")}`);
	if (previous.wire !== undefined && current.wire !== undefined) {
		for (const [key, value] of Object.entries(current.wire)) {
			const old = previous.wire[key];
			if (old === undefined) {
				changes.push(`wire:${key}`);
				continue;
			}
			if (Array.isArray(value) && Array.isArray(old)) {
				// The transcript is expected to differ after a restart; only the first difference says where the reuse ended.
				if (restarted && (key === "messages" || key === "input" || key === "contents")) continue;
				const index = firstDifference(old, value);
				if (index >= 0) changes.push(`wire:${key}[${index}]`);
				else if (value.length < old.length) changes.push(`wire:${key}[${value.length}]`);
			} else if (JSON.stringify(old) !== JSON.stringify(value)) {
				changes.push(`wire:${key}`);
			}
		}
		for (const key of Object.keys(previous.wire)) if (!(key in current.wire)) changes.push(`wire:${key}`);
	}
	return changes;
}
