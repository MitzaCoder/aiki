/**
 * Quotes in the chat: what a selection becomes, the message a composer with quotes sends, and the quotes and text a
 * user message shows again.
 */
import { describe, expect, test } from "bun:test";
import { parseTaskReference, withTaskReference } from "@kemiri/client";
import {
	messageWithQuotes,
	quoteFromSelection,
	quotePreview,
	selectionInWholeWords,
	splitQuotes,
} from "../src/lib/chat/quotes.ts";

describe("quoteFromSelection", () => {
	test("keeps the lines and drops the edges", () => {
		expect(quoteFromSelection("\n\n  first line  \r\nsecond\u00a0line\n\n\n\nthird\n")).toBe(
			"  first line\nsecond line\n\nthird",
		);
	});

	test("is empty for whitespace", () => {
		expect(quoteFromSelection(" \n\t\n")).toBe("");
	});
});

describe("selectionInWholeWords", () => {
	const paragraph = "This paragraph is quoted.";

	test("moves an edge inside a word out to the whole word", () => {
		const start = { text: paragraph, offset: 1 };
		const end = { text: paragraph, offset: 8 };
		expect(selectionInWholeWords("his par", start, end)).toBe("This paragraph");
	});

	test("leaves edges between words where they are", () => {
		const start = { text: paragraph, offset: 5 };
		const end = { text: paragraph, offset: 14 };
		expect(selectionInWholeWords("paragraph", start, end)).toBe("paragraph");
		expect(selectionInWholeWords("This", { text: paragraph, offset: 0 }, { text: paragraph, offset: 4 })).toBe("This");
		expect(selectionInWholeWords("quoted.", { text: paragraph, offset: 18 }, { text: paragraph, offset: 25 })).toBe(
			"quoted.",
		);
	});

	test("completes a word cut on both sides inside one node", () => {
		expect(selectionInWholeWords("ragra", { text: paragraph, offset: 7 }, { text: paragraph, offset: 12 })).toBe(
			"paragraph",
		);
	});

	test("reads only the edge's own node, so it stops at a block or a line", () => {
		// A triple-click ends at the start of the next block: nothing of it comes along.
		const next = { text: "Next block", offset: 0 };
		expect(selectionInWholeWords(`${paragraph}\n`, { text: paragraph, offset: 0 }, next)).toBe(`${paragraph}\n`);
		// Ends cut mid-word in preformatted text: the word stops at the line break.
		const code = "const a = 1;\nconst b = 2;";
		expect(selectionInWholeWords("onst a = 1", { text: code, offset: 1 }, { text: code, offset: 11 })).toBe(
			"const a = 1",
		);
		expect(selectionInWholeWords("= 1;\ncon", { text: code, offset: 8 }, { text: code, offset: 16 })).toBe(
			"= 1;\nconst",
		);
	});

	test("leaves an edge outside a text node alone", () => {
		expect(selectionInWholeWords("his", undefined, undefined)).toBe("his");
	});

	test("knows letters beyond ASCII", () => {
		const text = "Ştiinţa şi über";
		expect(selectionInWholeWords("inţa şi üb", { text, offset: 3 }, { text, offset: 13 })).toBe("Ştiinţa şi über");
	});
});

describe("messageWithQuotes", () => {
	test("puts each quote before the typed text as a blockquote", () => {
		expect(messageWithQuotes(["one line", "two\n\nparagraphs"], "  Why?  ")).toBe(
			"> one line\n\n> two\n>\n> paragraphs\n\nWhy?",
		);
	});

	test("sends quotes alone and text alone", () => {
		expect(messageWithQuotes(["just this"], "")).toBe("> just this");
		expect(messageWithQuotes([], "hello")).toBe("hello");
		expect(messageWithQuotes(["  "], "hello")).toBe("hello");
	});

	test("keeps a quoted quote's own marker", () => {
		expect(messageWithQuotes(["> earlier\nreply"], "ok")).toBe("> > earlier\n> reply\n\nok");
	});
});

describe("splitQuotes", () => {
	test("reads back what messageWithQuotes wrote", () => {
		const quotes = ["one line", "two\n\nparagraphs", "> earlier\nreply", "  indented code"];
		expect(splitQuotes(messageWithQuotes(quotes, "Why?\n\n> not a quote"))).toEqual({
			quotes,
			text: "Why?\n\n> not a quote",
		});
		expect(splitQuotes(messageWithQuotes(["only"], ""))).toEqual({ quotes: ["only"], text: "" });
	});

	test("leaves a message without leading quotes alone", () => {
		expect(splitQuotes("hello\n> later")).toEqual({ quotes: [], text: "hello\n> later" });
		expect(splitQuotes("")).toEqual({ quotes: [], text: "" });
	});

	test("reads quotes typed by hand", () => {
		expect(splitQuotes(">tight\n> spaced\n\n\nrest")).toEqual({ quotes: ["tight\nspaced"], text: "rest" });
	});

	test("works after the task reference the server puts in front", () => {
		const sent = withTaskReference("T12", messageWithQuotes(["the plan"], "Go ahead"));
		const reference = parseTaskReference(sent);
		expect(reference.taskId).toBe("T12");
		expect(splitQuotes(reference.text)).toEqual({ quotes: ["the plan"], text: "Go ahead" });
	});
});

describe("quotePreview", () => {
	test("is the first line with text, whitespace collapsed", () => {
		expect(quotePreview("\n   \n  a   b \nsecond")).toBe("a b");
		expect(quotePreview("")).toBe("");
	});
});
