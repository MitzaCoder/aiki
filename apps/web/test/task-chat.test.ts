/** How the chat names board tasks: ID lookup in text, `T12` mention links and the composer's `#` picker. */
import { describe, expect, test } from "bun:test";
import {
	checkInTaskIds,
	hashTrigger,
	linkTaskMentions,
	pickerChoices,
	splitTaskMentions,
	taskHref,
	taskIdsIn,
	taskOptions,
	withoutTrigger,
	type TaskOption,
} from "../src/lib/task-chat.ts";

const titles: Record<string, string> = { T1: "Fix the login", T12: 'Say "hi"' };
const title = (id: string): string | undefined => titles[id];

describe("task IDs in text", () => {
	test("finds each task once, in order, and not parts of other words", () => {
		expect(taskIdsIn("T3 then T12, T3 again; AT4, T5x, a/T6 and #T7")).toEqual(["T3", "T12"]);
		expect(checkInTaskIds("worker w1\ntask T3: 42m in progress\n\nworker w2\ntask T3: 3m\ntask T9: no time recorded")).toEqual(["T3", "T9"]);
	});

	test("splits a line around the tasks the board knows", () => {
		expect(splitTaskMentions("You edited T1 (and T2)", (id) => id === "T1")).toEqual([
			{ text: "You edited " },
			{ taskId: "T1" },
			{ text: " (and T2)" },
		]);
		expect(splitTaskMentions("nothing here", () => true)).toEqual([{ text: "nothing here" }]);
	});

	test("the link opens the task on the page the reader is on", () => {
		expect(taskHref("T12")).toBe("?task=T12");
	});
});

describe("T12 mentions in replies", () => {
	test("link existing tasks only, with the title as the link's title", () => {
		expect(linkTaskMentions("See T1 and T99.", { title })).toBe('See [T1](?task=T1 "Fix the login") and T99.');
		expect(linkTaskMentions("Done: T12", { title })).toBe('Done: [T12](?task=T12 "Say hi")');
	});

	test("leave code, links and URLs alone", () => {
		const text = "`T1` and [T1](https://x.test/T1) and https://x.test/T1 and <T1>\n```\nT1\n```\n~~~\nT1\n~~~\nT1";
		const linked = linkTaskMentions(text, { title });
		expect(linked.match(/\[T1\]\(\?task=T1/g)?.length).toBe(1);
		expect(linked.endsWith('[T1](?task=T1 "Fix the login")')).toBe(true);
	});

	test("an unclosed code fence while streaming keeps its content", () => {
		expect(linkTaskMentions("```\nT1", { title, streaming: true })).toBe("```\nT1");
	});

	test("a mention at the very end of arriving text waits, since it may be half of T12", () => {
		expect(linkTaskMentions("see T1", { title, streaming: true })).toBe("see T1");
		expect(linkTaskMentions("see T1 now", { title, streaming: true })).toBe('see [T1](?task=T1 "Fix the login") now');
		expect(linkTaskMentions("see T1", { title })).toBe('see [T1](?task=T1 "Fix the login")');
	});

	test("text without a task ID comes back as it was", () => {
		expect(linkTaskMentions("hello **world**", { title })).toBe("hello **world**");
	});
});

describe("the composer's task picker", () => {
	const options: TaskOption[] = [
		{ id: "T1", title: "Fix the login", status: "in_progress" },
		{ id: "T2", title: "Docs", status: "todo" },
		{ id: "T3", title: "Triage", status: "review" },
		{ id: "T4", title: "Old login screenshots", status: "done" },
		{ id: "T5", title: "Blocked thing", status: "blocked" },
	];

	test("offers open tasks first: review, blocked, in progress, to do", () => {
		expect(pickerChoices(options, "").map((option) => option.id)).toEqual(["T3", "T5", "T1", "T2"]);
	});

	test("a search matches ID or title and may find finished tasks", () => {
		expect(pickerChoices(options, "login").map((option) => option.id)).toEqual(["T1", "T4"]);
		expect(pickerChoices(options, "t2").map((option) => option.id)).toEqual(["T2"]);
		expect(pickerChoices(options, "zzz")).toEqual([]);
	});

	test("archived tasks are not offered", () => {
		expect(
			taskOptions([
				{ id: "T1", title: "a", status: "todo", archived: false },
				{ id: "T2", title: "b", status: "done", archived: true },
			]),
		).toEqual([{ id: "T1", title: "a", status: "todo" }]);
	});

	test("# starts a search only at the start of a word, up to the caret", () => {
		expect(hashTrigger("#", 1)).toEqual({ start: 0, query: "" });
		expect(hashTrigger("look at #fix", 12)).toEqual({ start: 8, query: "fix" });
		expect(hashTrigger("look at #fix more", 12)).toEqual({ start: 8, query: "fix" });
		expect(hashTrigger("issue#12", 8)).toBeUndefined();
		expect(hashTrigger("look at #fix more", 17)).toBeUndefined();
		expect(hashTrigger("a #b c", 3)).toEqual({ start: 2, query: "" });
	});

	test("picking removes `#word` and one space, keeping the rest", () => {
		expect(withoutTrigger("#fix", { start: 0, query: "fix" })).toEqual({ text: "", caret: 0 });
		expect(withoutTrigger("look at #fix now", { start: 8, query: "fix" })).toEqual({ text: "look at now", caret: 8 });
		expect(withoutTrigger("look at #", { start: 8, query: "" })).toEqual({ text: "look at ", caret: 8 });
	});
});
