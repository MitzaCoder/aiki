import { describe, expect, test } from "bun:test";
import type { ChatDraft, DraftContent } from "@kemiri/protocol";
import {
	DRAFT_DEBOUNCE_MS,
	DRAFT_MAX_ATTEMPTS,
	DRAFT_RETRY_MS,
	DRAFT_TYPING_QUIET_MS,
	DraftSync,
	decideRemote,
	draftOrigin,
	type DraftSyncTransport,
} from "../src/lib/drafts-sync.ts";
import type { Draft, SyncedDraft } from "../src/lib/drafts.ts";

const draft = (text: string, extra: Partial<Draft> = {}): Draft => ({ text, quotes: [], ...extra });
const none: SyncedDraft = { revision: 0, content: null };
const entry = (revision: number, content: DraftContent | null, author?: ChatDraft["author"]): ChatDraft => ({
	projectId: "p",
	threadId: "main",
	revision,
	updatedAt: "2026-11-08T10:00:00.000Z",
	content,
	...(author === undefined ? {} : { author }),
});

describe("decideRemote: never overwrite what the user has not synced", () => {
	const base = { focused: false, sinceLocalEdit: Number.POSITIVE_INFINITY };
	test("an entry that is not newer is ignored", () => {
		const synced = { revision: 3, content: draft("a") };
		expect(decideRemote({ ...base, local: draft("a"), synced, remote: entry(3, draft("b")) })).toEqual({ action: "ignore" });
		expect(decideRemote({ ...base, local: draft("a"), synced, remote: entry(2, draft("b")) })).toEqual({ action: "ignore" });
		// ... unless the backend itself answered with it (it may have lost its entry).
		expect(decideRemote({ ...base, local: draft("a"), synced, remote: entry(2, draft("b")), authoritative: true })).toEqual({ action: "apply" });
	});
	test("the same content only moves the revision", () => {
		expect(decideRemote({ ...base, local: draft("same"), synced: none, remote: entry(1, draft("same")) })).toEqual({ action: "adopt" });
		// Empty and cleared are the same thing, and a missing attachment list is an empty one.
		expect(decideRemote({ ...base, local: draft("  "), synced: { revision: 1, content: draft("x") }, remote: entry(2, null) })).toEqual({ action: "adopt" });
		expect(decideRemote({ ...base, local: draft("t", { attachments: [] }), synced: none, remote: entry(1, draft("t")) })).toEqual({ action: "adopt" });
	});
	test("an untouched composer takes the remote draft, and a remote clear", () => {
		const synced = { revision: 1, content: draft("old") };
		expect(decideRemote({ ...base, local: draft("old"), synced, remote: entry(2, draft("new")) })).toEqual({ action: "apply" });
		expect(decideRemote({ ...base, local: draft("old"), synced, remote: entry(2, null) })).toEqual({ action: "apply" });
		expect(decideRemote({ ...base, local: draft(""), synced: none, remote: entry(1, draft("hi", { taskId: "T1" })) })).toEqual({ action: "apply" });
	});
	test("a composer with unsynced text keeps it: a conflict, focused or not", () => {
		const synced = { revision: 1, content: draft("old") };
		for (const focused of [true, false]) {
			expect(decideRemote({ local: draft("old, plus typing"), synced, remote: entry(2, draft("theirs")), focused, sinceLocalEdit: 10_000 })).toEqual({ action: "conflict" });
		}
		// A task or a quote added offline counts.
		expect(decideRemote({ ...base, local: draft("old", { quotes: ["q"] }), synced, remote: entry(2, draft("theirs")) })).toEqual({ action: "conflict" });
		// Text typed into a chat the backend had nothing for, while a remote draft arrives.
		expect(decideRemote({ ...base, local: draft("typed"), synced: none, remote: entry(1, draft("theirs")) })).toEqual({ action: "conflict" });
	});
	test("a focused composer that was just typed in waits until the typing stops", () => {
		const synced = { revision: 1, content: draft("old") };
		expect(decideRemote({ local: draft("old"), synced, remote: entry(2, draft("n")), focused: true, sinceLocalEdit: 1000 })).toEqual({
			action: "defer",
			waitMs: DRAFT_TYPING_QUIET_MS - 1000,
		});
		expect(decideRemote({ local: draft("old"), synced, remote: entry(2, draft("n")), focused: true, sinceLocalEdit: DRAFT_TYPING_QUIET_MS })).toEqual({ action: "apply" });
		expect(decideRemote({ local: draft("old"), synced, remote: entry(2, draft("n")), focused: false, sinceLocalEdit: 100 })).toEqual({ action: "apply" });
	});
});

describe("draftOrigin", () => {
	test("names another device, not this one, not a clear", () => {
		const other = { deviceId: "b", name: "Pixel 8" };
		expect(draftOrigin(entry(1, draft("x"), other), "a")).toEqual({ name: "Pixel 8", attachments: 0 });
		expect(draftOrigin(entry(1, draft("x"), { deviceId: "b" }), "a")).toEqual({ name: "another device", attachments: 0 });
		expect(draftOrigin(entry(1, draft("x"), { deviceId: "a" }), "a")).toBeUndefined();
		expect(draftOrigin(entry(1, null, other), "a")).toBeUndefined();
		expect(draftOrigin(entry(1, draft("x")), "a")).toBeUndefined();
		expect(draftOrigin(entry(1, draft("", { attachments: [{ id: "a".repeat(64), mimeType: "image/png", size: 1 }] }), other), "a")?.attachments).toBe(1);
	});
});

/** A clock and timers a test moves by hand, and a backend with one chat. */
function rig(initial: { local?: Draft; synced?: SyncedDraft } = {}) {
	let now = 1_000_000;
	let available = true;
	const timers = new Map<number, { at: number; run: () => void }>();
	let nextTimer = 0;
	const server: {
		entry: ChatDraft | undefined;
		writes: { content: DraftContent | null; base: number }[];
		failNext: boolean;
		/** Another device always writes first: every write is refused with a newer entry. */
		alwaysRefuse: boolean;
	} = { entry: undefined, writes: [], failNext: false, alwaysRefuse: false };
	const applied: Draft[] = [];
	const persisted: { local: Draft; synced: SyncedDraft }[] = [];
	let focused = false;
	const transport: DraftSyncTransport = {
		available: () => available,
		read: async () => server.entry,
		write: async (content, base) => {
			server.writes.push({ content, base });
			if (server.failNext) {
				server.failNext = false;
				throw new Error("offline");
			}
			if (server.alwaysRefuse) {
				server.entry = entry((server.entry?.revision ?? 0) + 1, draft(`other ${server.writes.length}`));
				return { applied: false, draft: server.entry };
			}
			const current = server.entry;
			const same = current === undefined ? content === null : JSON.stringify(current.content) === JSON.stringify(content);
			if (same) return { applied: true, draft: current ?? null };
			if (base !== (current?.revision ?? 0)) return { applied: false, draft: current ?? null };
			server.entry = entry((current?.revision ?? 0) + 1, content);
			return { applied: true, draft: server.entry };
		},
	};
	const sync = new DraftSync({
		transport,
		local: initial.local ?? draft(""),
		synced: initial.synced ?? none,
		focused: () => focused,
		apply: (value) => applied.push(value),
		persist: (local, synced) => persisted.push({ local, synced }),
		now: () => now,
		setTimer: (run, ms) => {
			timers.set(++nextTimer, { at: now + ms, run });
			return nextTimer;
		},
		clearTimer: (handle) => void timers.delete(handle as number),
	});
	async function advance(ms: number): Promise<void> {
		const until = now + ms;
		for (;;) {
			const due = [...timers.entries()].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
			if (due === undefined) break;
			timers.delete(due[0]);
			now = Math.max(now, due[1].at);
			due[1].run();
			await settle();
		}
		now = until;
	}
	async function settle(): Promise<void> {
		for (let index = 0; index < 5; index += 1) await Promise.resolve();
	}
	return {
		sync,
		server,
		applied,
		persisted,
		timers,
		advance,
		settle,
		setAvailable: (value: boolean) => (available = value),
		setFocused: (value: boolean) => (focused = value),
		type: (text: string) => sync.changed(draft(text)),
	};
}

describe("DraftSync", () => {
	test("writes once, a debounce after typing stops", async () => {
		const test = rig();
		test.type("h");
		await test.advance(300);
		test.type("he");
		await test.advance(300);
		test.type("hel");
		expect(test.server.writes).toHaveLength(0);
		await test.advance(DRAFT_DEBOUNCE_MS);
		expect(test.server.writes).toEqual([{ content: draft("hel"), base: 0 }]);
		expect(test.sync.synced).toMatchObject({ revision: 1, content: { text: "hel" } });
		// The next write builds on the revision the last one got.
		test.type("hello");
		await test.advance(DRAFT_DEBOUNCE_MS);
		expect(test.server.writes[1]).toEqual({ content: draft("hello"), base: 1 });
	});

	test("flush writes at once; an empty composer clears", async () => {
		const test = rig({ local: draft("x"), synced: { revision: 4, content: draft("x") } });
		test.server.entry = entry(4, draft("x"));
		test.sync.changed(draft(""));
		test.sync.flush();
		await test.settle();
		expect(test.server.writes).toEqual([{ content: null, base: 4 }]);
		expect(test.sync.synced).toEqual({ revision: 5, content: null });
	});

	test("typing while a write is in flight is written after it", async () => {
		const test = rig();
		test.type("a");
		await test.advance(DRAFT_DEBOUNCE_MS);
		test.type("ab");
		await test.advance(DRAFT_DEBOUNCE_MS);
		expect(test.server.writes.map((write) => write.content?.text)).toEqual(["a", "ab"]);
		expect(test.server.writes[1]?.base).toBe(1);
	});

	test("a push into an idle composer is applied; a push of what it already shows is not", async () => {
		const test = rig({ local: draft("mine"), synced: { revision: 1, content: draft("mine") } });
		test.sync.pushed(entry(2, draft("mine")));
		expect(test.applied).toEqual([]);
		test.sync.pushed(entry(3, draft("from B", { taskId: "T1" })));
		expect(test.applied).toEqual([draft("from B", { taskId: "T1" })]);
		expect(test.sync.synced.revision).toBe(3);
		// It is the remote draft now, so nothing is written back.
		await test.advance(2000);
		expect(test.server.writes).toHaveLength(0);
		test.sync.pushed(entry(4, null));
		expect(test.applied.at(-1)).toEqual(draft(""));
	});

	test("a push while the user is typing waits for quiet, then applies; if they typed more it is a conflict", async () => {
		const test = rig({ local: draft("a"), synced: { revision: 1, content: draft("a") } });
		test.server.entry = entry(1, draft("a"));
		test.setFocused(true);
		// Typed and written: clean again, but the user is still at it.
		test.type("ab");
		await test.advance(DRAFT_DEBOUNCE_MS);
		expect(test.sync.synced.revision).toBe(2);
		test.server.entry = entry(3, draft("from B"));
		test.sync.pushed(entry(3, draft("from B")));
		expect(test.applied).toEqual([]);
		await test.advance(DRAFT_TYPING_QUIET_MS);
		expect(test.applied).toEqual([draft("from B")]);

		// Typing again before the wait is over: that text wins and is written on top.
		test.type("from B, edited");
		await test.advance(DRAFT_DEBOUNCE_MS);
		expect(test.sync.synced.revision).toBe(4);
		test.server.entry = entry(5, draft("C was here"));
		test.sync.pushed(entry(5, draft("C was here")));
		test.type("from B, edited more");
		await test.advance(DRAFT_TYPING_QUIET_MS + DRAFT_DEBOUNCE_MS);
		expect(test.applied).toHaveLength(1);
		expect(test.server.entry?.content?.text).toBe("from B, edited more");
	});

	test("a write refused because another device wrote first keeps the local text and sends it on the new revision", async () => {
		const test = rig({ local: draft("a"), synced: { revision: 1, content: draft("a") } });
		test.server.entry = entry(2, draft("B was faster"));
		test.type("a, and mine");
		await test.advance(DRAFT_DEBOUNCE_MS);
		expect(test.server.writes).toEqual([
			{ content: draft("a, and mine"), base: 1 },
			{ content: draft("a, and mine"), base: 2 },
		]);
		expect(test.server.entry).toMatchObject({ revision: 3, content: { text: "a, and mine" } });
		expect(test.applied).toEqual([]);
	});

	test("a push for a composer with unsynced text keeps it and writes it", async () => {
		const test = rig({ local: draft("a"), synced: { revision: 1, content: draft("a") } });
		test.server.entry = entry(1, draft("a"));
		test.type("a plus");
		// B's write lands before A's debounce fires.
		test.server.entry = entry(2, draft("from B"));
		test.sync.pushed(entry(2, draft("from B")));
		await test.advance(0);
		await test.settle();
		expect(test.applied).toEqual([]);
		expect(test.server.entry).toMatchObject({ revision: 3, content: { text: "a plus" } });
	});

	test("gives up after repeated refusals until the next change or push", async () => {
		const test = rig({ local: draft("a"), synced: { revision: 1, content: draft("a") } });
		test.server.alwaysRefuse = true;
		test.type("b");
		await test.advance(DRAFT_DEBOUNCE_MS);
		await test.advance(10_000);
		expect(test.server.writes).toHaveLength(DRAFT_MAX_ATTEMPTS);
		test.type("bc");
		await test.advance(DRAFT_DEBOUNCE_MS);
		expect(test.server.writes).toHaveLength(DRAFT_MAX_ATTEMPTS * 2);
		// The local text was never thrown away.
		expect(test.applied).toEqual([]);
		test.server.alwaysRefuse = false;
		test.sync.pushed(entry(100, draft("settled")));
		await test.advance(DRAFT_DEBOUNCE_MS);
		expect(test.server.entry?.content?.text).toBe("bc");
	});

	test("a failed request is retried later; offline nothing is written, and the cache has it", async () => {
		const test = rig();
		test.server.failNext = true;
		test.type("typed offline-ish");
		await test.advance(DRAFT_DEBOUNCE_MS);
		expect(test.server.writes).toHaveLength(1);
		await test.advance(DRAFT_RETRY_MS);
		expect(test.server.writes).toHaveLength(2);
		expect(test.server.entry?.content?.text).toBe("typed offline-ish");

		const offline = rig();
		offline.setAvailable(false);
		offline.type("no network");
		await offline.advance(10_000);
		expect(offline.server.writes).toHaveLength(0);
		expect(offline.persisted.at(-1)?.local.text).toBe("no network");
		// The connection comes back: the text typed meanwhile goes up.
		offline.setAvailable(true);
		await offline.sync.connectionChanged();
		await offline.advance(0);
		expect(offline.server.entry?.content?.text).toBe("no network");
	});

	test("on connect: an untouched cache takes the backend's draft; an edited one is pushed; a clear made offline stays cleared", async () => {
		const fresh = rig();
		fresh.server.entry = entry(5, draft("from B"));
		await fresh.sync.connectionChanged();
		expect(fresh.applied).toEqual([draft("from B")]);

		const edited = rig({ local: draft("old plus offline"), synced: { revision: 5, content: draft("old") } });
		edited.server.entry = entry(5, draft("old"));
		await edited.sync.connectionChanged();
		await edited.advance(0);
		expect(edited.server.entry).toMatchObject({ revision: 6, content: { text: "old plus offline" } });
		expect(edited.applied).toEqual([]);

		const cleared = rig({ local: draft(""), synced: { revision: 5, content: draft("old") } });
		cleared.server.entry = entry(5, draft("old"));
		await cleared.sync.connectionChanged();
		await cleared.advance(0);
		expect(cleared.server.entry).toMatchObject({ revision: 6, content: null });
		expect(cleared.applied).toEqual([]);

		// Offline edits against a draft B changed meanwhile: the local text wins (the later writer).
		const both = rig({ local: draft("mine"), synced: { revision: 5, content: draft("old") } });
		both.server.entry = entry(7, draft("B's"));
		await both.sync.connectionChanged();
		await both.advance(0);
		expect(both.server.entry).toMatchObject({ revision: 8, content: { text: "mine" } });
	});

	test("a draft too big for the backend stays on the device", async () => {
		const test = rig();
		test.type("x".repeat(100_001));
		await test.advance(DRAFT_DEBOUNCE_MS * 3);
		expect(test.server.writes).toHaveLength(0);
		expect(test.persisted.at(-1)?.local.text.length).toBe(100_001);
	});

	test("send then the server's own clear is a no-op for the sender; another device's typing after it is kept", async () => {
		const test = rig({ local: draft("sent"), synced: { revision: 1, content: draft("sent") } });
		test.server.entry = entry(1, draft("sent"));
		test.sync.changed(draft(""));
		test.sync.flush();
		await test.settle();
		// The server cleared on submit (revision 2) at the same moment; the push arrives after the writer's own clear.
		test.sync.pushed(entry(2, null));
		expect(test.applied).toEqual([]);
		expect(test.sync.synced.content).toBeNull();
	});

	test("after destroy a last write goes out and nothing comes back", async () => {
		const test = rig();
		test.type("leaving");
		const persisted = test.persisted.length;
		test.sync.destroy();
		await test.settle();
		expect(test.server.entry?.content?.text).toBe("leaving");
		expect(test.persisted).toHaveLength(persisted);
		test.sync.pushed(entry(9, draft("late")));
		expect(test.applied).toEqual([]);
		test.sync.changed(draft("again"));
		await test.advance(5000);
		expect(test.server.writes).toHaveLength(1);
	});
});
