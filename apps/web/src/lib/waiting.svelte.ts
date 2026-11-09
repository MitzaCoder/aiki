/**
 * The messages this screen's conversation holds back: what the user sent while a run was busy, from the request until
 * the run places it. The pure parts (what to draw, what left the queue) are in `waiting.ts`; this holds the state and
 * makes the requests, with runes so the transcript follows it.
 *
 * A send that fails stays as a bubble with the text and the same request ID, so Retry cannot admit it twice. Stop
 * withdraws everything waiting, so a message that left the queue without an entry becomes a bubble you can take back
 * into the composer. Cancel and Edit withdraw one message by its submission ID.
 */
import type { HarnessClient, SubmitOptions } from "@mihai-harness/client";
import { imageCountLabel, inputContent, type HeldImage } from "./chat/images.ts";
import type { ConversationView, EntryRecord, QueuedInput } from "@mihai-harness/protocol";
import {
	UNLISTED_GRACE_MS,
	departures,
	inputKey,
	newestEntryId,
	sendKey,
	typedQueue,
	waitingMessages,
	type LocalSend,
	type WaitingMessage,
} from "./waiting.ts";

export type WaitingDeps = {
	client: HarnessClient;
	projectId: string;
	/** The thread this conversation is, or undefined for main. */
	threadId?: string;
	/** Whether the backend lists waiting messages (`queued-inputs`); without it nothing here shows. */
	supported: () => boolean;
	/** Whether a run is going now. */
	busy: () => boolean;
	/** Put text, and the images that were with it, back in the composer. */
	restore: (text: string, taskId?: string, images?: HeldImage[]) => void;
	/** Tell the user something about an action. */
	notify: (message: string) => void;
	now?: () => number;
};

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export class WaitingMessages {
	/** Requests this screen made that the conversation has not placed. */
	sends = $state<LocalSend[]>([]);
	/** Messages that left the queue unplaced, kept so their text is not lost. */
	lost = $state<WaitingMessage[]>([]);
	/** Keys with a cancel or edit in flight. */
	pending = $state<ReadonlySet<string>>(new Set());
	/** The element key of every message this screen sent, by submission, so a waiting bubble and its entry are one. */
	inputKeys = $state.raw<ReadonlyMap<number, string>>(new Map());

	readonly #deps: WaitingDeps;
	readonly #options = new Map<string, Omit<SubmitOptions, "requestId">>();
	/** Submissions the user withdrew, whose leaving the queue is not a loss. */
	readonly #withdrawn = new Set<number>();
	readonly #timers = new Set<ReturnType<typeof setTimeout>>();
	#previous: QueuedInput[] = [];
	#seenEntry = 0;
	#attached = false;

	constructor(deps: WaitingDeps) {
		this.#deps = deps;
	}

	get supported(): boolean {
		return this.#deps.supported();
	}

	/** Everything to draw waiting, for a view's queue. */
	messages(queued: readonly QueuedInput[] | undefined): WaitingMessage[] {
		return waitingMessages({ queued, sends: this.sends, lost: this.lost });
	}

	stop(): void {
		for (const timer of this.#timers) clearTimeout(timer);
		this.#timers.clear();
	}

	/**
	 * Send a message. The request failing does not lose the text: the bubble keeps it with Retry. Resolves when the
	 * server has answered, so the composer can keep its "sending" state until then.
	 */
	async send(
		text: string,
		taskId: string | undefined,
		options: Omit<SubmitOptions, "requestId" | "taskId">,
		images: readonly HeldImage[] = [],
	): Promise<void> {
		const requestId = `submit-${crypto.randomUUID()}`;
		const now = this.#deps.now ?? Date.now;
		const send: LocalSend = {
			requestId,
			text,
			...(taskId === undefined ? {} : { taskId }),
			...(images.length === 0 ? {} : { images: [...images] }),
			state: "sending",
			at: now(),
			wasBusy: this.#deps.busy(),
		};
		this.#options.set(requestId, { ...options, ...(taskId === undefined ? {} : { taskId }) });
		this.sends = [...this.sends, send];
		await this.#submit(send);
	}

	async #submit(send: LocalSend): Promise<void> {
		const options = this.#options.get(send.requestId) ?? {};
		try {
			const answer = await this.#deps.client.submit(this.#deps.projectId, inputContent(send.text, send.images ?? []), {
				...options,
				requestId: send.requestId,
			});
			const answeredAt = (this.#deps.now ?? Date.now)();
			this.#patch(send.requestId, {
				state: answer.status === "queued" ? "queued" : "placed",
				submissionId: answer.submissionId,
				answeredAt,
			});
			this.#keyFor(answer.submissionId, sendKey(send.requestId));
			if (answer.status === "queued") this.#dropIfUnlisted(send.requestId, answer.submissionId);
			else this.#forget(send.requestId);
		} catch (error) {
			this.#patch(send.requestId, { state: "failed", error: messageOf(error) });
		}
	}

	/** Try a failed send again, with the same request ID. */
	async retry(key: string): Promise<void> {
		const send = this.sends.find((entry) => sendKey(entry.requestId) === key && entry.state === "failed");
		if (send === undefined) return;
		const { error: _error, ...rest } = send;
		const again: LocalSend = { ...rest, state: "sending", wasBusy: true };
		// What is sent is the old text, not what the composer holds now: a draft typed since must stay.
		this.#options.set(send.requestId, { ...(this.#options.get(send.requestId) ?? {}), keepDraft: true });
		this.sends = this.sends.map((entry) => (entry.requestId === send.requestId ? again : entry));
		await this.#submit(again);
	}

	/** Take a waiting message back: withdraw it, and with `edit` put its text in the composer. */
	async withdraw(key: string, edit: boolean): Promise<void> {
		const message = this.messages(this.#previous).find((entry) => entry.key === key);
		if (message === undefined) return;
		if (message.state === "failed" || message.state === "withdrawn") {
			if (edit) this.#restoreMessage(message);
			this.#discard(message);
			return;
		}
		if (message.state !== "waiting" || message.inputId === undefined) return;
		const inputId = message.inputId;
		this.pending = new Set([...this.pending, key]);
		this.#withdrawn.add(inputId);
		try {
			const outcome = await this.#deps.client.withdraw(this.#deps.projectId, inputId, {
				...(this.#deps.threadId === undefined ? {} : { threadId: this.#deps.threadId }),
			});
			if (outcome === "withdrawn") {
				if (edit) this.#restoreMessage(message);
				// The view's next update drops the bubble; until then it says it is being taken back.
			} else {
				this.#withdrawn.delete(inputId);
				if (outcome === "already_placed") {
					this.#deps.notify("The run had already taken that message, so it was not withdrawn.");
				}
			}
		} catch (error) {
			this.#withdrawn.delete(inputId);
			this.#deps.notify(`Could not withdraw the message: ${messageOf(error)}`);
		} finally {
			const rest = new Set(this.pending);
			rest.delete(key);
			this.pending = rest;
		}
	}

	/** Edit: the text and task go back in the composer, and the images when this screen still holds them. */
	#restoreMessage(message: WaitingMessage): void {
		const send = this.sends.find((entry) => sendKey(entry.requestId) === message.key);
		const images = message.images ?? send?.images ?? [];
		this.#deps.restore(message.text, message.taskId, [...images]);
		const missing = (message.imageCount ?? 0) - images.length;
		if (missing > 0) this.#deps.notify(`The ${imageCountLabel(missing)} of that message cannot be taken back; attach ${missing === 1 ? "it" : "them"} again.`);
	}

	/** Compare the view with the previous one: what the run placed, and what left the queue without an entry. */
	observe(view: ConversationView | undefined, entries: readonly EntryRecord[], live: boolean): void {
		if (!live || view === undefined) {
			// Entries placed while the view was away have no tag; the next live view starts the comparison afresh.
			this.#attached = false;
			return;
		}
		const current = view.queued ?? [];
		if (!this.#attached) {
			this.#attached = true;
			this.#previous = [...current];
			this.#seenEntry = newestEntryId(entries);
			this.#adoptKeys(current);
			return;
		}
		const gone = departures({
			previous: typedQueue(this.#previous),
			current,
			entries,
			seenEntryId: this.#seenEntry,
		});
		this.#adoptKeys(current);
		for (const item of gone.placed) this.#forgetInput(item);
		const lost: WaitingMessage[] = [];
		for (const item of gone.withdrawn) {
			const send = this.sends.find(
				(entry) => entry.requestId === item.requestId || (entry.submissionId !== undefined && entry.submissionId === item.id),
			);
			const own = this.#withdrawn.delete(item.id);
			if (send !== undefined) this.#forget(send.requestId);
			if (own) continue;
			lost.push({
				key: send === undefined ? inputKey(item.id) : sendKey(send.requestId),
				state: "withdrawn",
				text: item.text,
				...(item.taskId === undefined ? {} : { taskId: item.taskId }),
				...(send?.images === undefined ? {} : { images: send.images }),
				...(item.images === undefined ? {} : { imageCount: item.images }),
				...(item.at === undefined ? {} : { at: item.at }),
				requestId: item.requestId ?? send?.requestId ?? "",
			});
		}
		if (lost.length > 0) this.lost = [...this.lost, ...lost];
		this.#previous = [...current];
		this.#seenEntry = newestEntryId(entries);
	}

	/** Remember which element key each of our own queued messages has, so its entry takes it over. */
	#adoptKeys(queued: readonly QueuedInput[]): void {
		for (const item of queued) {
			const send = this.sends.find(
				(entry) => entry.requestId === item.requestId || (entry.submissionId !== undefined && entry.submissionId === item.id),
			);
			if (send !== undefined) this.#keyFor(item.id, sendKey(send.requestId));
		}
	}

	#keyFor(submissionId: number, key: string): void {
		if (this.inputKeys.get(submissionId) === key) return;
		this.inputKeys = new Map([...this.inputKeys, [submissionId, key]]);
	}

	#forgetInput(item: QueuedInput): void {
		const send = this.sends.find(
			(entry) => entry.requestId === item.requestId || (entry.submissionId !== undefined && entry.submissionId === item.id),
		);
		if (send !== undefined) this.#forget(send.requestId);
	}

	#patch(requestId: string, change: Partial<LocalSend>): void {
		this.sends = this.sends.map((entry) => (entry.requestId === requestId ? { ...entry, ...change } : entry));
	}

	#forget(requestId: string): void {
		this.sends = this.sends.filter((entry) => entry.requestId !== requestId);
		this.#options.delete(requestId);
	}

	/** A message the server queued that the view never listed was taken by the run before the view caught up. */
	#dropIfUnlisted(requestId: string, submissionId: number): void {
		const timer = setTimeout(() => {
			this.#timers.delete(timer);
			if (!this.#previous.some((item) => item.id === submissionId)) this.#forget(requestId);
		}, UNLISTED_GRACE_MS);
		this.#timers.add(timer);
	}

	#discard(message: WaitingMessage): void {
		if (message.state === "withdrawn") this.lost = this.lost.filter((entry) => entry.key !== message.key);
		const send = this.sends.find((entry) => sendKey(entry.requestId) === message.key);
		if (send !== undefined) this.#forget(send.requestId);
	}
}
