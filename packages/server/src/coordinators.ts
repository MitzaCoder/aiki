/**
 * The coordinator conversations of one project: main and its background threads (see `threads.ts`).
 *
 * Every coordinator tool (workers, board, memory, history, compaction) answers any of them and refuses a worker. The
 * services were built around main's conversation; this registry tells them which other conversations count as a
 * coordinator, which thread each is, and where that thread's workers work. Main is registered at construction;
 * `ThreadService` registers a background thread inside the commit that creates it, so its first turn can never run
 * before the registry knows it, and registers every existing thread on open before anything resumes.
 */
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Context } from "@earendil-works/chord";
import type { Conversation, ConversationId, Harness } from "@earendil-works/pi-durable";
import { MAIN_THREAD_ID } from "@mihai-harness/protocol";

/** Where one coordinator's workers run. */
export type CoordinatorPlace = {
	threadId: string;
	conversationId: number;
	/** The directory its `shared` workers run in: the project checkout for main, the thread's own workspace otherwise. */
	checkout: string;
	/** Where its `workspace` workers get their jj workspaces. */
	workspacesDir: string;
	/** Prepended to a worker ID to name its jj workspace, so two threads' workers never share a name. */
	workspacePrefix: string;
};

export class Coordinators {
	readonly #harness: Harness;
	readonly #main: Conversation;
	readonly #byConversation = new Map<number, CoordinatorPlace>();
	readonly #byThread = new Map<string, CoordinatorPlace>();
	readonly #listeners = new Set<(place: CoordinatorPlace) => void>();

	constructor(options: { harness: Harness; main: Conversation; checkout: () => string; workspacesDir: string }) {
		this.#harness = options.harness;
		this.#main = options.main;
		const main: CoordinatorPlace = {
			threadId: MAIN_THREAD_ID,
			conversationId: options.main.id,
			workspacesDir: options.workspacesDir,
			workspacePrefix: "harness-",
			get checkout() {
				return options.checkout();
			},
		};
		this.#byConversation.set(main.conversationId, main);
		this.#byThread.set(main.threadId, main);
	}

	get main(): Conversation {
		return this.#main;
	}

	get mainId(): number {
		return this.#main.id;
	}

	/** Register a background thread; listeners hear about a new one once. */
	add(place: CoordinatorPlace): void {
		const known = this.#byThread.get(place.threadId);
		if (known !== undefined && known.conversationId === place.conversationId) return;
		this.#byConversation.set(place.conversationId, place);
		this.#byThread.set(place.threadId, place);
		// Called from inside the creating commit: listeners run once the caller's code yields, never inside it.
		for (const listener of this.#listeners) {
			queueMicrotask(() => {
				try {
					listener(place);
				} catch {
					// A listener's failure is its own; the registry stays consistent.
				}
			});
		}
	}

	/** Called for every background thread registered from now on. Resolves to a stop function. */
	onAdded(listener: (place: CoordinatorPlace) => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	isCoordinator(conversationId: number): boolean {
		return this.#byConversation.has(conversationId);
	}

	isMain(conversationId: number): boolean {
		return conversationId === this.#main.id;
	}

	/** A background thread's conversation, not main's. */
	isBackground(conversationId: number): boolean {
		return this.isCoordinator(conversationId) && !this.isMain(conversationId);
	}

	/** The thread a coordinator conversation is (`"main"` for main), or undefined for a worker or an unknown one. */
	threadIdOf(conversationId: number): string | undefined {
		return this.#byConversation.get(conversationId)?.threadId;
	}

	placeOf(conversationId: number): CoordinatorPlace | undefined {
		return this.#byConversation.get(conversationId);
	}

	placeOfThread(threadId: string): CoordinatorPlace | undefined {
		return this.#byThread.get(threadId);
	}

	/** Every coordinator, main first. */
	places(): CoordinatorPlace[] {
		const main = this.#byConversation.get(this.#main.id) as CoordinatorPlace;
		return [main, ...[...this.#byThread.values()].filter((place) => place !== main)];
	}

	/** A coordinator's conversation by ID; undefined for anything that is not one. */
	async conversation(conversationId: number, context: Context = BACKGROUND_CONTEXT): Promise<Conversation | undefined> {
		if (conversationId === this.#main.id) return this.#main;
		if (!this.isCoordinator(conversationId)) return undefined;
		return this.#harness.conversation(conversationId as ConversationId, context);
	}
}
