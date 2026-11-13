/**
 * The server's own status: which release it runs, how the last deploy went, and what a restart would interrupt.
 *
 * Two of the three come from files a deploy writes, so they are read from disk rather than configured: `RELEASE.json`
 * inside the running release, absent in a checkout, and `deploy-status.json` in the deploy root, which a deploy writes
 * while this server keeps running (a failed deploy never restarts it). The deploy status file is therefore watched, and
 * every change is pushed as `server.status.changed`; `busy` is computed on demand because a restart only asks for it
 * before restarting.
 */
import type { ReleaseUpdateState } from "@kemiri/protocol";
import { serverSettings } from "./server-settings.ts";
import { packagedResources } from "./packaged-resources.ts";
import type { DeployStatus, DiskStatus, ReleaseInfo, ServerStatus } from "@kemiri/protocol";
import { existsSync, readFileSync, realpathSync, watch, type FSWatcher } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { Environment } from "./data-dir.ts";
import { errorMessage } from "./errors.ts";
import { readJsonFile } from "./fs-json.ts";

/** The deploy writes it into the release it published, next to the repository's root `package.json`. */
export const RELEASE_FILE_NAME = "RELEASE.json";
/** The deploy writes it in the deploy root, atomically, after every attempt that concerned this backend. */
export const DEPLOY_STATUS_FILE_NAME = "deploy-status.json";
/** Names the deploy's status file outright, for a layout this server cannot derive from the release it runs. */
export const DEPLOY_STATUS_FILE_ENV = "KEMIRI_DEPLOY_STATUS_FILE";
/** A watch sees every atomic write; this poll is only the fallback for a directory that cannot be watched. */
export const DEPLOY_STATUS_POLL_INTERVAL_MS = 10_000;

/** What a restart would interrupt now; idle when conversations and workers are 0. `toolCalls` as `ServerStatus.busy`. */
export type BusyState = { conversations: number; workers: number; toolCalls?: number };

/**
 * The directory holding the running code's root `package.json`, found from a module's location so it never depends on the
 * process's cwd: the release directory in a deploy (`~/.local/share/aiki-deploy/releases/<name>`) and the
 * checkout in development. The nearest enclosing `package.json` that declares `workspaces` is the workspace root, so
 * from `packages/server/src` it is the root rather than `packages/server`; a stray `package.json` in a home directory or
 * any other ancestor cannot win it. Without a workspace declaration the nearest `package.json` is all there is.
 */
export function findPackageRoot(from: string): string | undefined {
	let nearest: string | undefined;
	let dir = resolve(from);
	for (;;) {
		const manifest = packageJsonOf(dir);
		if (manifest !== undefined) {
			nearest ??= dir;
			if (declaresWorkspaces(manifest)) return dir;
		}
		const parent = dirname(dir);
		if (parent === dir) return nearest;
		dir = parent;
	}
}

/** The running release's root. `from` defaults to this module's directory, which is `packages/server/src` everywhere. */
export function resolveReleaseRoot(from: string = import.meta.dir): string {
	return findPackageRoot(from) ?? resolve(from);
}

/**
 * The deploy's status file for the release at `releaseRoot`: `${KEMIRI_DEPLOY_STATUS_FILE}` when set, else
 * `<releaseRoot>/../../deploy-status.json` when the release sits in a deploy root's `releases/` directory (the layout
 * `current -> releases/<name>` gives, so the symlink is resolved first), else `null`: nothing wrote one.
 */
export function resolveDeployStatusFile(releaseRoot: string, env: Environment = serverSettings): string | null {
	const override = env[DEPLOY_STATUS_FILE_ENV];
	if (override !== undefined && override.trim().length > 0) return resolve(expandHome(override.trim()));
	if (packagedResources.release) return null;
	const real = realpathOf(releaseRoot);
	if (basename(dirname(real)) !== "releases") return null;
	return join(dirname(dirname(real)), DEPLOY_STATUS_FILE_NAME);
}

/** The states a deploy status may carry; the protocol's `DeployStatus` spells them out as literals. */
const DEPLOY_STATES: ReadonlySet<string> = new Set(["ok", "failed", "rolled_back"]);

/** The release from `RELEASE.json`, or null when there is none (running from a checkout) or it does not validate. */
export async function readRelease(releaseRoot: string): Promise<ReleaseInfo | null> {
	if (packagedResources.release) return packagedResources.release;
	const raw = await readJsonQuietly(join(releaseRoot, RELEASE_FILE_NAME));
	if (!isRecord(raw)) return null;
	// The name is the release directory's, so a file that leaves it out still describes the release it sits in.
	const name = typeof raw.name === "string" && raw.name.length > 0 ? raw.name : basename(realpathOf(releaseRoot));
	const { commit, description, deployedAt } = raw;
	if (typeof commit !== "string" || commit.length === 0) return null;
	if (typeof description !== "string" || typeof deployedAt !== "string") return null;
	return { name, commit, description, deployedAt };
}

/** The last deploy attempt from `file`, or null when the file is missing, unreadable or does not validate. */
export async function readDeployStatus(file: string | null): Promise<DeployStatus | null> {
	if (file === null) return null;
	const raw = await readJsonQuietly(file);
	if (!isRecord(raw)) return null;
	const { state, commit, at } = raw;
	if (typeof state !== "string" || !DEPLOY_STATES.has(state)) return null;
	if (typeof commit !== "string" || commit.length === 0) return null;
	if (typeof at !== "string") return null;
	return {
		state: state as DeployStatus["state"],
		commit,
		// A commit without a subject is still a commit; only a failure has something to explain, and only it must.
		description: typeof raw.description === "string" ? raw.description : "",
		message: typeof raw.message === "string" ? raw.message : null,
		at,
		...(state === "ok" && raw.backendUnchanged === true ? { backendUnchanged: true as const } : {}),
		...readPending(raw.pending),
	};
}

/** The optional catch-up note of a deploy status; nothing when it is absent or malformed. */
function readPending(raw: unknown): { pending: NonNullable<DeployStatus["pending"]> } | Record<string, never> {
	if (!isRecord(raw)) return {};
	const { commit, description, message, since } = raw;
	if (typeof commit !== "string" || commit.length === 0 || typeof since !== "string") return {};
	return {
		pending: {
			commit,
			description: typeof description === "string" ? description : "",
			message: typeof message === "string" ? message : "",
			since,
		},
	};
}

export type ServerStatusServiceOptions = {
	/** What a restart would interrupt right now, from the open projects. */
	busy: () => Promise<BusyState>;
	/** The running release's root. Default: `resolveReleaseRoot()`. */
	releaseRoot?: string;
	/** The deploy's status file. Default: `resolveDeployStatusFile(releaseRoot, env)`; `null` watches no deploy status. */
	deployStatusFile?: string | null;
	/** The environment the deploy status file is resolved from. Default: `serverSettings`. */
	env?: Environment;
	/** The clock, for tests. Default: `Date.now`. */
	now?: () => number;
	log?: (message: string) => void;
	/** Called when the release or the deploy outcome changes, never for `busy`. */
	onChange?: (status: ServerStatus) => void;
	/** Free space per filesystem, as last measured; omitted leaves `disks` out. */
	disks?: () => DiskStatus[];
	updates?: () => ReleaseUpdateState;
	selfUpdate?: () => import("@kemiri/protocol").SelfUpdateState;
};

/**
 * Reads the release and the deploy status, watches the deploy status file, and reports both with the busy state.
 *
 * Create it with `ServerStatusService.create`, which has read the files by the time it resolves, so the first
 * `server.status` answer is complete.
 */
export class ServerStatusService {
	readonly #updates: (() => ReleaseUpdateState) | undefined;
	readonly #selfUpdate: (() => import("@kemiri/protocol").SelfUpdateState) | undefined;
	readonly #busy: () => Promise<BusyState>;
	readonly #releaseRoot: string;
	readonly #deployStatusFile: string | null;
	readonly #log: (message: string) => void;
	readonly #onChange: ((status: ServerStatus) => void) | undefined;
	readonly #startedAt: string;
	readonly #disks: (() => DiskStatus[]) | undefined;
	#release: ReleaseInfo | null = null;
	#deploy: DeployStatus | null = null;
	/** The deploy as JSON, so a re-read that changed nothing pushes nothing. */
	#deployEncoded = "null";
	#watcher: FSWatcher | undefined;
	#watchedDir: string | undefined;
	#warnedWatcher = false;
	#warnedInvalid = false;
	#poll: ReturnType<typeof setInterval> | undefined;
	/** Serializes re-reads; a watch event during a read queues one after it. */
	#reading: Promise<void> = Promise.resolve();
	#closed = false;

	private constructor(options: ServerStatusServiceOptions) {
		this.#updates = options.updates;
		this.#selfUpdate = options.selfUpdate;
		this.#busy = options.busy;
		this.#releaseRoot = options.releaseRoot ?? resolveReleaseRoot();
		this.#deployStatusFile =
			options.deployStatusFile === undefined
				? resolveDeployStatusFile(this.#releaseRoot, options.env ?? serverSettings)
				: options.deployStatusFile;
		this.#log = options.log ?? ((message) => console.log(message));
		this.#onChange = options.onChange;
		this.#disks = options.disks;
		const now = options.now ?? Date.now;
		this.#startedAt = new Date(now()).toISOString();
	}

	/** Read what the deploy wrote and start watching the deploy status file. */
	static async create(options: ServerStatusServiceOptions): Promise<ServerStatusService> {
		const service = new ServerStatusService(options);
		service.#release = await readRelease(service.#releaseRoot);
		service.#deploy = await readDeployStatus(service.#deployStatusFile);
		service.#deployEncoded = JSON.stringify(service.#deploy);
		service.#warnIfInvalid(service.#deploy);
		service.#startWatching();
		return service;
	}

	/** The release found at start. It cannot change without a restart, so it is never re-read. */
	get release(): ReleaseInfo | null {
		return this.#release;
	}

	/** The last deploy attempt read so far, or null when none wrote one. */
	get deploy(): DeployStatus | null {
		return this.#deploy;
	}

	/** The deploy status file being watched, or `null` when this layout has none. */
	get deployStatusFile(): string | null {
		return this.#deployStatusFile;
	}

	get releaseRoot(): string {
		return this.#releaseRoot;
	}

	/** The complete status now: the release and deploy read so far, the busy state asked for. */
	async status(): Promise<ServerStatus> {
		return {
			release: this.#release,
			deploy: this.#deploy,
			busy: await this.#readBusy(),
			startedAt: this.#startedAt,
			...(this.#updates ? { updates: this.#updates() } : {}),
			...(this.#selfUpdate ? { selfUpdate: this.#selfUpdate() } : {}),
			...(this.#disks === undefined ? {} : { disks: this.#disks() }),
		};
	}

	/** Push the status after something outside the deploy changed, such as the disks. */
	async changed(): Promise<void> {
		await this.#publish();
	}

	/** Read the deploy status again and push it when it changed; cheap, so a watch event and a poll both use it. */
	async refresh(): Promise<void> {
		if (this.#closed) return;
		const next = this.#reading.then(() => this.#readDeploy());
		this.#reading = next.catch(() => undefined);
		return next;
	}

	/** The same, for a timer or a watch event, where a rejection would have nobody to catch it. */
	#refreshQuietly(): void {
		void this.refresh().catch((error: unknown) => this.#log(`server status: deploy status read failed: ${errorMessage(error)}`));
	}

	stop(): void {
		if (this.#closed) return;
		this.#closed = true;
		this.#detachWatcher();
		if (this.#poll !== undefined) clearInterval(this.#poll);
		this.#poll = undefined;
	}

	async #readDeploy(): Promise<void> {
		if (this.#closed) return;
		const deploy = await readDeployStatus(this.#deployStatusFile);
		const encoded = JSON.stringify(deploy);
		if (encoded === this.#deployEncoded) return;
		this.#deploy = deploy;
		this.#deployEncoded = encoded;
		this.#warnIfInvalid(deploy);
		await this.#publish();
	}

	async #readBusy(): Promise<BusyState> {
		try {
			return await this.#busy();
		} catch (error) {
			// Reporting an idle server on a failed count would invite a restart that interrupts work: say so instead.
			this.#log(`server status: busy count failed: ${errorMessage(error)}`);
			throw error;
		}
	}

	async #publish(): Promise<void> {
		if (this.#closed || this.#onChange === undefined) return;
		try {
			this.#onChange(await this.status());
		} catch (error) {
			this.#log(`server status listener failed: ${errorMessage(error)}`);
		}
	}

	/** A deploy status file that exists but does not validate is worth one line; the status stays `null` for it. */
	#warnIfInvalid(deploy: DeployStatus | null): void {
		if (deploy !== null) {
			this.#warnedInvalid = false;
			return;
		}
		if (this.#deployStatusFile === null || this.#warnedInvalid || !existsSync(this.#deployStatusFile)) return;
		this.#warnedInvalid = true;
		this.#log(`server status: ${this.#deployStatusFile} does not describe a deploy status; reporting none`);
	}

	#startWatching(): void {
		if (this.#deployStatusFile === null) return;
		// The directory may not exist yet (a checkout never has one), so the poll attaches it when it appears.
		this.#attachWatcher();
		const timer = setInterval(() => {
			this.#attachWatcher();
			this.#refreshQuietly();
		}, DEPLOY_STATUS_POLL_INTERVAL_MS);
		timer.unref?.();
		this.#poll = timer;
	}

	/** Watch the deploy root, not the file: the deploy replaces the file by rename, which a file watch would lose. */
	#attachWatcher(): void {
		if (this.#closed || this.#deployStatusFile === null) return;
		const dir = dirname(this.#deployStatusFile);
		if (this.#watcher !== undefined && this.#watchedDir === dir) return;
		if (!existsSync(dir)) return;
		this.#detachWatcher();
		try {
			const watcher = watch(dir, { persistent: false }, () => this.#refreshQuietly());
			watcher.on("error", (error) => {
				if (!this.#warnedWatcher) this.#log(`server status: watching ${dir} failed: ${errorMessage(error)}; polling instead`);
				this.#warnedWatcher = true;
				this.#detachWatcher();
			});
			watcher.unref?.();
			this.#watcher = watcher;
			this.#watchedDir = dir;
			this.#warnedWatcher = false;
		} catch (error) {
			if (!this.#warnedWatcher) this.#log(`server status: watching ${dir} failed: ${errorMessage(error)}; polling instead`);
			this.#warnedWatcher = true;
		}
	}

	#detachWatcher(): void {
		if (this.#watcher === undefined) return;
		try {
			this.#watcher.close();
		} catch {
			// A watcher that already failed is closed enough.
		}
		this.#watcher = undefined;
		this.#watchedDir = undefined;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The parsed `package.json` of `dir`, or undefined when there is none or it is not a JSON object. */
function packageJsonOf(dir: string): Record<string, unknown> | undefined {
	let text: string;
	try {
		text = readFileSync(join(dir, "package.json"), "utf8");
	} catch {
		return undefined;
	}
	try {
		const parsed: unknown = JSON.parse(text);
		return isRecord(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

/** npm and Bun accept an array or a map here, so either one marks the workspace root. */
function declaresWorkspaces(manifest: Record<string, unknown>): boolean {
	const workspaces = manifest["workspaces"];
	if (Array.isArray(workspaces)) return workspaces.length > 0;
	return isRecord(workspaces) && Object.keys(workspaces).length > 0;
}

async function readJsonQuietly(path: string): Promise<unknown> {
	try {
		return await readJsonFile(path);
	} catch {
		// A missing, unreadable or corrupt file describes no release or deploy; it must not stop the server.
		return undefined;
	}
}

/** `~` is the service user's home, which is what a deploy script would write. */
function expandHome(path: string): string {
	if (path === "~") return homedir();
	if (path.startsWith("~/")) return join(homedir(), path.slice(2));
	return path;
}

function realpathOf(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		return resolve(path);
	}
}
