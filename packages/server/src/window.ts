/**
 * Windowed conversation views on top of pi-durable 1.4.0.
 *
 * pi-durable 1.4.0's view carries the whole active transcript and has no `from`/window parameters (those are unreleased
 * additions). This tracker gives clients the same wire shape the design asks for: a bounded `entries` window with
 * `before`, `from` for resuming after a reconnect, and Chord ops computed by diffing successive windowed values.
 * The server can switch to pi-durable's own windowing when a release provides it.
 */
import type { JsonValue } from "@earendil-works/chord";
import { diffRevisions } from "@earendil-works/chord/delta";
import type { ConversationView as DurableConversationView, EntryRecord as DurableEntry } from "@earendil-works/pi-durable";
import type { CacheWarmStretch, ChordOp, ConversationView } from "@mihai-harness/protocol";
import { ServerError } from "./errors.ts";
import type { QueueDecoration } from "./queued-inputs.ts";
import { wireConversation, wireEntry } from "./wire.ts";

export type WindowBounds = { readonly min: number; readonly max: number };

export const DEFAULT_WINDOW_MIN = 50;

export function resolveWindowBounds(min?: number, max?: number): WindowBounds {
	const lower = min ?? DEFAULT_WINDOW_MIN;
	const upper = max ?? lower * 2;
	if (!Number.isInteger(lower) || lower < 1) {
		throw new ServerError("bad_request", "min must be an integer of at least 1");
	}
	if (!Number.isInteger(upper) || upper < lower) {
		throw new ServerError("bad_request", "max must be an integer of at least min");
	}
	return { min: lower, max: upper };
}

function compareEntryIds(left: number, right: number): number {
	return left - right;
}

/** Where `ids` appears as a contiguous run in `entries`, searching from the newest end, or undefined. */
function contiguousRunStart(entries: readonly DurableEntry[], ids: readonly number[]): number | undefined {
	if (ids.length === 0) return undefined;
	if (entries.length < ids.length) return undefined;
	for (let start = entries.length - ids.length; start >= 0; start--) {
		let matches = true;
		for (let index = 0; index < ids.length; index++) {
			if (entries[start + index]?.id !== ids[index]) {
				matches = false;
				break;
			}
		}
		if (matches) return start;
	}
	return undefined;
}

function toWireView(
	raw: DurableConversationView,
	entries: readonly DurableEntry[],
	before: number | undefined,
	queue: QueueDecoration | undefined,
	keepWarm?: CacheWarmStretch[],
): ConversationView {
	return {
		conversation: wireConversation(raw.conversation),
		...(keepWarm === undefined ? {} : { keepWarm }),
		entries: entries.map((entry) => {
			const wired = wireEntry(entry);
			const submissionId = queue?.placed.get(entry.id);
			return submissionId === undefined ? wired : { ...wired, submissionId };
		}),
		...(before === undefined ? {} : { before }),
		docs: raw.docs as unknown as ConversationView["docs"],
		// Empty values are never sent, so a client that sees no `queued` has nothing waiting.
		...(queue === undefined || queue.queued.length === 0 ? {} : { queued: queue.queued }),
	};
}

export type WindowUpdate = {
	value: ConversationView;
	ops: ChordOp[];
};

export class WatchWindow {
	readonly #bounds: WindowBounds;
	#current: ConversationView | undefined;

	constructor(bounds: WindowBounds) {
		this.#bounds = bounds;
	}

	/**
	 * The first value: `from` starts it at that entry when at most `max` entries are at or after it, otherwise at the
	 * newest `min`; without `from`, at the newest `min`. A `from` past the newest entry starts empty.
	 */
	initial(raw: DurableConversationView, from?: number, queue?: QueueDecoration, keepWarm?: CacheWarmStretch[]): ConversationView {
		const { min, max } = this.#bounds;
		const entries = raw.entries;
		let start: number;
		if (from === undefined) {
			start = Math.max(0, entries.length - min);
		} else {
			const first = entries.findIndex((entry) => compareEntryIds(entry.id, from) >= 0);
			const atOrAfter = first === -1 ? 0 : entries.length - first;
			if (atOrAfter <= max) {
				start = first === -1 ? entries.length : first;
			} else {
				start = Math.max(0, entries.length - min);
			}
		}
		const windowEntries = entries.slice(start);
		const before = start > 0 ? entries[start - 1]?.id : undefined;
		this.#current = toWireView(raw, windowEntries, before, queue, keepWarm);
		return this.#current;
	}

	/** The next value plus the ops that turn the previous value into it. */
	update(raw: DurableConversationView, queue?: QueueDecoration, keepWarm?: CacheWarmStretch[]): WindowUpdate {
		const current = this.#current;
		if (current === undefined) {
			const value = this.initial(raw, undefined, queue, keepWarm);
			return { value, ops: [] };
		}

		const { min, max } = this.#bounds;
		const currentIds = current.entries.map((entry) => entry.id);
		const entries = raw.entries;
		const runStart = contiguousRunStart(entries, currentIds);

		let windowEntries: readonly DurableEntry[];
		if (runStart === undefined) {
			// The active transcript was replaced (a reset or a compaction moved the head): start a fresh window.
			windowEntries = entries.slice(Math.max(0, entries.length - min));
		} else {
			// Keep the window, append what came after it, and bound it again.
			windowEntries = entries.slice(runStart);
			if (windowEntries.length > max) {
				// Drop in one splice, down to `min`, exactly once the window would exceed `max`.
				windowEntries = windowEntries.slice(windowEntries.length - min);
			}
		}

		const firstId = windowEntries[0]?.id;
		let before: number | undefined;
		if (firstId === undefined) {
			const newest = entries.at(-1);
			before = newest === undefined ? undefined : newest.id;
		} else {
			const firstIndex = entries.findIndex((entry) => entry.id === firstId);
			if (firstIndex > 0) before = entries[firstIndex - 1]?.id;
		}

		const value = toWireView(raw, windowEntries, before, queue, keepWarm);
		const ops = diffRevisions(current as unknown as JsonValue, value as unknown as JsonValue) as ChordOp[];
		this.#current = value;
		return { value, ops };
	}
}
