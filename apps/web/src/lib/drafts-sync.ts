/**
 * Keeping one chat's draft in step with the backend (`chat-drafts`), framework-free. The rules are in docs/DESIGN.md "Chat
 * drafts"; `decideRemote` is the one that matters for the user: it says what to do with a draft that arrived from another
 * device, and never lets it overwrite text the user has typed and not yet synced, or text under a cursor in the middle of
 * typing. `DraftSync` runs the rest: the debounce, the compare-and-set write, the retry after a refused write.
 */
import { draftLimitError, sameDraftContent, type ChatDraft, type DraftContent } from "@kemiri/protocol";
import { isEmptyDraft, type Draft, type SyncedDraft } from "./drafts.ts";

/** Writes go out this long after the user stops typing. */
export const DRAFT_DEBOUNCE_MS = 500;
/** A remote draft waits while the composer is focused and was edited more recently than this. */
export const DRAFT_TYPING_QUIET_MS = 3000;
/** Writes in a row that ended in a refusal before the next change or push tries again. */
export const DRAFT_MAX_ATTEMPTS = 3;
/** After a failed request (not a refusal) the write is tried again this long later. */
export const DRAFT_RETRY_MS = 4000;

/** A draft as the backend sees it: empty is no draft. */
export function asContent(draft: Draft | null): DraftContent | null {
	return draft === null || isEmptyDraft(draft) ? null : draft;
}

export type RemoteDecision =
	/** Old news (its revision is not newer than what this device already knows). */
	| { action: "ignore" }
	/** Same as the composer already shows: only the revision moves. */
	| { action: "adopt" }
	/** The composer is untouched since the last sync: show the remote draft. */
	| { action: "apply" }
	/** The composer is untouched but the user is typing in it: look again after `waitMs`. */
	| { action: "defer"; waitMs: number }
	/** The composer has text the backend has not seen: keep it, take the revision, write again. */
	| { action: "conflict" };

/**
 * What to do with `remote`, an entry from the backend, given the composer's `local` draft, what was `synced` last, and
 * whether the composer is `focused` and how long ago the user last changed it (`sinceLocalEdit`, Infinity for never).
 * `authoritative` is for an entry the backend itself answered a request with (a refused write, a read): its revision
 * counts even if it is lower than what this device knew (the backend lost the entry).
 */
export function decideRemote(input: {
	local: Draft | null;
	synced: SyncedDraft;
	remote: { revision: number; content: DraftContent | null };
	focused: boolean;
	sinceLocalEdit: number;
	authoritative?: boolean;
}): RemoteDecision {
	const { synced, remote } = input;
	if (input.authoritative !== true && remote.revision <= synced.revision) return { action: "ignore" };
	const local = asContent(input.local);
	if (sameDraftContent(local, asContent(remote.content))) return { action: "adopt" };
	if (!sameDraftContent(local, asContent(synced.content))) return { action: "conflict" };
	if (input.focused && input.sinceLocalEdit < DRAFT_TYPING_QUIET_MS) {
		return { action: "defer", waitMs: DRAFT_TYPING_QUIET_MS - input.sinceLocalEdit };
	}
	return { action: "apply" };
}

/** The text of the small hint when a draft came from another device, or undefined. */
export function draftOrigin(entry: ChatDraft, ownDeviceId: string): { name: string; attachments: number } | undefined {
	if (entry.author === undefined || entry.author.deviceId === ownDeviceId || entry.content === null) return undefined;
	return { name: entry.author.name ?? "another device", attachments: entry.content.attachments?.length ?? 0 };
}

export interface DraftSyncTransport {
	/** Connected, and the backend has `chat-drafts`. Re-checked with each action; `connectionChanged` says when it moved. */
	available(): boolean;
	read(): Promise<ChatDraft | undefined>;
	write(content: DraftContent | null, baseRevision: number): Promise<{ applied: boolean; draft: ChatDraft | null }>;
}

export interface DraftSyncOptions {
	transport: DraftSyncTransport;
	/** The draft restored from the local cache and what that cache knew of the backend. */
	local: Draft;
	synced: SyncedDraft;
	focused: () => boolean;
	/** The composer takes this draft (empty when the remote one was cleared). `entry` is where it came from. */
	apply: (draft: Draft, entry: ChatDraft) => void;
	/** `local` or `synced` changed, for the device's cache. Not called after `destroy`. */
	persist: (local: Draft, synced: SyncedDraft) => void;
	now?: () => number;
	setTimer?: (run: () => void, ms: number) => unknown;
	clearTimer?: (handle: unknown) => void;
}

export class DraftSync {
	readonly #options: DraftSyncOptions;
	readonly #now: () => number;
	readonly #setTimer: (run: () => void, ms: number) => unknown;
	readonly #clearTimer: (handle: unknown) => void;
	#local: Draft;
	#synced: SyncedDraft;
	#lastEdit = Number.NEGATIVE_INFINITY;
	#debounce: unknown;
	#recheck: unknown;
	#writing = false;
	#refusals = 0;
	#remote: ChatDraft | undefined;
	#destroyed = false;

	constructor(options: DraftSyncOptions) {
		this.#options = options;
		this.#now = options.now ?? Date.now;
		this.#setTimer = options.setTimer ?? ((run, ms) => setTimeout(run, ms));
		this.#clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
		this.#local = options.local;
		this.#synced = options.synced;
	}

	get synced(): SyncedDraft {
		return this.#synced;
	}

	/** The user changed the composer (not a draft applied from outside). */
	changed(draft: Draft): void {
		if (this.#destroyed) return;
		this.#local = draft;
		this.#lastEdit = this.#now();
		this.#refusals = 0;
		this.#options.persist(this.#local, this.#synced);
		this.#schedule(DRAFT_DEBOUNCE_MS);
	}

	/** Write now if there is something unsynced: on blur, on leaving the chat, when the page is hidden, after a send. */
	flush(): void {
		if (this.#destroyed) return;
		this.#clear("debounce");
		void this.#write();
	}

	/** The chat is left: one last write goes out, and nothing after it comes back to this object. */
	destroy(): void {
		if (this.#destroyed) return;
		this.#clear("debounce");
		this.#clear("recheck");
		if (this.#dirty() && this.#options.transport.available() && !this.#writing) void this.#write();
		this.#destroyed = true;
	}

	/** The connection came up or the backend's features arrived: read the chat's entry and settle with it. */
	async connectionChanged(): Promise<void> {
		if (this.#destroyed || !this.#options.transport.available()) return;
		let entry: ChatDraft | undefined;
		try {
			entry = await this.#options.transport.read();
		} catch {
			return;
		}
		if (this.#destroyed) return;
		this.#refusals = 0;
		this.#receive(entry ?? { projectId: "", threadId: "", revision: 0, updatedAt: "", content: null }, true);
		if (this.#dirty()) this.#schedule(0);
	}

	/** A `drafts.changed` push for this chat. */
	pushed(entry: ChatDraft): void {
		if (this.#destroyed) return;
		this.#refusals = 0;
		this.#receive(entry, false);
	}

	#dirty(): boolean {
		return !sameDraftContent(asContent(this.#local), asContent(this.#synced.content));
	}

	#schedule(ms: number): void {
		this.#clear("debounce");
		if (!this.#dirty() || !this.#options.transport.available()) return;
		this.#debounce = this.#setTimer(() => {
			this.#debounce = undefined;
			void this.#write();
		}, ms);
	}

	#clear(which: "debounce" | "recheck"): void {
		const handle = which === "debounce" ? this.#debounce : this.#recheck;
		if (handle !== undefined) this.#clearTimer(handle);
		if (which === "debounce") this.#debounce = undefined;
		else this.#recheck = undefined;
	}

	async #write(): Promise<void> {
		const transport = this.#options.transport;
		if (this.#writing || !this.#dirty() || !transport.available()) return;
		const content = asContent(this.#local);
		if (content !== null && draftLimitError(content) !== undefined) return; // Too big for the backend: stays on this device.
		if (this.#refusals >= DRAFT_MAX_ATTEMPTS) return;
		this.#writing = true;
		let result: { applied: boolean; draft: ChatDraft | null };
		try {
			result = await transport.write(content, this.#synced.revision);
		} catch {
			this.#writing = false;
			if (!this.#destroyed) this.#schedule(DRAFT_RETRY_MS);
			return;
		}
		this.#writing = false;
		if (this.#destroyed) return;
		if (result.applied) {
			this.#refusals = 0;
			this.#synced = { revision: result.draft?.revision ?? 0, content: content === null ? null : { ...content } };
			this.#options.persist(this.#local, this.#synced);
			this.#schedule(DRAFT_DEBOUNCE_MS);
			return;
		}
		this.#refusals += 1;
		this.#receive(result.draft ?? { projectId: "", threadId: "", revision: 0, updatedAt: "", content: null }, true);
	}

	#receive(entry: ChatDraft, authoritative: boolean): void {
		this.#clear("recheck");
		const decision = decideRemote({
			local: this.#local,
			synced: this.#synced,
			remote: entry,
			focused: this.#options.focused(),
			sinceLocalEdit: this.#now() - this.#lastEdit,
			authoritative,
		});
		switch (decision.action) {
			case "ignore":
				return;
			case "adopt":
				this.#synced = { revision: entry.revision, content: entry.content === null ? null : { ...entry.content } };
				this.#remote = undefined;
				this.#options.persist(this.#local, this.#synced);
				return;
			case "apply": {
				const draft: Draft = entry.content === null ? { text: "", quotes: [] } : { ...entry.content, quotes: [...entry.content.quotes] };
				this.#synced = { revision: entry.revision, content: entry.content === null ? null : { ...entry.content } };
				this.#local = draft;
				this.#remote = undefined;
				this.#options.persist(this.#local, this.#synced);
				this.#options.apply(draft, entry);
				return;
			}
			case "defer":
				this.#remote = entry;
				this.#recheck = this.#setTimer(() => {
					this.#recheck = undefined;
					const waiting = this.#remote;
					if (waiting !== undefined) this.#receive(waiting, authoritative);
				}, decision.waitMs);
				return;
			case "conflict":
				// The later writer wins: keep what was typed, build on the backend's revision, write at once.
				this.#remote = undefined;
				this.#synced = { revision: entry.revision, content: entry.content === null ? null : { ...entry.content } };
				this.#options.persist(this.#local, this.#synced);
				this.#schedule(0);
				return;
		}
	}
}
