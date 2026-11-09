/**
 * What a ref's card shows, for `refs.details`: a pull request's branches, checks, reviews and size and an issue's people
 * and labels through the host's `gh` (one GraphQL query, more pages only to name failing checks), a Jira ticket's
 * people, parent, sprint and description through its `acli`. Read when a card first opens, so one ref at a time; kept
 * for a minute (finished things longer), and asks that arrive together share one read. Without a tool or its login the
 * source rests for ten minutes and the answer is null; a failed read answers what was known before.
 */
import type { PullRequestChecks, PullRequestReviews, ProjectLinks, RefDetails, ResolvedRef } from "@mihai-harness/protocol";
import { refIdentity, resolveRef } from "@mihai-harness/protocol";
import { type RunCommand, runHostCommand } from "./host-commands.ts";
import { hostOf, jiraCategory, jsonIn } from "./ref-status.ts";

/** Details without the `ref` they were asked by, since `#12` and its URL share one. */
type Found = RefDetails extends infer Details ? (Details extends RefDetails ? Omit<Details, "ref"> : never) : never;

/** What a read came back with: the details, null when there is no such thing, undefined when it could not be read. */
type ReadResult = Found | null | undefined;

type CacheEntry = { found: Found | null; expiresAt: number };

const OPEN_TTL_MS = 60_000;
const SETTLED_TTL_MS = 10 * 60_000;
const NOT_FOUND_TTL_MS = 5 * 60_000;
const SOURCE_REST_MS = 10 * 60_000;
const COMMAND_TIMEOUT_MS = 15_000;
/** Pages of checks read past the first only to name the failing ones. */
const EXTRA_CHECK_PAGES = 2;
const EXCERPT_LINES = 3;
const EXCERPT_CHARS = 320;

const CONTEXT_NODES = "pageInfo { hasNextPage endCursor } nodes { __typename ... on CheckRun { name status conclusion } ... on StatusContext { context state } }";

const PULL_FIELDS = `title url number state isDraft updatedAt author { login } headRefName baseRefName mergeable
additions deletions changedFiles reviewDecision
reviewRequests(first: 20) { nodes { requestedReviewer { __typename ... on User { login } ... on Team { name } ... on Bot { login } ... on Mannequin { login } } } }
latestOpinionatedReviews(first: 30) { nodes { author { login } state } }
commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 100) { ${CONTEXT_NODES} checkRunCountsByState { state count } statusContextCountsByState { state count } } } } } }`;

const ITEM_QUERY = `query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { issueOrPullRequest(number: $number) { __typename
... on PullRequest { ${PULL_FIELDS} }
... on Issue { title url number state stateReason updatedAt author { login } assignees(first: 10) { nodes { login } } labels(first: 10) { nodes { name } } comments { totalCount } body }
} } }`;

const CHECKS_PAGE_QUERY = `query($owner: String!, $name: String!, $number: Int!, $after: String!) { repository(owner: $owner, name: $name) { pullRequest(number: $number) {
commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 100, after: $after) { ${CONTEXT_NODES} } } } } } } } }`;

type ContextNode = { __typename?: string; name?: string; status?: string; conclusion?: string | null; context?: string; state?: string };
type ContextPage = { pageInfo?: { hasNextPage?: boolean; endCursor?: string | null }; nodes?: (ContextNode | null)[] };

const FAILING = new Set(["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"]);
const RUNNING = new Set(["QUEUED", "IN_PROGRESS", "WAITING", "PENDING", "REQUESTED", "EXPECTED"]);
const SKIPPED = new Set(["SKIPPED", "NEUTRAL", "STALE"]);

/** A failing check's name, with how it failed when that is not a plain failure: "build (cancelled)". */
function failingName(node: ContextNode): string | undefined {
	if (node.__typename === "CheckRun") {
		if (node.status !== "COMPLETED" || node.conclusion == null || !FAILING.has(node.conclusion) || typeof node.name !== "string") return undefined;
		const how = node.conclusion === "FAILURE" ? "" : ` (${node.conclusion.toLowerCase().replace(/_/g, " ")})`;
		return `${node.name}${how}`;
	}
	if (node.__typename === "StatusContext" && typeof node.context === "string" && FAILING.has(node.state ?? "")) return node.context;
	return undefined;
}

/** The checks counted by GitHub's own tallies of the latest commit; null when it has none. */
export function countChecks(counts: readonly { state?: string; count?: number }[]): PullRequestChecks | null {
	const checks: PullRequestChecks = { passed: 0, failing: 0, running: 0, skipped: 0, failingNames: [] };
	for (const { state, count } of counts) {
		if (typeof state !== "string" || typeof count !== "number" || count <= 0) continue;
		if (state === "SUCCESS") checks.passed += count;
		else if (FAILING.has(state)) checks.failing += count;
		else if (RUNNING.has(state)) checks.running += count;
		else if (SKIPPED.has(state)) checks.skipped += count;
	}
	return checks.passed + checks.failing + checks.running + checks.skipped === 0 ? null : checks;
}

function reviewsOf(node: Record<string, unknown>): PullRequestReviews {
	const decision = node.reviewDecision === "APPROVED" ? "approved" : node.reviewDecision === "CHANGES_REQUESTED" ? "changes_requested" : node.reviewDecision === "REVIEW_REQUIRED" ? "review_required" : null;
	const reviews = ((node.latestOpinionatedReviews as { nodes?: ({ author?: { login?: unknown } | null; state?: unknown } | null)[] } | undefined)?.nodes ?? []).filter(
		(review) => review !== null,
	);
	const by = (state: string): string[] => [
		...new Set(reviews.filter((review) => review.state === state).flatMap((review) => (typeof review.author?.login === "string" ? [review.author.login] : []))),
	];
	const requests = (node.reviewRequests as { nodes?: ({ requestedReviewer?: { login?: unknown; name?: unknown } | null } | null)[] } | undefined)?.nodes ?? [];
	const waitingOn = requests.flatMap((request) => {
		const reviewer = request?.requestedReviewer;
		const name = typeof reviewer?.login === "string" ? reviewer.login : typeof reviewer?.name === "string" ? reviewer.name : undefined;
		return name === undefined ? [] : [name];
	});
	return { decision, approvedBy: by("APPROVED"), changesRequestedBy: by("CHANGES_REQUESTED"), waitingOn: [...new Set(waitingOn)] };
}

/** The first few lines of a description as plain text: no comments, images, heading marks or blank lines. */
export function excerptOf(text: string): string | null {
	const lines = text
		.replace(/<!--[\s\S]*?-->/g, "")
		.replace(/!\[[^\]]*\]\([^)]*\)/g, "")
		.replace(/<img\b[^>]*>/gi, "")
		.replace(/\[([^\]\n]*)\]\([^)\n]*\)/g, "$1")
		.split(/\r?\n/)
		.map((line) => line.replace(/^\s{0,3}#{1,6}\s+/, "").replace(/\*\*|__/g, "").replace(/\s+/g, " ").trim())
		.filter((line) => line.length > 0 && !/^([-*_=]{3,}|`{3,}.*|~{3,}.*)$/.test(line))
		.slice(0, EXCERPT_LINES);
	if (lines.length === 0) return null;
	const joined = lines.join("\n");
	return joined.length <= EXCERPT_CHARS ? joined : `${joined.slice(0, EXCERPT_CHARS - 1).trimEnd()}…`;
}

type AdfNode = { type?: string; text?: string; attrs?: Record<string, unknown>; content?: AdfNode[] };

const ADF_BLOCKS = new Set(["paragraph", "heading", "blockquote", "codeBlock", "panel", "listItem", "tableRow", "rule", "mediaSingle"]);

/** A Jira description (Atlassian document format, or plain text on older sites) as plain text. */
export function adfText(document: unknown): string {
	if (typeof document === "string") return document;
	const out: string[] = [];
	const walk = (node: AdfNode | undefined, prefix: string): void => {
		if (node === undefined || node === null || typeof node !== "object") return;
		switch (node.type) {
			case "text":
				out.push(node.text ?? "");
				return;
			case "hardBreak":
				out.push("\n");
				return;
			case "mention":
			case "emoji":
				out.push(String(node.attrs?.text ?? node.attrs?.shortName ?? ""));
				return;
			case "inlineCard":
				out.push(String(node.attrs?.url ?? ""));
				return;
		}
		const block = node.type !== undefined && ADF_BLOCKS.has(node.type);
		if (node.type === "listItem") out.push(`${prefix}• `);
		for (const child of node.content ?? []) walk(child, node.type === "listItem" ? `${prefix}  ` : prefix);
		if (block) out.push("\n");
	};
	walk(document as AdfNode, "");
	return out.join("").replace(/\n{2,}/g, "\n");
}

/** Jira's "2026-11-06T16:29:45.877+0000" as ISO 8601; null for anything else. */
function jiraTime(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const time = Date.parse(value.replace(/([+-]\d\d)(\d\d)$/, "$1:$2"));
	return Number.isNaN(time) ? null : new Date(time).toISOString();
}

/** The sprint a ticket is in: its sprint field is found by its shape, since each site numbers its custom fields. */
function sprintOf(fields: Record<string, unknown>): string | null {
	for (const [name, value] of Object.entries(fields)) {
		if (!name.startsWith("customfield_") || !Array.isArray(value) || value.length === 0) continue;
		const sprints = value.filter(
			(entry): entry is { name: string; state?: unknown } =>
				typeof entry === "object" && entry !== null && "boardId" in entry && typeof (entry as { name?: unknown }).name === "string",
		);
		if (sprints.length === 0) continue;
		return (sprints.find((sprint) => sprint.state === "active") ?? sprints.at(-1)!).name;
	}
	return null;
}

function named(value: unknown, key: "displayName" | "name"): string | null {
	const field = (value as Record<string, unknown> | null | undefined)?.[key];
	return typeof field === "string" && field.length > 0 ? field : null;
}

function settled(found: Found): boolean {
	switch (found.kind) {
		case "pull":
			return found.state === "merged" || found.state === "closed";
		case "issue":
			return found.state === "closed";
		case "jira":
			return found.category === "done";
	}
}

export class RefDetailsService {
	readonly #run: RunCommand;
	readonly #now: () => number;
	readonly #log: (message: string) => void;
	readonly #jiraSite: () => Promise<string | undefined>;
	readonly #cache = new Map<string, CacheEntry>();
	readonly #reading = new Map<string, Promise<Found | null>>();
	readonly #restingUntil = new Map<"github" | "jira", number>();

	constructor(options: {
		jiraSite: () => Promise<string | undefined>;
		run?: RunCommand;
		now?: () => number;
		log?: (message: string) => void;
	}) {
		this.#jiraSite = options.jiraSite;
		this.#run = options.run ?? runHostCommand;
		this.#now = options.now ?? Date.now;
		this.#log = options.log ?? ((message) => console.log(message));
	}

	/** What the card of a ref shows, fresh enough; null when this host cannot read it. */
	async details(ref: string, links: ProjectLinks): Promise<RefDetails | null> {
		const resolved = resolveRef(ref, links);
		if (resolved === undefined || resolved.source === "web") return null;
		const identity = refIdentity(resolved);
		const cached = this.#cache.get(identity);
		let found: Found | null;
		if (cached !== undefined && cached.expiresAt > this.#now()) found = cached.found;
		else {
			let reading = this.#reading.get(identity);
			if (reading === undefined) {
				reading = this.#read(identity, resolved).finally(() => this.#reading.delete(identity));
				this.#reading.set(identity, reading);
			}
			found = await reading;
		}
		return found === null ? null : ({ ...found, ref } as RefDetails);
	}

	async #read(identity: string, resolved: Exclude<ResolvedRef, { source: "web" }>): Promise<Found | null> {
		let result: ReadResult;
		try {
			result = resolved.source === "github" ? await this.#readGithub(resolved) : await this.#readJira(resolved);
		} catch (error) {
			this.#log(`ref details: ${error instanceof Error ? error.message : String(error)}`);
			result = undefined;
		}
		const at = this.#now();
		if (result === undefined) {
			// What was known stays, for one more short while.
			const known = this.#cache.get(identity);
			if (known === undefined) return null;
			this.#cache.set(identity, { ...known, expiresAt: at + OPEN_TTL_MS });
			return known.found;
		}
		const ttl = result === null ? NOT_FOUND_TTL_MS : settled(result) ? SETTLED_TTL_MS : OPEN_TTL_MS;
		this.#cache.set(identity, { found: result, expiresAt: at + ttl });
		return result;
	}

	#resting(source: "github" | "jira"): boolean {
		return (this.#restingUntil.get(source) ?? 0) > this.#now();
	}

	#rest(source: "github" | "jira", why: string): undefined {
		if (!this.#resting(source)) this.#log(`ref details: ${source === "github" ? "GitHub" : "Jira"} unavailable for 10 minutes: ${why}`);
		this.#restingUntil.set(source, this.#now() + SOURCE_REST_MS);
		return undefined;
	}

	async #graphql(query: string, variables: Record<string, string | number>): Promise<{ data?: Record<string, unknown> | null; errors?: { type?: string; message?: string }[] } | "missing" | undefined> {
		const args = ["api", "graphql", "-f", `query=${query}`];
		for (const [name, value] of Object.entries(variables)) args.push(typeof value === "number" ? "-F" : "-f", `${name}=${value}`);
		const result = await this.#run("gh", args, { timeoutMs: COMMAND_TIMEOUT_MS });
		if (result.missing) return "missing";
		const json = jsonIn(result.stdout, "{") as { data?: Record<string, unknown> | null; errors?: { type?: string; message?: string }[] } | undefined;
		if (json === undefined) {
			this.#rest("github", result.stderr.trim().split("\n")[0] || `gh exited ${result.exitCode}`);
			return undefined;
		}
		return json;
	}

	async #readGithub(resolved: Extract<ResolvedRef, { source: "github" }>): Promise<ReadResult> {
		if (this.#resting("github")) return undefined;
		const [owner, name] = resolved.repo.split("/") as [string, string];
		const variables = { owner, name, number: resolved.number };
		const json = await this.#graphql(ITEM_QUERY, variables);
		if (json === "missing") return this.#rest("github", "gh is not installed");
		if (json === undefined) return undefined;
		const repository = json.data?.repository as { issueOrPullRequest?: Record<string, unknown> | null } | null | undefined;
		const node = repository?.issueOrPullRequest ?? null;
		if (node === null) {
			if (json.errors?.some((error) => error.type === "NOT_FOUND") === true || (json.data !== undefined && json.data !== null)) return null;
			const limited = json.errors?.some((error) => error.type === "RATE_LIMITED") === true;
			return this.#rest("github", limited ? "rate limited" : (json.errors?.[0]?.message ?? "no answer"));
		}
		const checkedAt = new Date(this.#now()).toISOString();
		const title = typeof node.title === "string" ? node.title : "";
		const url = typeof node.url === "string" ? node.url : resolved.url;
		const updatedAt = typeof node.updatedAt === "string" ? node.updatedAt : null;
		const author = typeof (node.author as { login?: unknown } | null)?.login === "string" ? (node.author as { login: string }).login : null;
		if (node.__typename === "Issue") {
			const logins = (node.assignees as { nodes?: ({ login?: unknown } | null)[] } | undefined)?.nodes ?? [];
			const labels = (node.labels as { nodes?: ({ name?: unknown } | null)[] } | undefined)?.nodes ?? [];
			return {
				kind: "issue",
				url,
				title,
				updatedAt,
				checkedAt,
				repo: resolved.repo,
				number: resolved.number,
				author,
				state: node.state === "CLOSED" ? "closed" : "open",
				closedAs:
					node.state !== "CLOSED" ? null : node.stateReason === "NOT_PLANNED" ? "not_planned" : node.stateReason === "DUPLICATE" ? "duplicate" : "completed",
				assignees: logins.flatMap((entry) => (typeof entry?.login === "string" ? [entry.login] : [])),
				labels: labels.flatMap((entry) => (typeof entry?.name === "string" ? [entry.name] : [])),
				comments: Number((node.comments as { totalCount?: unknown } | undefined)?.totalCount ?? 0) || 0,
				excerpt: typeof node.body === "string" ? excerptOf(node.body) : null,
			};
		}
		if (node.__typename !== "PullRequest") return null;
		const rollup = (node.commits as { nodes?: { commit?: { statusCheckRollup?: { contexts?: ContextPage & Record<string, unknown> } | null } }[] } | undefined)
			?.nodes?.[0]?.commit?.statusCheckRollup;
		const contexts = rollup?.contexts;
		const counts = [
			...((contexts?.checkRunCountsByState as { state?: string; count?: number }[] | undefined) ?? []),
			...((contexts?.statusContextCountsByState as { state?: string; count?: number }[] | undefined) ?? []),
		];
		const checks = countChecks(counts);
		if (checks !== null && contexts !== undefined) checks.failingNames = await this.#failingNames(contexts, checks.failing, variables);
		const state = node.state === "MERGED" ? "merged" : node.state === "CLOSED" ? "closed" : node.isDraft === true ? "draft" : "open";
		return {
			kind: "pull",
			url,
			title,
			updatedAt,
			checkedAt,
			repo: resolved.repo,
			number: resolved.number,
			author,
			state,
			headBranch: typeof node.headRefName === "string" ? node.headRefName : "",
			baseBranch: typeof node.baseRefName === "string" ? node.baseRefName : "",
			conflicts: node.mergeable === "CONFLICTING" ? true : node.mergeable === "MERGEABLE" ? false : null,
			checks,
			reviews: reviewsOf(node),
			additions: Number(node.additions) || 0,
			deletions: Number(node.deletions) || 0,
			changedFiles: Number(node.changedFiles) || 0,
		};
	}

	/** The failing checks by name, reading later pages only while some are still unnamed. */
	async #failingNames(first: ContextPage, failing: number, variables: { owner: string; name: string; number: number }): Promise<string[]> {
		const names = new Set<string>();
		let page: ContextPage | undefined = first;
		for (let extra = 0; page !== undefined; extra += 1) {
			for (const node of page.nodes ?? []) {
				const name = node === null ? undefined : failingName(node);
				if (name !== undefined) names.add(name);
			}
			const cursor = page.pageInfo?.endCursor;
			if (failing === 0 || names.size >= failing || page.pageInfo?.hasNextPage !== true || typeof cursor !== "string" || extra >= EXTRA_CHECK_PAGES) break;
			const json = await this.#graphql(CHECKS_PAGE_QUERY, { ...variables, after: cursor });
			if (json === "missing" || json === undefined) break;
			const repository = json.data?.repository as
				| { pullRequest?: { commits?: { nodes?: { commit?: { statusCheckRollup?: { contexts?: ContextPage } | null } }[] } } | null }
				| null
				| undefined;
			page = repository?.pullRequest?.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts;
		}
		return [...names];
	}

	async #readJira(resolved: Extract<ResolvedRef, { source: "jira" }>): Promise<ReadResult> {
		if (this.#resting("jira")) return undefined;
		const site = await this.#jiraSite();
		if (site === undefined) return this.#rest("jira", "acli is not installed or not logged in");
		// A ticket of another site cannot be read with this login.
		if (hostOf(resolved.site) !== hostOf(site)) return null;
		const result = await this.#run("acli", ["jira", "workitem", "view", resolved.key, "--fields", "*navigable", "--json"], {
			timeoutMs: COMMAND_TIMEOUT_MS,
		});
		if (result.missing) return this.#rest("jira", "acli is not installed");
		const item = jsonIn(result.stdout, "{") as { key?: unknown; fields?: Record<string, unknown> } | undefined;
		if (result.exitCode !== 0 || item?.fields === undefined) {
			if (/does not exist|do not have permission/i.test(result.stderr)) return null;
			return this.#rest("jira", result.stderr.trim().split("\n")[0] || `acli exited ${result.exitCode}`);
		}
		const fields = item.fields;
		const status = fields.status as { name?: unknown; statusCategory?: { key?: unknown } } | undefined;
		if (typeof status?.name !== "string") return null;
		const parent = fields.parent as { key?: unknown; fields?: { summary?: unknown; issuetype?: unknown } } | undefined;
		const description = fields.description === null || fields.description === undefined ? null : excerptOf(adfText(fields.description));
		return {
			kind: "jira",
			url: resolved.url,
			title: typeof fields.summary === "string" ? fields.summary : "",
			updatedAt: jiraTime(fields.updated),
			checkedAt: new Date(this.#now()).toISOString(),
			key: resolved.key,
			type: named(fields.issuetype, "name"),
			status: status.name,
			category: jiraCategory(status.statusCategory?.key),
			priority: named(fields.priority, "name"),
			assignee: named(fields.assignee, "displayName"),
			reporter: named(fields.reporter, "displayName"),
			parent:
				typeof parent?.key === "string"
					? {
							key: parent.key,
							title: typeof parent.fields?.summary === "string" ? parent.fields.summary : "",
							type: named(parent.fields?.issuetype, "name"),
							url: `${resolved.site}/browse/${parent.key}`,
						}
					: null,
			sprint: sprintOf(fields),
			excerpt: description,
		};
	}
}
