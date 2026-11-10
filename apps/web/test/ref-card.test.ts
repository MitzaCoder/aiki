import { describe, expect, test } from "bun:test";
import type { ProjectLinks } from "@aiki/protocol";
import {
	boardRefFor,
	cardRefLabel,
	cardRefOf,
	changeWords,
	checksWords,
	containsTarget,
	failingChecksWords,
	namesWords,
	placeCard,
	reviewLines,
	tasksNaming,
	visiblePart,
} from "../src/lib/ref-card.ts";

const LINKS: ProjectLinks = { jiraSite: "https://acme.atlassian.net", jiraProjects: ["EX"], githubRepos: ["acme/platform"] };

describe("which links get a card", () => {
	test("pull requests, issues and tickets, not other pages", () => {
		const pull = cardRefOf("https://github.com/acme/platform/pull/12/files");
		expect(pull).toMatchObject({ source: "github", repo: "acme/platform", number: 12 });
		expect(cardRefLabel(pull!)).toBe("acme/platform #12");
		expect(cardRefLabel(cardRefOf("https://acme.atlassian.net/browse/EX-7")!)).toBe("EX-7");
		expect(cardRefOf("https://github.com/acme/platform")).toBeUndefined();
		expect(cardRefOf("https://example.com/x")).toBeUndefined();
		expect(cardRefOf("?task=T1")).toBeUndefined();
	});
});

describe("card words", () => {
	test("checks", () => {
		const checks = { passed: 12, failing: 2, running: 1, skipped: 40, failingNames: ["lint", "e2e (cancelled)"] };
		expect(checksWords(checks)).toBe("12 passed, 2 failing, 1 running");
		expect(checksWords({ ...checks, passed: 0, failing: 0, running: 0 })).toBe("40 skipped");
		expect(checksWords({ passed: 1234, failing: 0, running: 0, skipped: 0, failingNames: [] })).toBe("1,234 passed");
		expect(failingChecksWords(checks)).toBe("lint, e2e (cancelled)");
		expect(failingChecksWords({ ...checks, failing: 6, failingNames: ["a", "b", "c", "d"] })).toBe("a, b, c and 3 more");
		expect(failingChecksWords({ ...checks, failingNames: [] })).toBeUndefined();
	});

	test("reviews", () => {
		const none = { decision: null, approvedBy: [], changesRequestedBy: [], waitingOn: [] };
		expect(reviewLines(none)).toEqual([{ tone: "todo", text: "No reviews yet" }]);
		expect(reviewLines({ ...none, decision: "review_required" })).toEqual([{ tone: "todo", text: "Needs a review" }]);
		expect(reviewLines({ ...none, decision: "changes_requested", changesRequestedBy: ["bob"], approvedBy: ["cy"], waitingOn: ["a", "b", "c", "d"] })).toEqual([
			{ tone: "blocked", text: "Changes requested by bob" },
			{ tone: "done", text: "Approved by cy" },
			{ tone: "review", text: "Waiting on a, b and 2 others" },
		]);
		expect(namesWords(["a", "b", "c"])).toBe("a, b and c");
		expect(namesWords(["a", "b"])).toBe("a and b");
	});

	test("size", () => {
		expect(changeWords({ additions: 1173, deletions: 98, changedFiles: 27 })).toBe("+1,173 −98 · 27 files");
		expect(changeWords({ additions: 1, deletions: 0, changedFiles: 1 })).toBe("+1 −0 · 1 file");
	});
});

describe("tasks that name it", () => {
	test("a number and its URL count as one", () => {
		const tasks = [
			{ id: "T1", title: "Merge it", status: "in_progress", refs: ["#12"] },
			{ id: "T2", title: "Other", status: "todo", refs: ["EX-7"] },
			{ id: "T3", title: "Same PR", status: "review", refs: ["https://github.com/acme/platform/pull/12"] },
		];
		const ref = cardRefOf("https://github.com/acme/platform/issues/12")!;
		expect(tasksNaming(ref, tasks, LINKS).map((task) => task.id)).toEqual(["T1", "T3"]);
		expect(boardRefFor(ref, ["EX-7", "#12"], LINKS)).toBe("#12");
		expect(tasksNaming(cardRefOf("https://acme.atlassian.net/browse/EX-7")!, tasks, LINKS).map((task) => task.id)).toEqual(["T2"]);
	});
});

describe("placing a card", () => {
	const screen = { left: 0, top: 0, width: 390, height: 800 };
	const card = { width: 352, height: 300 };

	test("under its link, kept inside the screen", () => {
		expect(placeCard({ left: 300, top: 100, width: 40, height: 16 }, card, screen)).toEqual({ left: 30, top: 122, side: "below" });
		expect(placeCard({ left: 2, top: 100, width: 40, height: 16 }, card, screen).left).toBe(8);
	});

	test("over it near the bottom, and on the roomier side when neither fits", () => {
		expect(placeCard({ left: 20, top: 700, width: 40, height: 16 }, card, screen)).toEqual({ left: 20, top: 394, side: "above" });
		const tall = { width: 352, height: 760 };
		const placed = placeCard({ left: 20, top: 300, width: 40, height: 16 }, tall, screen);
		expect(placed.side).toBe("below");
		expect(placed.top).toBe(32);
	});

	test("inside a sheet's visible part", () => {
		expect(visiblePart({ left: 500, top: -10, width: 900, height: 900 }, { width: 1280, height: 800 })).toEqual({ left: 500, top: 0, width: 780, height: 800 });
		const sheet = visiblePart({ left: 500, top: 0, width: 780, height: 800 }, { width: 1280, height: 800 });
		expect(placeCard({ left: 505, top: 100, width: 40, height: 16 }, card, sheet).left).toBe(508);
	});
});

describe("containsTarget", () => {
	const inside = {};
	const box = { contains: (node: unknown) => node === inside };

	test("a card that was closed is null, and holds nothing (the second hover threw on null.contains)", () => {
		expect(containsTarget(null, inside)).toBe(false);
		expect(containsTarget(undefined, inside)).toBe(false);
	});

	test("an open card holds what is inside it", () => {
		expect(containsTarget(box, inside)).toBe(true);
		expect(containsTarget(box, {})).toBe(false);
		expect(containsTarget(box, null)).toBe(false);
	});
});
