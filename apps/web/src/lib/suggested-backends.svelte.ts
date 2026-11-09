/**
 * The published backend list as the screens read it: fetched once at startup from `/backends.json` beside the app, and
 * empty forever on a host that publishes nothing. Svelte runes live here; parsing is in `published-backends.ts`.
 */
import { fetchPublishedBackends, type PublishedBackend } from "./published-backends.ts";

class SuggestedBackends {
	/** The published list this browser is offered; empty until it answers, and after, if there is no list. */
	backends = $state<PublishedBackend[]>([]);
	/** True once the fetch has answered, so a screen can tell "nothing suggested" from "still asking". */
	loaded = $state(false);

	#loading: Promise<void> | undefined;

	/** Fetch the list. Idempotent, so every screen may call it. */
	load(): void {
		void this.ready();
	}

	/** The same fetch, for a caller that wants to wait for it. */
	async ready(): Promise<void> {
		if (this.#loading === undefined) {
			this.#loading = (async () => {
				this.backends = await fetchPublishedBackends();
				this.loaded = true;
			})();
		}
		await this.#loading;
	}
}

export const suggestedBackends = new SuggestedBackends();
