import { describe, expect, test } from "bun:test";
import { Value } from "typebox/value";
import { ProjectsConfigureRequestSchema, RefsStatusRequestSchema, RefsStatusResponseSchema } from "../src/index.ts";
import {
	normalizeGithubRepo,
	normalizeJiraSite,
	type ProjectLinks,
	refIdentity,
	refMentions,
	resolveRef,
} from "../src/refs.ts";

const ONE_REPO: ProjectLinks = {
	jiraSite: "https://acme.atlassian.net",
	jiraProjects: ["EX"],
	githubRepos: ["acme/platform"],
};
const TWO_REPOS: ProjectLinks = { ...ONE_REPO, githubRepos: ["acme/platform", "acme/web"] };

describe("resolveRef", () => {
	test("full GitHub and Jira URLs resolve without settings", () => {
		expect(resolveRef("https://github.com/acme/platform/pull/1234")).toEqual({
			source: "github",
			repo: "acme/platform",
			number: 1234,
			kind: "pull",
			url: "https://github.com/acme/platform/pull/1234",
		});
		expect(resolveRef("https://github.com/acme/platform/issues/7#issuecomment-1")).toMatchObject({ kind: "issue", number: 7 });
		expect(resolveRef("https://acme.atlassian.net/browse/EX-1234")).toEqual({
			source: "jira",
			key: "EX-1234",
			site: "https://acme.atlassian.net",
			url: "https://acme.atlassian.net/browse/EX-1234",
		});
		expect(resolveRef("https://jira.acme.com/jira/browse/OPS-12")).toMatchObject({ site: "https://jira.acme.com/jira" });
		expect(resolveRef("https://example.com/doc")).toEqual({ source: "web", url: "https://example.com/doc" });
	});

	test("bare keys and numbers need the project's settings", () => {
		expect(resolveRef("EX-1234")).toBeUndefined();
		expect(resolveRef("#1234")).toBeUndefined();
		expect(resolveRef("EX-1234", ONE_REPO)?.url).toBe("https://acme.atlassian.net/browse/EX-1234");
		// A ref is a ticket whatever its prefix; only text needs the prefix list.
		expect(resolveRef("CORE-9", ONE_REPO)?.url).toBe("https://acme.atlassian.net/browse/CORE-9");
		expect(resolveRef("#1234", ONE_REPO)?.url).toBe("https://github.com/acme/platform/issues/1234");
	});

	test("#N with several repositories links only with a repository named", () => {
		expect(resolveRef("#12", TWO_REPOS)).toBeUndefined();
		expect(resolveRef("web#12", TWO_REPOS)).toMatchObject({ repo: "acme/web", number: 12 });
		expect(resolveRef("acme/web#12", TWO_REPOS)).toMatchObject({ repo: "acme/web" });
		expect(resolveRef("other/thing#3", TWO_REPOS)).toMatchObject({ repo: "other/thing" });
		expect(resolveRef("nothing#3", TWO_REPOS)).toBeUndefined();
	});

	test("a number and its URL are the same thing", () => {
		const short = resolveRef("#1234", ONE_REPO)!;
		const long = resolveRef("https://github.com/Acme/Platform/pull/1234")!;
		expect(refIdentity(short)).toBe(refIdentity(long));
	});
});

describe("refMentions", () => {
	test("finds keys with a known prefix and numbers with one repository", () => {
		const text = "Fixed EX-1234 (see #1234), not UTF-8 or SHA-256; CORE-12 is elsewhere; acme/web#5 too.";
		expect(refMentions(text, ONE_REPO).map((mention) => mention.text)).toEqual(["EX-1234", "#1234", "acme/web#5"]);
	});

	test("leaves numbers alone when the repository is ambiguous", () => {
		expect(refMentions("PR #12 and web#13", TWO_REPOS).map((mention) => mention.text)).toEqual(["web#13"]);
	});

	test("does not take parts of words, paths or versions", () => {
		expect(refMentions("XEX-1 a/EX-2 EX-3x EX-4.5 issue#9 page#top", ONE_REPO)).toEqual([]);
	});
});

describe("normalizing settings", () => {
	test("a Jira site becomes an address", () => {
		expect(normalizeJiraSite("acme.atlassian.net")).toBe("https://acme.atlassian.net");
		expect(normalizeJiraSite("https://acme.atlassian.net/")).toBe("https://acme.atlassian.net");
		expect(normalizeJiraSite("not a site")).toBeUndefined();
	});

	test("a repository from a name, a URL or a remote", () => {
		expect(normalizeGithubRepo("acme/platform")).toBe("acme/platform");
		expect(normalizeGithubRepo("git@github.com:acme/platform.git")).toBe("acme/platform");
		expect(normalizeGithubRepo("https://github.com/acme/platform")).toBe("acme/platform");
		expect(normalizeGithubRepo("ssh://git@github.com/acme/platform.git")).toBe("acme/platform");
		expect(normalizeGithubRepo("git@gitlab.com:acme/platform.git")).toBeUndefined();
		expect(normalizeGithubRepo("platform")).toBeUndefined();
	});
});

describe("refs.status", () => {
	test("validates a request and an answer with each kind of status", () => {
		expect(Value.Check(RefsStatusRequestSchema, { type: "refs.status", id: "r1", projectId: "p", refs: ["#1", "EX-2"] })).toBe(true);
		const checkedAt = "2026-11-06T12:00:00.000Z";
		const statuses = [
			{ ref: "#1", url: "https://github.com/a/b/pull/1", title: "Fix", checkedAt, kind: "pull", state: "draft", checks: null },
			{ ref: "#2", url: "https://github.com/a/b/issues/2", title: "Bug", checkedAt, kind: "issue", state: "closed" },
			{ ref: "EX-2", url: "https://a.atlassian.net/browse/EX-2", title: "T", checkedAt, kind: "jira", status: "In review", category: "in_progress" },
		];
		expect(Value.Check(RefsStatusResponseSchema, { type: "refs.status", id: "r1", statuses })).toBe(true);
		expect(
			Value.Check(ProjectsConfigureRequestSchema, {
				type: "projects.configure",
				id: "r2",
				projectId: "p",
				links: { jiraSite: null, jiraProjects: [], githubRepos: ["a/b"] },
			}),
		).toBe(true);
	});
});
