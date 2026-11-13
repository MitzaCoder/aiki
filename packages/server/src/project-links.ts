/**
 * Filling in a project's link settings when the user has not set them: its GitHub repositories from the git remotes,
 * its ticket prefixes from recent commit messages ("EX-4409 - CRUD on comments"), and the Jira site from the host's
 * `acli` login, used only when the commits name tickets. Read-only: `git` and `jj` only read (jj with
 * `--ignore-working-copy`, so it never snapshots), and nothing is written to the project.
 */
import type { ProjectLinks } from "@kemiri/protocol";
import { NO_PROJECT_LINKS, normalizeGithubRepo, normalizeJiraSite } from "@kemiri/protocol";
import { type RunCommand, runHostCommand } from "./host-commands.ts";

const COMMAND_TIMEOUT_MS = 5_000;
/** How long what was found holds before the next summary looks again. */
const DETECTED_TTL_MS = 60 * 60_000;
/** How long the host's Jira login holds; it is shared by every project. */
const JIRA_LOGIN_TTL_MS = 10 * 60_000;
/** Commit subjects read for ticket prefixes, and how often a prefix must turn up among them. */
const COMMITS_READ = 300;
const PREFIX_MIN_MENTIONS = 3;
const MAX_PREFIXES = 8;
/** Words shaped like ticket keys that are not tickets. */
const NOT_TICKETS = new Set(["UTF", "SHA", "ISO", "RFC", "GPT", "HTTP", "TLS", "SSL", "AES", "RSA", "CVE", "ES", "PEP", "WCAG", "IPV"]);

/** "origin" first, then "upstream", then the rest as listed. */
function remoteRank(name: string): number {
	return name === "origin" ? 0 : name === "upstream" ? 1 : 2;
}

/** The GitHub repositories in `git remote -v` or `jj git remote list` output, origin first. */
export function reposFromRemotes(output: string): string[] {
	const remotes: { name: string; repo: string; index: number }[] = [];
	for (const [index, line] of output.split("\n").entries()) {
		const [name, url] = line.trim().split(/\s+/);
		if (name === undefined || url === undefined) continue;
		const repo = normalizeGithubRepo(url);
		if (repo !== undefined) remotes.push({ name, repo, index });
	}
	remotes.sort((left, right) => remoteRank(left.name) - remoteRank(right.name) || left.index - right.index);
	return [...new Set(remotes.map((remote) => remote.repo))];
}

/** The ticket prefixes commit subjects name often enough, most named first. */
export function prefixesFromSubjects(subjects: string): string[] {
	const counts = new Map<string, number>();
	for (const match of subjects.matchAll(/(?<![\w/#.-])([A-Z][A-Z0-9_]+)-[1-9]\d*(?![\w-])/g)) {
		const prefix = match[1]!;
		if (NOT_TICKETS.has(prefix)) continue;
		counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
	}
	return [...counts]
		.filter(([, count]) => count >= PREFIX_MIN_MENTIONS)
		.sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
		.slice(0, MAX_PREFIXES)
		.map(([prefix]) => prefix);
}

/** The site `acli jira auth status` names when it says the login works; undefined otherwise. */
export function jiraSiteFromAuthStatus(output: string): string | undefined {
	if (!/authenticated/i.test(output) || /unauthorized|not authenticated/i.test(output)) return undefined;
	const site = /^\s*Site:\s*(\S+)/im.exec(output)?.[1];
	return site === undefined ? undefined : normalizeJiraSite(site);
}

function sameLinks(left: ProjectLinks, right: ProjectLinks): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * What the host can tell about each project's links, cached per project folder. `cached` answers at once (undefined
 * before the first look); `detect` looks (once at a time per folder) and calls `onChange` when the answer changed.
 */
export class ProjectLinkDetector {
	readonly #run: RunCommand;
	readonly #now: () => number;
	/** Called when a look found something different for a folder than the look before. */
	onChange: (path: string) => void;
	readonly #found = new Map<string, { links: ProjectLinks; at: number }>();
	readonly #looking = new Map<string, Promise<ProjectLinks>>();
	#jiraLogin: { site: string | undefined; at: number } | undefined;
	#jiraLoginLooking: Promise<string | undefined> | undefined;

	constructor(options: { run?: RunCommand; now?: () => number; onChange?: (path: string) => void } = {}) {
		this.#run = options.run ?? runHostCommand;
		this.#now = options.now ?? Date.now;
		this.onChange = options.onChange ?? (() => {});
	}

	/** What was found for this folder, or undefined before the first look ends. Starts a look when there is none or it is old. */
	cached(path: string): ProjectLinks | undefined {
		const found = this.#found.get(path);
		if (found === undefined || this.#now() - found.at > DETECTED_TTL_MS) void this.detect(path);
		return found?.links;
	}

	/** Looks again (or joins the look under way). */
	detect(path: string): Promise<ProjectLinks> {
		const looking = this.#looking.get(path);
		if (looking !== undefined) return looking;
		const look = this.#look(path).finally(() => this.#looking.delete(path));
		this.#looking.set(path, look);
		return look;
	}

	/** The cached answer, or a fresh one when there is none yet. */
	async links(path: string): Promise<ProjectLinks> {
		return this.cached(path) ?? (await this.detect(path));
	}

	/** Forget a folder's answer, so the next summary looks again (the user went back to automatic). */
	forget(path: string): void {
		this.#found.delete(path);
	}

	async #look(path: string): Promise<ProjectLinks> {
		let links: ProjectLinks;
		try {
			const [repos, prefixes] = await Promise.all([this.#repos(path), this.#prefixes(path)]);
			const site = prefixes.length > 0 ? await this.jiraLoginSite() : undefined;
			links = { jiraSite: site ?? null, jiraProjects: site === undefined ? [] : prefixes, githubRepos: repos };
		} catch {
			links = NO_PROJECT_LINKS;
		}
		const previous = this.#found.get(path);
		this.#found.set(path, { links, at: this.#now() });
		if (previous === undefined || !sameLinks(previous.links, links)) this.onChange(path);
		return links;
	}

	async #repos(path: string): Promise<string[]> {
		const git = await this.#run("git", ["-C", path, "remote", "-v"], { timeoutMs: COMMAND_TIMEOUT_MS });
		if (git.exitCode === 0) return reposFromRemotes(git.stdout);
		const jj = await this.#run("jj", ["--ignore-working-copy", "-R", path, "git", "remote", "list"], { timeoutMs: COMMAND_TIMEOUT_MS });
		return jj.exitCode === 0 ? reposFromRemotes(jj.stdout) : [];
	}

	async #prefixes(path: string): Promise<string[]> {
		const git = await this.#run("git", ["-C", path, "log", "-n", String(COMMITS_READ), "--format=%s"], { timeoutMs: COMMAND_TIMEOUT_MS });
		if (git.exitCode === 0) return prefixesFromSubjects(git.stdout);
		const jj = await this.#run(
			"jj",
			[
				"--ignore-working-copy",
				"-R",
				path,
				"log",
				"--no-graph",
				"-r",
				`ancestors(@, ${COMMITS_READ})`,
				"-T",
				'description.first_line() ++ "\\n"',
			],
			{ timeoutMs: COMMAND_TIMEOUT_MS },
		);
		return jj.exitCode === 0 ? prefixesFromSubjects(jj.stdout) : [];
	}

	/** The Jira site the host's `acli` is logged in to; undefined without acli or a login. Shared with the status reader. */
	async jiraLoginSite(): Promise<string | undefined> {
		if (this.#jiraLogin !== undefined && this.#now() - this.#jiraLogin.at < JIRA_LOGIN_TTL_MS) return this.#jiraLogin.site;
		this.#jiraLoginLooking ??= this.#run("acli", ["jira", "auth", "status"], { timeoutMs: 15_000 })
			.then((result) => {
				const site = result.exitCode === 0 ? jiraSiteFromAuthStatus(result.stdout + result.stderr) : undefined;
				this.#jiraLogin = { site, at: this.#now() };
				return site;
			})
			.finally(() => {
				this.#jiraLoginLooking = undefined;
			});
		return this.#jiraLoginLooking;
	}
}
