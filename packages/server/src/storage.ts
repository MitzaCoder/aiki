/**
 * Project storage: what a project's worker workspaces and background-thread checkouts take on disk, and removing the
 * finished ones (`projects.storage`, `projects.storage.clean`).
 *
 * The items are the directories themselves, not the records: main's worker workspaces (`<project>/workspaces/<worker>`),
 * each thread's checkout (`<project>/threads/<thread>/checkout`) and its workers' workspaces
 * (`<project>/threads/<thread>/workers/<worker>`). A directory whose worker the list no longer remembers is listed too,
 * since that is exactly what piles up. Removable: a worker that was forgotten (`done`) or is unknown, or whose thread is
 * done, stopped or archived and that does not run; a thread that is done, stopped or archived. Sizes come from an
 * asynchronous walk and are cached for a few minutes, so a request never blocks the event loop on a big tree.
 */
import { MAIN_THREAD_ID, type StorageItem } from "@kemiri/protocol";
import type { Dirent } from "node:fs";
import { lstat, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ConversationId } from "@earendil-works/pi-durable";
import { errorMessage } from "./errors.ts";
import { jjRoot, removeJjWorkspace } from "./jj.ts";
import type { ThreadRecord, ThreadService } from "./threads.ts";
import { type WorkerRecord, type WorkerService, WorkersDoc } from "./workers.ts";

/** How long a measured size is reused. */
export const STORAGE_CACHE_MS = 3 * 60_000;
/** A directory no worker claims is only removable once it is this old: a spawn creates it before it records the worker. */
export const ORPHAN_GRACE_MS = 10 * 60_000;

/** One directory and everything known about it, before its size. */
type Candidate = {
	id: string;
	kind: "worker" | "thread";
	label: string;
	path: string;
	removable: boolean;
	/** Why it may not be removed, when it may not. */
	reason: string | null;
	updatedAt: string;
	/** How to remove it: the jj workspace to forget, if any, and the record to update. */
	jjName: string | null;
	threadId: string;
	worker: { conversationId: number; workerId: string } | null;
};

async function directories(path: string): Promise<Dirent[]> {
	try {
		return (await readdir(path, { withFileTypes: true })).filter((entry) => entry.isDirectory());
	} catch {
		return [];
	}
}

/**
 * The bytes a tree takes on disk, symlinks not followed. Each directory's entries are read and measured in one batch
 * of awaits, so a large tree yields to the event loop all along.
 */
export async function treeBytes(path: string): Promise<number> {
	let total = 0;
	const pending = [path];
	while (pending.length > 0) {
		const directory = pending.pop() as string;
		let entries: Dirent[];
		try {
			entries = await readdir(directory, { withFileTypes: true });
		} catch {
			continue;
		}
		const sizes = await Promise.all(
			entries.map(async (entry) => {
				const child = join(directory, entry.name);
				if (entry.isDirectory()) pending.push(child);
				try {
					const info = await lstat(child);
					return info.blocks > 0 ? info.blocks * 512 : info.size;
				} catch {
					return 0;
				}
			}),
		);
		for (const size of sizes) total += size;
	}
	return total;
}

function isFinishedThread(record: ThreadRecord | undefined): boolean {
	return record !== undefined && (record.archived || record.status === "done" || record.status === "stopped");
}

export type ProjectStorageOptions = {
	/** The project checkout, whose jj repository the workspaces belong to. */
	projectPath: () => string;
	/** Main's worker workspaces. */
	workspacesDir: string;
	/** Every background thread's directory: its checkout and its workers' workspaces. */
	threadsDir: string;
	workers: WorkerService;
	threads: ThreadService;
	now: () => number;
	log: (message: string) => void;
};

export class ProjectStorage {
	readonly #options: ProjectStorageOptions;
	readonly #sizes = new Map<string, { bytes: number; at: number }>();
	/** One clean or archive removal at a time, so two never fight over the same directory. */
	#removing: Promise<unknown> = Promise.resolve();

	constructor(options: ProjectStorageOptions) {
		this.#options = options;
	}

	async list(): Promise<{ totalBytes: number; items: StorageItem[]; measuredAt: string }> {
		const candidates = await this.#candidates();
		const now = this.#options.now();
		const items: StorageItem[] = [];
		let measuredAt = now;
		for (const candidate of candidates) {
			const bytes = await this.#size(candidate.path, now);
			measuredAt = Math.min(measuredAt, bytes.at);
			items.push({
				id: candidate.id,
				kind: candidate.kind,
				label: candidate.label,
				path: candidate.path,
				bytes: bytes.bytes,
				removable: candidate.removable,
				updatedAt: candidate.updatedAt,
			});
		}
		items.sort((left, right) => right.bytes - left.bytes || left.id.localeCompare(right.id));
		return {
			totalBytes: items.reduce((sum, item) => sum + item.bytes, 0),
			items,
			measuredAt: new Date(measuredAt).toISOString(),
		};
	}

	/** Remove the named items, or every removable one; the state is read again first, so a running one is refused. */
	async clean(itemIds?: readonly string[]): Promise<{
		removed: string[];
		freedBytes: number;
		refused: { id: string; reason: string }[];
	}> {
		const run = this.#removing.then(async () => {
			const candidates = new Map((await this.#candidates()).map((candidate) => [candidate.id, candidate]));
			const wanted = itemIds ?? [...candidates.values()].filter((candidate) => candidate.removable).map((candidate) => candidate.id);
			const removed: string[] = [];
			const refused: { id: string; reason: string }[] = [];
			let freedBytes = 0;
			for (const id of wanted) {
				const candidate = candidates.get(id);
				if (candidate === undefined) {
					refused.push({ id, reason: "No such workspace." });
					continue;
				}
				if (!candidate.removable) {
					refused.push({ id, reason: candidate.reason ?? "It is still in use." });
					continue;
				}
				const bytes = await this.#size(candidate.path, this.#options.now());
				try {
					await this.#remove(candidate);
				} catch (error) {
					refused.push({ id, reason: `Could not remove it: ${errorMessage(error)}` });
					continue;
				}
				removed.push(id);
				freedBytes += bytes.bytes;
			}
			return { removed, freedBytes, refused };
		});
		this.#removing = run.catch(() => undefined);
		return run;
	}

	/** An archived thread's checkout and its workers' workspaces go with it; running workers are left alone. */
	async removeThread(threadId: string): Promise<void> {
		const run = this.#removing.then(async () => {
			for (const candidate of await this.#candidates()) {
				if (candidate.threadId !== threadId || !candidate.removable) continue;
				await this.#remove(candidate).catch((error: unknown) => {
					this.#options.log(`storage: could not remove ${candidate.path}: ${errorMessage(error)}`);
				});
			}
		});
		this.#removing = run.catch(() => undefined);
		return run;
	}

	async #size(path: string, now: number): Promise<{ bytes: number; at: number }> {
		const cached = this.#sizes.get(path);
		if (cached !== undefined && now - cached.at < STORAGE_CACHE_MS) return cached;
		const measured = { bytes: await treeBytes(path), at: now };
		this.#sizes.set(path, measured);
		return measured;
	}

	async #remove(candidate: Candidate): Promise<void> {
		const worker = candidate.worker;
		if (worker !== null) {
			const record = (await this.#options.workers.state(BACKGROUND_CONTEXT, worker.conversationId)).workers[worker.workerId];
			if (record) await this.#options.workers.recordWorkspaceChanges(candidate.path, record, candidate.threadId);
		}
		const repo = candidate.jjName === null ? undefined : await jjRoot(this.#options.projectPath());
		if (repo !== undefined && candidate.jjName !== null) {
			await removeJjWorkspace({ repo, name: candidate.jjName, path: candidate.path });
		} else {
			await rm(candidate.path, { recursive: true, force: true });
		}
		await this.#options.workers.workspaceRemoved(candidate.path);
		this.#sizes.delete(candidate.path);
		if (worker === null) return;
		// The worker's record no longer points at a workspace; one that was only idle in a finished thread is forgotten.
		await this.#options.workers.harness.commit(async (tx) => {
			const doc = await tx.doc(WorkersDoc, worker.conversationId as ConversationId);
			const record = doc.workers[worker.workerId];
			if (record === undefined || record.workspacePath !== candidate.path || record.status === "running") return;
			record.workspacePath = null;
			record.status = "done";
			record.updatedAt = new Date(this.#options.now()).toISOString();
		}, BACKGROUND_CONTEXT);
	}

	async #candidates(): Promise<Candidate[]> {
		const now = this.#options.now();
		const threads = (await this.#options.threads.state()).threads;
		const candidates: Candidate[] = [];

		const addWorkers = async (input: {
			threadId: string;
			dir: string;
			prefix: string;
			conversationId: number | null;
			thread: ThreadRecord | undefined;
		}): Promise<void> => {
			const records =
				input.conversationId === null
					? {}
					: (await this.#options.workers.state(BACKGROUND_CONTEXT, input.conversationId)).workers;
			for (const entry of await directories(input.dir)) {
				const path = join(input.dir, entry.name);
				const record: WorkerRecord | undefined = Object.values(records).find(
					(candidate) => candidate.workspacePath === path || candidate.id === entry.name,
				);
				const modified = await stat(path).then((info) => info.mtimeMs).catch(() => now);
				let reason: string | null = null;
				if (record?.status === "running") reason = "Its worker is running.";
				else if (record === undefined && now - modified < ORPHAN_GRACE_MS) reason = "It was just created.";
				else if (record !== undefined && record.status !== "done" && !isFinishedThread(input.thread)) {
					reason = "Its worker is not forgotten yet: the coordinator may still merge its work.";
				}
				candidates.push({
					id: `worker:${input.threadId}/${entry.name}`,
					kind: "worker",
					label: record?.title ?? entry.name,
					path,
					removable: reason === null,
					reason,
					updatedAt: record?.updatedAt ?? new Date(modified).toISOString(),
					jjName: `${input.prefix}${entry.name}`,
					threadId: input.threadId,
					worker: record === undefined || input.conversationId === null ? null : { conversationId: input.conversationId, workerId: record.id },
				});
			}
		};

		await addWorkers({
			threadId: MAIN_THREAD_ID,
			dir: this.#options.workspacesDir,
			prefix: "harness-",
			conversationId: this.#options.workers.mainId,
			thread: undefined,
		});
		for (const entry of await directories(this.#options.threadsDir)) {
			const threadId = entry.name;
			const record = threads[threadId];
			const checkout = join(this.#options.threadsDir, threadId, "checkout");
			const exists = await stat(checkout).then((info) => info.isDirectory()).catch(() => false);
			if (exists) {
				const modified = await stat(checkout).then((info) => info.mtimeMs).catch(() => now);
				const reason =
					record === undefined
						? now - modified < ORPHAN_GRACE_MS
							? "It was just created."
							: null
						: isFinishedThread(record)
							? null
							: `Its thread is ${record.status}.`;
				candidates.push({
					id: `thread:${threadId}`,
					kind: "thread",
					label: record?.title ?? threadId,
					path: checkout,
					removable: reason === null,
					reason,
					updatedAt: record?.updatedAt ?? new Date(modified).toISOString(),
					jjName: record === undefined || record.checkoutKind === "jj" ? `harness-thread-${threadId}` : null,
					threadId,
					worker: null,
				});
			}
			await addWorkers({
				threadId,
				dir: join(this.#options.threadsDir, threadId, "workers"),
				prefix: `harness-${threadId}-`,
				conversationId: record?.conversationId ?? null,
				thread: record,
			});
		}
		return candidates;
	}
}
