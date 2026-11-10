/**
 * Prompt cache statistics, per backend: read `cache.stats` when the Usage screen shows them (and after a reconnect),
 * for the range the reader picked. Only backends with the `cache-stats` feature are asked.
 */
import type { CacheStats } from "@aiki/protocol";
import type { CacheStatsRange } from "./cache-stats.ts";
import type { BackendConnection } from "./harness.svelte.ts";

export class BackendCacheStats {
	stats = $state<CacheStats | undefined>(undefined);
	loading = $state(false);
	error = $state<string | undefined>(undefined);
	/** The range the shown stats are for. */
	days = $state<CacheStatsRange | 1>(30);
	calendarToday = $state(false);

	readonly backend: BackendConnection;
	#stop: (() => void) | undefined;
	/** Drops an answer when a newer read was asked for meanwhile. */
	#asked = 0;

	constructor(backend: BackendConnection) {
		this.backend = backend;
	}

	get supported(): boolean {
		return this.backend.supports("cache-stats");
	}

	start(): void {
		if (this.#stop !== undefined) return;
		this.#stop = this.backend.client.subscribe((state) => {
			if (state.status === "ready" && this.supported) void this.load();
		});
		if (this.backend.client.connected && this.supported) void this.load();
	}

	stop(): void {
		this.#stop?.();
		this.#stop = undefined;
	}

	async load(days: CacheStatsRange | 1 = this.days, calendarToday = this.calendarToday): Promise<void> {
		if (!this.backend.client.connected) return;
		const asked = ++this.#asked;
		this.days = days;
		this.calendarToday = calendarToday;
		this.loading = true;
		try {
			const stats = await this.backend.client.readCacheStats({ days, utcOffsetMinutes: -new Date().getTimezoneOffset(), ...(this.backend.supports("usage-breakdown") ? {calendarToday} : {}) });
			if (asked !== this.#asked) return;
			this.stats = stats;
			this.error = undefined;
		} catch (error) {
			if (asked === this.#asked) this.error = error instanceof Error ? error.message : String(error);
		} finally {
			if (asked === this.#asked) this.loading = false;
		}
	}
}

/** One per backend, kept while the app runs so going back to the screen shows the last numbers at once. */
class CacheStatsBoard {
	#byBackend = new Map<string, BackendCacheStats>();

	for(backend: BackendConnection): BackendCacheStats {
		let stats = this.#byBackend.get(backend.id);
		if (stats === undefined || stats.backend !== backend) {
			stats?.stop();
			stats = new BackendCacheStats(backend);
			this.#byBackend.set(backend.id, stats);
		}
		return stats;
	}
}

export const cacheStatsBoard = new CacheStatsBoard();
