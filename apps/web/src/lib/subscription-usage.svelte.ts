/**
 * Live subscription usage, per backend: read `subscriptions.usage` when the backend is ready (and after every
 * reconnect, because pushes sent while away are lost), then follow `subscriptions.usage.changed`. Only the usage screen
 * starts it, so the other screens never ask.
 */
import type { SubscriptionUsage } from "@aiki/protocol";
import type { BackendConnection } from "./harness.svelte.ts";

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export class BackendUsage {
	subscriptions = $state<SubscriptionUsage[]>([]);
	/** Whether a list has arrived since the screen opened. */
	loaded = $state(false);
	/** A refresh the reader asked for is running: the server is reading the providers. */
	refreshing = $state(false);
	/** Why the last read failed; cleared by the next answer or push. */
	error = $state<string | undefined>(undefined);

	readonly backend: BackendConnection;
	#pushes = 0;
	#stop: (() => void) | undefined;

	constructor(backend: BackendConnection) {
		this.backend = backend;
	}

	start(): void {
		if (this.#stop !== undefined) return;
		const client = this.backend.client;
		const offState = client.subscribe((state) => {
			if (state.status === "ready" && this.backend.supports("subscription-usage")) void this.load();
		});
		const offPush = client.onSubscriptionsUsageChanged((subscriptions) => {
			this.#pushes += 1;
			this.subscriptions = subscriptions;
			this.loaded = true;
			this.error = undefined;
		});
		this.#stop = () => {
			offState();
			offPush();
		};
		if (client.connected && this.backend.supports("subscription-usage")) void this.load();
	}

	stop(): void {
		this.#stop?.();
		this.#stop = undefined;
	}

	/**
	 * Read the list; `refresh` makes the server read the providers now. An answer is dropped when a push arrived after the
	 * request was sent, because the push describes a later read.
	 */
	async load(refresh = false): Promise<void> {
		if (!this.backend.client.connected) return;
		const pushesBefore = this.#pushes;
		if (refresh) this.refreshing = true;
		try {
			const subscriptions = await this.backend.client.readSubscriptionsUsage(refresh ? { refresh: true } : {});
			if (this.#pushes === pushesBefore) this.subscriptions = subscriptions;
			this.loaded = true;
			this.error = undefined;
		} catch (error) {
			this.error = messageOf(error);
		} finally {
			if (refresh) this.refreshing = false;
		}
	}
}

/** One `BackendUsage` per backend, kept while the app runs so going back to the screen shows the last numbers at once. */
class UsageBoard {
	#byBackend = new Map<string, BackendUsage>();

	for(backend: BackendConnection): BackendUsage {
		let usage = this.#byBackend.get(backend.id);
		if (usage === undefined || usage.backend !== backend) {
			usage?.stop();
			usage = new BackendUsage(backend);
			this.#byBackend.set(backend.id, usage);
		}
		return usage;
	}
}

export const usageBoard = new UsageBoard();
