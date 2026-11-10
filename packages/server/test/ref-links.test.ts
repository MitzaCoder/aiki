/** Link settings filled in from the host (`project-links.ts`) and the live state of refs (`ref-status.ts`). */
import { describe, expect, it } from "bun:test";
import type { ProjectLinks } from "@aiki/protocol";
import type { CommandResult, RunCommand } from "../src/host-commands.ts";
import {
	jiraSiteFromAuthStatus,
	prefixesFromSubjects,
	ProjectLinkDetector,
	reposFromRemotes,
} from "../src/project-links.ts";
import { RefStatusService } from "../src/ref-status.ts";

const ok = (stdout: string): CommandResult => ({ exitCode: 0, stdout, stderr: "", missing: false });
const failed = (stderr: string): CommandResult => ({ exitCode: 1, stdout: "", stderr, missing: false });
const missing: CommandResult = { exitCode: null, stdout: "", stderr: "", missing: true };

type Call = { command: string; args: readonly string[] };

function fakeRun(answer: (call: Call) => CommandResult): { run: RunCommand; calls: Call[] } {
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

const AUTH_OK = "✓ Authenticated\n  Site: acme.atlassian.net\n  Email: someone@acme.com\n";

describe("filling in link settings", () => {
	it("reads GitHub repositories from remotes, origin first", () => {
		const remotes = [
			"fork\tgit@github.com:me/platform.git (fetch)",
			"fork\tgit@github.com:me/platform.git (push)",
			"origin\thttps://github.com/acme/platform.git (fetch)",
			"gitlab\tgit@gitlab.com:acme/other.git (fetch)",
		].join("\n");
		expect(reposFromRemotes(remotes)).toEqual(["acme/platform", "me/platform"]);
		// jj git remote list prints "name url".
		expect(reposFromRemotes("origin git@github.com:acme/app.git\n")).toEqual(["acme/app"]);
	});

	it("takes ticket prefixes that commit subjects name often, not look-alikes", () => {
		const subjects = [
			"feat: EX-1 a",
			"fix: EX-2 b",
			"feat(x): EX-3 - c",
			"chore: CORE-9 d",
			"docs: UTF-8 everywhere",
			"docs: UTF-8 again",
			"docs: UTF-8 thrice",
			"fix: OPS-1",
			"fix: OPS-2",
			"fix: OPS-3 OPS-4",
		].join("\n");
		expect(prefixesFromSubjects(subjects)).toEqual(["OPS", "EX"]);
	});

	it("reads the Jira site only from a working login", () => {
		expect(jiraSiteFromAuthStatus(AUTH_OK)).toBe("https://acme.atlassian.net");
		expect(jiraSiteFromAuthStatus("✗ Error: unauthorized: use 'acli jira auth login' to authenticate")).toBeUndefined();
	});

	it("fills in repositories, prefixes and the site, and tells when the answer changes", async () => {
		const { run, calls } = fakeRun(({ command, args }) => {
			if (command === "git" && args.includes("remote")) return ok("origin\tgit@github.com:acme/platform.git (fetch)\n");
			if (command === "git" && args.includes("log")) return ok("EX-1 a\nEX-2 b\nEX-3 c\n");
			if (command === "acli") return ok(AUTH_OK);
			return failed("unexpected");
		});
		const changed: string[] = [];
		const detector = new ProjectLinkDetector({ run, onChange: (path) => changed.push(path) });
		expect(detector.cached("/repo")).toBeUndefined();
		const links = await detector.detect("/repo");
		expect(links).toEqual({ jiraSite: "https://acme.atlassian.net", jiraProjects: ["EX"], githubRepos: ["acme/platform"] });
		expect(detector.cached("/repo")).toEqual(links);
		expect(changed).toEqual(["/repo"]);
		await detector.detect("/repo");
		expect(changed).toEqual(["/repo"]);
		// The host's Jira login is looked up once for every project.
		await detector.detect("/other");
		expect(calls.filter((call) => call.command === "acli")).toHaveLength(1);
	});

	it("falls back to jj, and leaves Jira out when no commit names a ticket", async () => {
		const { run, calls } = fakeRun(({ command, args }) => {
			if (command === "git") return failed("not a git repository");
			if (command === "jj" && args.includes("remote")) return ok("origin https://github.com/acme/app\n");
			if (command === "jj") return ok("feat: a thing\n");
			return ok(AUTH_OK);
		});
		const links = await new ProjectLinkDetector({ run }).detect("/repo");
		expect(links).toEqual({ jiraSite: null, jiraProjects: [], githubRepos: ["acme/app"] });
		expect(calls.every((call) => call.command !== "jj" || call.args.includes("--ignore-working-copy"))).toBe(true);
		expect(calls.some((call) => call.command === "acli")).toBe(false);
	});
});

const LINKS: ProjectLinks = { jiraSite: "https://acme.atlassian.net", jiraProjects: ["EX"], githubRepos: ["acme/platform"] };

function graphqlAnswer(nodes: Record<string, unknown>): CommandResult {
	return ok(JSON.stringify({ data: { r0: nodes } }));
}

const PR_OPEN = {
	__typename: "PullRequest",
	title: "Add comments",
	url: "https://github.com/acme/platform/pull/12",
	state: "OPEN",
	isDraft: false,
	commits: { nodes: [{ commit: { statusCheckRollup: { state: "FAILURE" } } }] },
};

describe("ref status", () => {
	it("reads pull requests in one query, a number and its URL as one, and answers again from the cache", async () => {
		let now = Date.parse("2026-11-06T12:00:00Z");
		const { run, calls } = fakeRun(({ command }) => {
			if (command === "gh") {
				return graphqlAnswer({
					n12: PR_OPEN,
					n13: { __typename: "PullRequest", title: "Old", url: "https://github.com/acme/platform/pull/13", state: "MERGED", isDraft: false, commits: { nodes: [] } },
					n14: { __typename: "Issue", title: "Bug", url: "https://github.com/acme/platform/issues/14", state: "OPEN" },
					n15: null,
				});
			}
			return failed("unexpected");
		});
		const service = new RefStatusService({ run, now: () => now, jiraSite: async () => undefined, log: () => {} });
		const refs = ["#12", "https://github.com/acme/platform/pull/12", "#13", "#14", "#15", "https://example.com"];
		const statuses = await service.statuses(refs, LINKS);
		expect(calls).toHaveLength(1);
		expect(calls[0]!.args.join(" ")).toContain("n12: issueOrPullRequest(number: 12)");
		expect(statuses.map((status) => [status.ref, status.kind, "state" in status ? status.state : ""])).toEqual([
			["#12", "pull", "open"],
			["https://github.com/acme/platform/pull/12", "pull", "open"],
			["#13", "pull", "merged"],
			["#14", "issue", "open"],
		]);
		expect(statuses[0]).toMatchObject({ checks: "failing", title: "Add comments" });

		await service.statuses(refs, LINKS);
		expect(calls).toHaveLength(1);
		// Open things are read again after a couple of minutes; merged ones and missing ones are not.
		now += 3 * 60_000;
		await service.statuses(refs, LINKS);
		expect(calls).toHaveLength(2);
		expect(calls[1]!.args.join(" ")).toContain("n12:");
		expect(calls[1]!.args.join(" ")).not.toContain("n13:");
		expect(calls[1]!.args.join(" ")).not.toContain("n15:");
	});

	it("rests a source whose tool is missing or logged out, and leaves its refs out", async () => {
		let now = 0;
		const { run, calls } = fakeRun(({ command }) => (command === "gh" ? missing : failed("unexpected")));
		const service = new RefStatusService({ run, now: () => now, jiraSite: async () => undefined, log: () => {} });
		expect(await service.statuses(["#12"], LINKS)).toEqual([]);
		expect(await service.statuses(["#12"], LINKS)).toEqual([]);
		expect(calls).toHaveLength(1);
		now += 11 * 60_000;
		await service.statuses(["#12"], LINKS);
		expect(calls).toHaveLength(2);

		const loggedOut = fakeRun(() => failed("To get started with GitHub CLI, please run:  gh auth login"));
		const other = new RefStatusService({ run: loggedOut.run, jiraSite: async () => undefined, log: () => {} });
		expect(await other.statuses(["#12"], LINKS)).toEqual([]);
	});

	it("keeps what it knew when a later read fails", async () => {
		let now = 0;
		let broken = false;
		const { run } = fakeRun(() => (broken ? failed("timeout") : graphqlAnswer({ n12: PR_OPEN })));
		const service = new RefStatusService({ run, now: () => now, jiraSite: async () => undefined, log: () => {} });
		expect(await service.statuses(["#12"], LINKS)).toHaveLength(1);
		broken = true;
		now += 3 * 60_000;
		expect(await service.statuses(["#12"], LINKS)).toHaveLength(1);
	});

	it("reads Jira tickets of the site acli is logged in to, in one search", async () => {
		const { run, calls } = fakeRun(({ command }) => {
			if (command !== "acli") return failed("unexpected");
			return ok(
				`You're using an outdated version.\n${JSON.stringify([
					{ key: "EX-1", fields: { summary: "Ship it", status: { name: "In testing", statusCategory: { key: "indeterminate" } } } },
					{ key: "EX-2", fields: { summary: "Done one", status: { name: "Closed", statusCategory: { key: "done" } } } },
				])}`,
			);
		});
		const service = new RefStatusService({ run, jiraSite: async () => "https://acme.atlassian.net", log: () => {} });
		const statuses = await service.statuses(["EX-1", "https://acme.atlassian.net/browse/EX-2", "EX-3", "https://other.atlassian.net/browse/X-1"], LINKS);
		expect(calls).toHaveLength(1);
		expect(calls[0]!.args).toContain("key in (EX-1, EX-2, EX-3)");
		expect(statuses).toMatchObject([
			{ ref: "EX-1", kind: "jira", status: "In testing", category: "in_progress", title: "Ship it", url: "https://acme.atlassian.net/browse/EX-1" },
			{ ref: "https://acme.atlassian.net/browse/EX-2", status: "Closed", category: "done" },
		]);
	});

	it("leaves Jira out without a login", async () => {
		const { run, calls } = fakeRun(() => failed("unexpected"));
		const service = new RefStatusService({ run, jiraSite: async () => undefined, log: () => {} });
		expect(await service.statuses(["EX-1"], LINKS)).toEqual([]);
		expect(calls).toHaveLength(0);
	});

	it("shares one read between requests that arrive together", async () => {
		const { run, calls } = fakeRun(() => graphqlAnswer({ n12: PR_OPEN }));
		const service = new RefStatusService({ run, jiraSite: async () => undefined, log: () => {} });
		const [first, second] = await Promise.all([service.statuses(["#12"], LINKS), service.statuses(["#12"], LINKS)]);
		expect(calls).toHaveLength(1);
		expect(first).toHaveLength(1);
		expect(second).toHaveLength(1);
	});
});
