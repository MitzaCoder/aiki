import type { ReleaseUpdateState, ReleaseUpdatesSetRequest } from "@kemiri/protocol";
import { compareReleaseVersions, releaseChannel, RELEASES_API, selectChannelRelease, type PublishedRelease, type UpdateChannel } from "../../protocol/src/release-versions.ts";
import { readJsonFile, writeJsonFile } from "./fs-json.ts";

export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60_000;
export const UPDATE_STARTUP_DELAY_MS = 60_000;
type SavedChecks = {
	enabled: boolean | null;
	dismissedVersion: string | null;
	nextCheckAt: number;
	etag: string | null;
	stable: PublishedRelease | null;
	pilot: PublishedRelease | null;
};
export type ReleaseUpdateOptions = {
	file: string;
	installedVersion?: string | null;
	channel?: UpdateChannel;
	transport?: typeof fetch;
	now?: () => number;
	onChange?: () => void;
};

/** One backend-wide, persisted daily budget, including failures and restarts. No tokens, gh CLI, retries or log noise. */
export class ReleaseUpdates {
	readonly #options: ReleaseUpdateOptions;
	readonly #now: () => number;
	#saved: SavedChecks = { enabled: null, dismissedVersion: null, nextCheckAt: 0, etag: null, stable: null, pilot: null };
	#timer: ReturnType<typeof setTimeout> | undefined;
	#checking: Promise<void> | undefined;
	#writing: Promise<void> = Promise.resolve();
	#closed = false;
	#abort: AbortController | undefined;

	private constructor(options: ReleaseUpdateOptions) { this.#options = options; this.#now = options.now ?? Date.now; }
	static async create(options: ReleaseUpdateOptions): Promise<ReleaseUpdates> {
		const service = new ReleaseUpdates(options);
		// Corrupt/unreadable state fails closed: don't replace a disabled setting or reset a rate-limit budget.
		try {
			const raw = await readJsonFile(options.file);
			if (raw !== undefined) {
				if (!isSavedChecks(raw)) throw new Error("Invalid release update settings");
				service.#saved = raw;
			}
		} catch {
			// A broken optional notice must never prevent the backend starting, or reset its request budget.
			service.#saved.enabled = false;
			service.#saved.nextCheckAt = service.#now() + UPDATE_CHECK_INTERVAL_MS;
		}
		return service;
	}
	get state(): ReleaseUpdateState {
		const installedVersion = this.#options.installedVersion ?? null;
		const enabled = this.#saved.enabled ?? installedVersion !== null;
		const channel = this.#options.channel ?? releaseChannel(installedVersion ?? "v0.0.0-dev");
		const candidate = this.#saved[channel];
		return {
			schemaVersion: 1, enabled, installedVersion, channel,
			available: enabled && candidate && compareReleaseVersions(candidate.version, installedVersion ?? "v0.0.0-dev")! > 0 ? candidate : null,
			dismissedVersion: this.#saved.dismissedVersion,
		};
	}
	async set(change: Pick<ReleaseUpdatesSetRequest, "enabled" | "dismissVersion">): Promise<ReleaseUpdateState> {
		if (change.enabled !== undefined) this.#saved.enabled = change.enabled;
		if (change.dismissVersion !== undefined && change.dismissVersion === this.state.available?.version) this.#saved.dismissedVersion = change.dismissVersion;
		await this.#save();
		this.#options.onChange?.();
		this.start();
		return this.state;
	}
	start(): void {
		if (this.#timer) clearTimeout(this.#timer);
		if (this.#closed || !this.state.enabled) return;
		const delay = Math.max(UPDATE_STARTUP_DELAY_MS, this.#saved.nextCheckAt - this.#now());
		// Timeout's signed 32-bit range; a long Retry-After is re-evaluated without a request.
		this.#timer = setTimeout(() => {
			this.#timer = undefined;
			void this.check().catch(() => undefined).finally(() => this.start());
		}, Math.min(delay, 2_147_000_000));
		this.#timer.unref();
	}
	async stop(): Promise<void> {
		this.#closed = true;
		if (this.#timer) clearTimeout(this.#timer);
		this.#abort?.abort();
		await this.#checking?.catch(() => undefined);
		await this.#writing.catch(() => undefined);
	}
	async check(): Promise<void> {
		if (this.#checking) return this.#checking;
		if (this.#closed || !this.state.enabled || this.#now() < this.#saved.nextCheckAt) return;
		this.#checking = this.#check();
		try { await this.#checking; } finally { this.#checking = undefined; }
	}
	async #check(): Promise<void> {
		this.#saved.nextCheckAt = this.#now() + UPDATE_CHECK_INTERVAL_MS;
		// Persist before making the request, so a crash/restart can't cause a retry storm.
		await this.#save();
		if (this.#closed) return;
		this.#abort = new AbortController();
		try {
			const response = await (this.#options.transport ?? fetch)(RELEASES_API, {
				headers: { Accept: "application/vnd.github+json", "User-Agent": "Kemiri-release-check", "X-GitHub-Api-Version": "2022-11-28", ...(this.#saved.etag ? { "If-None-Match": this.#saved.etag } : {}) },
				signal: AbortSignal.any([this.#abort.signal, AbortSignal.timeout(15_000)]),
			});
			if (response.status === 403 || response.status === 429) {
				const retry = response.headers.get("retry-after");
				const retryAt = retry && /^\d+$/.test(retry) ? this.#now() + Number(retry) * 1000 : Date.parse(retry ?? "");
				const resetAt = Number(response.headers.get("x-ratelimit-reset")) * 1000;
				this.#saved.nextCheckAt = Math.max(this.#saved.nextCheckAt, Number.isFinite(retryAt) ? retryAt : 0, Number.isFinite(resetAt) ? resetAt : 0);
			} else if (response.ok) {
				const raw: unknown = await response.json();
				if (!Array.isArray(raw)) return;
				this.#saved.stable = selectChannelRelease(raw, "stable");
				this.#saved.pilot = selectChannelRelease(raw, "pilot");
				this.#saved.etag = response.headers.get("etag");
			}
			// 304 keeps both cached candidates; all other HTTP failures simply wait another day.
		} catch { /* Offline, timeouts and bad JSON are intentionally silent. Keep the last valid cache. */ }
		finally {
			this.#abort = undefined;
			await this.#save();
			if (!this.#closed) this.#options.onChange?.();
		}
	}
	#save(): Promise<void> {
		const snapshot = structuredClone(this.#saved);
		this.#writing = this.#writing.catch(() => undefined).then(() => writeJsonFile(this.#options.file, snapshot));
		return this.#writing;
	}
}

function isSavedChecks(raw: unknown): raw is SavedChecks {
	if (!raw || typeof raw !== "object") return false;
	const value = raw as SavedChecks;
	const candidate = (release: PublishedRelease | null) => release === null || (release && typeof release.version === "string" && compareReleaseVersions(release.version, release.version) === 0 && ["aiki", "kemiri"].some(repo => release.notesUrl === `https://github.com/MitzaCoder/${repo}/releases/tag/${encodeURIComponent(release.version)}`));
	return (value.enabled === null || typeof value.enabled === "boolean") && (value.dismissedVersion === null || typeof value.dismissedVersion === "string") &&
		Number.isFinite(value.nextCheckAt) && value.nextCheckAt >= 0 && (value.etag === null || typeof value.etag === "string") && !!candidate(value.stable) && !!candidate(value.pilot);
}
