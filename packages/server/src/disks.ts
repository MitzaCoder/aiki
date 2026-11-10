/**
 * Free disk space where the harness writes: the data directory (workers' and threads' workspaces live there) and every
 * project's checkout, one entry per filesystem. Reported in `ServerStatus.disks`, pushed as `server.status.changed` when
 * a disk turns low or back, or its numbers move notably, and announced with one `disk_low` notification per crossing.
 * The harness warns; it never blocks work on it.
 *
 * A disk is low below `AIKI_DISK_LOW_PERCENT` (15) percent free or `AIKI_DISK_LOW_BYTES` (10 GiB),
 * whichever is smaller, so a large disk is not low with hundreds of gigabytes left and a small one not from the start.
 * Which disks are low is kept in `disks.json` in the data directory, so a restart does not announce a crossing again.
 */
import type { DiskStatus } from "@aiki/protocol";
import { stat, statfs } from "node:fs/promises";
import { join } from "node:path";
import { errorMessage } from "./errors.ts";
import { readJsonFile, writeJsonFile } from "./fs-json.ts";
import { type NotificationEvent, notificationTag } from "./notifications.ts";

export const DISK_LOW_PERCENT_ENV = "AIKI_DISK_LOW_PERCENT";
export const DISK_LOW_BYTES_ENV = "AIKI_DISK_LOW_BYTES";
export const DEFAULT_DISK_LOW_PERCENT = 15;
export const DEFAULT_DISK_LOW_BYTES = 10 * 1024 ** 3;
export const DISK_POLL_INTERVAL_MS = 3 * 60_000;
/** A change in free space worth a push without a crossing: 1% of the disk or 1 GiB, whichever is smaller. */
const NOTABLE_FRACTION = 0.01;
const NOTABLE_BYTES = 1024 ** 3;
export const DISKS_FILE_NAME = "disks.json";

export type DiskThreshold = { percent: number; bytes: number };

export function resolveDiskThreshold(env: Record<string, string | undefined> = process.env): DiskThreshold {
	const number = (raw: string | undefined): number | undefined => {
		const value = raw === undefined || raw.trim() === "" ? Number.NaN : Number(raw);
		return Number.isFinite(value) && value >= 0 ? value : undefined;
	};
	return {
		percent: number(env[DISK_LOW_PERCENT_ENV]) ?? DEFAULT_DISK_LOW_PERCENT,
		bytes: number(env[DISK_LOW_BYTES_ENV]) ?? DEFAULT_DISK_LOW_BYTES,
	};
}

export function isDiskLow(freeBytes: number, totalBytes: number, threshold: DiskThreshold): boolean {
	return freeBytes < Math.min((totalBytes * threshold.percent) / 100, threshold.bytes);
}

/** "8.2 GiB". */
export function formatBytes(bytes: number): string {
	const units = ["B", "KiB", "MiB", "GiB", "TiB"];
	let value = bytes;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit += 1;
	}
	return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}

function percentFree(disk: Pick<DiskStatus, "freeBytes" | "totalBytes">): number {
	return disk.totalBytes === 0 ? 0 : Math.round((disk.freeBytes / disk.totalBytes) * 100);
}

/** The one line main's check-ins carry for a low disk. */
export function diskWarningLine(disk: DiskStatus): string {
	return `Disk low: ${disk.label} (${disk.path}) has ${formatBytes(disk.freeBytes)} free of ${formatBytes(disk.totalBytes)} (${percentFree(disk)}%). Avoid filling it further; the user can remove finished workspaces in the app's storage settings.`;
}

export function diskLowNotification(disk: DiskStatus, crossedAt: string): NotificationEvent {
	const event: NotificationEvent = {
		kind: "disk_low",
		title: `Disk low · ${disk.label}`,
		body: `${formatBytes(disk.freeBytes)} free of ${formatBytes(disk.totalBytes)} (${percentFree(disk)}%) at ${disk.path}`,
		key: `disk_low:${disk.path}:${crossedAt}`,
	};
	return { ...event, tag: `${notificationTag(event)}:${disk.path}` };
}

/** What one disk measures, or undefined when the path cannot be read (a project folder that went away). */
export type DiskReader = (path: string) => Promise<{ device: number; freeBytes: number; totalBytes: number } | undefined>;

export const readDisk: DiskReader = async (path) => {
	try {
		const [info, fs] = await Promise.all([stat(path), statfs(path)]);
		return { device: info.dev, freeBytes: fs.bavail * fs.bsize, totalBytes: fs.blocks * fs.bsize };
	} catch {
		return undefined;
	}
};

type DisksFile = { version: 1; low: Record<string, string> };

export class DiskMonitor {
	readonly #options: {
		dataDir: string;
		/** The places to watch besides the data directory: each project's name and checkout. */
		projects: () => Promise<{ label: string; path: string }[]>;
		threshold: DiskThreshold;
		read: DiskReader;
		now: () => number;
		/** A disk turned low or back, or its numbers moved notably. */
		onChange: (disks: DiskStatus[]) => void;
		onLow: (disk: DiskStatus, crossedAt: string) => void;
		log: (message: string) => void;
	};
	readonly #file: string;
	#disks: DiskStatus[] = [];
	/** The disks as last reported to `onChange`, so slow drift adds up to a push too. */
	#reported: DiskStatus[] = [];
	/** When each disk (by its listed path) last turned low; persisted. */
	#low: Record<string, string> = {};
	#timer: ReturnType<typeof setInterval> | undefined;
	#checking: Promise<void> = Promise.resolve();
	#stopped = false;

	constructor(options: {
		dataDir: string;
		projects: () => Promise<{ label: string; path: string }[]>;
		threshold?: DiskThreshold;
		read?: DiskReader;
		now?: () => number;
		onChange: (disks: DiskStatus[]) => void;
		onLow: (disk: DiskStatus, crossedAt: string) => void;
		log: (message: string) => void;
	}) {
		this.#options = {
			...options,
			threshold: options.threshold ?? resolveDiskThreshold(),
			read: options.read ?? readDisk,
			now: options.now ?? Date.now,
		};
		this.#file = join(options.dataDir, DISKS_FILE_NAME);
	}

	/** Reads the persisted crossings, measures once and polls every `intervalMs`. */
	async start(intervalMs: number = DISK_POLL_INTERVAL_MS): Promise<void> {
		const stored = (await readJsonFile(this.#file).catch(() => undefined)) as Partial<DisksFile> | undefined;
		if (stored?.low !== undefined && typeof stored.low === "object" && stored.low !== null) this.#low = { ...stored.low };
		await this.check();
		this.#timer = setInterval(() => void this.check(), intervalMs);
		this.#timer.unref?.();
	}

	stop(): void {
		this.#stopped = true;
		if (this.#timer !== undefined) clearInterval(this.#timer);
		this.#timer = undefined;
	}

	get disks(): DiskStatus[] {
		return this.#disks;
	}

	/** One line per low disk, for main's check-ins. */
	warnings(): string[] {
		return this.#disks.filter((disk) => disk.low).map(diskWarningLine);
	}

	/** Measure every disk now; serialized, so a poll and a request never overlap. */
	check(): Promise<void> {
		const next = this.#checking.then(() => this.#check());
		this.#checking = next.catch((error: unknown) => this.#options.log(`disks: check failed: ${errorMessage(error)}`));
		return this.#checking;
	}

	async #check(): Promise<void> {
		if (this.#stopped) return;
		const places = [{ label: "Data", path: this.#options.dataDir }, ...(await this.#options.projects())];
		const seen = new Set<number>();
		const disks: DiskStatus[] = [];
		for (const place of places) {
			const measured = await this.#options.read(place.path);
			if (measured === undefined || seen.has(measured.device)) continue;
			seen.add(measured.device);
			disks.push({
				label: place.label,
				path: place.path,
				freeBytes: Math.max(0, Math.floor(measured.freeBytes)),
				totalBytes: Math.max(0, Math.floor(measured.totalBytes)),
				low: isDiskLow(measured.freeBytes, measured.totalBytes, this.#options.threshold),
			});
		}
		this.#disks = disks;

		let crossings = false;
		const now = new Date(this.#options.now()).toISOString();
		for (const disk of disks) {
			if (disk.low && this.#low[disk.path] === undefined) {
				this.#low[disk.path] = now;
				crossings = true;
				this.#options.onLow(disk, now);
			} else if (!disk.low && this.#low[disk.path] !== undefined) {
				delete this.#low[disk.path];
				crossings = true;
			}
		}
		if (crossings) {
			await writeJsonFile(this.#file, { version: 1, low: this.#low } satisfies DisksFile).catch((error: unknown) =>
				this.#options.log(`disks: could not save ${DISKS_FILE_NAME}: ${errorMessage(error)}`),
			);
		}
		if (notablyDifferent(this.#reported, disks)) {
			this.#reported = disks;
			this.#options.onChange(disks);
		}
	}
}

function notablyDifferent(previous: readonly DiskStatus[], next: readonly DiskStatus[]): boolean {
	if (previous.length !== next.length) return true;
	return next.some((disk, index) => {
		const before = previous[index] as DiskStatus;
		if (before.path !== disk.path || before.low !== disk.low || before.totalBytes !== disk.totalBytes) return true;
		const notable = Math.min(disk.totalBytes * NOTABLE_FRACTION, NOTABLE_BYTES);
		return Math.abs(before.freeBytes - disk.freeBytes) >= notable;
	});
}
