/**
 * Artifacts, live: lists that follow `artifacts.changed`, and signed URLs asked for again before they expire. Both are
 * shared through registries per client, so a chat card, a thumbnail and the open dialog showing one artifact ask for its
 * URL once, and the lists with the same filters read once. A lease released is kept a little while, so an effect that
 * re-runs or a dialog reopened does not read again.
 *
 * A screen that has a backend and a project offers them to the components below it with `provideArtifactScope`, so
 * chat cards and board rows find them without threading props through.
 */
import {
	applyArtifactChange,
	artifactUrlRefreshIn,
	artifactUrlUsable,
	type ArtifactFilter,
	type HarnessClient,
} from "@aiki/client";
import type { Artifact } from "@aiki/protocol";
import { getContext, setContext } from "svelte";

/** The default length of a list, as the server answers it. */
export const ARTIFACT_LIST_LIMIT = 100;
/** How long a released lease keeps its list or URL, in case it is taken again. */
const KEEP_RELEASED_MS = 30_000;
/** Pushed changes are taken in at once; the list is read again after this quiet time, in case the push was not all. */
const RELOAD_AFTER_CHANGE_MS = 600;

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** One list of a project's artifacts with fixed filters, newest first. */
export class ArtifactFeed {
	readonly projectId: string;
	readonly filter: ArtifactFilter;
	readonly limit: number;
	artifacts = $state<readonly Artifact[]>([]);
	loaded = $state(false);
	error = $state<string | undefined>(undefined);

	readonly #client: HarnessClient;
	readonly #unsubscribeChanges: () => void;
	readonly #unsubscribeState: () => void;
	#reloadTimer: ReturnType<typeof setTimeout> | undefined;
	#sequence = 0;
	#stopped = false;

	constructor(client: HarnessClient, projectId: string, filter: ArtifactFilter, limit = ARTIFACT_LIST_LIMIT) {
		this.#client = client;
		this.projectId = projectId;
		this.filter = filter;
		this.limit = limit;
		this.#unsubscribeChanges = client.onArtifactsChanged((event) => {
			if (this.#stopped) return;
			const next = applyArtifactChange(this.artifacts, event, projectId, filter, limit);
			if (next === this.artifacts) return;
			// A read already on its way may not hold this change; the one after the quiet time will.
			this.#sequence += 1;
			this.artifacts = next;
			clearTimeout(this.#reloadTimer);
			this.#reloadTimer = setTimeout(() => void this.load(), RELOAD_AFTER_CHANGE_MS);
		});
		// A reconnect loses the pushes sent while away, so read again.
		this.#unsubscribeState = client.subscribe((state) => {
			if (state.status === "ready") void this.load();
		});
		if (client.connected) void this.load();
	}

	async load(): Promise<void> {
		if (this.#stopped || !this.#client.connected) return;
		this.#sequence += 1;
		const sequence = this.#sequence;
		try {
			const artifacts = await this.#client.listArtifacts(this.projectId, { ...this.filter, limit: this.limit });
			if (this.#stopped || sequence !== this.#sequence) return;
			this.artifacts = artifacts;
			this.error = undefined;
		} catch (error) {
			if (this.#stopped || sequence !== this.#sequence) return;
			this.error = messageOf(error);
		} finally {
			if (sequence === this.#sequence) this.loaded = true;
		}
	}

	/** Take in a row the server answered (a tag change), as the push of it would. */
	upsert(artifact: Artifact): void {
		if (this.#stopped) return;
		this.artifacts = applyArtifactChange(
			this.artifacts,
			{ type: "artifacts.changed", projectId: this.projectId, artifact, deleted: false },
			this.projectId,
			this.filter,
			this.limit,
		);
	}

	/** Delete one; the list drops it at once, and the push confirms it. */
	async delete(artifactId: string): Promise<void> {
		await this.#client.deleteArtifact(this.projectId, artifactId);
		this.artifacts = this.artifacts.filter((artifact) => artifact.id !== artifactId);
	}

	stop(): void {
		this.#stopped = true;
		clearTimeout(this.#reloadTimer);
		this.#unsubscribeChanges();
		this.#unsubscribeState();
	}
}

/**
 * One artifact's signed URL, asked for again a few minutes before it expires, when the page comes back from the
 * background with an old one, and on `recover()`: an element that failed to load it (most often a token that ran out
 * while the tab slept) calls that and loads the fresh URL.
 */
export class ArtifactSource {
	readonly projectId: string;
	readonly artifactId: string;
	readonly download: boolean;
	url = $state<string | undefined>(undefined);
	expiresAt = $state<string | undefined>(undefined);
	error = $state<string | undefined>(undefined);

	readonly #client: HarnessClient;
	readonly #unsubscribeState: () => void;
	readonly #onVisible: () => void;
	#timer: ReturnType<typeof setTimeout> | undefined;
	#inFlight: Promise<boolean> | undefined;
	#stopped = false;

	constructor(client: HarnessClient, projectId: string, artifactId: string, download = false) {
		this.#client = client;
		this.projectId = projectId;
		this.artifactId = artifactId;
		this.download = download;
		this.#unsubscribeState = client.subscribe((state) => {
			if (state.status === "ready" && !this.#fresh()) void this.refresh();
		});
		this.#onVisible = () => {
			if (document.visibilityState === "visible" && !this.#fresh()) void this.refresh();
		};
		if (typeof document !== "undefined") document.addEventListener("visibilitychange", this.#onVisible);
		if (client.connected) void this.refresh();
	}

	#fresh(): boolean {
		return this.url !== undefined && this.expiresAt !== undefined && artifactUrlUsable({ url: this.url, expiresAt: this.expiresAt }, Date.now());
	}

	/** Ask for a new URL now; true when one came. Calls made while one is on its way share it. */
	refresh(): Promise<boolean> {
		if (this.#stopped) return Promise.resolve(false);
		this.#inFlight ??= this.#read().finally(() => {
			this.#inFlight = undefined;
		});
		return this.#inFlight;
	}

	/** The element showing the URL failed to load it: ask for a fresh one. The element limits its tries (`MEDIA_RETRY_LIMIT`). */
	recover(): Promise<boolean> {
		return this.refresh();
	}

	async #read(): Promise<boolean> {
		if (!this.#client.connected) return false;
		try {
			const answer = await this.#client.readArtifactUrl(this.projectId, this.artifactId, { download: this.download });
			if (this.#stopped) return false;
			this.url = answer.url;
			this.expiresAt = answer.expiresAt;
			this.error = undefined;
			clearTimeout(this.#timer);
			this.#timer = setTimeout(() => void this.refresh(), artifactUrlRefreshIn(answer.expiresAt, Date.now()));
			return true;
		} catch (error) {
			if (!this.#stopped) this.error = messageOf(error);
			return false;
		}
	}

	stop(): void {
		this.#stopped = true;
		clearTimeout(this.#timer);
		this.#unsubscribeState();
		if (typeof document !== "undefined") document.removeEventListener("visibilitychange", this.#onVisible);
	}
}

type Entry<T> = { value: T; refs: number; disposeTimer: ReturnType<typeof setTimeout> | undefined };

/** Shared values per client and key, counted by lease and stopped a while after the last release. */
class Registry<T extends { stop(): void }> {
	readonly #byClient = new WeakMap<HarnessClient, Map<string, Entry<T>>>();

	acquire(client: HarnessClient, key: string, create: () => T): { value: T; release: () => void } {
		let entries = this.#byClient.get(client);
		if (entries === undefined) {
			entries = new Map();
			this.#byClient.set(client, entries);
		}
		let entry = entries.get(key);
		if (entry === undefined) {
			entry = { value: create(), refs: 0, disposeTimer: undefined };
			entries.set(key, entry);
		}
		clearTimeout(entry.disposeTimer);
		entry.refs += 1;
		const held = entry;
		const map = entries;
		let released = false;
		return {
			value: held.value,
			release: () => {
				if (released) return;
				released = true;
				held.refs -= 1;
				if (held.refs > 0) return;
				held.disposeTimer = setTimeout(() => {
					if (held.refs > 0 || map.get(key) !== held) return;
					map.delete(key);
					held.value.stop();
				}, KEEP_RELEASED_MS);
			},
		};
	}
}

const feeds = new Registry<ArtifactFeed>();
const sources = new Registry<ArtifactSource>();

export function feedKey(projectId: string, filter: ArtifactFilter, limit: number): string {
	return JSON.stringify([projectId, filter.threadId ?? null, filter.workerId ?? null, filter.taskId ?? null, limit]);
}

export type FeedParams = { client: HarnessClient; projectId: string; filter?: ArtifactFilter; limit?: number };

/** A list for the component calling this, following `params` as they change. Call it during component setup. */
export function useArtifactFeed(params: () => FeedParams | undefined): { readonly current: ArtifactFeed | undefined } {
	let feed = $state<ArtifactFeed | undefined>(undefined);
	$effect(() => {
		const wanted = params();
		if (wanted === undefined) {
			feed = undefined;
			return;
		}
		const filter: ArtifactFilter = {
			...(wanted.filter?.threadId === undefined ? {} : { threadId: wanted.filter.threadId }),
			...(wanted.filter?.workerId === undefined ? {} : { workerId: wanted.filter.workerId }),
			...(wanted.filter?.taskId === undefined ? {} : { taskId: wanted.filter.taskId }),
		};
		const limit = wanted.limit ?? ARTIFACT_LIST_LIMIT;
		const lease = feeds.acquire(wanted.client, feedKey(wanted.projectId, filter, limit), () => new ArtifactFeed(wanted.client, wanted.projectId, filter, limit));
		feed = lease.value;
		return lease.release;
	});
	return {
		get current() {
			return feed;
		},
	};
}

export type SourceParams = { client: HarnessClient; projectId: string; artifactId: string; download?: boolean };

/** An artifact's URL for the component calling this; undefined params (not visible yet, say) ask for nothing. */
export function useArtifactSource(params: () => SourceParams | undefined): { readonly current: ArtifactSource | undefined } {
	let source = $state<ArtifactSource | undefined>(undefined);
	$effect(() => {
		const wanted = params();
		if (wanted === undefined) {
			source = undefined;
			return;
		}
		const download = wanted.download === true;
		const key = JSON.stringify([wanted.projectId, wanted.artifactId, download]);
		const lease = sources.acquire(wanted.client, key, () => new ArtifactSource(wanted.client, wanted.projectId, wanted.artifactId, download));
		source = lease.value;
		return lease.release;
	});
	return {
		get current() {
			return source;
		},
	};
}

/**
 * Ask for a download URL once and start the download, for a button: the URL answers as an attachment, so the page
 * stays where it is.
 */
export async function downloadArtifact(client: HarnessClient, artifact: Pick<Artifact, "projectId" | "id" | "name">): Promise<void> {
	const { url } = await client.readArtifactUrl(artifact.projectId, artifact.id, { download: true });
	const link = document.createElement("a");
	link.href = url;
	link.download = artifact.name;
	link.rel = "noopener";
	document.body.append(link);
	link.click();
	link.remove();
}

// --- the scope a screen offers ------------------------------------------------------------------------------------

/** What artifact components below a screen need: the backend's client, the project, and whether it has artifacts. */
export type ArtifactScope = { client: HarnessClient; projectId: string; available: boolean };

const SCOPE_KEY = Symbol("artifact-scope");

/** Offer the screen's backend and project to the artifact components below it. */
export function provideArtifactScope(scope: () => ArtifactScope): void {
	setContext(SCOPE_KEY, scope);
}

/** The scope a screen offered, read as it changes; undefined outside one. */
export function artifactScope(): (() => ArtifactScope) | undefined {
	return getContext<(() => ArtifactScope) | undefined>(SCOPE_KEY);
}
