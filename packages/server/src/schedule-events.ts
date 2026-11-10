/**
 * Event triggers for schedules: a schedule whose rule is `github-review-requested` runs when someone requests a review
 * of a pull request from the account the backend's `gh` is logged in as (directly, or through a team of it). The design
 * is in docs/DESIGN.md ("Event triggers"); this file holds the three parts that are not the schedule itself:
 *
 * - `GithubReviewReader` reads the account's open review requests with one `gh api graphql` call.
 * - `ScheduleEventStore` persists, per schedule, which requests were already handled (`schedule-events.json` next to
 *   the project's `schedules.json`), so a restart or a repeated poll never fires the same request twice.
 * - `ScheduleEventPoller` is the server-level loop: every 2 minutes, only while an enabled event schedule exists, it
 *   reads GitHub once, routes each request to the schedules that listen to its repository, and starts a run for each
 *   request not seen before. Opening a project is the `fire` callback's job and happens only for a request to run.
 *
 * A poll that fails changes nothing: it is logged, its message is kept for the app, and the next tick tries again.
 */
import type { SetTimer } from "@earendil-works/pi-durable";
import type { Schedule, ScheduleRun } from "@aiki/protocol";
import { isEventSpec } from "@aiki/protocol";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { errorMessage } from "./errors.ts";
import { readJsonFile, writeJsonFile } from "./fs-json.ts";
import { type RunCommand, runHostCommand } from "./host-commands.ts";
import type { ProjectStore } from "./projects.ts";
import type { ScheduleStore } from "./schedules.ts";

/** The file, next to `schedules.json`, holding the review requests each event schedule has handled. */
export const SCHEDULE_EVENTS_FILE = "schedule-events.json";
/** How often GitHub is read while an enabled event schedule exists. */
export const GITHUB_REVIEW_POLL_MS = 2 * 60_000;
/** How long a handled request is remembered after it was last seen open. */
export const SEEN_KEEP_MS = 7 * 24 * 60 * 60_000;
/** How long the account's teams are remembered; a team change takes up to this long to be noticed. */
const TEAMS_TTL_MS = 60 * 60_000;
/** How long a team lookup that failed is not repeated. */
const TEAMS_FAILURE_TTL_MS = 10 * 60_000;
const SEARCH_TIMEOUT_MS = 45_000;
/** The most pull requests one poll reads, newest updated first. */
const SEARCH_PAGE = 100;
/** The most review-request events read per pull request, newest last. */
const EVENTS_PER_PULL_REQUEST = 30;

// --- what a request is --------------------------------------------------------------------------------------------

/** One new review request from the account, with what the run needs to know about the pull request. */
export type ReviewRequest = {
	/** `<owner/repo>#<number>@<event id>`: one per request event, so a re-request is a new key. */
	key: string;
	/** "owner/name" as GitHub spells it. */
	repo: string;
	number: number;
	url: string;
	title: string;
	author: string | null;
	baseBranch: string;
	headBranch: string;
	headSha: string;
	draft: boolean;
	/** ISO 8601, when GitHub recorded the request. */
	requestedAt: string;
	/** Who was asked: the account (`user`, its login) or one of its teams (`team`, "org/slug"). */
	requested: { kind: "user" | "team"; name: string };
};

export type ReviewRequestsRead = { ok: true; requests: ReviewRequest[] } | { ok: false; message: string };

const SEARCH_QUERY = `query {
  viewer { login }
  search(query: "is:pr is:open review-requested:@me archived:false sort:updated-desc", type: ISSUE, first: ${SEARCH_PAGE}) {
    nodes {
      ... on PullRequest {
        number url title isDraft baseRefName headRefName headRefOid
        repository { nameWithOwner }
        author { login }
        reviewRequests(first: 50) { nodes { requestedReviewer { __typename ... on User { login } ... on Team { slug organization { login } } } } }
        timelineItems(itemTypes: [REVIEW_REQUESTED_EVENT], last: ${EVENTS_PER_PULL_REQUEST}) {
          nodes { __typename ... on ReviewRequestedEvent { id createdAt requestedReviewer { __typename ... on User { login } ... on Team { slug organization { login } } } } }
        }
      }
    }
  }
}`;

type Reviewer = { kind: "user" | "team"; name: string };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** "sample-user" or "acme/frontend-admins"; undefined for a reviewer the query did not describe (a bot, a ghost). */
function reviewerOf(value: unknown): Reviewer | undefined {
	if (!isRecord(value)) return undefined;
	if (value.__typename === "Team") {
		const slug = text(value.slug);
		const org = isRecord(value.organization) ? text(value.organization.login) : undefined;
		return slug === undefined ? undefined : { kind: "team", name: org === undefined ? slug : `${org}/${slug}` };
	}
	const login = text(value.login);
	return login === undefined ? undefined : { kind: "user", name: login };
}

const sameReviewer = (left: Reviewer, right: Reviewer): boolean =>
	left.kind === right.kind && left.name.toLowerCase() === right.name.toLowerCase();

/**
 * The account's open review requests from a `gh api graphql` answer, one per pull request: the latest request event
 * whose reviewer is the account or one of its teams and who is still asked. If no pending reviewer is recognisably the
 * account's (the teams could not be read, or the account is in a parent team) it falls back to the latest event of any
 * pending team request: the search matched, so some request is the account's.
 */
export function reviewRequestsFrom(output: unknown, teams: readonly string[] | undefined): ReviewRequestsRead {
	if (!isRecord(output) || !isRecord(output.data)) {
		const first = isRecord(output) && Array.isArray(output.errors) && isRecord(output.errors[0]) ? text(output.errors[0].message) : undefined;
		return { ok: false, message: first === undefined ? "GitHub's answer had no data" : `GitHub: ${first}` };
	}
	const viewer = isRecord(output.data.viewer) ? text(output.data.viewer.login) : undefined;
	const search = output.data.search;
	if (viewer === undefined || !isRecord(search) || !Array.isArray(search.nodes)) {
		return { ok: false, message: "GitHub's answer was not the review search" };
	}
	const mine = (reviewer: Reviewer): boolean =>
		reviewer.kind === "user"
			? reviewer.name.toLowerCase() === viewer.toLowerCase()
			: (teams ?? []).some((team) => team.toLowerCase() === reviewer.name.toLowerCase());
	const requests: ReviewRequest[] = [];
	for (const node of search.nodes) {
		if (!isRecord(node)) continue;
		const repo = isRecord(node.repository) ? text(node.repository.nameWithOwner) : undefined;
		const number = typeof node.number === "number" ? node.number : undefined;
		const url = text(node.url);
		if (repo === undefined || number === undefined || url === undefined) continue;
		const pending: Reviewer[] = [];
		if (isRecord(node.reviewRequests) && Array.isArray(node.reviewRequests.nodes)) {
			for (const entry of node.reviewRequests.nodes) {
				const reviewer = isRecord(entry) ? reviewerOf(entry.requestedReviewer) : undefined;
				if (reviewer !== undefined) pending.push(reviewer);
			}
		}
		const events: { id: string; at: string; reviewer: Reviewer }[] = [];
		if (isRecord(node.timelineItems) && Array.isArray(node.timelineItems.nodes)) {
			for (const entry of node.timelineItems.nodes) {
				if (!isRecord(entry)) continue;
				const id = text(entry.id);
				const at = text(entry.createdAt);
				const reviewer = reviewerOf(entry.requestedReviewer);
				if (id !== undefined && at !== undefined && reviewer !== undefined) events.push({ id, at, reviewer });
			}
		}
		const stillAsked = (event: { reviewer: Reviewer }): boolean => pending.some((reviewer) => sameReviewer(reviewer, event.reviewer));
		const candidates = events.filter((event) => stillAsked(event) && mine(event.reviewer));
		const chosen = (candidates.length > 0 ? candidates : events.filter((event) => stillAsked(event) && event.reviewer.kind === "team")).at(-1);
		if (chosen === undefined) continue;
		requests.push({
			key: `${repo}#${number}@${chosen.id}`,
			repo,
			number,
			url,
			title: text(node.title) ?? `${repo}#${number}`,
			author: isRecord(node.author) ? (text(node.author.login) ?? null) : null,
			baseBranch: text(node.baseRefName) ?? "",
			headBranch: text(node.headRefName) ?? "",
			headSha: text(node.headRefOid) ?? "",
			draft: node.isDraft === true,
			requestedAt: new Date(Date.parse(chosen.at)).toISOString(),
			requested: chosen.reviewer,
		});
	}
	return { ok: true, requests };
}

export type GithubReviewReaderOptions = {
	/** Default: `runHostCommand`. */
	run?: RunCommand;
	/** Default: `Date.now`. */
	now?: () => number;
};

/** Reads the open review requests of the account `gh` is logged in as. Never throws. */
export class GithubReviewReader {
	readonly #run: RunCommand;
	readonly #now: () => number;
	#teams: { names: string[] | undefined; at: number } | undefined;

	constructor(options: GithubReviewReaderOptions = {}) {
		this.#run = options.run ?? runHostCommand;
		this.#now = options.now ?? Date.now;
	}

	async read(): Promise<ReviewRequestsRead> {
		const teams = await this.#teamNames();
		const result = await this.#run("gh", ["api", "graphql", "-f", `query=${SEARCH_QUERY}`], { timeoutMs: SEARCH_TIMEOUT_MS });
		if (result.missing) return { ok: false, message: "gh is not installed on this backend" };
		let output: unknown;
		try {
			output = JSON.parse(result.stdout);
		} catch {
			const reason = (result.stderr || result.stdout).trim().split("\n")[0] ?? "";
			return {
				ok: false,
				message:
					result.exitCode === 0
						? "gh answered something that is not JSON"
						: `gh failed${result.exitCode === null ? " (timed out)" : ""}${reason.length > 0 ? `: ${reason.slice(0, 200)}` : ""}`,
			};
		}
		return reviewRequestsFrom(output, teams);
	}

	/** The account's teams as "org/slug", or undefined when they cannot be read (the fallback in `reviewRequestsFrom` applies). */
	async #teamNames(): Promise<string[] | undefined> {
		const known = this.#teams;
		if (known !== undefined && this.#now() - known.at < (known.names === undefined ? TEAMS_FAILURE_TTL_MS : TEAMS_TTL_MS)) {
			return known.names;
		}
		const result = await this.#run("gh", ["api", "--paginate", "user/teams", "--jq", '.[] | .organization.login + "/" + .slug'], {
			timeoutMs: SEARCH_TIMEOUT_MS,
		});
		const names =
			result.exitCode === 0
				? result.stdout
						.split("\n")
						.map((line) => line.trim())
						.filter((line) => line.length > 0)
				: undefined;
		this.#teams = { names, at: this.#now() };
		return names;
	}
}

// --- what a run is made of ----------------------------------------------------------------------------------------

function slug(value: string, max: number): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, max)
		.replace(/-+$/g, "");
}

/** The suffix a run started by hand on an already handled request adds, so it is a new run and not the old one found again. */
export type EventRunKind = { rerunAt?: number };

/**
 * The identity of one event run: the worker or thread ID, and the key the reporter's request IDs derive from. Both come
 * from the schedule, the pull request and the request time, so a retried event finds what it already started.
 */
export function eventRunIdentity(scheduleId: string, request: ReviewRequest, kind: EventRunKind = {}): { id: string; key: string } {
	const key = `event:${request.repo}#${request.number}@${request.requestedAt}${kind.rerunAt === undefined ? "" : `+manual${new Date(kind.rerunAt).toISOString()}`}`;
	const hash = createHash("sha256").update(`${scheduleId}\n${key}`).digest("hex").slice(0, 8);
	const id = [slug(scheduleId, 14), slug(request.repo.replace("/", "-"), 14), String(request.number), hash]
		.filter((part) => part.length > 0)
		.join("-");
	return { id, key };
}

/** The task's title: a plain outcome, with the pull request's own title. */
export function eventTaskTitle(request: ReviewRequest): string {
	return `Review PR: ${request.title}`.slice(0, 120);
}

/** Who was asked, in words. */
function requestedWords(request: ReviewRequest): string {
	return request.requested.kind === "team" ? `team ${request.requested.name}` : `${request.requested.name} (you)`;
}

/** The task's description, which also identifies the request, so a retry finds the task it already made. */
export function eventTaskDescription(request: ReviewRequest, marker: string): string {
	return [
		`A review was requested from you on ${request.url} (${requestedWords(request)}).`,
		"The agent reads the pull request and keeps its findings in this task's report. Nothing is posted to GitHub until you approve it here.",
		"",
		marker,
	].join("\n");
}

/** The line of a task's description that names the request (and a by-hand run) it was made for. */
export function eventTaskMarker(request: ReviewRequest, kind: EventRunKind = {}): string {
	return `Review requested at ${request.requestedAt}${kind.rerunAt === undefined ? "" : `; run by hand at ${new Date(kind.rerunAt).toISOString()}`}.`;
}

/** The fixed block the harness appends to the user's brief. Only the facts vary, so prompts stay byte-stable. */
export function eventBriefBlock(request: ReviewRequest): string {
	return [
		"---",
		"Event: a review was requested on a GitHub pull request.",
		`Pull request: ${request.url}`,
		`Repository: ${request.repo}`,
		`Number: ${request.number}`,
		`Title: ${request.title}`,
		`Author: ${request.author ?? "unknown"}`,
		`Base branch: ${request.baseBranch}`,
		`Head branch: ${request.headBranch}`,
		`Head commit: ${request.headSha}`,
		`Review requested from: ${requestedWords(request)}`,
		`Requested at: ${request.requestedAt}`,
		"Nothing is posted to GitHub (no review, comment, approval or push) until the user explicitly approves it on the task.",
	].join("\n");
}

/** The brief of an event run: the user's brief, then the event. */
export function eventBrief(brief: string, request: ReviewRequest): string {
	return `${brief.trimEnd()}\n\n${eventBriefBlock(request)}`;
}

// --- routing -------------------------------------------------------------------------------------------------------

/** The repositories a schedule listens in: its own list, else the project's; empty means every repository. */
export function listenedRepos(own: readonly string[] | undefined, project: readonly string[]): string[] {
	const chosen = own !== undefined && own.length > 0 ? own : project;
	return [...new Set(chosen.map((repo) => repo.toLowerCase()))].sort();
}

const inRepos = (repos: readonly string[], request: ReviewRequest): boolean =>
	repos.length === 0 || repos.includes(request.repo.toLowerCase());

// --- what was handled ----------------------------------------------------------------------------------------------

type SeenState = {
	/** The repositories the schedule listened in when this was written; a different set starts over from a baseline. */
	scope: string;
	/** Request key to the last time it was still open (ISO 8601). */
	seen: Record<string, string>;
};

type EventsFile = { version: 1; schedules: Record<string, SeenState> };

/** Per project: which requests each event schedule has handled. One small file next to `schedules.json`. */
export class ScheduleEventStore {
	readonly #projects: ProjectStore;
	readonly #log: (message: string) => void;
	readonly #cache = new Map<string, EventsFile>();
	#queue: Promise<unknown> = Promise.resolve();

	constructor(options: { projects: ProjectStore; log?: (message: string) => void }) {
		this.#projects = options.projects;
		this.#log = options.log ?? ((message) => console.log(message));
	}

	fileOf(projectId: string): string {
		return join(this.#projects.projectDir(projectId), SCHEDULE_EVENTS_FILE);
	}

	async get(projectId: string, scheduleId: string): Promise<SeenState | undefined> {
		return (await this.#load(projectId)).schedules[scheduleId];
	}

	/** The schedule IDs a project has state for. */
	async ids(projectId: string): Promise<string[]> {
		return Object.keys((await this.#load(projectId)).schedules);
	}

	async set(projectId: string, scheduleId: string, state: SeenState): Promise<void> {
		await this.#write(projectId, (file) => {
			file.schedules[scheduleId] = state;
		});
	}

	/** Forget a schedule: it was deleted or disabled, so turning it on starts from a baseline again. */
	async forget(projectId: string, scheduleId: string): Promise<void> {
		if ((await this.get(projectId, scheduleId)) === undefined) return;
		await this.#write(projectId, (file) => {
			delete file.schedules[scheduleId];
		});
	}

	async #load(projectId: string): Promise<EventsFile> {
		const cached = this.#cache.get(projectId);
		if (cached !== undefined) return cached;
		let file: EventsFile = { version: 1, schedules: {} };
		try {
			const value = await readJsonFile(this.fileOf(projectId));
			if (isRecord(value) && isRecord(value.schedules)) {
				for (const [id, entry] of Object.entries(value.schedules)) {
					if (!isRecord(entry) || typeof entry.scope !== "string" || !isRecord(entry.seen)) continue;
					const seen: Record<string, string> = {};
					for (const [key, at] of Object.entries(entry.seen)) if (typeof at === "string") seen[key] = at;
					file.schedules[id] = { scope: entry.scope, seen };
				}
			}
		} catch (error) {
			this.#log(`project ${projectId}: schedule-events.json is unreadable, starting from a baseline: ${errorMessage(error)}`);
			file = { version: 1, schedules: {} };
		}
		this.#cache.set(projectId, file);
		return file;
	}

	async #write(projectId: string, change: (file: EventsFile) => void): Promise<void> {
		const run = this.#queue.then(async () => {
			const file = await this.#load(projectId);
			change(file);
			await writeJsonFile(this.fileOf(projectId), file, 0o600);
		});
		this.#queue = run.catch(() => undefined);
		return run;
	}
}

// --- the poller ----------------------------------------------------------------------------------------------------

/** How `fire` was asked: by the poll (`event`) or by hand (`manual`), and whether the request had been handled before. */
export type FireEventOptions = { trigger: "event" | "manual"; rerunAt?: number };

export type ScheduleEventPollerOptions = {
	store: ScheduleStore;
	events: ScheduleEventStore;
	projects: ProjectStore;
	reader: GithubReviewReader;
	/** The project's own GitHub repositories ("owner/name"), as its link settings say. */
	projectRepos: (projectId: string) => Promise<string[]>;
	/** Open the project and start the run of one request; resolves with the run, throws when the project cannot open. */
	fire: (projectId: string, scheduleId: string, request: ReviewRequest, options: FireEventOptions) => Promise<ScheduleRun>;
	/** Default: `GITHUB_REVIEW_POLL_MS`. */
	intervalMs?: number;
	/** Default: `Date.now`. */
	now?: () => number;
	/** Default: `setTimeout`. */
	setTimer?: SetTimer;
	log?: (message: string) => void;
};

type Target = { projectId: string; schedule: Schedule };

/**
 * The backend's one poll of GitHub for event schedules. `wake()` re-reads the schedules (after a save or delete) and
 * arms or disarms the timer; `poll()` is one tick. Everything is serialized, so a tick, a Run now and a wake never
 * interleave.
 */
export class ScheduleEventPoller {
	readonly #options: ScheduleEventPollerOptions;
	readonly #now: () => number;
	readonly #setTimer: SetTimer;
	readonly #interval: number;
	readonly #log: (message: string) => void;
	#disarm: (() => void) | undefined;
	#chain: Promise<unknown> = Promise.resolve();
	#stopped = true;

	constructor(options: ScheduleEventPollerOptions) {
		this.#options = options;
		this.#now = options.now ?? Date.now;
		this.#interval = options.intervalMs ?? GITHUB_REVIEW_POLL_MS;
		this.#setTimer =
			options.setTimer ??
			((callback, delayMs) => {
				const timer = setTimeout(callback, delayMs);
				timer.unref?.();
				return () => clearTimeout(timer);
			});
		this.#log = options.log ?? ((message) => console.log(message));
	}

	/**
	 * Start listening: poll at once if an enabled event schedule exists (so a request made while the server was off does
	 * not wait two minutes), and then every interval. Does not wait for GitHub.
	 */
	start(): void {
		this.#stopped = false;
		void this.poll().catch(() => undefined);
	}

	stop(): void {
		this.#stopped = true;
		this.#disarm?.();
		this.#disarm = undefined;
	}

	/**
	 * Something changed in the schedules: drop the state of schedules that are gone or off, then arm the timer if an
	 * enabled event schedule exists (and poll now when one has no baseline yet, so enabling does not wait two minutes).
	 */
	async wake(): Promise<void> {
		await this.#queue(async () => {
			if (this.#stopped) return;
			const targets = await this.#reconcile();
			if (targets.length === 0) {
				this.#disarm?.();
				this.#disarm = undefined;
				return;
			}
			let fresh = false;
			for (const { projectId, schedule } of targets) {
				if ((await this.#options.events.get(projectId, schedule.id)) === undefined) fresh = true;
			}
			if (fresh) await this.#tick(targets);
			else this.#arm();
		});
	}

	/** One tick: read GitHub once and run what is new. A no-op without an enabled event schedule. */
	async poll(): Promise<void> {
		await this.#queue(async () => {
			const targets = await this.#reconcile();
			if (targets.length === 0) return;
			await this.#tick(targets);
		});
	}

	/**
	 * Run now: read GitHub at once and run every request of this schedule not handled yet; if there is none, the newest
	 * open one again (a new run); if none is open, record a skipped run. Resolves with the newest run.
	 */
	async runNow(projectId: string, scheduleId: string): Promise<ScheduleRun> {
		return this.#queue(async () => {
			const schedule = await this.#options.store.find(projectId, scheduleId);
			if (schedule === undefined || !isEventSpec(schedule.spec)) {
				throw new Error(`Schedule "${scheduleId}" does not listen for events`);
			}
			const at = new Date(this.#now()).toISOString();
			const read = await this.#options.reader.read();
			if (!read.ok) {
				this.#log(`project ${projectId}: schedule ${scheduleId}: GitHub could not be read: ${read.message}`);
				await this.#options.store.recordEventState(projectId, scheduleId, { checkedAt: at, error: read.message });
				return this.#record(projectId, scheduleId, { at, trigger: "manual", outcome: "failed", workerId: null, message: read.message });
			}
			await this.#options.store.recordEventState(projectId, scheduleId, { checkedAt: at, error: null });
			const repos = listenedRepos(schedule.spec.repos, await this.#options.projectRepos(projectId));
			const matching = read.requests.filter((request) => inRepos(repos, request));
			const state = await this.#options.events.get(projectId, scheduleId);
			const unhandled = state === undefined ? [] : matching.filter((request) => state.seen[request.key] === undefined);
			const newestFirst = (requests: ReviewRequest[]): ReviewRequest[] =>
				[...requests].sort((left, right) => Date.parse(right.requestedAt) - Date.parse(left.requestedAt));
			if (unhandled.length === 0 && matching.length === 0) {
				return this.#record(projectId, scheduleId, {
					at,
					trigger: "manual",
					outcome: "skipped",
					workerId: null,
					message: "no open review requests from you",
				});
			}
			const runs: ScheduleRun[] = [];
			if (unhandled.length > 0) {
				// The genuine events, oldest first, so the newest run is the one the answer carries.
				for (const request of newestFirst(unhandled).reverse()) {
					runs.push(await this.#options.fire(projectId, scheduleId, request, { trigger: "manual" }));
					await this.#markSeen(projectId, schedule, repos, request.key);
				}
				return runs.at(-1) as ScheduleRun;
			}
			const newest = newestFirst(matching)[0] as ReviewRequest;
			return this.#options.fire(projectId, scheduleId, newest, { trigger: "manual", rerunAt: this.#now() });
		});
	}

	async #queue<T>(work: () => Promise<T>): Promise<T> {
		const run = this.#chain.then(work);
		this.#chain = run.catch((error: unknown) => {
			this.#log(`schedule events: ${errorMessage(error)}`);
		});
		return run;
	}

	/** Every enabled event schedule; the state of any schedule that is gone, off, or no longer an event rule is dropped. */
	async #reconcile(): Promise<Target[]> {
		const targets: Target[] = [];
		for (const project of await this.#options.projects.list()) {
			// An archived project listens to nothing, and forgets what it had seen, so unarchiving starts from a baseline.
			const schedules = project.archived === true ? [] : await this.#options.store.list(project.id);
			const listening = new Set<string>();
			for (const schedule of schedules) {
				if (schedule.enabled && isEventSpec(schedule.spec)) {
					targets.push({ projectId: project.id, schedule });
					listening.add(schedule.id);
				}
			}
			for (const id of await this.#options.events.ids(project.id)) {
				if (!listening.has(id)) await this.#options.events.forget(project.id, id);
			}
		}
		return targets;
	}

	#arm(): void {
		this.#disarm?.();
		this.#disarm = undefined;
		if (this.#stopped) return;
		this.#disarm = this.#setTimer(
			() => {
				this.#disarm = undefined;
				void this.poll().catch(() => undefined);
			},
			this.#interval,
			{ background: false },
		);
	}

	async #tick(targets: Target[]): Promise<void> {
		try {
			await this.#check(targets);
		} finally {
			this.#arm();
		}
	}

	async #check(targets: Target[]): Promise<void> {
		const checkedAt = new Date(this.#now()).toISOString();
		const read = await this.#options.reader.read();
		if (!read.ok) {
			this.#log(`schedule events: GitHub could not be read: ${read.message}`);
			for (const { projectId, schedule } of targets) {
				await this.#options.store.recordEventState(projectId, schedule.id, { checkedAt, error: read.message });
			}
			return;
		}
		for (const { projectId, schedule } of targets) {
			if (!isEventSpec(schedule.spec)) continue;
			// Archived while this tick was reading GitHub: nothing fires for it.
			if ((await this.#options.projects.load(projectId))?.archived === true) continue;
			let error: string | null = null;
			try {
				const repos = listenedRepos(schedule.spec.repos, await this.#options.projectRepos(projectId));
				const matching = read.requests.filter((request) => inRepos(repos, request));
				const state = await this.#options.events.get(projectId, schedule.id);
				const scope = JSON.stringify(repos);
				if (state === undefined || state.scope !== scope) {
					// First look, or a different set of repositories: what is open now is the baseline, not news.
					const seen: Record<string, string> = {};
					for (const request of matching) seen[request.key] = checkedAt;
					await this.#options.events.set(projectId, schedule.id, { scope, seen });
				} else {
					const news = matching
						.filter((request) => state.seen[request.key] === undefined)
						.sort((left, right) => Date.parse(left.requestedAt) - Date.parse(right.requestedAt));
					for (const request of news) {
						try {
							await this.#options.fire(projectId, schedule.id, request, { trigger: "event" });
						} catch (fireError) {
							// Not seen: the next tick tries again.
							error = `Could not start the run for ${request.repo}#${request.number}: ${errorMessage(fireError)}`;
							this.#log(`project ${projectId}: schedule ${schedule.id}: ${error}`);
							continue;
						}
						await this.#markSeen(projectId, schedule, repos, request.key);
					}
					await this.#refresh(projectId, schedule, repos, matching, checkedAt);
				}
			} catch (checkError) {
				error = errorMessage(checkError);
				this.#log(`project ${projectId}: schedule ${schedule.id}: ${error}`);
			}
			await this.#options.store.recordEventState(projectId, schedule.id, { checkedAt, error });
		}
	}

	async #markSeen(projectId: string, schedule: Schedule, repos: readonly string[], key: string): Promise<void> {
		const state = (await this.#options.events.get(projectId, schedule.id)) ?? { scope: JSON.stringify(repos), seen: {} };
		await this.#options.events.set(projectId, schedule.id, {
			scope: state.scope,
			seen: { ...state.seen, [key]: new Date(this.#now()).toISOString() },
		});
	}

	/** Stamp what is still open as seen now, and drop what has not been open for a week. */
	async #refresh(projectId: string, schedule: Schedule, repos: readonly string[], open: readonly ReviewRequest[], checkedAt: string): Promise<void> {
		const state = await this.#options.events.get(projectId, schedule.id);
		if (state === undefined) return;
		const seen: Record<string, string> = {};
		const cutoff = this.#now() - SEEN_KEEP_MS;
		for (const [key, at] of Object.entries(state.seen)) if (Date.parse(at) >= cutoff) seen[key] = at;
		for (const request of open) if (seen[request.key] !== undefined) seen[request.key] = checkedAt;
		await this.#options.events.set(projectId, schedule.id, { scope: JSON.stringify(repos), seen });
	}

	async #record(projectId: string, scheduleId: string, run: ScheduleRun): Promise<ScheduleRun> {
		await this.#options.store.recordRun(projectId, scheduleId, run, { sameSlot: false });
		return run;
	}
}
