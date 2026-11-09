/**
 * Inputs waiting in a conversation's queue, for the app (feature `queued-inputs`).
 *
 * pi-durable keeps an input admitted while a run is busy in the `pi.inbox` document until a boundary places it: a
 * steer at the run's next tool boundary, a follow-up when it ends (and after a failed run, see `afterFailedRun` in
 * `runtime.ts`). `pi.inbox` is already in every view's `docs`, but an item has no request ID, no time, and once placed
 * nothing says which transcript entry it became. A `QueuedInputs` per watch turns the document into the protocol's
 * `queued` list and, when an item leaves the queue, asks the durable submission record which entry it was placed as,
 * so the view's `pi.user` entry can say `submissionId` and a client hands its waiting message over by ID.
 */
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ConversationView as DurableView, Harness } from "@earendil-works/pi-durable";
import { type QueuedInput, TASK_REFERENCE_PREFIX } from "@mihai-harness/protocol";

/** Entries remembered as placed from a submission; far more than a window holds. */
const KEPT_PLACEMENTS = 500;

/** First-seen times of waiting inputs, per conversation, shared by every watch of a harness. In memory only. */
export class QueueClock {
	readonly #seen = new Map<string, number>();
	readonly #now: () => number;

	constructor(now: () => number = Date.now) {
		this.#now = now;
	}

	/** Note an input at the moment it is admitted; keeps the first time. */
	stamp(conversationId: number, submissionId: number): number {
		const key = `${conversationId}:${submissionId}`;
		const known = this.#seen.get(key);
		if (known !== undefined) return known;
		const at = this.#now();
		this.#seen.set(key, at);
		return at;
	}

	/** Forget what left the queue. */
	retain(conversationId: number, waiting: ReadonlySet<number>): void {
		const prefix = `${conversationId}:`;
		for (const key of this.#seen.keys()) {
			if (key.startsWith(prefix) && !waiting.has(Number(key.slice(prefix.length)))) this.#seen.delete(key);
		}
	}
}

const clocks = new WeakMap<Harness, QueueClock>();

/** The clock of a harness; one per project, created on first use. */
export function queueClock(harness: Harness): QueueClock {
	let clock = clocks.get(harness);
	if (clock === undefined) {
		clock = new QueueClock();
		clocks.set(harness, clock);
	}
	return clock;
}

type InboxItemLike = { id: number; mode: string; content?: unknown };

function inboxItems(raw: DurableView): InboxItemLike[] {
	const inbox = raw.docs["pi.inbox"] as { items?: InboxItemLike[] } | undefined;
	return inbox?.items ?? [];
}

/** The text of an input's content, and how many images it carries. */
export function describeContent(content: unknown): { text: string; images: number } {
	if (typeof content === "string") return { text: content, images: 0 };
	if (!Array.isArray(content)) return { text: "", images: 0 };
	let images = 0;
	const parts: string[] = [];
	for (const block of content) {
		if (typeof block !== "object" || block === null) continue;
		const typed = block as { type?: unknown; text?: unknown };
		if (typed.type === "image") images += 1;
		else if (typed.type === "text" && typeof typed.text === "string") parts.push(typed.text);
	}
	return { text: parts.join("\n"), images };
}

/** The task a text names with `[task T12] ` (or `[task T12, feedback F3] `) in front, and the text after it. */
export function splitTaskReference(text: string): { taskId?: string; feedbackId?: string; text: string } {
	if (!text.startsWith(TASK_REFERENCE_PREFIX)) return { text };
	const end = text.indexOf("]", TASK_REFERENCE_PREFIX.length);
	if (end < 0) return { text };
	const [taskId = "", rest] = text.slice(TASK_REFERENCE_PREFIX.length, end).split(",", 2).map((part) => part.trim());
	if (taskId === "" || /\s/.test(taskId)) return { text };
	const feedbackId = rest?.match(/^feedback (\S+)$/)?.[1];
	return { taskId, ...(feedbackId === undefined ? {} : { feedbackId }), text: text.slice(end + 1).replace(/^ /, "") };
}

export type QueueDecoration = {
	/** The waiting inputs, oldest first. */
	queued: QueuedInput[];
	/** Entry ID -> the submission it was placed from, for entries placed while this watch ran. */
	placed: ReadonlyMap<number, number>;
};

/** One watch's view of the queue. Not shared: it remembers what the previous view held. */
export class QueuedInputs {
	readonly #harness: Harness;
	readonly #conversationId: number;
	readonly #clock: QueueClock;
	/** What the previous view's queue held, to tell what left it. */
	#previous = new Set<number>();
	readonly #requestIds = new Map<number, string | undefined>();
	readonly #placed = new Map<number, number>();

	constructor(harness: Harness, conversationId: number) {
		this.#harness = harness;
		this.#conversationId = conversationId;
		this.#clock = queueClock(harness);
	}

	/** The decoration of a view. Reads the submission records of items that are new or just left; never throws. */
	async decorate(raw: DurableView): Promise<QueueDecoration> {
		const items = inboxItems(raw).filter((item) => item.mode === "steer" || item.mode === "followUp");
		const waiting = new Set(items.map((item) => item.id));

		for (const id of this.#previous) {
			if (waiting.has(id)) continue;
			const entry = await this.#placedEntry(id);
			if (entry !== undefined) this.#placed.set(entry, id);
			this.#requestIds.delete(id);
		}
		while (this.#placed.size > KEPT_PLACEMENTS) {
			const oldest = this.#placed.keys().next().value;
			if (oldest === undefined) break;
			this.#placed.delete(oldest);
		}

		const queued: QueuedInput[] = [];
		for (const item of items) {
			if (!this.#requestIds.has(item.id)) this.#requestIds.set(item.id, await this.#requestId(item.id));
			const { text, images } = describeContent(item.content);
			const reference = splitTaskReference(text);
			const requestId = this.#requestIds.get(item.id);
			queued.push({
				id: item.id,
				...(requestId === undefined ? {} : { requestId }),
				mode: item.mode as QueuedInput["mode"],
				text: reference.text,
				...(reference.taskId === undefined ? {} : { taskId: reference.taskId }),
				...(images === 0 ? {} : { images }),
				at: this.#clock.stamp(this.#conversationId, item.id),
			});
		}
		this.#previous = waiting;
		this.#clock.retain(this.#conversationId, waiting);
		return { queued, placed: this.#placed };
	}

	async #requestId(id: number): Promise<string | undefined> {
		try {
			const submission = await this.#harness.submission(id as never, BACKGROUND_CONTEXT);
			return (await submission?.status(BACKGROUND_CONTEXT))?.requestId;
		} catch {
			return undefined;
		}
	}

	async #placedEntry(id: number): Promise<number | undefined> {
		try {
			const submission = await this.#harness.submission(id as never, BACKGROUND_CONTEXT);
			const record = await submission?.status(BACKGROUND_CONTEXT);
			return record?.status === "placed" || record?.status === "done" ? Number(record.entry) : undefined;
		} catch {
			return undefined;
		}
	}
}
