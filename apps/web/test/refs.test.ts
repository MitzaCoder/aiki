import { describe, expect, test } from "bun:test";
import type { ProjectLinks, RefStatus } from "@mihai-harness/protocol";
import {
	linkRefMentions,
	refHref,
	refStatusTone,
	refStatusWords,
	refTooltip,
	splitRefMentions,
} from "../src/lib/refs.ts";
import { refLabel } from "../src/lib/tasks.ts";

const LINKS: ProjectLinks = { jiraSite: "https://acme.atlassian.net", jiraProjects: ["EX"], githubRepos: ["acme/platform"] };
const checkedAt = "2026-11-06T12:00:00.000Z";

const pull = (state: "open" | "draft" | "merged" | "closed", checks: "passing" | "failing" | "pending" | null): RefStatus => ({
	ref: "#12",
	url: "https://github.com/acme/platform/pull/12",
	title: "Add comments",
	checkedAt,
	kind: "pull",
	state,
	checks,
});

describe("linking mentions in Markdown", () => {
	test("links keys and numbers in prose, not in code, links or addresses", () => {
		const markdown = [
			"Fixed EX-1234 in #1234; UTF-8 stays.",
			"`EX-1` and [EX-2](https://x.test) and https://acme.atlassian.net/browse/EX-3 and <a href=\"/x\">EX-4</a>",
			"```",
			"EX-5 #6",
			"```",
			"**EX-7**",
		].join("\n");
		expect(linkRefMentions(markdown, LINKS)).toBe(
			[
				"Fixed [EX-1234](https://acme.atlassian.net/browse/EX-1234) in [#1234](https://github.com/acme/platform/issues/1234); UTF-8 stays.",
				"`EX-1` and [EX-2](https://x.test) and https://acme.atlassian.net/browse/EX-3 and <a href=\"/x\">EX-4</a>",
				"```",
				"EX-5 #6",
				"```",
				"**[EX-7](https://acme.atlassian.net/browse/EX-7)**",
			].join("\n"),
		);
	});

	test("leaves task links alone and waits for a mention still arriving", () => {
		expect(linkRefMentions('[T3](?task=T3 "Ship EX-1")', LINKS)).toBe('[T3](?task=T3 "Ship EX-1")');
		expect(linkRefMentions("Working on EX-45", LINKS, { streaming: true })).toBe("Working on EX-45");
		expect(linkRefMentions("EX-45 done", LINKS, { streaming: true })).toBe("[EX-45](https://acme.atlassian.net/browse/EX-45) done");
	});
});

describe("linking mentions in plain text", () => {
	test("cuts text into pieces, addresses left as they are", () => {
		expect(splitRefMentions("See EX-1 and https://x.test/#2 then #2", LINKS)).toEqual([
			{ text: "See " },
			{ text: "EX-1", href: "https://acme.atlassian.net/browse/EX-1" },
			{ text: " and https://x.test/#2 then " },
			{ text: "#2", href: "https://github.com/acme/platform/issues/2" },
		]);
		expect(splitRefMentions("See EX-1", undefined)).toEqual([{ text: "See EX-1" }]);
	});
});

describe("ref chips", () => {
	test("say where a ref opens and label it by the project's repositories", () => {
		expect(refHref("EX-1", LINKS)).toBe("https://acme.atlassian.net/browse/EX-1");
		expect(refHref("EX-1", undefined)).toBeUndefined();
		expect(refLabel("https://github.com/acme/platform/pull/12", LINKS)).toBe("#12");
		expect(refLabel("https://github.com/acme/web/pull/12", LINKS)).toBe("web#12");
		expect(refLabel("https://github.com/acme/web/pull/12")).toBe("#12");
	});

	test("put a state in plain words and a task's colours", () => {
		expect(refStatusWords(pull("open", "failing"))).toBe("Open · checks failing");
		expect(refStatusWords(pull("draft", "pending"))).toBe("Draft · checks running");
		expect(refStatusWords(pull("merged", "failing"))).toBe("Merged");
		expect(refStatusTone(pull("open", "failing"))).toBe("blocked");
		expect(refStatusTone(pull("open", "passing"))).toBe("working");
		expect(refStatusTone(pull("merged", null))).toBe("done");
		expect(refStatusTone(pull("closed", null))).toBe("dropped");
		const ticket: RefStatus = {
			ref: "EX-1",
			url: "https://acme.atlassian.net/browse/EX-1",
			title: "Ship it",
			checkedAt,
			kind: "jira",
			status: "In testing",
			category: "in_progress",
		};
		expect(refStatusWords(ticket)).toBe("In testing");
		expect(refStatusTone(ticket)).toBe("working");
		expect(refTooltip("EX-1", "EX-1", LINKS, ticket)).toBe("Ticket EX-1: In testing\nShip it");
		expect(refTooltip("EX-1", "EX-1", undefined, undefined)).toBe("Ticket EX-1");
	});
});
