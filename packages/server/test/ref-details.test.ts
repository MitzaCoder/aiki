/** What a ref's card shows (`ref-details.ts`): pull requests, issues and tickets read through faked `gh` and `acli`. */
import { describe, expect, it } from "bun:test";
import type { ProjectLinks } from "@aiki/protocol";
import type { CommandResult, RunCommand } from "../src/host-commands.ts";
import { adfText, countChecks, excerptOf, RefDetailsService } from "../src/ref-details.ts";

const ok = (stdout: string): CommandResult => ({ exitCode: 0, stdout, stderr: "", missing: false });
const failed = (stderr: string, stdout = ""): CommandResult => ({ exitCode: 1, stdout, stderr, missing: false });
const missing: CommandResult = { exitCode: null, stdout: "", stderr: "", missing: true };

type Call = { command: string; args: readonly string[] };

function fakeRun(answer: (call: Call) => CommandResult | Promise<CommandResult>): { run: RunCommand; calls: Call[] } {
	const calls: Call[] = [];
	return {
		calls,
		run: async (command, args) => {
			const call = { command, args };
			calls.push(call);
			return answer(call);
		},
	};
}

const LINKS: ProjectLinks = { jiraSite: "https://acme.atlassian.net", jiraProjects: ["EX"], githubRepos: ["acme/platform"] };

const item = (node: unknown): CommandResult => ok(JSON.stringify({ data: { repository: { issueOrPullRequest: node } } }));

const PULL = {
	__typename: "PullRequest",
	title: "Fix the preview",
	url: "https://github.com/acme/platform/pull/12",
	number: 12,
	state: "OPEN",
	isDraft: false,
	updatedAt: "2026-11-06T10:00:00Z",
	author: { login: "ana" },
	headRefName: "fix/preview",
	baseRefName: "main",
	mergeable: "CONFLICTING",
	additions: 120,
	deletions: 8,
	changedFiles: 5,
	reviewDecision: "CHANGES_REQUESTED",
	reviewRequests: { nodes: [{ requestedReviewer: { __typename: "Team", name: "backend" } }, { requestedReviewer: { __typename: "User", login: "dan" } }] },
	latestOpinionatedReviews: { nodes: [{ author: { login: "bob" }, state: "CHANGES_REQUESTED" }, { author: { login: "cy" }, state: "APPROVED" }] },
	commits: {
		nodes: [
			{
				commit: {
					statusCheckRollup: {
						contexts: {
							pageInfo: { hasNextPage: true, endCursor: "c1" },
							nodes: [
								{ __typename: "CheckRun", name: "build", status: "COMPLETED", conclusion: "SUCCESS" },
								{ __typename: "CheckRun", name: "lint", status: "COMPLETED", conclusion: "FAILURE" },
								{ __typename: "CheckRun", name: "lint", status: "COMPLETED", conclusion: "FAILURE" },
							],
							checkRunCountsByState: [
								{ state: "SUCCESS", count: 12 },
								{ state: "FAILURE", count: 2 },
								{ state: "CANCELLED", count: 1 },
								{ state: "SKIPPED", count: 4 },
								{ state: "IN_PROGRESS", count: 0 },
							],
							statusContextCountsByState: [{ state: "PENDING", count: 1 }],
						},
					},
				},
			},
		],
	},
};

const NEXT_CHECKS = ok(
	JSON.stringify({
		data: {
			repository: {
				pullRequest: {
					commits: {
						nodes: [
							{
								commit: {
									statusCheckRollup: {
										contexts: {
											pageInfo: { hasNextPage: false, endCursor: null },
											nodes: [{ __typename: "CheckRun", name: "e2e", status: "COMPLETED", conclusion: "CANCELLED" }],
										},
									},
								},
							},
						],
					},
				},
			},
		},
	}),
);

describe("ref details", () => {
	it("reads a pull request's branches, checks, reviews and size, naming failing checks from later pages", async () => {
		const { run, calls } = fakeRun(({ args }) => (args.some((arg) => arg.startsWith("after=")) ? NEXT_CHECKS : item(PULL)));
		const service = new RefDetailsService({ run, jiraSite: async () => undefined, log: () => {} });
		const details = await service.details("#12", LINKS);
		expect(details).toMatchObject({
			kind: "pull",
			ref: "#12",
			repo: "acme/platform",
			number: 12,
			author: "ana",
			state: "open",
			headBranch: "fix/preview",
			baseBranch: "main",
			conflicts: true,
			checks: { passed: 12, failing: 3, running: 1, skipped: 4, failingNames: ["lint", "e2e (cancelled)"] },
			reviews: { decision: "changes_requested", approvedBy: ["cy"], changesRequestedBy: ["bob"], waitingOn: ["backend", "dan"] },
			additions: 120,
			deletions: 8,
			changedFiles: 5,
			updatedAt: "2026-11-06T10:00:00Z",
		});
		expect(calls).toHaveLength(2);
		expect(calls[0]!.args).toContain("number=12");
	});

	it("answers again from the cache, shares a read between asks, and says null for what does not exist", async () => {
		let now = Date.parse("2026-11-06T12:00:00Z");
		let release: () => void = () => {};
		const gate = new Promise<void>((resolve) => (release = resolve));
		const { run, calls } = fakeRun(async ({ args }) => {
			await gate;
			if (args.includes("number=13")) return failed("GraphQL: Could not resolve", JSON.stringify({ data: { repository: { issueOrPullRequest: null } }, errors: [{ type: "NOT_FOUND" }] }));
			return item({ ...PULL, commits: { nodes: [] } });
		});
		const service = new RefDetailsService({ run, now: () => now, jiraSite: async () => undefined, log: () => {} });
		const both = Promise.all([service.details("#12", LINKS), service.details("https://github.com/acme/platform/pull/12", LINKS)]);
		release();
		const [first, second] = await both;
		expect(first?.ref).toBe("#12");
		expect(second?.ref).toBe("https://github.com/acme/platform/pull/12");
		expect(calls).toHaveLength(1);
		expect(first).toMatchObject({ checks: null });
		await service.details("#12", LINKS);
		expect(calls).toHaveLength(1);
		now += 61_000;
		await service.details("#12", LINKS);
		expect(calls).toHaveLength(2);
		expect(await service.details("#13", LINKS)).toBeNull();
		expect(await service.details("https://example.com/x", LINKS)).toBeNull();
	});

	it("keeps what it knew when a later read fails, and rests a missing tool", async () => {
		let now = Date.parse("2026-11-06T12:00:00Z");
		let answer: CommandResult = item({ ...PULL, commits: { nodes: [] } });
		const { run, calls } = fakeRun(() => answer);
		const service = new RefDetailsService({ run, now: () => now, jiraSite: async () => undefined, log: () => {} });
		expect(await service.details("#12", LINKS)).toMatchObject({ title: "Fix the preview" });
		now += 61_000;
		answer = failed("error connecting to api.github.com");
		expect(await service.details("#12", LINKS)).toMatchObject({ title: "Fix the preview" });

		const other = fakeRun(() => missing);
		const resting = new RefDetailsService({ run: other.run, jiraSite: async () => undefined, log: () => {} });
		expect(await resting.details("#12", LINKS)).toBeNull();
		expect(await resting.details("#14", LINKS)).toBeNull();
		expect(other.calls).toHaveLength(1);
		expect(calls.length).toBeGreaterThan(1);
	});

	it("reads an issue's people, labels and the start of its description", async () => {
		const { run } = fakeRun(() =>
			item({
				__typename: "Issue",
				title: "Preview crashes",
				url: "https://github.com/acme/platform/issues/14",
				state: "CLOSED",
				stateReason: "NOT_PLANNED",
				updatedAt: "2026-11-05T09:00:00Z",
				author: { login: "eve" },
				assignees: { nodes: [{ login: "ana" }] },
				labels: { nodes: [{ name: "bug" }] },
				comments: { totalCount: 3 },
				body: "<!-- template -->\n## Steps\n\nOpen a case with **no items**.\n```\ncode\n```\nSee [the log](https://x).\nMore\nEven more",
			}),
		);
		const service = new RefDetailsService({ run, jiraSite: async () => undefined, log: () => {} });
		expect(await service.details("#14", LINKS)).toMatchObject({
			kind: "issue",
			state: "closed",
			closedAs: "not_planned",
			author: "eve",
			assignees: ["ana"],
			labels: ["bug"],
			comments: 3,
			excerpt: "Steps\nOpen a case with no items.\ncode",
		});
	});

	it("reads a ticket's people, parent, sprint and description through acli, only on its login's site", async () => {
		const ticket = {
			key: "EX-1235",
			fields: {
				summary: "Validations for the designer",
				updated: "2026-11-06T16:29:45.877+0000",
				issuetype: { name: "Story" },
				status: { name: "Code Review", statusCategory: { key: "indeterminate" } },
				priority: { name: "High" },
				assignee: { displayName: "Gabriel" },
				reporter: { displayName: "Andra" },
				parent: { key: "EX-1236", fields: { summary: "Example validation", issuetype: { name: "Epic" } } },
				customfield_10019: "0|i05ani:",
				customfield_10020: [
					{ boardId: 28, name: "EX Sprint 21-26", state: "closed" },
					{ boardId: 28, name: "EX Sprint 22-26", state: "active" },
				],
				description: {
					type: "doc",
					content: [
						{ type: "paragraph", content: [{ type: "text", text: "First line" }, { type: "hardBreak" }, { type: "text", text: "second" }] },
						{ type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "a point" }] }] }] },
					],
				},
			},
		};
		const { run, calls } = fakeRun(({ command, args }) => {
			if (command !== "acli") return failed("unexpected");
			if (args.includes("EX-1")) return failed("✗ Error: Issue does not exist or you do not have permission to see it.");
			return ok(`A new version is out\n${JSON.stringify(ticket)}`);
		});
		const service = new RefDetailsService({ run, jiraSite: async () => "https://acme.atlassian.net", log: () => {} });
		expect(await service.details("EX-1235", LINKS)).toEqual({
			kind: "jira",
			ref: "EX-1235",
			url: "https://acme.atlassian.net/browse/EX-1235",
			title: "Validations for the designer",
			updatedAt: "2026-11-06T16:29:45.877Z",
			checkedAt: expect.any(String),
			key: "EX-1235",
			type: "Story",
			status: "Code Review",
			category: "in_progress",
			priority: "High",
			assignee: "Gabriel",
			reporter: "Andra",
			parent: { key: "EX-1236", title: "Example validation", type: "Epic", url: "https://acme.atlassian.net/browse/EX-1236" },
			sprint: "EX Sprint 22-26",
			excerpt: "First line\nsecond\n• a point",
		});
		expect(await service.details("EX-1", LINKS)).toBeNull();
		expect(await service.details("https://other.atlassian.net/browse/EX-2", LINKS)).toBeNull();
		expect(calls).toHaveLength(2);
	});

	it("counts checks by GitHub's tallies and says null without any", () => {
		expect(countChecks([])).toBeNull();
		expect(countChecks([{ state: "SUCCESS", count: 0 }])).toBeNull();
		expect(countChecks([{ state: "QUEUED", count: 2 }, { state: "STALE", count: 1 }])).toEqual({
			passed: 0,
			failing: 0,
			running: 2,
			skipped: 1,
			failingNames: [],
		});
		expect(excerptOf("\n\n")).toBeNull();
		expect(excerptOf("x".repeat(400))?.endsWith("…")).toBe(true);
		expect(adfText("plain")).toBe("plain");
	});
});
