/**
 * What a project screen knows about tickets and pull requests: the project's link settings (so keys and `#123`s become
 * links wherever text renders) and the live state the backend read for the board's refs. A screen offers them with
 * `provideRefLinks`; without them (an older backend) only full URLs link and no state shows.
 */
import { getContext, setContext } from "svelte";
import { SvelteMap } from "svelte/reactivity";
import type { HarnessClient } from "@mihai-harness/client";
import { MAX_REF_STATUS_REFS, type ProjectLinks, type RefStatus } from "@mihai-harness/protocol";

export type RefLinks = {
	/** Undefined from a backend older than link settings. */
	links: ProjectLinks | undefined;
	/** The state the backend read for a ref; undefined when it could not (no tool, no login) or has not yet. */
	status: (ref: string) => RefStatus | undefined;
};

const KEY = Symbol("ref-links");

export function provideRefLinks(links: () => RefLinks | undefined): void {
	setContext(KEY, links);
}

/** Call while a component initialises; the returned function reads the links as they change. */
export function useRefLinks(): () => RefLinks | undefined {
	return getContext<(() => RefLinks | undefined) | undefined>(KEY) ?? (() => undefined);
}

/** How often the state of the shown refs is read again while the page is in view; the backend caches it anyway. */
const REFRESH_MS = 2 * 60_000;
/** Coming back to the page reads again only when the last read is at least this old. */
const STALE_ON_RETURN_MS = 45_000;
/** New refs (a task added or edited) are read after a short pause, so a burst of changes is one request. */
const SETTLE_MS = 400;

/**
 * The live state of the refs a screen shows, read with `refs.status` when the set changes, every couple of minutes
 * while the page is visible, when it comes back into view and after a reconnect. Any failure keeps what was known.
 */
export class ProjectRefStatus {
	readonly #statuses = new SvelteMap<string, RefStatus>();
	readonly #client: HarnessClient;
	readonly #projectId: string;
	readonly #unsubscribe: () => void;
	#wanted: string[] = [];
	#lastRead = 0;
	#settle: ReturnType<typeof setTimeout> | undefined;
	#timer: ReturnType<typeof setInterval> | undefined;
	#stopped = false;
	readonly #onVisibility = (): void => {
		if (document.visibilityState === "visible" && Date.now() - this.#lastRead > STALE_ON_RETURN_MS) void this.#read();
	};

	constructor(client: HarnessClient, projectId: string) {
		this.#client = client;
		this.#projectId = projectId;
		this.#unsubscribe = client.subscribe((state) => {
			if (state.status === "ready") void this.#read();
		});
		this.#timer = setInterval(() => {
			if (typeof document === "undefined" || document.visibilityState === "visible") void this.#read();
		}, REFRESH_MS);
		if (typeof document !== "undefined") document.addEventListener("visibilitychange", this.#onVisibility);
	}

	status(ref: string): RefStatus | undefined {
		return this.#statuses.get(ref);
	}

	/** The refs on screen. A ref not asked for before is read soon; the same set again changes nothing. */
	want(refs: readonly string[]): void {
		const next = [...new Set(refs)].slice(0, MAX_REF_STATUS_REFS);
		const known = new Set(this.#wanted);
		const added = next.some((ref) => !known.has(ref));
		this.#wanted = next;
		if (!added) return;
		clearTimeout(this.#settle);
		this.#settle = setTimeout(() => void this.#read(), SETTLE_MS);
	}

	stop(): void {
		this.#stopped = true;
		clearTimeout(this.#settle);
		clearInterval(this.#timer);
		this.#unsubscribe();
		if (typeof document !== "undefined") document.removeEventListener("visibilitychange", this.#onVisibility);
	}

	async #read(): Promise<void> {
		const refs = this.#wanted;
		if (this.#stopped || refs.length === 0 || !this.#client.connected) return;
		this.#lastRead = Date.now();
		let statuses: RefStatus[];
		try {
			statuses = await this.#client.readRefStatus(this.#projectId, refs);
		} catch {
			return;
		}
		if (this.#stopped) return;
		const found = new Map(statuses.map((status) => [status.ref, status]));
		for (const ref of refs) {
			const status = found.get(ref);
			if (status === undefined) this.#statuses.delete(ref);
			else this.#statuses.set(ref, status);
		}
	}
}
