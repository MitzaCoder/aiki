import { describe, expect, it } from "bun:test";
import { applyImmutable } from "@earendil-works/chord/delta";
import type { Op } from "@earendil-works/chord/delta";
import type { ConversationView as DurableView } from "@earendil-works/pi-durable";
import type { ConversationView } from "@kemiri/protocol";
import { WatchWindow, resolveWindowBounds } from "../src/window.ts";

/** A durable view as pi-durable 1.5.1 hands one out: already windowed, with `before` naming the entry outside it. */
function raw(ids: readonly number[], options: { before?: number; docs?: Record<string, unknown> } = {}): DurableView {
	return {
		conversation: { id: 1 },
		entries: ids.map((id) => ({
			id,
			conversationId: 1,
			kind: "pi.user",
			model: [{ role: "user", content: String(id), timestamp: 0 }],
		})),
		...(options.before === undefined ? {} : { before: options.before }),
		docs: options.docs ?? {},
	} as unknown as DurableView;
}

function ids(view: ConversationView): number[] {
	return view.entries.map((entry) => entry.id);
}

function apply(current: ConversationView, ops: readonly unknown[]): ConversationView {
	return applyImmutable(current as never, ops as unknown as Op[]) as unknown as ConversationView;
}

describe("WatchWindow", () => {
	// The regression behind T163: pi-durable's window is forwarded, `before` included. Recomputing `before` from the
	// entries of an already windowed view found an empty prefix and reported no older history, so nothing ever paged.
	it("keeps the dependency's `before` so the client knows older history exists", () => {
		const window = new WatchWindow();
		const value = window.initial(raw([71, 72, 73], { before: 70 }));
		expect(ids(value)).toEqual([71, 72, 73]);
		expect(value.before).toBe(70);
	});

	it("sends no `before` when the window starts the transcript", () => {
		const window = new WatchWindow();
		expect(window.initial(raw([1, 2])).before).toBeUndefined();
	});

	it("forwards the dependency's window instead of slicing it again", () => {
		const window = new WatchWindow();
		const value = window.initial(raw([51, 52], { before: 50 }));
		expect(ids(value)).toEqual([51, 52]);
		expect(value.before).toBe(50);
	});

	it("diffs successive windows so the client applies ops", () => {
		const window = new WatchWindow();
		let value = window.initial(raw([1, 2], { docs: { "pi.live": {} } }));
		const changed = window.update(raw([1, 2], { docs: { "pi.live": { run: { taskId: 1, inputs: [2] } } } }));
		value = apply(value, changed.ops);
		expect(ids(value)).toEqual([1, 2]);
		expect((value.docs["pi.live"] as { run?: unknown }).run).toBeDefined();
	});

	it("reports the window moving on, `before` and all, as ops", () => {
		const window = new WatchWindow();
		let value = window.initial(raw([51, 52], { before: 50 }));
		const advanced = window.update(raw([53, 54], { before: 52 }));
		value = apply(value, advanced.ops);
		expect(ids(value)).toEqual([53, 54]);
		expect(value.before).toBe(52);
		expect(advanced.value).toEqual(value);
	});

	it("an update before any initial value becomes the first value", () => {
		const window = new WatchWindow();
		const update = window.update(raw([7], { before: 6 }));
		expect(update.ops).toEqual([]);
		expect(update.value.before).toBe(6);
	});

	it("rejects bounds that cannot describe a window", () => {
		expect(() => resolveWindowBounds(0)).toThrow();
		expect(() => resolveWindowBounds(5, 4)).toThrow();
		expect(resolveWindowBounds(undefined, undefined)).toEqual({ min: 50, max: 100 });
	});
});
