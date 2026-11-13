/**
 * Waiting messages: how queued inputs and this screen's own sends join the transcript, and how a waiting message hands
 * over to the entry the run placed it as (by submission ID, never by text).
 */
import { describe, expect, test } from "bun:test";
import type { EntryRecord, QueuedInput } from "@kemiri/protocol";
import { buildTranscript, isTypedInput, type TranscriptItem } from "../src/lib/transcript.ts";
import {
	departures,
	inputKey,
	sendKey,
	typedQueue,
	waitingMessages,
	waitingStatus,
	withWaiting,
	type LocalSend,
} from "../src/lib/waiting.ts";

function userEntry(id: number, text: string, submissionId?: number): EntryRecord {
	return {
		id,
		conversationId: 1,
		kind: "pi.user",
		model: [{ role: "user", content: text, timestamp: 5_000 + id }],
		...(submissionId === undefined ? {} : { submissionId }),
	};
}

function queued(id: number, text: string, extra: Partial<QueuedInput> = {}): QueuedInput {
	return { id, mode: "steer", text, at: 1_000 + id, ...extra };
}

function send(requestId: string, extra: Partial<LocalSend> = {}): LocalSend {
	return { requestId, text: `text of ${requestId}`, state: "sending", at: 10, wasBusy: true, ...extra };
}

describe("what counts as a waiting message", () => {
	test("the user's typing does, the harness's own notes do not", () => {
		expect(isTypedInput("please also check the tests")).toBe(true);
		expect(isTypedInput("[worker w1 reported]\nall done")).toBe(false);
		expect(isTypedInput("[check-in]\n2 workers running")).toBe(false);
		expect(isTypedInput("[board] T3 moved")).toBe(false);
		expect(typedQueue([queued(1, "hi"), queued(2, "[worker w1 reported]\ndone")]).map((item) => item.id)).toEqual([1]);
		expect(typedQueue(undefined)).toEqual([]);
	});
});

describe("waitingMessages", () => {
	test("lists queued inputs oldest first, under the submission's key", () => {
		const list = waitingMessages({ queued: [queued(9, "second"), queued(4, "first", { taskId: "T2" })], sends: [], lost: [] });
		expect(list.map((message) => [message.key, message.text, message.state, message.taskId])).toEqual([
			[inputKey(4), "first", "waiting", "T2"],
			[inputKey(9), "second", "waiting", undefined],
		]);
	});

	test("a queued input this screen sent takes the send's key, by request ID or by submission", () => {
		const byRequest = waitingMessages({
			queued: [queued(4, "mine", { requestId: "r1" })],
			sends: [send("r1", { state: "queued", submissionId: 4 })],
			lost: [],
		});
		expect(byRequest).toHaveLength(1);
		expect(byRequest[0]?.key).toBe(sendKey("r1"));
		const bySubmission = waitingMessages({
			queued: [queued(4, "mine")],
			sends: [send("r1", { state: "queued", submissionId: 4 })],
			lost: [],
		});
		expect(bySubmission.map((message) => message.key)).toEqual([sendKey("r1")]);
	});

	test("a send on its way shows only when a run was busy; a queued answer shows before the view lists it", () => {
		const list = waitingMessages({
			queued: [],
			sends: [
				send("idle", { wasBusy: false }),
				send("busy", { at: 20 }),
				send("answered", { state: "queued", submissionId: 7, at: 30 }),
				send("done", { state: "placed", submissionId: 8 }),
			],
			lost: [],
		});
		expect(list.map((message) => [message.key, message.state])).toEqual([
			[sendKey("busy"), "sending"],
			[sendKey("answered"), "waiting"],
		]);
	});

	test("a failed send keeps its text, request ID and reason; lost messages come first", () => {
		const lost = { key: inputKey(1), state: "withdrawn" as const, text: "stopped", at: 1 };
		const list = waitingMessages({
			queued: [queued(5, "waiting")],
			sends: [send("bad", { state: "failed", error: "offline", text: "keep me" })],
			lost: [lost],
		});
		expect(list.map((message) => message.state)).toEqual(["withdrawn", "failed", "waiting"]);
		expect(list[1]).toMatchObject({ key: sendKey("bad"), text: "keep me", error: "offline", requestId: "bad" });
	});
});

describe("withWaiting", () => {
	const turn: TranscriptItem = { kind: "turn", key: "turn-2", parts: [] };

	test("appends waiting messages below the running turn, with the task reference back on their text", () => {
		const waiting = waitingMessages({ queued: [queued(3, "one", { taskId: "T9", mode: "followUp" }), queued(4, "two")], sends: [], lost: [] });
		const items = withWaiting([turn], waiting, new Set([inputKey(4)]));
		expect(items.map((item) => item.key)).toEqual(["turn-2", inputKey(3), inputKey(4)]);
		const first = items[1];
		expect(first).toMatchObject({ kind: "user", text: "[task T9] one", waiting: { state: "waiting", mode: "followUp" } });
		expect(first?.kind === "user" ? first.waiting?.pending : "x").toBeUndefined();
		const second = items[2];
		expect(second?.kind === "user" ? second.waiting?.pending : undefined).toBe(true);
	});

	test("returns the transcript itself when nothing waits", () => {
		const items = [turn];
		expect(withWaiting(items, [])).toBe(items);
	});

	test("never draws a message twice: an entry with the same key is the message placed", () => {
		const entries = [userEntry(7, "hello", 4)];
		const items = buildTranscript(entries, undefined);
		expect(items[0]?.key).toBe(inputKey(4));
		const waiting = waitingMessages({ queued: [queued(4, "hello")], sends: [], lost: [] });
		expect(withWaiting(items, waiting).map((item) => item.key)).toEqual([inputKey(4)]);
	});
});

describe("the hand-off to the entry the run placed", () => {
	test("an entry tagged with a submission is keyed like the waiting bubble, so the element stays", () => {
		const waiting = waitingMessages({
			queued: [queued(4, "also this", { requestId: "r1" })],
			sends: [send("r1", { state: "queued", submissionId: 4 })],
			lost: [],
		});
		const before = withWaiting(buildTranscript([userEntry(1, "start")], undefined), waiting);
		const inputKeys = new Map([[4, sendKey("r1")]]);
		const after = buildTranscript([userEntry(1, "start"), userEntry(3, "also this", 4)], undefined, { inputKeys });
		const waitingItem = before.at(-1);
		expect(waitingItem?.key).toBe(sendKey("r1"));
		expect(after.at(-1)?.key).toBe(waitingItem?.key ?? "");
		expect(after.at(-1)).toMatchObject({ kind: "user", text: "also this" });
		expect((after.at(-1) as { waiting?: unknown }).waiting).toBeUndefined();
		// Entries nobody tagged keep their own key.
		expect(after[0]?.key).toBe("entry-1");
	});

	test("two messages placed together keep their order and their own keys", () => {
		const after = buildTranscript([userEntry(3, "a", 4), userEntry(4, "b", 5)], undefined);
		expect(after.map((item) => item.key)).toEqual([inputKey(4), inputKey(5)]);
	});
});

describe("departures", () => {
	test("a message the run placed is found by the tag on its entry, whatever the text", () => {
		const result = departures({
			previous: [queued(4, "one"), queued(5, "two")],
			current: [queued(5, "two")],
			entries: [userEntry(8, "[task T1] reworded by nobody", 4)],
			seenEntryId: 7,
		});
		expect(result.placed.map((item) => item.id)).toEqual([4]);
		expect(result.withdrawn).toEqual([]);
	});

	test("a message that left the queue with no entry was withdrawn", () => {
		const result = departures({ previous: [queued(4, "one")], current: undefined, entries: [userEntry(1, "one")], seenEntryId: 1 });
		expect(result.withdrawn.map((item) => item.id)).toEqual([4]);
	});

	test("without a tag, only a new untagged entry with the same text counts as the placed message, once each", () => {
		const result = departures({
			previous: [queued(4, "same"), queued(5, "same"), queued(6, "gone")],
			current: [],
			entries: [userEntry(9, "same"), userEntry(2, "gone")],
			seenEntryId: 8,
		});
		// Only one new "same" entry: one of the two inputs is that, the other was withdrawn; "gone" is older than the last view.
		expect(result.placed.map((item) => item.id)).toEqual([4]);
		expect(result.withdrawn.map((item) => item.id)).toEqual([5, 6]);
	});

	test("what still waits has not departed", () => {
		const result = departures({ previous: [queued(4, "one")], current: [queued(4, "one")], entries: [], seenEntryId: 0 });
		expect(result).toEqual({ placed: [], withdrawn: [] });
	});
});

describe("waitingStatus", () => {
	test("says where the message is and who gets it", () => {
		expect(waitingStatus({ state: "waiting", mode: "steer" }, "coordinator")).toEqual({
			label: "Waiting",
			detail: "reaches the coordinator at its next step",
		});
		expect(waitingStatus({ state: "waiting", mode: "steer" }, "thread").detail).toBe("reaches the thread at its next step");
		expect(waitingStatus({ state: "waiting", mode: "followUp" }, "coordinator").detail).toBe("sent when the current turn ends");
		expect(waitingStatus({ state: "failed", error: "offline" }, "coordinator")).toEqual({ label: "Not sent", detail: "offline" });
		expect(waitingStatus({ state: "sending" }, "coordinator")).toEqual({ label: "Sending" });
	});
});
