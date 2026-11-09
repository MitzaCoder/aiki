import { describe, expect, test } from "bun:test";
import { DRAFTS_STORAGE_KEY, DRAFT_MAX_AGE_MS, clearDraft, draftKey, loadDraft, loadDraftState, saveDraft, saveDraftState, type DraftStorage } from "../src/lib/drafts.ts";

function memory(): DraftStorage & { map: Map<string, string> } {
	const map = new Map<string, string>();
	return { map, getItem: (key) => map.get(key) ?? null, setItem: (key, value) => void map.set(key, value) };
}

describe("draft keys", () => {
	test("differ by backend, project and conversation; main and undefined agree", () => {
		const keys = [draftKey("a", "p"), draftKey("b", "p"), draftKey("a", "q"), draftKey("a", "p", "t1")];
		expect(new Set(keys).size).toBe(4);
		expect(draftKey("a", "p", "main")).toBe(draftKey("a", "p"));
	});
	test("ids that contain separators cannot collide", () => {
		expect(draftKey("a:b", "c")).not.toBe(draftKey("a", "b:c"));
	});
});

describe("draft store", () => {
	test("restores text, task and quotes per chat", () => {
		const storage = memory();
		saveDraft(storage, draftKey("a", "p"), { text: "hello", taskId: "T1", quotes: ["q1"] });
		saveDraft(storage, draftKey("a", "p", "t"), { text: "thread", quotes: [] });
		expect(loadDraft(storage, draftKey("a", "p"))).toEqual({ text: "hello", taskId: "T1", quotes: ["q1"] });
		expect(loadDraft(storage, draftKey("a", "p", "t"))).toEqual({ text: "thread", quotes: [] });
		expect(loadDraft(storage, draftKey("b", "p"))).toEqual({ text: "", quotes: [] });
	});
	test("clear removes only that chat; an empty save removes too", () => {
		const storage = memory();
		saveDraft(storage, "x", { text: "1", quotes: [] });
		saveDraft(storage, "y", { text: "2", quotes: [] });
		clearDraft(storage, "x");
		expect(loadDraft(storage, "x").text).toBe("");
		expect(loadDraft(storage, "y").text).toBe("2");
		saveDraft(storage, "y", { text: "  ", quotes: [] });
		expect(storage.getItem(DRAFTS_STORAGE_KEY)).toBe("{}");
	});
	test("a task or quote alone is a draft", () => {
		const storage = memory();
		saveDraft(storage, "x", { text: "", taskId: "T2", quotes: [] });
		saveDraft(storage, "y", { text: "", quotes: ["q"] });
		expect(loadDraft(storage, "x").taskId).toBe("T2");
		expect(loadDraft(storage, "y").quotes).toEqual(["q"]);
	});
	test("drafts older than 30 days are dropped on read and on write", () => {
		const storage = memory();
		const t0 = 1_000_000_000_000;
		saveDraft(storage, "old", { text: "stale", quotes: [] }, t0);
		expect(loadDraft(storage, "old", t0 + DRAFT_MAX_AGE_MS - 1).text).toBe("stale");
		expect(loadDraft(storage, "old", t0 + DRAFT_MAX_AGE_MS + 1).text).toBe("");
		saveDraft(storage, "new", { text: "fresh", quotes: [] }, t0 + DRAFT_MAX_AGE_MS + 1);
		expect(Object.keys(JSON.parse(storage.getItem(DRAFTS_STORAGE_KEY) ?? "{}"))).toEqual(["new"]);
	});
	test("unreadable storage reads as no drafts", () => {
		const storage = memory();
		storage.setItem(DRAFTS_STORAGE_KEY, "{nope");
		expect(loadDraft(storage, "x").text).toBe("");
		storage.setItem(DRAFTS_STORAGE_KEY, JSON.stringify({ x: { text: 5 }, y: null }));
		expect(loadDraft(storage, "x").text).toBe("");
	});
	test("two tabs writing different chats keep both", () => {
		const storage = memory();
		saveDraft(storage, "a", { text: "tab1", quotes: [] });
		saveDraft(storage, "b", { text: "tab2", quotes: [] });
		expect(loadDraft(storage, "a").text).toBe("tab1");
	});
});

describe("draft cache with what the backend holds", () => {
	test("remembers the revision and content last synced, and keeps them when only the text changes", () => {
		const storage = memory();
		expect(loadDraftState(storage, "x")).toEqual({ draft: { text: "", quotes: [] }, synced: { revision: 0, content: null } });
		saveDraftState(storage, "x", { text: "ab", quotes: [] }, { revision: 4, content: { text: "a", quotes: [] } });
		saveDraft(storage, "x", { text: "abc", quotes: [] });
		expect(loadDraftState(storage, "x")).toEqual({ draft: { text: "abc", quotes: [] }, synced: { revision: 4, content: { text: "a", quotes: [] } } });
	});
	test("an empty draft is kept while the backend still holds a non-empty one, so a clear made offline is pushed", () => {
		const storage = memory();
		saveDraftState(storage, "x", { text: "", quotes: [] }, { revision: 4, content: { text: "old", quotes: [] } });
		expect(loadDraftState(storage, "x")).toEqual({ draft: { text: "", quotes: [] }, synced: { revision: 4, content: { text: "old", quotes: [] } } });
		// Once synced as empty, nothing is left to keep.
		saveDraftState(storage, "x", { text: "", quotes: [] }, { revision: 5, content: null });
		expect(storage.getItem(DRAFTS_STORAGE_KEY)).toBe("{}");
		clearDraft(storage, "y");
		expect(storage.getItem(DRAFTS_STORAGE_KEY)).toBe("{}");
	});
	test("attachments from another device survive a round trip; entries from the first version still load", () => {
		const storage = memory();
		const attachments = [{ id: "a".repeat(64), mimeType: "image/png" as const, size: 3 }];
		saveDraft(storage, "x", { text: "", quotes: [], attachments });
		expect(loadDraft(storage, "x").attachments).toEqual(attachments);
		storage.setItem(DRAFTS_STORAGE_KEY, JSON.stringify({ old: { text: "v1", quotes: ["q"], at: Date.now() } }));
		expect(loadDraftState(storage, "old")).toEqual({ draft: { text: "v1", quotes: ["q"] }, synced: { revision: 0, content: null } });
	});
});
