/**
 * Memory tool cards: the server's tool text is prose, so the card parses it back
 * into hits, sections, a written section and close matches. The wording of the
 * one-line summary is part of the contract.
 */
import { describe, expect, test } from "bun:test";
import {
	highlightedSnippetParts,
	isMemoryTool,
	memoryCallView,
	memoryScopeBadge,
} from "../src/lib/chat/memory-tools.ts";
import type { ToolPart } from "../src/lib/transcript.ts";

function memoryPart(name: string, args: Record<string, unknown>, output: string, details?: unknown): ToolPart {
	return {
		type: "tool",
		key: "p0",
		callId: "call-1",
		name,
		arguments: args,
		output,
		status: "done",
		diagnostics: [],
		...(details === undefined ? {} : { details }),
	};
}

describe("memory search cards", () => {
	const output = [
		'project:testing — Testing conventions (section "Deploy", rank 0.93)',
		"  Run \u0002bun test\u0003 from the root; it takes 12s.",
		"",
		"global:workflow — How I work (intro, rank 0.41)",
		"  Prefer small commits and a \u0002short\u0003 review loop.",
	].join("\n");

	test("reads hits, headings, scopes and highlighted snippets", () => {
		const view = memoryCallView(
			memoryPart("memory_search", { query: "compaction thresholds" }, output, { hits: 2 })
		);
		if (view.kind !== "search") throw new Error("expected a search");
		expect(view.summary).toBe("Searched memory for “compaction thresholds” · 2 matches");
		expect(view.scope).toBe("both");
		expect(view.hits).toHaveLength(2);
		expect(view.hits[0]).toMatchObject({
			scope: "project",
			fileId: "testing",
			title: "Testing conventions",
			heading: "Deploy",
			rank: 0.93,
		});
		expect(view.hits[0]?.parts.filter((part) => part.match).map((part) => part.text)).toEqual(["bun test"]);
		expect(view.hits[1]).toMatchObject({ scope: "global", heading: null });
	});

	test("reads hits as the server writes them: a bare heading and a negative rank", () => {
		const view = memoryCallView(
			memoryPart(
				"memory_search",
				{ query: "bun test" },
				'project:testing — Testing conventions ("Deploy", rank -1.25)\n  Run `bun test` from the root.\n\nglobal:workflow — How I work (intro, rank -0.00)\n  Prefer small commits.',
				{ hits: 2 }
			)
		);
		if (view.kind !== "search") throw new Error("expected a search");
		expect(view.hits.map((hit) => hit.fileId)).toEqual(["testing", "workflow"]);
		expect(view.hits[0]?.rank).toBe(-1.25);
		expect(view.hits[0]?.heading).toBe("Deploy");
		expect(view.hits[1]?.heading).toBeNull();
	});

	test("an explicit scope and no matches read plainly", () => {
		const view = memoryCallView(
			memoryPart(
				"memory_search",
				{ query: "nothing", scope: "global" },
				'No memory matched "nothing". Try other words.',
				{ hits: 0 }
			)
		);
		if (view.kind !== "search") throw new Error("expected a search");
		expect(view.summary).toBe("Searched memory for “nothing” · no matches");
		expect(view.scope).toBe("global");
		expect(view.hits).toEqual([]);
	});
});

describe("memory read cards", () => {
	const output = [
		"project:testing — Testing conventions",
		"Summary: How tests are run here.",
		"Tags: bun, ci; status: active",
		"Updated: 2026-11-04T12:00:00.000Z",
		"",
		"## Deploy",
		"",
		"Run `bun test` from the root.",
		"",
		"## Recovery",
		"",
		"Retry once, then read the log.",
	].join("\n");

	test("reads the title, metadata and sections as markdown", () => {
		const view = memoryCallView(
			memoryPart("memory_read", { fileId: "testing", sections: ["Deploy", "Recovery"] }, output, {
				scope: "project",
				fileId: "testing",
			})
		);
		if (view.kind !== "read") throw new Error("expected a read");
		expect(view.summary).toBe("Read testing · 2 sections");
		expect(view.scope).toBe("project");
		expect(view.title).toBe("Testing conventions");
		expect(view.summaryText).toBe("How tests are run here.");
		expect(view.tags).toEqual(["bun", "ci"]);
		expect(view.status).toBe("active");
		expect(view.sections.map((section) => section.heading)).toEqual(["Deploy", "Recovery"]);
		expect(view.sections[0]?.text).toContain("bun test");
	});

	test("a global topic reads as global and keeps its intro", () => {
		const view = memoryCallView(
			memoryPart(
				"memory_read",
				{ fileId: "workflow" },
				[
					"global:workflow — How I work",
					"Summary: Preferences.",
					"Tags: none; status: active",
					"",
					"Small commits, short reviews.",
					"",
					"## Reviews",
					"",
					"Ask for one early.",
				].join("\n"),
				{ scope: "global", fileId: "workflow" }
			)
		);
		if (view.kind !== "read") throw new Error("expected a read");
		expect(view.scope).toBe("global");
		expect(view.tags).toEqual([]);
		expect(view.intro).toContain("Small commits");
		expect(view.sections).toHaveLength(1);
	});
});

describe("memory write cards", () => {
	const text = "Run `bun test` from the root.";

	test("a created section says so and keeps the text", () => {
		const view = memoryCallView(
			memoryPart(
				"memory_write",
				{ fileId: "testing", heading: "Deploy", text, title: "Testing" },
				'Created project:testing — "Testing", 2 sections. Commit abc. It is searchable now.',
				{ scope: "project", fileId: "testing", created: true }
			)
		);
		if (view.kind !== "write") throw new Error("expected a write");
		expect(view.summary).toBe("Created testing › Deploy");
		expect(view.outcome).toBe("created");
		expect(view.text).toBe(text);
		expect(view.scope).toBe("project");
	});

	test("an update reads as saved, an intro without a heading too", () => {
		const updated = memoryCallView(
			memoryPart(
				"memory_write",
				{ fileId: "testing", heading: "Deploy", text },
				'Updated section "Deploy" of project:testing, 2 sections in all. Commit abc.',
				{ scope: "project", fileId: "testing", created: false }
			)
		);
		if (updated.kind !== "write") throw new Error("expected a write");
		expect(updated.summary).toBe("Saved to testing › Deploy");
		expect(updated.outcome).toBe("updated");

		const intro = memoryCallView(
			memoryPart("memory_write", { fileId: "testing", text }, "Updated the intro of project:testing, 2 sections in all.")
		);
		if (intro.kind !== "write") throw new Error("expected a write");
		expect(intro.summary).toBe("Saved to testing");
	});

	test("an unchanged topic and close matches both read in words", () => {
		const unchanged = memoryCallView(
			memoryPart(
				"memory_write",
				{ fileId: "testing", heading: "Deploy", text },
				"project:testing already reads that way; nothing was written."
			)
		);
		if (unchanged.kind !== "write") throw new Error("expected a write");
		expect(unchanged.summary).toBe("No change to testing › Deploy");
		expect(unchanged.outcome).toBe("unchanged");

		const suggested = memoryCallView(
			memoryPart(
				"memory_write",
				{ fileId: "testing", heading: "Deploy", text },
				[
					"Memory close to project:testing already exists, so nothing was created. Update one of these instead:",
					'- project:testing-old — Testing old, section "Deploy": run it from the root',
					"- global:testing — Testing: run it",
					"",
					"Call memory_write again with one of those fileIds (and its scope), or pass create: true to start project:testing anyway.",
				].join("\n"),
				{ created: false, matches: 2 }
			)
		);
		if (suggested.kind !== "write") throw new Error("expected a write");
		expect(suggested.summary).toBe("Didn't create testing · 2 close matches");
		expect(suggested.outcome).toBe("suggested");
		expect(suggested.closeMatches).toHaveLength(2);
		expect(suggested.closeMatches[0]).toMatchObject({
			scope: "project",
			fileId: "testing-old",
			title: "Testing old",
			heading: "Deploy",
		});
	});
});

describe("memory archive cards", () => {
	test("shows the topic and its reason", () => {
		const view = memoryCallView(
			memoryPart(
				"memory_archive",
				{ fileId: "old-notes", reason: "superseded by testing" },
				"Archived project:old-notes. It leaves search and the catalog; includeArchived still finds it."
			)
		);
		if (view.kind !== "archive") throw new Error("expected an archive");
		expect(view.summary).toBe("Archived old-notes — superseded by testing");
		expect(view.reason).toBe("superseded by testing");
		expect(view.scope).toBe("project");
	});

	test("no reason is simply absent", () => {
		const view = memoryCallView(memoryPart("memory_archive", { fileId: "old-notes" }, "Archived project:old-notes."));
		if (view.kind !== "archive") throw new Error("expected an archive");
		expect(view.summary).toBe("Archived old-notes");
		expect(view.reason).toBeUndefined();
	});
});

describe("snippet highlighting", () => {
	test("marks the query's words in a plain snippet, case-insensitively and as word prefixes", () => {
		const parts = highlightedSnippetParts(
			"The Compaction thresholds is met; the latest tests pass.",
			"compaction thresholds test"
		);
		expect(parts.filter((part) => part.match).map((part) => part.text)).toEqual([
			"Compaction",
			"thresholds",
			"tests",
		]);
	});

	test("does not mark a term inside a word, but does mark a word that starts with it", () => {
		expect(highlightedSnippetParts("accomplish the task", "comp").filter((part) => part.match)).toEqual([]);
		expect(
			highlightedSnippetParts("the completion", "comp")
				.filter((part) => part.match)
				.map((part) => part.text)
		).toEqual(["completion"]);
	});

	test("the server's markers still win when the snippet carries them", () => {
		const marked = "use \u0002this\u0003 now";
		expect(
			highlightedSnippetParts(marked, "other")
				.filter((part) => part.match)
				.map((part) => part.text)
		).toEqual(["this"]);
	});
});

describe("memory card basics", () => {
	test("only the four memory tools are cards", () => {
		expect(isMemoryTool("memory_search")).toBe(true);
		expect(isMemoryTool("memory_write")).toBe(true);
		expect(isMemoryTool("bash")).toBe(false);
		expect(memoryScopeBadge("both")).toBe("Both");
		expect(memoryScopeBadge("global")).toBe("Global");
		expect(memoryScopeBadge("project")).toBe("Project");
	});

	test("an error says what failed and keeps its text", () => {
		const part = {
			...memoryPart("memory_read", { fileId: "missing" }, 'No memory "missing" in project or global.'),
			isError: true,
		};
		const view = memoryCallView(part);
		expect(view.isError).toBe(true);
		expect(view.summary).toBe("Memory read failed");
		expect(view.output).toContain("No memory");
	});
});
