/** Task attribution and integration facts. All VCS reads are object/ref reads, never working-copy snapshots. */
import { execFile } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { childEnvironment } from "./child-environment.ts";
import { readJsonFile, writeJsonFile } from "./fs-json.ts";

export const TASK_CHANGES_FILE = "task-changes.json";
export type AttributionSource = "trailer" | "worker-declaration" | "workspace" | "manual";
export type ChangeContext = { threadId?: string; conversationId?: number; runId?: string };
export type TaskChange = ChangeContext & {
	taskId: string;
	source: AttributionSource;
	/** jj identity survives a rebase. Hashes describe only the latest observed version, not every rewrite. */
	changeId?: string;
	commits: string[];
};
export type AttributedCommit = { hash: string; subject: string; taskIds: string[]; changeId?: string; reverts?: string };
export type ChangesLanded = {
	/** Durable admission key. Consumers must deduplicate this: delivery is at least once after a crash. */
	id: string;
	projectId: string;
	repository: string;
	ref: string;
	previous: string;
	tip: string;
	at: string;
	taskIds: string[];
	commits: AttributedCommit[];
	removed: AttributedCommit[];
	/** A revert does not remove ancestry. Keep its semantic undo distinct from unreachable commits. */
	reverted: AttributedCommit[];
};

type WorkspaceBase = { base: string; taskId?: string; context?: ChangeContext };
export type TaskChangeLedger = {
	version: 1;
	projectId: string;
	repositories: Record<string, {
		ref?: string;
		tip?: string;
		sequence: number;
		changes: TaskChange[];
		facts: (ChangesLanded & { delivered?: boolean })[];
		workspaces: Record<string, WorkspaceBase>;
	}>;
};

function command(binary: string, args: string[], cwd: string): Promise<string> {
	return new Promise((accept, reject) => execFile(binary, args, {
		cwd, env: { ...childEnvironment(), GIT_OPTIONAL_LOCKS: "0" }, timeout: 10_000,
		maxBuffer: 8 * 1024 * 1024, encoding: "utf8",
	}, (error, stdout, stderr) => error ? reject(new Error(`${binary}: ${stderr.trim() || error.message}`)) : accept(stdout.trimEnd())));
}

/** Only the final trailer paragraph is interpreted; examples in the subject/body are not declarations. */
export function taskTrailers(message: string): string[] {
	const paragraph = message.trimEnd().split(/\r?\n\s*\r?\n/).at(-1) ?? "";
	if (!paragraph.split(/\r?\n/).every(line => /^[A-Za-z][A-Za-z0-9-]*:/.test(line) || /^[ \t]+\S/.test(line))) return [];
	const tasks: string[] = [];
	for (const line of paragraph.split(/\r?\n/)) {
		const match = /^(?:Aiki|Kemiri)-Task:[ \t]*(T[1-9]\d*(?:[ \t]*,[ \t]*T[1-9]\d*)*)[ \t]*$/i.exec(line);
		if (match) tasks.push(...(match[1] ?? "").toUpperCase().split(/\s*,\s*/));
	}
	return [...new Set(tasks)];
}

/** Git worktrees, colocated jj and jj's Git-backed non-colocated workspaces all use Git objects. */
export async function gitRepository(path: string): Promise<string | undefined> {
	try { return await realpath(await command("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], path)); } catch { /* jj workspace */ }
	try {
		const pointer = join(path, ".jj", "repo");
		const repo = await readFile(pointer, "utf8").then(text => resolve(path, ".jj", text.trim())).catch(() => pointer);
		const git = await realpath(join(repo, "store", "git"));
		await command("git", [`--git-dir=${git}`, "rev-parse", "--git-dir"], path);
		return git;
	} catch { return undefined; }
}

export type TaskChangeObserverOptions = {
	projectId: string;
	path: string;
	file: string;
	/** undefined/auto: main, then master; null: disabled; otherwise a full refs/heads/... or refs/... name. */
	integrationRef(): string | null | undefined;
	taskIds(): Promise<readonly string[]>;
	/** Internal integration seam for freshness and folded Delivery. Default no-op; no push/deploy claim. */
	onChangesLanded?(fact: ChangesLanded): Promise<void> | void;
	log(message: string): void;
	now?: () => number;
};

export class TaskChangeObserver {
	readonly #options: TaskChangeObserverOptions;
	#queue: Promise<unknown> = Promise.resolve();
	#timer: ReturnType<typeof setTimeout> | undefined;
	#stopped = false;
	constructor(options: TaskChangeObserverOptions) { this.#options = options; }

	async #ledger(): Promise<TaskChangeLedger> {
		const stored = await readJsonFile(this.#options.file) as TaskChangeLedger | undefined;
		if (stored && (stored.version !== 1 || stored.projectId !== this.#options.projectId)) throw new Error("Task change ledger scope/version mismatch");
		return stored ?? { version: 1, projectId: this.#options.projectId, repositories: {} };
	}
	#serialize<T>(work: () => Promise<T>): Promise<T> {
		const next = this.#queue.then(work);
		this.#queue = next.catch(() => undefined);
		return next;
	}
	#git(repo: string, args: string[]): Promise<string> { return command("git", [`--git-dir=${repo}`, ...args], this.#options.path); }
	async #resolve(repo: string, ref: string): Promise<string | undefined> {
		try { return await this.#git(repo, ["rev-parse", "--verify", `${ref}^{commit}`]); } catch { return undefined; }
	}
	async #ref(repo: string): Promise<string | undefined> {
		const configured = this.#options.integrationRef();
		if (configured === null) return undefined;
		if (configured && configured !== "auto") {
			if (!/^refs\/[A-Za-z0-9_./-]+$/.test(configured) || configured.includes("..")) throw new Error("Invalid integration ref");
			return configured;
		}
		for (const ref of ["refs/heads/main", "refs/heads/master"]) if (await this.#resolve(repo, ref)) return ref;
		return undefined;
	}
	async #commit(repo: string, hash: string): Promise<{ hash: string; subject: string; message: string; changeId?: string; reverts?: string }> {
		const message = await this.#git(repo, ["log", "-1", "--format=%B", hash, "--"]);
		let changeId: string | undefined;
		try {
			// --ignore-working-copy also disables automatic imports/snapshots in colocated repositories.
			const id = await command("jj", ["--ignore-working-copy", "log", "--no-graph", "-r", hash, "-T", "change_id"], this.#options.path);
			if (/^[k-z]{32}$/.test(id)) changeId = id;
		} catch { /* ordinary Git, or a commit not yet imported by jj */ }
		const reverts = /(?:^|\n)This reverts commit ([0-9a-f]{40,64})\./.exec(message)?.[1];
		return { hash, subject: message.split("\n")[0] ?? "", message, ...(changeId ? { changeId } : {}), ...(reverts ? { reverts } : {}) };
	}
	#valid(ids: readonly string[], known: readonly string[]): string[] {
		return ids.filter(id => {
			if (known.includes(id)) return true;
			this.#options.log(`task changes: ignored unknown task ${id}`);
			return false;
		});
	}
	#attribute(changes: TaskChange[], commit: { hash: string; changeId?: string }, taskIds: string[], source: AttributionSource, context: ChangeContext = {}): string[] {
		const matches = changes.filter(change => commit.changeId ? change.changeId === commit.changeId : change.commits.includes(commit.hash));
		const previousIds = [...new Set(matches.map(change => change.taskId))];
		if (matches.some(change => change.source === "manual") || (previousIds.length && taskIds.length && previousIds.slice().sort().join() !== taskIds.slice().sort().join())) {
			if (taskIds.length && previousIds.slice().sort().join() !== taskIds.slice().sort().join()) this.#options.log(`task changes: attribution conflict for ${commit.hash}; manual correction required`);
			taskIds = previousIds;
		}
		if (!taskIds.length) taskIds = previousIds;
		for (const id of taskIds) {
			const existing = matches.find(change => change.taskId === id);
			if (existing) {
				existing.commits = [commit.hash];
				if (source === "trailer" && existing.source === "workspace") existing.source = source;
			} else changes.push({ taskId: id, source, ...context, ...(commit.changeId ? { changeId: commit.changeId } : {}), commits: [commit.hash] });
		}
		return taskIds;
	}
	async #range(repo: string, from: string, to: string): Promise<string[]> {
		return (await this.#git(repo, ["rev-list", "--reverse", `${from}..${to}`, "--"])).split("\n").filter(Boolean);
	}
	async #deliver(ledger: TaskChangeLedger): Promise<void> {
		for (const repository of Object.values(ledger.repositories)) for (const fact of repository.facts) {
			if (fact.delivered) continue;
			await this.#options.onChangesLanded?.(fact);
			fact.delivered = true;
			await writeJsonFile(this.#options.file, ledger);
		}
	}

	/** No history reads on quiet polls. Initial attach/ref changes baseline without importing old history. */
	poll(): Promise<void> { return this.#serialize(async () => {
		const ledger = await this.#ledger();
		await this.#deliver(ledger);
		if (this.#options.integrationRef() === null) return;
		const repo = await gitRepository(this.#options.path);
		if (!repo) return;
		const ref = await this.#ref(repo);
		if (!ref) return;
		const tip = await this.#resolve(repo, ref);
		if (!tip) return;
		const state = ledger.repositories[repo] ??= { sequence: 0, changes: [], facts: [], workspaces: {} };
		if (!state.tip || state.ref !== ref) {
			state.ref = ref; state.tip = tip;
			await writeJsonFile(this.#options.file, ledger);
			return;
		}
		if (state.tip === tip) return;
		const known = await this.#options.taskIds();
		const commits: AttributedCommit[] = [], removed: AttributedCommit[] = [], reverted: AttributedCommit[] = [];
		const read = async (hash: string, attribute: boolean): Promise<AttributedCommit> => {
			const commit = await this.#commit(repo, hash);
			const explicit = this.#valid(taskTrailers(commit.message), known);
			const existing = state.changes.filter(change => change.commits.includes(hash)).map(change => change.taskId);
			const taskIds = attribute ? this.#attribute(state.changes, commit, explicit, "trailer") : (existing.length ? existing : explicit);
			return { hash, subject: commit.subject, taskIds, ...(commit.changeId ? { changeId: commit.changeId } : {}), ...(commit.reverts ? { reverts: commit.reverts } : {}) };
		};
		// Removed hashes must be read before an incoming rewrite replaces the ledger's hashes.
		for (const hash of await this.#range(repo, tip, state.tip)) removed.push(await read(hash, false));
		for (const hash of await this.#range(repo, state.tip, tip)) {
			const commit = await read(hash, true);
			if (commit.reverts && await this.#resolve(repo, commit.reverts)) {
				const original = await read(commit.reverts, false);
				reverted.push(original);
				if (!commit.taskIds.length) commit.taskIds = original.taskIds;
			}
			commits.push(commit);
		}
		state.sequence++;
		const taskIds = [...new Set([...commits, ...removed, ...reverted].flatMap(commit => commit.taskIds))];
		if (taskIds.length) state.facts.push({
			id: `${this.#options.projectId}:${repo}:${state.sequence}`, projectId: this.#options.projectId, repository: repo,
			ref, previous: state.tip, tip, at: new Date((this.#options.now ?? Date.now)()).toISOString(), taskIds,
			commits, removed, reverted,
		});
		state.tip = tip;
		await writeJsonFile(this.#options.file, ledger);
		await this.#deliver(ledger);
	}); }

	/** Verified deployment range, using the same ledger corrections and portable trailers as integration. */
	deploymentTasks(repository: string, previous: string | undefined, intended: string): Promise<string[]> { return this.#serialize(async () => {
		const repo = await gitRepository(this.#options.path);
		if (repo !== repository) throw new Error("Deploy repository scope mismatch");
		const verify = async (hash: string) => {
			if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(hash) || await this.#resolve(repo, hash) !== hash) throw new Error("Invalid deploy commit");
		};
		await verify(intended);
		if (!previous) return []; // No verified baseline: never backfill the repository's entire history.
		await verify(previous);
		const hashes = (await this.#git(repo, ["rev-list", "--max-count=2049", `${previous}..${intended}`, "--"])).split("\n").filter(Boolean);
		if (hashes.length > 2048) throw new Error("Deploy range exceeds 2048 commits");
		const ledger = await this.#ledger();
		const changes = ledger.repositories[repo]?.changes ?? [];
		const known = await this.#options.taskIds();
		const ids = new Set<string>();
		for (const hash of hashes) {
			const stored = changes.filter(change => change.commits.includes(hash));
			const attributed = stored.length ? stored.map(change => change.taskId) : taskTrailers(await this.#git(repo, ["log", "-1", "--format=%B", hash, "--"]));
			for (const id of this.#valid(attributed, known)) ids.add(id);
		}
		return [...ids];
	}); }

	/** Called immediately after workspace creation, before any worker runs. Never reconstruct a base from time. */
	rememberWorkspace(path: string): Promise<void> { return this.#serialize(async () => {
		const repo = await gitRepository(this.#options.path);
		if (!repo) return;
		const ledger = await this.#ledger();
		const state = ledger.repositories[repo] ??= { sequence: 0, changes: [], facts: [], workspaces: {} };
		const marker = join(path, ".jj", "aiki-task-base.json");
		const captured = await readJsonFile(marker) as { base: string } | undefined;
		if (state.workspaces[path] && captured?.base === state.workspaces[path].base) return;
		const base = await command("jj", ["--ignore-working-copy", "log", "--no-graph", "-r", "@-", "-T", "commit_id"], path);
		await writeJsonFile(marker, { base });
		state.workspaces[path] = { base };
		await writeJsonFile(this.#options.file, ledger);
	}); }

	/** Persist committed base→tip membership BEFORE forgetting/deleting a workspace. Missing bases never guess. */
	recordWorkspace(path: string, taskIds: readonly string[], context: ChangeContext = {}): Promise<void> { return this.#serialize(async () => {
		const repo = await gitRepository(this.#options.path);
		if (!repo) return;
		const ledger = await this.#ledger();
		const state = ledger.repositories[repo];
		const workspace = state?.workspaces[path];
		if (!state || !workspace) { this.#options.log("task changes: no recorded workspace base; provenance skipped"); return; }
		const known = await this.#options.taskIds();
		const fallback = taskIds.length === 1 ? this.#valid(taskIds, known) : [];
		// Exclude @ itself: uncommitted/snapshotted edits are not completed worker commits.
		const tip = await command("jj", ["--ignore-working-copy", "log", "--no-graph", "-r", "@-", "-T", "commit_id"], path);
		for (const hash of await this.#range(repo, workspace.base, tip)) {
			const commit = await this.#commit(repo, hash);
			const declared = taskTrailers(commit.message);
			const explicit = this.#valid(declared, known);
			// Invalid explicit declarations must not silently become fallback attribution.
			this.#attribute(state.changes, commit, declared.length ? explicit : fallback, declared.length ? "trailer" : "workspace", context);
		}
		workspace.taskId = fallback[0];
		workspace.context = context;
		await writeJsonFile(this.#options.file, ledger);
	}); }

	/** Cleanup completed: a later worker reusing the same directory must capture a new base. */
	forgetWorkspace(path: string): Promise<void> { return this.#serialize(async () => {
		const ledger = await this.#ledger();
		for (const state of Object.values(ledger.repositories)) delete state.workspaces[path];
		await writeJsonFile(this.#options.file, ledger);
	}); }

	/** Explicit declarations/corrections are trusted server-side APIs, but still verify repo objects and board IDs. */
	declareChanges(hashes: readonly string[], taskIds: readonly string[], source: "worker-declaration" | "manual", context: ChangeContext = {}): Promise<void> { return this.#serialize(async () => {
		const repo = await gitRepository(this.#options.path);
		if (!repo) throw new Error("No repository for task changes");
		const ledger = await this.#ledger();
		const state = ledger.repositories[repo] ??= { sequence: 0, changes: [], facts: [], workspaces: {} };
		const valid = this.#valid(taskIds, await this.#options.taskIds());
		for (const hash of hashes) {
			if (!/^[0-9a-f]{40,64}$/.test(hash) || await this.#resolve(repo, hash) !== hash) throw new Error("Unknown commit in task declaration");
			const commit = await this.#commit(repo, hash);
			if (source === "manual") state.changes = state.changes.filter(change => commit.changeId ? change.changeId !== commit.changeId : !change.commits.includes(hash));
			this.#attribute(state.changes, commit, valid, source, context);
		}
		await writeJsonFile(this.#options.file, ledger);
	}); }

	async start(): Promise<void> {
		await this.poll().catch(error => this.#options.log(`task changes: ${String(error)}`));
		const arm = (): void => {
			if (this.#stopped) return;
			this.#timer = setTimeout(() => { void this.poll().catch(error => this.#options.log(`task changes: ${String(error)}`)).finally(arm); }, 10_000);
			this.#timer.unref?.();
		};
		arm();
	}
	async stop(): Promise<void> { this.#stopped = true; clearTimeout(this.#timer); await this.#queue; }
}
