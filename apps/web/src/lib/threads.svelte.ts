/**
 * One project's threads, live: the server pushes the list without archived threads on every change (`threads.state`),
 * so a screen replaces what it holds; `threads.list` fills it in on connect and after a reconnect. Archived threads are
 * not pushed, so they are read when the user asks for them and again after each push while they are shown. Stop and
 * archive go through here and put the answer in the list at once, so a row changes without waiting for the push.
 */
import { backgroundThreads, threadsStateIsFor, type HarnessClient } from "@mihai-harness/client";
import type { ThreadSummary } from "@mihai-harness/protocol";

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export class ProjectThreads {
	readonly projectId: string;
	/** Main and the live background threads, as the server sends them. */
	threads = $state<ThreadSummary[]>([]);
	/** Archived background threads, read while `showArchived` is on. */
	archived = $state<ThreadSummary[]>([]);
	showArchived = $state(false);
	loaded = $state(false);
	error = $state<string | undefined>(undefined);
	/** The last failed stop or archive, by thread. */
	actionError = $state<{ threadId: string; message: string } | undefined>(undefined);

	/** Background threads only; archived ones too while they are shown. */
	readonly background = $derived.by(() => {
		const live = backgroundThreads(this.threads);
		if (!this.showArchived) return live;
		const ids = new Set(live.map((thread) => thread.id));
		return [...live, ...this.archived.filter((thread) => !ids.has(thread.id))];
	});

	readonly #client: HarnessClient;
	readonly #unsubscribeThreads: () => void;
	readonly #unsubscribeState: () => void;
	#stopped = false;

	constructor(client: HarnessClient, projectId: string) {
		this.projectId = projectId;
		this.#client = client;
		this.#unsubscribeThreads = client.onThreadsState((state) => {
			if (this.#stopped || !threadsStateIsFor(state, projectId)) return;
			this.#apply(state.threads);
			if (this.showArchived) void this.#readArchived();
		});
		// A reconnect loses the pushes sent while away, so ask for the list again.
		this.#unsubscribeState = client.subscribe((state) => {
			if (state.status === "ready") void this.load();
		});
		if (client.connected) void this.load();
	}

	async load(): Promise<void> {
		if (this.#stopped || !this.#client.connected) return;
		try {
			const snapshot = await this.#client.listThreads(this.projectId, { includeArchived: this.showArchived });
			if (this.#stopped) return;
			this.#apply(snapshot.threads.filter((thread) => !thread.archived));
			if (this.showArchived) this.archived = snapshot.threads.filter((thread) => thread.archived);
		} catch (error) {
			if (this.#stopped) return;
			this.error = messageOf(error);
		}
	}

	/** A thread by ID, archived ones included while they are shown. */
	thread(id: string | undefined): ThreadSummary | undefined {
		if (id === undefined) return undefined;
		return this.threads.find((thread) => thread.id === id) ?? this.archived.find((thread) => thread.id === id);
	}

	async setShowArchived(show: boolean): Promise<void> {
		this.showArchived = show;
		if (show) await this.#readArchived();
		else this.archived = [];
	}

	async stopThread(threadId: string): Promise<boolean> {
		return this.#act(threadId, () => this.#client.stopThread(this.projectId, threadId));
	}

	async archive(threadId: string, archived = true): Promise<boolean> {
		return this.#act(threadId, () => this.#client.archiveThread(this.projectId, threadId, archived));
	}

	stop(): void {
		this.#stopped = true;
		this.#unsubscribeState();
		this.#unsubscribeThreads();
	}

	async #act(threadId: string, request: () => Promise<ThreadSummary>): Promise<boolean> {
		this.actionError = undefined;
		try {
			const thread = await request();
			if (!this.#stopped) this.#upsert(thread);
			return true;
		} catch (error) {
			if (!this.#stopped) this.actionError = { threadId, message: messageOf(error) };
			return false;
		}
	}

	async #readArchived(): Promise<void> {
		if (this.#stopped || !this.#client.connected) return;
		try {
			const snapshot = await this.#client.listThreads(this.projectId, { includeArchived: true });
			if (this.#stopped || !this.showArchived) return;
			this.archived = snapshot.threads.filter((thread) => thread.archived);
		} catch (error) {
			if (this.#stopped) return;
			this.error = messageOf(error);
		}
	}

	#apply(threads: ThreadSummary[]): void {
		this.threads = threads;
		this.loaded = true;
		this.error = undefined;
	}

	#upsert(thread: ThreadSummary): void {
		if (thread.archived) {
			this.threads = this.threads.filter((entry) => entry.id !== thread.id);
			this.archived = [...this.archived.filter((entry) => entry.id !== thread.id), thread];
			return;
		}
		this.archived = this.archived.filter((entry) => entry.id !== thread.id);
		const index = this.threads.findIndex((entry) => entry.id === thread.id);
		const next = [...this.threads];
		if (index === -1) next.push(thread);
		else next[index] = thread;
		this.threads = next;
	}
}
