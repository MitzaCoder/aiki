import { describe, expect, it } from "bun:test";
import { applyImmutable } from "@earendil-works/chord/delta";
import type { Op } from "@earendil-works/chord/delta";
import type { ConversationView as DurableView } from "@earendil-works/pi-durable";
import type { ConversationView } from "@mihai-harness/protocol";
import { WatchWindow, resolveWindowBounds } from "../src/window.ts";

function raw(ids: readonly number[], docs: Record<string, unknown> = {}): DurableView {
	return {
		conversation: { id: 1 },
		entries: ids.map((id) => ({
			id,
			conversationId: 1,
			kind: "pi.user",
			model: [{ role: "user", content: String(id), timestamp: 0 }],
		})),
		docs,
	} as unknown as DurableView;
}

function ids(view: ConversationView): number[] {
	return view.entries.map((entry) => entry.id);
}

function apply(current: ConversationView, ops: readonly unknown[]): ConversationView {
	return applyImmutable(current as never, ops as unknown as Op[]) as unknown as ConversationView;
}

describe("WatchWindow", () => {
	it("starts with the newest min entries, with `before` pointing at the entry just outside", () => {
		const window = new WatchWindow(resolveWindowBounds(50, 100));
		const value = window.initial(raw(Array.from({ length: 120 }, (_, index) => index + 1)));
		expect(ids(value)).toHaveLength(50);
		expect(ids(value)[0]).toBe(71);
		expect(ids(value).at(-1)).toBe(120);
		expect(value.before).toBe(70);
	});

	it("`from` starts at that entry when the window can hold what follows", () => {
		const window = new WatchWindow(resolveWindowBounds(50, 100));
		const value = window.initial(raw(Array.from({ length: 120 }, (_, index) => index + 1)), 100);
		expect(ids(value)[0]).toBe(100);
		expect(value.before).toBe(99);
	});

	it("`from` falls back to the newest min when too much follows", () => {
		const window = new WatchWindow(resolveWindowBounds(5, 10));
		const value = window.initial(raw(Array.from({ length: 20 }, (_, index) => index + 1)), 2);
		expect(ids(value)).toEqual([16, 17, 18, 19, 20]);
		expect(value.before).toBe(15);
	});

	it("a `from` past the newest entry starts empty with `before` at the newest", () => {
		const window = new WatchWindow(resolveWindowBounds(5, 10));
		const value = window.initial(raw([1, 2, 3]), 99);
		expect(ids(value)).toEqual([]);
		expect(value.before).toBe(3);
	});

	it("appends new entries and drops to min in one step past max", () => {
		const bounds = resolveWindowBounds(5, 10);
		const window = new WatchWindow(bounds);
		let value = window.initial(raw([1, 2, 3]));
		expect(ids(value)).toEqual([1, 2, 3]);

		const appended = window.update(raw([1, 2, 3, 4, 5]));
		value = apply(value, appended.ops);
		expect(ids(value)).toEqual([1, 2, 3, 4, 5]);
		expect(appended.value).toEqual(value);

		const grown = window.update(raw([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]));
		value = apply(value, grown.ops);
		expect(ids(value)).toEqual([7, 8, 9, 10, 11]);
		expect(value.before).toBe(6);

		const appendedAgain = window.update(raw([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]));
		value = apply(value, appendedAgain.ops);
		expect(ids(value)).toEqual([7, 8, 9, 10, 11, 12]);
	});

	it("keeps the client's window while still delivering changes to docs", () => {
		const window = new WatchWindow(resolveWindowBounds(2, 4));
		let value = window.initial(raw([1, 2], { "pi.live": {} }));
		const changed = window.update(raw([1, 2], { "pi.live": { run: { taskId: 1, inputs: [2] } } }));
		value = apply(value, changed.ops);
		expect(ids(value)).toEqual([1, 2]);
		expect((value.docs["pi.live"] as { run?: unknown }).run).toBeDefined();
	});

	it("rebuilds when a reset or compaction replaces the active transcript", () => {
		const window = new WatchWindow(resolveWindowBounds(2, 4));
		let value = window.initial(raw([1, 2, 3]));
		const replaced = window.update(raw([3, 20, 21, 22]));
		value = apply(value, replaced.ops);
		expect(ids(value)).toEqual([21, 22]);
		expect(value.before).toBe(20);
	});

	it("rejects bounds that cannot describe a window", () => {
		expect(() => resolveWindowBounds(0)).toThrow();
		expect(() => resolveWindowBounds(5, 4)).toThrow();
		expect(resolveWindowBounds(undefined, undefined)).toEqual({ min: 50, max: 100 });
	});
});
