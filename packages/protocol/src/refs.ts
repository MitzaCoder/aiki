/**
 * Tickets and pull requests as links: where a project's bare keys point (`ProjectLinks`, part of its settings), how a
 * ref or a mention in text resolves to a web address (`resolveRef`, `refMentions`), and the live state a backend reads
 * for a task's refs (`refs.status`, feature `ref-status`). The app and the server share the resolution, so a chip's link
 * and the status the server looked up are always about the same thing.
 */
import { type Static, Type } from "typebox";
import { ProjectIdSchema, RequestIdSchema } from "./common.ts";

// --- link settings -----------------------------------------------------------------------------------------------

/**
 * Where a project's bare ticket keys and PR numbers point. `jiraSite` is the Jira site's address
 * ("https://acme.atlassian.net"); `jiraProjects` the ticket prefixes ("EX") whose keys link in text, since a word like
 * "UTF-8" has the same shape; `githubRepos` the "owner/name" of the repositories a `#123` means.
 */
export const ProjectLinksSchema = Type.Object({
	jiraSite: Type.Union([Type.String({ minLength: 1 }), Type.Null()], {
		description: 'The Jira site keys open on, e.g. "https://acme.atlassian.net"; null leaves keys as plain text.',
	}),
	jiraProjects: Type.Array(Type.String({ minLength: 1 }), {
		description: 'Ticket prefixes ("EX") whose keys link where they appear in text. A ref links whatever its prefix.',
	}),
	githubRepos: Type.Array(Type.String({ minLength: 1 }), {
		description: '"owner/name" on github.com. A bare #123 links only with exactly one; with more, write name#123.',
	}),
});
export type ProjectLinks = Static<typeof ProjectLinksSchema>;

/** A project's link settings as the server reports them: what applies, and whether it was filled in automatically. */
export const ProjectLinkSettingsSchema = Type.Object({
	...ProjectLinksSchema.properties,
	detected: Type.Boolean({
		description:
			"True while the server fills them in itself (from the project's git remotes, its commit messages and the host's Jira login); false once the user set them.",
	}),
});
export type ProjectLinkSettings = Static<typeof ProjectLinkSettingsSchema>;

export const NO_PROJECT_LINKS: ProjectLinks = { jiraSite: null, jiraProjects: [], githubRepos: [] };

// --- resolving refs ----------------------------------------------------------------------------------------------

export type ResolvedRef =
	/** An issue or pull request on github.com (`kind` is only known from a URL that says so). */
	| { source: "github"; repo: string; number: number; kind: "pull" | "issue" | "unknown"; url: string }
	| { source: "jira"; key: string; site: string; url: string }
	/** Any other web address. */
	| { source: "web"; url: string };

const JIRA_KEY = /^[A-Z][A-Z0-9_]+-[1-9]\d*$/;
const REPO = /^[\w.-]+\/[\w.-]+$/;

/** "https://acme.atlassian.net/" or "acme.atlassian.net" as "https://acme.atlassian.net"; undefined when it is no address. */
export function normalizeJiraSite(site: string): string | undefined {
	const text = site.trim();
	if (text.length === 0) return undefined;
	try {
		const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
		if (url.hostname.length === 0 || !url.hostname.includes(".")) return undefined;
		return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
	} catch {
		return undefined;
	}
}

/** "acme/platform", a github.com URL or an SSH remote of it as "owner/name"; undefined for anything else. */
export function normalizeGithubRepo(repo: string): string | undefined {
	const text = repo.trim().replace(/\.git$/, "").replace(/\/+$/, "");
	const remote = /^(?:(?:https?|ssh|git):\/\/)?(?:[\w.-]+@)?(?:www\.)?github\.com[:/]([\w.-]+\/[\w.-]+)$/i.exec(text);
	if (remote !== null) return remote[1];
	return REPO.test(text) ? text : undefined;
}

function githubUrl(repo: string, number: number, kind: "pull" | "issue" | "unknown"): string {
	// GitHub sends /issues/N on to /pull/N when N is a pull request, so a number of unknown kind opens either.
	return `https://github.com/${repo}/${kind === "pull" ? "pull" : "issues"}/${number}`;
}

function jiraUrl(site: string, key: string): string {
	return `${site}/browse/${key}`;
}

/** The configured repository a short name means ("platform" for "acme/platform"), when only one does. */
function repoNamed(name: string, links: ProjectLinks): string | undefined {
	const lower = name.toLowerCase();
	const matches = links.githubRepos.filter((repo) => repo.toLowerCase() === lower || repo.split("/")[1]?.toLowerCase() === lower);
	return matches.length === 1 ? matches[0] : undefined;
}

/** The one repository a bare `#123` means: only when the project has exactly one. */
function onlyRepo(links: ProjectLinks): string | undefined {
	return links.githubRepos.length === 1 ? links.githubRepos[0] : undefined;
}

/**
 * What a ref is about and where it opens: a GitHub or Jira URL as itself, any other URL as a web link, `#123` and
 * `name#123` through the project's repositories, `EX-1234` through its Jira site. Undefined for what cannot be linked.
 */
export function resolveRef(ref: string, links: ProjectLinks = NO_PROJECT_LINKS): ResolvedRef | undefined {
	const text = ref.trim();
	if (/^https?:\/\//i.test(text)) {
		let url: URL;
		try {
			url = new URL(text);
		} catch {
			return undefined;
		}
		const path = url.pathname.split("/").filter((part) => part.length > 0);
		if (/^(www\.)?github\.com$/i.test(url.hostname) && path.length >= 4) {
			const kind = path[2] === "pull" || path[2] === "pulls" ? "pull" : path[2] === "issues" ? "issue" : undefined;
			if (kind !== undefined && /^[1-9]\d*$/.test(path[3]!)) {
				return { source: "github", repo: `${path[0]}/${path[1]}`, number: Number(path[3]), kind, url: url.href };
			}
		}
		const browse = path.indexOf("browse");
		const key = browse >= 0 ? path[browse + 1] : undefined;
		if (key !== undefined && JIRA_KEY.test(key)) {
			const site = `${url.origin}${browse === 0 ? "" : `/${path.slice(0, browse).join("/")}`}`;
			return { source: "jira", key, site, url: url.href };
		}
		return { source: "web", url: url.href };
	}
	const numbered = /^(?:([\w.-]+\/[\w.-]+|[\w.-]+))?#([1-9]\d*)$/.exec(text);
	if (numbered !== null) {
		const named = numbered[1];
		const repo = named === undefined ? onlyRepo(links) : named.includes("/") ? named : repoNamed(named, links);
		if (repo === undefined) return undefined;
		const number = Number(numbered[2]);
		return { source: "github", repo, number, kind: "unknown", url: githubUrl(repo, number, "unknown") };
	}
	if (JIRA_KEY.test(text) && links.jiraSite !== null) {
		return { source: "jira", key: text, site: links.jiraSite, url: jiraUrl(links.jiraSite, text) };
	}
	return undefined;
}

/** The identity of what a ref resolves to, so `#1234` and its full URL count as one: "github:o/r#1234", "jira:<site>:EX-1". */
export function refIdentity(resolved: ResolvedRef): string {
	switch (resolved.source) {
		case "github":
			return `github:${resolved.repo.toLowerCase()}#${resolved.number}`;
		case "jira":
			return `jira:${resolved.site.toLowerCase()}:${resolved.key}`;
		case "web":
			return `web:${resolved.url}`;
	}
}

// --- mentions in text --------------------------------------------------------------------------------------------

/** A key, `#123`, `name#123` or `owner/name#123` in running text that links, with where it is. */
export type RefMention = { index: number; text: string; resolved: ResolvedRef };

const MENTION = /(?<![\w/#.:@-])(?:([A-Z][A-Z0-9_]+)-[1-9]\d*|(?:[\w.-]+\/[\w.-]+|[\w.-]+)?#[1-9]\d*)(?![\w-]|\.\d)/g;

/**
 * The tickets and pull requests a plain text names that the project's settings can link: keys only with a prefix in
 * `jiraProjects`, `#123` only with one repository, `name#123` for a repository it has, `owner/name#123` always.
 * The caller keeps code, links and addresses out of `text`.
 */
export function refMentions(text: string, links: ProjectLinks): RefMention[] {
	const mentions: RefMention[] = [];
	const prefixes = new Set(links.jiraProjects.map((prefix) => prefix.toUpperCase()));
	for (const match of text.matchAll(MENTION)) {
		const prefix = match[1];
		if (prefix !== undefined && !prefixes.has(prefix)) continue;
		const resolved = resolveRef(match[0], links);
		if (resolved === undefined) continue;
		mentions.push({ index: match.index, text: match[0], resolved });
	}
	return mentions;
}

// --- live status -------------------------------------------------------------------------------------------------

export const PullRequestStateSchema = Type.Union([
	Type.Literal("open"),
	Type.Literal("draft"),
	Type.Literal("merged"),
	Type.Literal("closed"),
]);
export type PullRequestState = Static<typeof PullRequestStateSchema>;

/** The checks on a pull request's latest commit, summed up; null when it has none. */
export const ChecksStateSchema = Type.Union([Type.Literal("passing"), Type.Literal("failing"), Type.Literal("pending")]);
export type ChecksState = Static<typeof ChecksStateSchema>;

/** Jira's own three groups of statuses, whatever a project calls its steps. */
export const JiraStatusCategorySchema = Type.Union([Type.Literal("todo"), Type.Literal("in_progress"), Type.Literal("done")]);
export type JiraStatusCategory = Static<typeof JiraStatusCategorySchema>;

const RefStatusBase = {
	ref: Type.String({ description: "The ref as the request named it." }),
	url: Type.String({ description: "Where it opens." }),
	title: Type.String(),
	checkedAt: Type.String({ description: "ISO 8601, when the backend last read it." }),
};

export const RefStatusSchema = Type.Union([
	Type.Object({
		...RefStatusBase,
		kind: Type.Literal("pull"),
		state: PullRequestStateSchema,
		checks: Type.Union([ChecksStateSchema, Type.Null()]),
	}),
	Type.Object({
		...RefStatusBase,
		kind: Type.Literal("issue"),
		state: Type.Union([Type.Literal("open"), Type.Literal("closed")]),
	}),
	Type.Object({
		...RefStatusBase,
		kind: Type.Literal("jira"),
		status: Type.String({ description: 'The status as the Jira project names it, e.g. "In review".' }),
		category: JiraStatusCategorySchema,
	}),
]);
export type RefStatus = Static<typeof RefStatusSchema>;

/** The most refs one `refs.status` reads. */
export const MAX_REF_STATUS_REFS = 200;

/**
 * The live state of some refs: pull requests and issues through the host's `gh`, Jira tickets through its `acli`.
 * Answered from a cache, so a client may ask every few minutes. A ref the backend cannot read (no tool, no login, not
 * found, not a ticket or PR) is left out of the answer, never an error.
 */
export const RefsStatusRequestSchema = Type.Object({
	type: Type.Literal("refs.status"),
	id: RequestIdSchema,
	projectId: ProjectIdSchema,
	refs: Type.Array(Type.String({ minLength: 1 }), { maxItems: MAX_REF_STATUS_REFS }),
});
export type RefsStatusRequest = Static<typeof RefsStatusRequestSchema>;

export const RefsStatusResponseSchema = Type.Object({
	type: Type.Literal("refs.status"),
	id: RequestIdSchema,
	statuses: Type.Array(RefStatusSchema),
});
export type RefsStatusResponse = Static<typeof RefsStatusResponseSchema>;

// --- details for a card ------------------------------------------------------------------------------------------

/** A pull request's checks on its latest commit, counted, with the names of the failing ones. */
export const PullRequestChecksSchema = Type.Object({
	passed: Type.Integer({ minimum: 0 }),
	failing: Type.Integer({ minimum: 0 }),
	running: Type.Integer({ minimum: 0 }),
	skipped: Type.Integer({ minimum: 0, description: "Skipped and neutral checks." }),
	failingNames: Type.Array(Type.String(), {
		description: 'The failing checks by name, each once ("build", "lint (cancelled)"); may be fewer than `failing`.',
	}),
});
export type PullRequestChecks = Static<typeof PullRequestChecksSchema>;

/** Where a pull request's review stands. */
export const PullRequestReviewsSchema = Type.Object({
	decision: Type.Union([Type.Literal("approved"), Type.Literal("changes_requested"), Type.Literal("review_required"), Type.Null()], {
		description: "GitHub's review decision; null when the repository requires no review.",
	}),
	approvedBy: Type.Array(Type.String()),
	changesRequestedBy: Type.Array(Type.String()),
	waitingOn: Type.Array(Type.String(), { description: "Users and teams asked to review who have not yet." }),
});
export type PullRequestReviews = Static<typeof PullRequestReviewsSchema>;

const RefDetailsBase = {
	ref: Type.String({ description: "The ref as the request named it." }),
	url: Type.String({ description: "Where it opens." }),
	title: Type.String(),
	updatedAt: Type.Union([Type.String(), Type.Null()], { description: "ISO 8601, when it last changed where it lives." }),
	checkedAt: Type.String({ description: "ISO 8601, when the backend read it." }),
};

export const RefDetailsSchema = Type.Union([
	Type.Object({
		...RefDetailsBase,
		kind: Type.Literal("pull"),
		repo: Type.String({ description: '"owner/name"' }),
		number: Type.Integer({ minimum: 1 }),
		author: Type.Union([Type.String(), Type.Null()]),
		state: PullRequestStateSchema,
		headBranch: Type.String(),
		baseBranch: Type.String(),
		conflicts: Type.Union([Type.Boolean(), Type.Null()], { description: "Null while GitHub has not worked it out." }),
		checks: Type.Union([PullRequestChecksSchema, Type.Null()], { description: "Null when the latest commit has none." }),
		reviews: PullRequestReviewsSchema,
		additions: Type.Integer({ minimum: 0 }),
		deletions: Type.Integer({ minimum: 0 }),
		changedFiles: Type.Integer({ minimum: 0 }),
	}),
	Type.Object({
		...RefDetailsBase,
		kind: Type.Literal("issue"),
		repo: Type.String({ description: '"owner/name"' }),
		number: Type.Integer({ minimum: 1 }),
		author: Type.Union([Type.String(), Type.Null()]),
		state: Type.Union([Type.Literal("open"), Type.Literal("closed")]),
		closedAs: Type.Union([Type.Literal("completed"), Type.Literal("not_planned"), Type.Literal("duplicate"), Type.Null()]),
		assignees: Type.Array(Type.String()),
		labels: Type.Array(Type.String()),
		comments: Type.Integer({ minimum: 0 }),
		excerpt: Type.Union([Type.String(), Type.Null()], { description: "The first few lines of its description, as plain text." }),
	}),
	Type.Object({
		...RefDetailsBase,
		kind: Type.Literal("jira"),
		key: Type.String(),
		type: Type.Union([Type.String(), Type.Null()], { description: 'The work type, e.g. "Story".' }),
		status: Type.String({ description: 'As the Jira project names it, e.g. "In review".' }),
		category: JiraStatusCategorySchema,
		priority: Type.Union([Type.String(), Type.Null()]),
		assignee: Type.Union([Type.String(), Type.Null()]),
		reporter: Type.Union([Type.String(), Type.Null()]),
		parent: Type.Union([
			Type.Object({ key: Type.String(), title: Type.String(), type: Type.Union([Type.String(), Type.Null()]), url: Type.String() }),
			Type.Null(),
		]),
		sprint: Type.Union([Type.String(), Type.Null()], { description: "The active (else the latest) sprint it is in." }),
		excerpt: Type.Union([Type.String(), Type.Null()], { description: "The first few lines of its description, as plain text." }),
	}),
]);
export type RefDetails = Static<typeof RefDetailsSchema>;

/**
 * What a card shows about one ref, read when its card first opens: a pull request's branches, checks, reviews and size,
 * an issue's people and labels, a ticket's people, parent, sprint and description. Through the host's `gh` and `acli`,
 * cached briefly. Null when the backend cannot read it (no tool, no login, not found, not a ticket or PR), never an
 * error. Needs `ref-details`.
 */
export const RefsDetailsRequestSchema = Type.Object({
	type: Type.Literal("refs.details"),
	id: RequestIdSchema,
	projectId: ProjectIdSchema,
	ref: Type.String({ minLength: 1 }),
});
export type RefsDetailsRequest = Static<typeof RefsDetailsRequestSchema>;

export const RefsDetailsResponseSchema = Type.Object({
	type: Type.Literal("refs.details"),
	id: RequestIdSchema,
	details: Type.Union([RefDetailsSchema, Type.Null()]),
});
export type RefsDetailsResponse = Static<typeof RefsDetailsResponseSchema>;
