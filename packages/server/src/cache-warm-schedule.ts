/** A single idle stretch. No transcript, provider or wall-clock dependencies. */
export type CacheWarmClock = {
	now: () => number;
	set: (callback: () => void, delay: number) => unknown;
	clear: (timer: unknown) => void;
};
export const cacheWarmInterval = (ttlMs: number): number => ttlMs >= 3_600_000 ? 3_000_000 : 240_000;
export class CacheWarmSchedule {
	readonly #clock: CacheWarmClock;
	readonly #realAt: number;
	readonly #ttl: number;
	readonly #cap: number;
	readonly #ping: (signal: AbortSignal) => Promise<boolean>;
	readonly #onStop: (reason: string) => void;
	#touch: number;
	readonly #notBefore: number;
	#timer: unknown;
	#controller: AbortController | undefined;
	#ended = false;
	#paused = true;
	constructor(options: { clock?: CacheWarmClock; realAt: number; touchAt?: number; resumeDelayMs?: number; ttlMs: number; hours: number;
		ping: (signal: AbortSignal) => Promise<boolean>; onStop: (reason: string) => void }) {
		this.#clock = options.clock ?? { now: Date.now, set: (f, ms) => { const t = setTimeout(f, ms); t.unref(); return t; }, clear: t => clearTimeout(t as ReturnType<typeof setTimeout>) };
		this.#realAt = options.realAt;
		this.#touch = options.touchAt ?? options.realAt;
		this.#notBefore = this.#clock.now() + (options.resumeDelayMs ?? 0);
		this.#ttl = options.ttlMs;
		this.#cap = options.hours * 3_600_000;
		this.#ping = options.ping;
		this.#onStop = options.onStop;
	}
	resume(): void { if (!this.#ended) { this.#paused = false; this.#schedule(); } }
	pause(): void {
		this.#paused = true;
		this.#clock.clear(this.#timer);
		this.#controller?.abort();
	}
	stop(reason: string): void {
		if (this.#ended) return;
		this.#ended = true;
		this.pause();
		this.#onStop(reason);
	}
	#schedule(): void {
		this.#clock.clear(this.#timer);
		const now = this.#clock.now();
		if (now >= this.#realAt + this.#cap) return this.stop("Idle limit reached");
		if (now >= this.#touch + this.#ttl) return this.stop("Cache expired");
		const due = Math.min(Math.max(this.#notBefore, this.#touch + cacheWarmInterval(this.#ttl)), this.#realAt + this.#cap);
		this.#timer = this.#clock.set(() => { void this.#run(); }, Math.max(0, due - now));
	}
	async #run(): Promise<void> {
		if (this.#ended || this.#paused || this.#controller !== undefined) return;
		const at = this.#clock.now();
		if (at >= this.#realAt + this.#cap) return this.stop("Idle limit reached");
		if (at >= this.#touch + this.#ttl) return this.stop("Cache expired");
		const controller = new AbortController();
		this.#controller = controller;
		try {
			const warm = await this.#ping(controller.signal);
			if (this.#ended || controller.signal.aborted) return;
			if (!warm) return this.stop("Cache refresh stopped: no cache read");
			this.#touch = at;
		} catch {
			if (!controller.signal.aborted) this.stop("Cache refresh failed");
		} finally {
			this.#controller = undefined;
			if (!this.#ended && !this.#paused) this.#schedule();
		}
	}
}
