/**
 * A live conversation view: the initial window from `conversation.watch`, every following Chord op applied with
 * `applyImmutable`, older entries paged in on demand, and the whole thing reattached with `from` after a reconnect.
 */
import { applyImmutable } from "@earendil-works/chord/delta";
import type { Op } from "@earendil-works/chord/delta";
import type {
	ChordOp,
	ConversationPageResponse,
	ConversationView,
	ConversationWatchResponse,
	EntryRecord,
	WatchEndReason,
} from "@aiki/protocol";
import { backoffDelay, canRetry, type BackoffOptions } from "./backoff.ts";
import { ClientError, errorMessage } from "./errors.ts";

export type WatchStatus = "connecting" | "live" | "reconnecting" | "ended" | "stopped";

export type ConversationWatchOptions = {
	/** Window floor requested from the server. Defaults to the server's 50. */
	min?: number;
	/** Window ceiling requested from the server. Defaults to twice `min`. */
	max?: number;
	/** Page size for "load earlier". Default 50. */
	earlierPageSize?: number;
	/** Backoff for reattaching after a drop or a failed watch. */
	retry?: BackoffOptions;
};

export type ClientConnectionStatus = "idle" | "connecting" | "ready" | "reconnecting" | "closed";

/** The slice of client state a watch needs, without importing the client class. */
export type WatchClientState = {
	status: ClientConnectionStatus;
	attempt: number;
	error?: string;
};

/** What a watch needs from its client. Implemented by `HarnessClient`. */
export type WatchHost = {
	readonly projectId: string;
	/** Set for a worker's conversation; absent for the coordinator's. */
	readonly workerId?: string;
	/** Set for a background thread's conversation (or a worker of one); absent for main. */
	readonly threadId?: string;
	state(): WatchClientState;
	subscribe(listener: (state: WatchClientState) => void): () => void;
	startWatch(projectId: string, from: number | undefined, options: ConversationWatchOptions): Promise<ConversationWatchResponse>;
	pageEarlier(
		projectId: string,
		options: { limit: number; before?: number; cursor?: Record<string, unknown> },
	): Promise<ConversationPageResponse>;
	unwatch(watchId: string): void;
	remove(watch: ConversationWatch): void;
};

export class ConversationWatch {
	readonly projectId: string;
	/** The worker whose conversation this watches; undefined for the coordinator's. */
	readonly workerId: string | undefined;
	/** The background thread this watches in; undefined for main. */
	readonly threadId: string | undefined;

	readonly #host: WatchHost;
	readonly #options: ConversationWatchOptions;
	readonly #listeners = new Set<(watch: ConversationWatch) => void>();
	#unsubscribeClient: (() => void) | undefined;
	#serverWatchId: string | undefined;
	#view: ConversationView | undefined;
	#entries: EntryRecord[] = [];
	#status: WatchStatus = "connecting";
	#error: string | undefined;
	#stopped = false;
	#attaching = false;
	#retryAttempt = 0;
	#retryTimer: ReturnType<typeof setTimeout> | undefined;
	#initializedEarlier = false;
	#hasMore = false;
	#loadingEarlier = false;
	#earlierError: string | undefined;
	#earlierCursor: Record<string, unknown> | undefined;

	constructor(host: WatchHost, options: ConversationWatchOptions = {}) {
		this.#host = host;
		this.projectId = host.projectId;
		this.workerId = host.workerId;
		this.threadId = host.threadId;
		this.#options = options;
		this.#unsubscribeClient = host.subscribe((state) => this.#onClientState(state));
		void this.#attach();
	}

	get view(): ConversationView | undefined {
		return this.#view;
	}

	/** Every entry seen, oldest first: the server's window plus anything paged in and kept across updates. */
	get entries(): readonly EntryRecord[] {
		return this.#entries;
	}

	/** Entry just before the oldest entry the server window knows about. */
	get before(): number | null | undefined {
		return this.#view?.before;
	}

	get status(): WatchStatus {
		return this.#status;
	}

	get error(): string | undefined {
		return this.#error;
	}

	/** A page failure, separate from live-watch errors; retained until the reader retries. */
	get earlierError(): string | undefined {
		return this.#earlierError;
	}

	get loadingEarlier(): boolean {
		return this.#loadingEarlier;
	}

	get canLoadEarlier(): boolean {
		return this.#hasMore && !this.#loadingEarlier && !this.#stopped;
	}

	subscribe(listener: (watch: ConversationWatch) => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	/** Fetch one page older than the oldest entry known, and merge it in. */
	async loadEarlier(limit = this.#options.earlierPageSize ?? 50): Promise<boolean> {
		if (this.#stopped || this.#loadingEarlier || !this.#hasMore) return false;
		this.#loadingEarlier = true;
		this.#earlierError = undefined;
		this.#emit();
		try {
			const earliest = this.#entries[0]?.id;
			const response = await this.#host.pageEarlier(this.projectId, {
				limit,
				...(this.#earlierCursor === undefined ? {} : { cursor: this.#earlierCursor }),
				...(this.#earlierCursor === undefined && earliest !== undefined ? { before: earliest } : {}),
			});
			this.#merge(response.entries);
			this.#earlierCursor = response.next;
			this.#hasMore = response.next !== undefined && response.entries.length > 0;
			return response.entries.length > 0;
		} catch (error) {
			this.#earlierError = errorMessage(error);
			this.#earlierCursor = undefined;
			return false;
		} finally {
			this.#loadingEarlier = false;
			this.#emit();
		}
	}

	/** Stop watching and release the server-side watch. */
	stop(): void {
		if (this.#stopped) return;
		this.#stopped = true;
		this.#status = "stopped";
		this.#clearRetry();
		this.#unsubscribeClient?.();
		this.#unsubscribeClient = undefined;
		this.#host.remove(this);
		const watchId = this.#serverWatchId;
		this.#serverWatchId = undefined;
		if (watchId !== undefined) this.#host.unwatch(watchId);
		this.#emit();
	}

	/** Whether a server watch ID is the one this view is currently attached to. */
	matchesServerWatch(watchId: string): boolean {
		return this.#serverWatchId === watchId;
	}

	/** Called by the client when a `conversation.view` event names this watch. */
	applyOps(ops: readonly ChordOp[]): void {
		if (this.#view === undefined) return;
		try {
			this.#view = applyImmutable(this.#view as never, ops as unknown as Op[]) as unknown as ConversationView;
			this.#merge(this.#view.entries);
			this.#error = undefined;
			this.#emit();
		} catch (error) {
			this.#error = `Could not apply a view update: ${errorMessage(error)}`;
			this.#status = "reconnecting";
			const stale = this.#serverWatchId;
			this.#serverWatchId = undefined;
			if (stale !== undefined) this.#host.unwatch(stale);
			this.#emit();
			this.#scheduleRetry();
		}
	}

	/** Called by the client when the server ends this watch (for example its session closed). */
	handleEnded(watchId: string, reason: WatchEndReason, message?: string): void {
		if (watchId !== this.#serverWatchId) return;
		this.#serverWatchId = undefined;
		if (this.#stopped) return;
		this.#status = "reconnecting";
		this.#error = message ?? `The server ended this view (${reason})`;
		this.#emit();
		this.#scheduleRetry();
	}

	#onClientState(state: WatchClientState): void {
		if (this.#stopped) return;
		if (state.status === "ready") {
			if (this.#status !== "ended" && this.#serverWatchId === undefined) void this.#attach();
			return;
		}
		if (state.status === "reconnecting" || state.status === "closed") {
			this.#serverWatchId = undefined;
			if (this.#status === "live") {
				this.#status = "reconnecting";
				this.#emit();
			}
		}
	}

	async #attach(): Promise<void> {
		if (this.#stopped || this.#attaching || this.#serverWatchId !== undefined) return;
		this.#attaching = true;
		this.#status = this.#retryAttempt === 0 ? "connecting" : "reconnecting";
		this.#emit();
		const from = this.#resumeFrom();
		try {
			const response = await this.#host.startWatch(this.projectId, from, this.#options);
			if (this.#stopped) {
				this.#host.unwatch(response.watchId);
				return;
			}
			this.#serverWatchId = response.watchId;
			this.#view = response.view;
			this.#merge(response.view.entries);
			if (!this.#initializedEarlier) {
				this.#initializedEarlier = true;
				this.#hasMore = response.view.before !== undefined && response.view.before !== null;
			}
			this.#status = "live";
			this.#error = undefined;
			this.#retryAttempt = 0;
			this.#earlierCursor = undefined;
			this.#clearRetry();
			this.#emit();
		} catch (error) {
			if (this.#stopped) return;
			this.#serverWatchId = undefined;
			this.#error = errorMessage(error);
			if (isPermanent(error)) {
				this.#status = "ended";
				this.#emit();
				return;
			}
			this.#status = "reconnecting";
			this.#emit();
			this.#scheduleRetry();
		} finally {
			this.#attaching = false;
		}
	}

	/** Where the next attach starts: the newest entry of the last server window, so new commits are not missed. */
	#resumeFrom(): number | undefined {
		const entries = this.#view?.entries;
		if (entries === undefined || entries.length === 0) return undefined;
		return entries[entries.length - 1]?.id;
	}

	#scheduleRetry(): void {
		if (this.#stopped || this.#retryTimer !== undefined) return;
		const retry = this.#options.retry;
		if (!canRetry(this.#retryAttempt, retry)) {
			this.#status = "ended";
			this.#emit();
			return;
		}
		const delay = backoffDelay(this.#retryAttempt, retry);
		this.#retryAttempt += 1;
		this.#retryTimer = setTimeout(() => {
			this.#retryTimer = undefined;
			void this.#attach();
		}, delay);
	}

	#clearRetry(): void {
		if (this.#retryTimer === undefined) return;
		clearTimeout(this.#retryTimer);
		this.#retryTimer = undefined;
	}

	#merge(incoming: readonly EntryRecord[]): void {
		if (incoming.length === 0) return;
		const byId = new Map<number, EntryRecord>();
		for (const entry of this.#entries) byId.set(entry.id, entry);
		for (const entry of incoming) byId.set(entry.id, entry);
		this.#entries = [...byId.values()].sort((left, right) => left.id - right.id);
	}

	#emit(): void {
		for (const listener of this.#listeners) {
			try {
				listener(this);
			} catch {
				// A consumer's listener must not break the watch.
			}
		}
	}
}

/** Errors retrying cannot fix (a bad project ID, for example). */
function isPermanent(error: unknown): boolean {
	if (!(error instanceof ClientError)) return false;
	return (
		error.code === "unknown_project" ||
		error.code === "unknown_worker" ||
		error.code === "bad_request" ||
		error.code === "unsupported_protocol" ||
		error.code === "unknown_model" ||
		error.code === "unknown_provider"
	);
}
