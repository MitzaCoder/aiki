/**
 * The live state of a task's tickets and pull requests, for `refs.status`: pull requests and issues through the host's
 * `gh` (one GraphQL query for many, about one point of GitHub's 5,000 an hour), Jira tickets through its `acli` (one
 * search for many). Every answer is cached: open things for a couple of minutes, finished ones for half an hour, so
 * clients may ask every few minutes and the tools are hardly ever run. Without a tool or its login the source rests
 * for ten minutes and its refs are simply left out; nothing here is ever an error for the client.
 */
import type { ChecksState, JiraStatusCategory, ProjectLinks, RefStatus, ResolvedRef } from "@aiki/protocol";
import { refIdentity, resolveRef } from "@aiki/protocol";
import { type RunCommand, runHostCommand } from "./host-commands.ts";

/** A status without the `ref` it was asked by, since `#12` and its URL share one. */
type Found = RefStatus extends infer Status ? (Status extends RefStatus ? Omit<Status, "ref"> : never) : never;

type CacheEntry = { found: Found | null; at: number; expiresAt: number };

const OPEN_TTL_MS = 2 * 60_000;
const SETTLED_TTL_MS = 30 * 60_000;
const NOT_FOUND_TTL_MS = 30 * 60_000;
/** How long a source rests after its tool was missing, logged out, limited or broken. */
const SOURCE_REST_MS = 10 * 60_000;
const COMMAND_TIMEOUT_MS = 15_000;
const GITHUB_BATCH = 40;
const JIRA_BATCH = 50;

type GithubItem = { identity: string; repo: string; number: number; url: string };
type JiraItem = { identity: string; key: string; site: string; url: string };

function checksOf(state: unknown): ChecksState | null {
	switch (state) {
		case "SUCCESS":
			return "passing";
		case "FAILURE":
		case "ERROR":
			return "failing";
		case "PENDING":
		case "EXPECTED":
			return "pending";
		default:
			return null;
	}
}

export function jiraCategory(key: unknown): JiraStatusCategory {
	return key === "done" ? "done" : key === "indeterminate" ? "in_progress" : "todo";
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

/** The JSON a tool printed, past any notice it put before it (acli announces new versions on stdout). */
export function jsonIn(output: string, open: "{" | "["): unknown {
	const start = output.indexOf(open);
	if (start < 0) return undefined;
	try {
		return JSON.parse(output.slice(start));
	} catch {
		return undefined;
	}
}

export function hostOf(site: string): string {
	try {
		return new URL(site).host.toLowerCase();
	} catch {
		return site.toLowerCase();
	}
}

export class RefStatusService {
	readonly #run: RunCommand;
	readonly #now: () => number;
	readonly #log: (message: string) => void;
	/** The Jira site `acli` is logged in to (`ProjectLinkDetector.jiraLoginSite`); only its tickets can be read. */
	readonly #jiraSite: () => Promise<string | undefined>;
	readonly #cache = new Map<string, CacheEntry>();
	readonly #fetching = new Map<string, Promise<void>>();
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

	/** The state of every ref this host can read, fresh enough; the rest are left out. */
	async statuses(refs: readonly string[], links: ProjectLinks): Promise<RefStatus[]> {
		const asked = new Map<string, { ref: string; resolved: ResolvedRef }[]>();
		for (const ref of new Set(refs.map((entry) => entry.trim()).filter((entry) => entry.length > 0))) {
			const resolved = resolveRef(ref, links);
			if (resolved === undefined || resolved.source === "web") continue;
			const identity = refIdentity(resolved);
			asked.set(identity, [...(asked.get(identity) ?? []), { ref, resolved }]);
		}
		const now = this.#now();
		const github: GithubItem[] = [];
		const jira: JiraItem[] = [];
		const waits: Promise<void>[] = [];
		for (const [identity, entries] of asked) {
			const fetching = this.#fetching.get(identity);
			if (fetching !== undefined) {
				waits.push(fetching);
				continue;
			}
			const cached = this.#cache.get(identity);
			if (cached !== undefined && cached.expiresAt > now) continue;
			const { resolved } = entries[0]!;
			if (resolved.source === "github") github.push({ identity, repo: resolved.repo, number: resolved.number, url: resolved.url });
			else if (resolved.source === "jira") jira.push({ identity, key: resolved.key, site: resolved.site, url: resolved.url });
		}
		for (let start = 0; start < github.length; start += GITHUB_BATCH) {
			waits.push(this.#track(github.slice(start, start + GITHUB_BATCH), (batch) => this.#readGithub(batch)));
		}
		for (let start = 0; start < jira.length; start += JIRA_BATCH) {
			waits.push(this.#track(jira.slice(start, start + JIRA_BATCH), (batch) => this.#readJira(batch)));
		}
		await Promise.all(waits);

		const statuses: RefStatus[] = [];
		for (const [identity, entries] of asked) {
			const found = this.#cache.get(identity)?.found;
			if (found === undefined || found === null) continue;
			for (const { ref } of entries) statuses.push({ ...found, ref } as RefStatus);
		}
		return statuses;
	}

	/** Marks the batch's refs as being read, so a second request waits for this read instead of starting its own. */
	#track<Item extends { identity: string }>(batch: Item[], read: (batch: Item[]) => Promise<void>): Promise<void> {
		const reading = read(batch)
			.catch((error: unknown) => this.#log(`ref status: ${error instanceof Error ? error.message : String(error)}`))
			.finally(() => {
				for (const item of batch) this.#fetching.delete(item.identity);
			});
		for (const item of batch) this.#fetching.set(item.identity, reading);
		return reading;
	}

	#resting(source: "github" | "jira"): boolean {
		return (this.#restingUntil.get(source) ?? 0) > this.#now();
	}

	#rest(source: "github" | "jira", why: string): void {
		if (!this.#resting(source)) this.#log(`ref status: ${source === "github" ? "GitHub" : "Jira"} unavailable for 10 minutes: ${why}`);
		this.#restingUntil.set(source, this.#now() + SOURCE_REST_MS);
	}

	#store(identity: string, found: Found | null): void {
		const at = this.#now();
		const ttl = found === null ? NOT_FOUND_TTL_MS : settled(found) ? SETTLED_TTL_MS : OPEN_TTL_MS;
		this.#cache.set(identity, { found, at, expiresAt: at + ttl });
	}

	/** A failed read keeps what was known, for one more short while, instead of forgetting it. */
	#keepStale(identities: readonly string[]): void {
		const at = this.#now();
		for (const identity of identities) {
			const cached = this.#cache.get(identity);
			if (cached !== undefined) this.#cache.set(identity, { ...cached, expiresAt: at + OPEN_TTL_MS });
		}
	}

	async #readGithub(batch: GithubItem[]): Promise<void> {
		if (this.#resting("github")) return;
		const repos = [...new Set(batch.map((item) => item.repo))];
		const fields =
			"__typename ... on PullRequest { title url state isDraft commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } } ... on Issue { title url state }";
		const query = `query { ${repos
			.map((repo, r) => {
				const [owner, name] = repo.split("/");
				const numbers = batch.filter((item) => item.repo === repo);
				return `r${r}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { ${numbers
					.map((item) => `n${item.number}: issueOrPullRequest(number: ${item.number}) { ${fields} }`)
					.join(" ")} }`;
			})
			.join(" ")} }`;
		const result = await this.#run("gh", ["api", "graphql", "-f", `query=${query}`], { timeoutMs: COMMAND_TIMEOUT_MS });
		if (result.missing) return this.#rest("github", "gh is not installed");
		const json = jsonIn(result.stdout, "{") as { data?: Record<string, Record<string, unknown> | null> | null; errors?: { type?: string; message?: string }[] } | undefined;
		if (json?.data === undefined || json.data === null) {
			this.#keepStale(batch.map((item) => item.identity));
			const limited = json?.errors?.some((error) => error.type === "RATE_LIMITED") === true;
			return this.#rest("github", limited ? "rate limited" : (result.stderr.trim().split("\n")[0] ?? `gh exited ${result.exitCode}`));
		}
		for (const [r, repo] of repos.entries()) {
			const nodes = json.data[`r${r}`] ?? null;
			for (const item of batch.filter((entry) => entry.repo === repo)) {
				const node = (nodes?.[`n${item.number}`] ?? null) as Record<string, unknown> | null;
				this.#store(item.identity, node === null ? null : githubFound(node, item.url, new Date(this.#now()).toISOString()));
			}
		}
	}

	async #readJira(batch: JiraItem[]): Promise<void> {
		if (this.#resting("jira")) return;
		const site = await this.#jiraSite();
		if (site === undefined) return this.#rest("jira", "acli is not installed or not logged in");
		const readable = batch.filter((item) => hostOf(item.site) === hostOf(site));
		// Tickets of another site cannot be read with this login; they get no status.
		for (const item of batch) if (!readable.includes(item)) this.#store(item.identity, null);
		if (readable.length === 0) return;
		const jql = `key in (${readable.map((item) => item.key).join(", ")})`;
		const result = await this.#run(
			"acli",
			["jira", "workitem", "search", "--jql", jql, "--fields", "key,summary,status", "--json", "--limit", String(readable.length)],
			{ timeoutMs: COMMAND_TIMEOUT_MS },
		);
		if (result.missing) return this.#rest("jira", "acli is not installed");
		const items = jsonIn(result.stdout, "[");
		if (result.exitCode !== 0 || !Array.isArray(items)) {
			this.#keepStale(readable.map((item) => item.identity));
			return this.#rest("jira", result.stderr.trim().split("\n")[0] || `acli exited ${result.exitCode}`);
		}
		const byKey = new Map<string, Record<string, unknown>>();
		for (const entry of items as Record<string, unknown>[]) if (typeof entry?.key === "string") byKey.set(entry.key, entry);
		for (const item of readable) {
			const entry = byKey.get(item.key);
			const fields = (entry?.fields ?? {}) as { summary?: unknown; status?: { name?: unknown; statusCategory?: { key?: unknown } } };
			this.#store(
				item.identity,
				entry === undefined || typeof fields.status?.name !== "string"
					? null
					: {
							kind: "jira",
							url: item.url,
							title: typeof fields.summary === "string" ? fields.summary : "",
							checkedAt: new Date(this.#now()).toISOString(),
							status: fields.status.name,
							category: jiraCategory(fields.status.statusCategory?.key),
						},
			);
		}
	}
}

function githubFound(node: Record<string, unknown>, fallbackUrl: string, checkedAt: string): Found | null {
	const title = typeof node.title === "string" ? node.title : "";
	const url = typeof node.url === "string" ? node.url : fallbackUrl;
	if (node.__typename === "PullRequest") {
		const commits = node.commits as { nodes?: { commit?: { statusCheckRollup?: { state?: unknown } | null } }[] } | undefined;
		const rollup = commits?.nodes?.[0]?.commit?.statusCheckRollup?.state;
		const state = node.state === "MERGED" ? "merged" : node.state === "CLOSED" ? "closed" : node.isDraft === true ? "draft" : "open";
		return { kind: "pull", url, title, checkedAt, state, checks: checksOf(rollup) };
	}
	if (node.__typename === "Issue") {
		return { kind: "issue", url, title, checkedAt, state: node.state === "CLOSED" ? "closed" : "open" };
	}
	return null;
}
