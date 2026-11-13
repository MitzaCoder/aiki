/**
 * Windowed conversation views on top of pi-durable 1.5.1.
 *
 * pi-durable 1.5.1 windows the view itself (`ConversationWindow`): the newest `min` entries, appends after that, one drop
 * to `min` past `max`, and a `before` naming the entry just outside the window. The server passes the client's bounds and
 * `from` to `conversation.watch()`, so the window and its `before` come from the dependency.
 *
 * pi-durable 1.4.0's view carried the whole transcript, and this file used to re-window it. Run against an already
 * windowed view that logic found `entries.length === min`, took its own prefix as empty, and dropped the durable `before`:
 * every client then believed the conversation started at the window's first entry and never offered to page back (T163).
 * What remains here is the wire conversion and the Chord ops between successive values.
 */
import type { JsonValue } from "@earendil-works/chord/json";
import { diffRevisions } from "@earendil-works/chord/delta";
import type { ConversationView as DurableConversationView, EntryRecord as DurableEntry } from "@earendil-works/pi-durable";
import type { CacheWarmStretch, ChordOp, ConversationView } from "@aiki/protocol";
import { ServerError } from "./errors.ts";
import type { QueueDecoration } from "./queued-inputs.ts";
import { wireConversation, wireEntry } from "./wire.ts";

export type WindowBounds = { readonly min: number; readonly max: number };

export const DEFAULT_WINDOW_MIN = 50;

/** The bounds a client asked for, checked; pi-durable applies the same `min`/`max` rules to its own window. */
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

function toWireView(
	raw: DurableConversationView,
	entries: readonly DurableEntry[],
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
		// `before` is the dependency's: recomputing it from the entries cannot see the history outside the window.
		...(raw.before === undefined ? {} : { before: raw.before }),
		docs: raw.docs as unknown as ConversationView["docs"],
		// Empty values are never sent, so a client that sees no `queued` has nothing waiting.
		...(queue === undefined || queue.queued.length === 0 ? {} : { queued: queue.queued }),
	};
}

export type WindowUpdate = {
	value: ConversationView;
	ops: ChordOp[];
};

/** Forwards pi-durable's window as protocol values and says what changed since the previous one. */
export class WatchWindow {
	#current: ConversationView | undefined;

	/** The first value, exactly the window pi-durable opened for this client. */
	initial(raw: DurableConversationView, queue?: QueueDecoration, keepWarm?: CacheWarmStretch[]): ConversationView {
		this.#current = toWireView(raw, raw.entries, queue, keepWarm);
		return this.#current;
	}

	/** The next value plus the ops that turn the previous value into it. */
	update(raw: DurableConversationView, queue?: QueueDecoration, keepWarm?: CacheWarmStretch[]): WindowUpdate {
		const current = this.#current;
		const value = toWireView(raw, raw.entries, queue, keepWarm);
		if (current === undefined) {
			this.#current = value;
			return { value, ops: [] };
		}
		const ops = diffRevisions(current as unknown as JsonValue, value as unknown as JsonValue) as ChordOp[];
		this.#current = value;
		return { value, ops };
	}
}
