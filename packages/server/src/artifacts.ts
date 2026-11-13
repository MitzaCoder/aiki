/**
 * Artifacts: files a conversation keeps for the user (demo videos, screenshots, logs, reports), copied into the
 * project's store in the data directory and served over HTTP from signed URLs.
 *
 * Layout: `<data>/projects/<id>/artifacts/<artifactId>/<name>` holds version 1; later snapshots live under
 * `<artifactId>.versions/<number>/<name>`. `index.json` holds latest rows plus retained version metadata, newest last.
 * Copy into a partial directory and rename before publishing the index. Serialize the entire save per project.
 * Legacy rows are read as version 1 without rewriting their metadata or bytes.
 *
 * URLs: `/artifacts/<projectId>/<artifactId>?token=<expiry>.<disposition>.<hmac>`, the HMAC (SHA-256) over the project,
 * artifact, expiry and disposition with a secret kept in `<data>/artifacts-secret` (created on first use, mode 0600).
 * The token is the only authorization, so nothing is served without one that verifies (compared in constant time) and
 * has not expired. Responses honor one byte range (206), so a `<video>` seeks.
 */
import { childEnvironment } from "./child-environment.ts";
import { serverSettings } from "./server-settings.ts";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { type Artifact, type ArtifactKind, type ArtifactsChangedEvent, normalizeTags } from "@kemiri/protocol";
import { ServerError, errorMessage } from "./errors.ts";
import { readJsonFile, writeJsonFile } from "./fs-json.ts";
import { isOriginAllowed, normalizeOrigin } from "./origins.ts";

export const ARTIFACTS_DIR = "artifacts";
export const ARTIFACTS_INDEX_FILE = "index.json";
export const ARTIFACTS_SECRET_FILE = "artifacts-secret";
/** Bytes one artifact may have; `KEMIRI_ARTIFACT_MAX_BYTES` overrides it. */
export const DEFAULT_ARTIFACT_MAX_BYTES = 2 * 1024 * 1024 * 1024;
export const ARTIFACT_MAX_BYTES_ENV = "KEMIRI_ARTIFACT_MAX_BYTES";
/** How long an `artifacts.url` answer stays valid. */
export const DEFAULT_ARTIFACT_URL_TTL_MS = 10 * 60 * 1000;
export const DEFAULT_ARTIFACT_LIST_LIMIT = 100;
/** `ffprobe` gets this long to read a duration before the save goes on without one. */
const DURATION_PROBE_TIMEOUT_MS = 10_000;

/** The per-file cap from the environment: a positive whole number of bytes, else the default. */
export function resolveArtifactMaxBytes(env: Readonly<Record<string, string | undefined>> = serverSettings): number {
	const raw = env[ARTIFACT_MAX_BYTES_ENV]?.trim();
	if (raw === undefined || raw.length === 0) return DEFAULT_ARTIFACT_MAX_BYTES;
	const value = Number(raw);
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw new Error(`${ARTIFACT_MAX_BYTES_ENV} must be a positive whole number of bytes, got "${raw}"`);
	}
	return value;
}

// --- MIME types and kinds ------------------------------------------------------------------------------------------

const MIME_BY_EXTENSION: Record<string, string> = {
	".webm": "video/webm",
	".mp4": "video/mp4",
	".m4v": "video/mp4",
	".mov": "video/quicktime",
	".mkv": "video/x-matroska",
	".avi": "video/x-msvideo",
	".ogv": "video/ogg",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".avif": "image/avif",
	".bmp": "image/bmp",
	".svg": "image/svg+xml",
	".ico": "image/x-icon",
	".mp3": "audio/mpeg",
	".m4a": "audio/mp4",
	".wav": "audio/wav",
	".ogg": "audio/ogg",
	".oga": "audio/ogg",
	".opus": "audio/ogg",
	".weba": "audio/webm",
	".flac": "audio/flac",
	".txt": "text/plain",
	".log": "text/plain",
	".md": "text/markdown",
	".csv": "text/csv",
	".tsv": "text/tab-separated-values",
	".html": "text/html",
	".htm": "text/html",
	".css": "text/css",
	".xml": "application/xml",
	".json": "application/json",
	".jsonl": "application/x-ndjson",
	".ndjson": "application/x-ndjson",
	".yaml": "application/yaml",
	".yml": "application/yaml",
	".js": "text/javascript",
	".ts": "text/plain",
	".diff": "text/x-diff",
	".patch": "text/x-diff",
	".pdf": "application/pdf",
	".zip": "application/zip",
	".gz": "application/gzip",
	".tar": "application/x-tar",
	".har": "application/json",
};

const TEXT_APPLICATION_TYPES = new Set([
	"application/json",
	"application/x-ndjson",
	"application/xml",
	"application/yaml",
]);

/** The type a file's first bytes announce, for the containers a video, image or audio file comes in. */
export function sniffMimeType(head: Uint8Array): string | undefined {
	const ascii = (from: number, to: number): string => String.fromCharCode(...head.subarray(from, to));
	const starts = (...bytes: number[]): boolean => bytes.every((byte, index) => head[index] === byte);
	if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
	if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
	if (ascii(0, 4) === "GIF8") return "image/gif";
	if (ascii(0, 4) === "RIFF") {
		const form = ascii(8, 12);
		if (form === "WEBP") return "image/webp";
		if (form === "AVI ") return "video/x-msvideo";
		if (form === "WAVE") return "audio/wav";
	}
	// Matroska and WebM share the EBML header; the extension tells them apart.
	if (starts(0x1a, 0x45, 0xdf, 0xa3)) return "video/webm";
	if (ascii(4, 8) === "ftyp") {
		const brand = ascii(8, 12);
		if (brand === "qt  ") return "video/quicktime";
		if (brand === "M4A " || brand === "M4B ") return "audio/mp4";
		if (brand === "avif" || brand === "avis") return "image/avif";
		return "video/mp4";
	}
	if (ascii(0, 4) === "OggS") return "audio/ogg";
	if (ascii(0, 4) === "fLaC") return "audio/flac";
	if (ascii(0, 3) === "ID3") return "audio/mpeg";
	if (ascii(0, 5) === "%PDF-") return "application/pdf";
	return undefined;
}

/** Containers whose header does not say whether they hold video or audio, or which of the family they are. */
const AMBIGUOUS_CONTAINERS = new Set(["video/webm", "video/mp4", "audio/mp4", "audio/ogg"]);

/**
 * The MIME type of a file from its name and first bytes. The bytes win over the extension (a PNG saved as `.jpg` is a
 * PNG, a `.txt` that is a WebM is a video), except for a container that holds either video or audio, where a media
 * extension is more precise (`.mkv` over the WebM header, `.weba` over video, `.ogv` over audio). Unknown files with
 * no NUL in their head are plain text.
 */
export function detectMimeType(name: string, head: Uint8Array): string {
	const byExtension = MIME_BY_EXTENSION[extname(name).toLowerCase()];
	const sniffed = sniffMimeType(head);
	if (sniffed !== undefined) {
		const isMedia = (type: string): boolean => type.startsWith("audio/") || type.startsWith("video/");
		return byExtension !== undefined && AMBIGUOUS_CONTAINERS.has(sniffed) && isMedia(byExtension)
			? byExtension
			: sniffed;
	}
	if (byExtension !== undefined) return byExtension;
	return head.includes(0) ? "application/octet-stream" : "text/plain";
}

/** How the app shows a type: play, view, read, or download. */
export function artifactKind(mimeType: string): ArtifactKind {
	if (mimeType.startsWith("video/")) return "video";
	if (mimeType.startsWith("image/")) return "image";
	if (mimeType.startsWith("audio/")) return "audio";
	if (mimeType.startsWith("text/") || TEXT_APPLICATION_TYPES.has(mimeType)) return "text";
	return "file";
}

/** A video or audio file's length from `ffprobe`, or null when it is not installed, fails, or takes too long. */
export async function probeDurationSeconds(path: string): Promise<number | null> {
	const ffprobe = Bun.which("ffprobe");
	if (ffprobe === null) return null;
	try {
		const child = Bun.spawn(
			[ffprobe, "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", path],
			{
				env: childEnvironment(),
				stdout: "pipe",
				stderr: "ignore",
				stdin: "ignore",
			},
		);
		const timer = setTimeout(() => child.kill(), DURATION_PROBE_TIMEOUT_MS);
		const [text, code] = await Promise.all([new Response(child.stdout).text(), child.exited]).finally(() =>
			clearTimeout(timer),
		);
		const seconds = Number(text.trim());
		return code === 0 && Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
	} catch {
		return null;
	}
}

// --- the store -----------------------------------------------------------------------------------------------------

type ArtifactIndex = { version: 1; artifacts: Artifact[]; receipts?: Record<string, string> };
/** Most recent snapshots retained per artifact; numbering never resets. */
export const ARTIFACT_VERSION_LIMIT = 20;

function snapshots(artifact: Artifact): NonNullable<Artifact["versions"]> {
	return artifact.versions ?? [{ ...artifact, id: `${artifact.id}~1`, version: 1, versionCount: 1 }];
}

function withVersions(artifact: Artifact): Artifact {
	return { ...artifact, version: artifact.version ?? 1, versionCount: artifact.versionCount ?? 1, versions: snapshots(artifact) };
}

export type ArtifactSaveInput = {
	projectId: string;
	/** An absolute path the caller already checked it may read. */
	sourcePath: string;
	title: string | null;
	note: string | null;
	threadId: string;
	workerId: string | null;
	taskId: string | null;
	/** Free-form tags; normalised on save (`normalizeTags`). */
	tags?: readonly string[];
	/** Memoized save-operation ID: a durable replay finds its snapshot instead of appending another version. */
	artifactId?: string;
};

export type ArtifactListFilter = {
	artifactId?: string;
	threadId?: string;
	workerId?: string;
	taskId?: string;
	limit?: number;
};

export type ArtifactStoreOptions = {
	dataDir: string;
	/** Bytes one file may have. Default: `KEMIRI_ARTIFACT_MAX_BYTES`, else 2 GiB. */
	maxFileBytes?: number;
	/** Reads a video's or audio file's duration. Default: `ffprobe` when it is on PATH. */
	probeDuration?: (path: string) => Promise<number | null>;
	now?: () => number;
	/** Every save and delete, for the `artifacts.changed` push. */
	onChange?: (event: ArtifactsChangedEvent) => void;
	log?: (message: string) => void;
};

/** A new artifact ID: time-ordered, so IDs sort like the rows, then random. */
export function newArtifactId(now = Date.now()): string {
	return `${now.toString(36)}-${randomBytes(5).toString("hex")}`;
}

const ARTIFACT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** A file name safe to keep as one path segment: no separators or control characters, never `.` or `..`. */
export function artifactFileName(path: string): string {
	const name = basename(path)
		.replace(/[\u0000-\u001f\u007f/\\]/g, "_")
		.trim();
	return name.length === 0 || name === "." || name === ".." ? "artifact" : name;
}

export class ArtifactStore {
	readonly dataDir: string;
	readonly maxFileBytes: number;
	readonly #probeDuration: (path: string) => Promise<number | null>;
	readonly #now: () => number;
	readonly #onChange: ((event: ArtifactsChangedEvent) => void) | undefined;
	readonly #log: (message: string) => void;
	/** The tail of each project's write queue. */
	readonly #writes = new Map<string, Promise<unknown>>();

	constructor(options: ArtifactStoreOptions) {
		this.dataDir = options.dataDir;
		this.maxFileBytes = options.maxFileBytes ?? resolveArtifactMaxBytes();
		this.#probeDuration = options.probeDuration ?? probeDurationSeconds;
		this.#now = options.now ?? Date.now;
		this.#onChange = options.onChange;
		this.#log = options.log ?? (() => undefined);
	}

	dir(projectId: string): string {
		return join(this.dataDir, "projects", projectId, ARTIFACTS_DIR);
	}

	filePath(artifact: Artifact): string {
		const rootId = artifact.id.split("~")[0]!;
		const version = artifact.version ?? 1;
		return version === 1
			? join(this.dir(artifact.projectId), rootId, artifact.name)
			: join(this.dir(artifact.projectId), `${rootId}.versions`, String(version), artifact.name);
	}

	/** Copy a file into the store and record it; a rerun with the same `artifactId` returns the row it saved. */
	async save(input: ArtifactSaveInput): Promise<Artifact> {
		const id = input.artifactId ?? newArtifactId(this.#now());
		if (!ARTIFACT_ID_PATTERN.test(id)) throw new ServerError("bad_request", `Invalid artifact ID "${id}"`);
		const pruned: Artifact[] = [];
		let changed: Artifact | undefined;
		const saved = await this.#write(input.projectId, async (index) => {
			const replay = index.receipts?.[id];
			if (replay !== undefined) {
				const root = index.artifacts.find((row) => row.id === replay.split("~")[0]);
				if (root !== undefined) {
					const snapshot = root.versions?.find((row) => row.id === replay);
					return snapshot === undefined || snapshot.version === root.version
						? withVersions(root) : { ...snapshot, id: root.id };
				}
			}
			// Legacy tool calls used the stable artifact ID as their memoized receipt.
			const legacyReplay = index.artifacts.find((row) => row.id === id);
			if (legacyReplay !== undefined) return withVersions(legacyReplay);
			const source = await stat(input.sourcePath);
			if (!source.isFile()) throw new ServerError("bad_request", `${input.sourcePath} is not a regular file`);
			this.#refuseSize(source.size, input.sourcePath);

			const name = artifactFileName(input.sourcePath);
			const previous = [...index.artifacts].reverse().find((row) => row.name === name &&
				(input.taskId !== null ? row.taskId === input.taskId : row.taskId === null && row.threadId === input.threadId && row.workerId === input.workerId));
			const rootId = previous?.id ?? id;
			const version = (previous?.version ?? (previous === undefined ? 0 : 1)) + 1;
			const dir = this.dir(input.projectId);
			const partial = join(dir, `${id}.partial`);
			const final = version === 1 ? join(dir, rootId) : join(dir, `${rootId}.versions`, String(version));
			await mkdir(partial, { recursive: true, mode: 0o700 });
			let artifact: Artifact;
			try {
				const copy = join(partial, name);
				// A copy, never a move: the file stays where the conversation left it.
				await copyFile(input.sourcePath, copy, constants.COPYFILE_FICLONE);
				// The source may have grown since it was measured.
				const size = (await stat(copy)).size;
				this.#refuseSize(size, input.sourcePath);
				const mimeType = detectMimeType(name, await readHead(copy));
				const kind = artifactKind(mimeType);
				const durationSeconds = kind === "video" || kind === "audio" ? await this.#probeDuration(copy) : null;
				artifact = {
					id: rootId,
					version,
					versionCount: version,
					projectId: input.projectId,
					name,
					title: input.title,
					note: input.note,
					kind,
					mimeType,
					size,
					durationSeconds,
					threadId: input.threadId,
					workerId: input.workerId,
					taskId: input.taskId,
					sourcePath: input.sourcePath,
					...(normalizeTags(input.tags).length === 0 ? {} : { tags: normalizeTags(input.tags) }),
					createdAt: new Date(this.#now()).toISOString(),
				};
				await mkdir(join(final, ".."), { recursive: true, mode: 0o700 });
				await rm(final, { recursive: true, force: true });
				await rename(partial, final);
			} catch (error) {
				await rm(partial, { recursive: true, force: true }).catch(() => undefined);
				throw error;
			}
			const retained = [...(previous === undefined ? [] : snapshots(previous)), { ...artifact, id: `${rootId}~${version}` }];
			pruned.push(...retained.slice(0, -ARTIFACT_VERSION_LIMIT));
			artifact.versions = retained.slice(-ARTIFACT_VERSION_LIMIT);
			if (previous !== undefined) index.artifacts.splice(index.artifacts.indexOf(previous), 1);
			index.artifacts.push(artifact);
			(index.receipts ??= {})[id] = `${rootId}~${version}`;
			changed = artifact;
			return artifact;
		});
		if (changed !== undefined) this.#emit({ type: "artifacts.changed", projectId: input.projectId, artifact: changed, deleted: false });
		// Publish before pruning: failure/crash may retain extra bytes, never lose referenced bytes.
		for (const snapshot of pruned) {
			await rm((snapshot.version ?? 1) === 1 ? this.filePath(snapshot) : dirname(this.filePath(snapshot)), { force: true, recursive: true }).catch((error: unknown) => this.#log(`artifacts: prune failed: ${errorMessage(error)}`));
		}
		return saved;
	}

	/** Newest first, narrowed by every filter given. */
	async list(projectId: string, filter: ArtifactListFilter = {}): Promise<Artifact[]> {
		const index = await this.#read(projectId);
		const limit = filter.limit ?? DEFAULT_ARTIFACT_LIST_LIMIT;
		return index.artifacts
			.filter(
				(artifact) =>
					(filter.artifactId === undefined || artifact.id === filter.artifactId) &&
					(filter.threadId === undefined || artifact.threadId === filter.threadId) &&
					(filter.workerId === undefined || artifact.workerId === filter.workerId) &&
					(filter.taskId === undefined || artifact.taskId === filter.taskId),
			)
			.reverse()
			.slice(0, limit)
			.map(withVersions);
	}

	async get(projectId: string, artifactId: string): Promise<Artifact | undefined> {
		const [rootId, version] = artifactId.split("~");
		const artifact = (await this.#read(projectId)).artifacts.find((row) => row.id === rootId);
		if (artifact === undefined) return undefined;
		return version === undefined ? withVersions(artifact) : snapshots(artifact).find((row) => row.id === artifactId);
	}

	async require(projectId: string, artifactId: string): Promise<Artifact> {
		const artifact = await this.get(projectId, artifactId);
		if (artifact === undefined) {
			throw new ServerError("unknown_artifact", `No artifact "${artifactId}" in this project`, { artifactId });
		}
		return artifact;
	}

	/**
	 * Replace an artifact's tags with the normalised `tags` (an empty list clears them) and push the change. Rows saved
	 * before tags existed have none; a row with no tags keeps no `tags` key.
	 */
	async updateTags(projectId: string, artifactId: string, tags: readonly string[]): Promise<Artifact> {
		const normal = normalizeTags(tags);
		const artifact = await this.#write(projectId, (index) => {
			const row = index.artifacts.find((candidate) => candidate.id === artifactId);
			if (row === undefined) {
				throw new ServerError("unknown_artifact", `No artifact "${artifactId}" in this project`, { artifactId });
			}
			if (normal.length === 0) delete row.tags;
			else row.tags = normal;
			const latest = row.versions?.at(-1);
			if (latest !== undefined) {
				if (normal.length === 0) delete latest.tags;
				else latest.tags = normal;
			}
			return withVersions(row);
		});
		this.#emit({ type: "artifacts.changed", projectId, artifact, deleted: false });
		return artifact;
	}

	/** Drop the row, then the bytes; a crash between them leaves an unlisted directory, never a row without bytes. */
	async delete(projectId: string, artifactId: string): Promise<Artifact> {
		const artifact = await this.#write(projectId, (index) => {
			const at = index.artifacts.findIndex((candidate) => candidate.id === artifactId);
			if (at === -1) {
				throw new ServerError("unknown_artifact", `No artifact "${artifactId}" in this project`, { artifactId });
			}
			for (const [receipt, address] of Object.entries(index.receipts ?? {})) {
				if (address.split("~")[0] === artifactId) delete index.receipts![receipt];
			}
			return index.artifacts.splice(at, 1)[0] as Artifact;
		});
		for (const directory of [artifact.id, `${artifact.id}.versions`]) {
			await rm(join(this.dir(projectId), directory), { recursive: true, force: true }).catch((error: unknown) => {
				this.#log(`project ${projectId}: could not remove artifact ${artifact.id}: ${errorMessage(error)}`);
			});
		}
		this.#emit({ type: "artifacts.changed", projectId, artifact, deleted: true });
		return artifact;
	}

	#refuseSize(size: number, path: string): void {
		if (size > this.maxFileBytes) {
			throw new ServerError(
				"bad_request",
				`${path} is ${size} bytes, over the ${this.maxFileBytes} byte limit for one artifact`,
			);
		}
	}

	async #read(projectId: string): Promise<ArtifactIndex> {
		const value = (await readJsonFile(join(this.dir(projectId), ARTIFACTS_INDEX_FILE))) as ArtifactIndex | undefined;
		return value === undefined ? { version: 1, artifacts: [] } : { ...value, version: 1, artifacts: value.artifacts ?? [] };
	}

	async #write<T>(projectId: string, change: (index: ArtifactIndex) => T | Promise<T>): Promise<T> {
		const previous = this.#writes.get(projectId) ?? Promise.resolve();
		const next = previous
			.catch(() => undefined)
			.then(async () => {
				const index = await this.#read(projectId);
				const result = await change(index);
				await writeJsonFile(join(this.dir(projectId), ARTIFACTS_INDEX_FILE), index);
				return result;
			});
		this.#writes.set(projectId, next);
		return next;
	}

	#emit(event: ArtifactsChangedEvent): void {
		try {
			this.#onChange?.(event);
		} catch (error) {
			this.#log(`artifacts: change listener failed: ${errorMessage(error)}`);
		}
	}
}

async function readHead(path: string, bytes = 4096): Promise<Uint8Array> {
	const handle = await open(path, "r");
	try {
		const buffer = new Uint8Array(bytes);
		const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
		return buffer.subarray(0, bytesRead);
	} finally {
		await handle.close();
	}
}

// --- signed URLs ---------------------------------------------------------------------------------------------------

export type ArtifactDisposition = "inline" | "attachment";

/** The HMAC secret, created on first use and kept in the data directory so URLs survive a restart. */
export async function loadOrCreateArtifactSecret(dataDir: string): Promise<Buffer> {
	const path = join(dataDir, ARTIFACTS_SECRET_FILE);
	try {
		const text = (await readFile(path, "utf8")).trim();
		if (/^[0-9a-f]{64}$/.test(text)) return Buffer.from(text, "hex");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	const secret = randomBytes(32);
	await writeFile(path, `${secret.toString("hex")}\n`, { mode: 0o600 });
	return secret;
}

export class ArtifactUrlSigner {
	readonly #secret: Buffer;
	readonly #now: () => number;
	readonly ttlMs: number;
	readonly #sessionActive: ((sessionId: string) => boolean) | undefined;
	readonly #required: (() => boolean) | undefined;
	readonly #streams = new Map<string, Set<() => void>>();

	constructor(options: {
		secret: Buffer;
		now?: () => number;
		ttlMs?: number;
		sessionActive?: (sessionId: string) => boolean;
		required?: () => boolean;
	}) {
		this.#sessionActive = options.sessionActive;
		this.#required = options.required;
		this.#secret = options.secret;
		this.#now = options.now ?? Date.now;
		this.ttlMs = options.ttlMs ?? DEFAULT_ARTIFACT_URL_TTL_MS;
	}

	/** A path with its token, to put after the backend's origin, and when it stops working. */
	sign(
		projectId: string,
		artifactId: string,
		disposition: ArtifactDisposition,
		sessionId?: string,
	): { path: string; expiresAt: string } {
		const expires = Math.floor((this.#now() + this.ttlMs) / 1000);
		const flag = disposition === "attachment" ? "a" : "i";
		if (sessionId && !this.#sessionActive?.(sessionId)) throw new ServerError("auth_revoked", "auth_revoked");
		if (!sessionId && this.#required?.()) throw new ServerError("auth_required", "auth_required");
		const token = sessionId
			? `v2.${expires}.${flag}.${sessionId}.${this.#mac(projectId, artifactId, expires, flag, sessionId).toString("base64url")}`
			: `${expires}.${flag}.${this.#mac(projectId, artifactId, expires, flag).toString("base64url")}`;
		return {
			path: `/artifacts/${encodeURIComponent(projectId)}/${encodeURIComponent(artifactId)}?token=${token}`,
			expiresAt: new Date(expires * 1000).toISOString(),
		};
	}

	/** The disposition a valid, unexpired token grants for this artifact, or undefined. */
	verify(projectId: string, artifactId: string, token: string | null): ArtifactDisposition | undefined {
		if (token === null) return undefined;
		const sessionId = this.sessionId(token);
		if (sessionId && !this.#sessionActive?.(sessionId)) return undefined;
		if (!sessionId && this.#required?.()) return undefined;
		const match = sessionId
			? /^v2\.(\d{1,12})\.([ia])\.[a-f0-9]{32}\.([A-Za-z0-9_-]{43})$/.exec(token)
			: /^(\d{1,12})\.([ia])\.([A-Za-z0-9_-]{43})$/.exec(token);
		if (match === null) return undefined;
		const expires = Number(match[1]);
		const flag = match[2] as "i" | "a";
		const given = Buffer.from(match[3] as string, "base64url");
		// The last of 43 base64url characters carries only 4 bits of the 32-byte MAC, so decoding alone would accept
		// several spellings of one token: insist on the canonical one.
		if (given.toString("base64url") !== match[3]) return undefined;
		const expected = this.#mac(projectId, artifactId, expires, flag, sessionId);
		if (given.length !== expected.length || !timingSafeEqual(given, expected)) return undefined;
		if (expires * 1000 <= this.#now()) return undefined;
		return flag === "a" ? "attachment" : "inline";
	}

	sessionId(token: string | null): string | undefined {
		return token?.match(/^v2\.\d{1,12}\.[ia]\.([a-f0-9]{32})\.[A-Za-z0-9_-]{43}$/)?.[1];
	}
	revoke(sessionId: string) {
		for (const abort of this.#streams.get(sessionId) ?? []) abort();
		this.#streams.delete(sessionId);
	}
	stream(file: Blob, sessionId: string | undefined): ReadableStream<Uint8Array> {
		if (!sessionId) return file.stream();
		const reader = file.stream().getReader();
		const streams = this.#streams.get(sessionId) ?? new Set<() => void>();
		this.#streams.set(sessionId, streams);
		let abort: () => void;
		const cleanup = () => {
			streams.delete(abort);
			if (!streams.size) this.#streams.delete(sessionId);
		};
		return new ReadableStream<Uint8Array>({
			start: (controller) => {
				abort = () => {
					void reader.cancel().catch(() => {});
					controller.error(new Error("auth_revoked"));
					cleanup();
				};
				streams.add(abort);
			},
			pull: async (controller) => {
				try {
					if (!this.#sessionActive?.(sessionId)) {
						abort();
						return;
					}
					const { done, value } = await reader.read();
					if (done) {
						controller.close();
						cleanup();
					} else controller.enqueue(value);
				} catch {
					cleanup();
					controller.error(new Error("artifact_stream_closed"));
				}
			},
			cancel: async () => {
				cleanup();
				await reader.cancel();
			},
		});
	}
	#mac(projectId: string, artifactId: string, expires: number, flag: string, sessionId?: string): Buffer {
		const payload = sessionId
			? `artifact-v2\n${projectId}\n${artifactId}\n${expires}\n${flag}\n${sessionId}`
			: `artifact\n${projectId}\n${artifactId}\n${expires}\n${flag}`;
		return createHmac("sha256", this.#secret).update(payload).digest();
	}
}

/**
 * Legacy optional/off origin derivation, for migration compatibility only: `KEMIRI_PUBLIC_URL` when set,
 * else the proxy's `X-Forwarded-Proto`/`X-Forwarded-Host` (Caddy sets both), else the request's own.
 */
export function requestOrigin(
	request: Request,
	env: Readonly<Record<string, string | undefined>> = serverSettings,
): string {
	const configured = env.KEMIRI_PUBLIC_URL?.trim();
	if (configured !== undefined && configured.length > 0) {
		const origin = normalizeOrigin(configured);
		if (origin !== undefined) return origin;
	}
	const url = new URL(request.url);
	const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
	const host =
		request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ?? request.headers.get("host") ?? url.host;
	return (
		normalizeOrigin(`${proto === "https" || proto === "http" ? proto : url.protocol.slice(0, -1)}://${host}`) ??
		url.origin
	);
}

// --- HTTP ----------------------------------------------------------------------------------------------------------

export const ARTIFACT_PATH_PREFIX = "/artifacts/";

/** CORS headers for an allowed browser origin; none for a request without one or from another origin. */
function corsHeaders(request: Request, allowedOrigins: readonly string[], exactOrigins = true): Record<string, string> {
	const origin = request.headers.get("origin");
	const headers: Record<string, string> = {
		vary: "Origin",
		"cache-control": "private, no-store",
		"referrer-policy": "no-referrer",
		"x-content-type-options": "nosniff",
	};
	if (origin === null || !isOriginAllowed(origin, allowedOrigins, exactOrigins)) return headers;
	return {
		...headers,
		"access-control-allow-origin": normalizeOrigin(origin) as string,
		"access-control-expose-headers": "Accept-Ranges, Content-Disposition, Content-Length, Content-Range, Content-Type",
	};
}

/** `filename` for ASCII clients and `filename*` with the real name. */
function contentDisposition(disposition: ArtifactDisposition, name: string): string {
	const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
	return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/** One `bytes=` range of a file of `size` bytes, inclusive; `null` when unsatisfiable, `undefined` to send it all. */
export function parseRange(header: string | null, size: number): { start: number; end: number } | null | undefined {
	if (header === null) return undefined;
	const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
	if (match === null) return undefined;
	const [, from = "", to = ""] = match;
	if (from === "" && to === "") return undefined;
	if (from === "") {
		const suffix = Number(to);
		if (suffix === 0 || size === 0) return null;
		return { start: Math.max(0, size - suffix), end: size - 1 };
	}
	const start = Number(from);
	if (start >= size) return null;
	const end = to === "" ? size - 1 : Math.min(Number(to), size - 1);
	if (end < start) return null;
	return { start, end };
}

/**
 * Answers `GET`/`HEAD`/`OPTIONS /artifacts/<projectId>/<artifactId>?token=…`, or undefined for any other path. A
 * missing, tampered or expired token is 403 before anything about the artifact is read.
 */
export async function serveArtifact(
	request: Request,
	options: {
		store: ArtifactStore;
		signer: ArtifactUrlSigner;
		allowedOrigins: readonly string[];
		exactOrigins?: boolean;
		log?: (message: string) => void;
	},
): Promise<Response | undefined> {
	const url = new URL(request.url);
	if (!url.pathname.startsWith(ARTIFACT_PATH_PREFIX)) return undefined;
	const cors = corsHeaders(request, options.allowedOrigins, options.exactOrigins);
	const text = (status: number, body: string, extra: Record<string, string> = {}): Response =>
		new Response(body, { status, headers: { ...cors, "content-type": "text/plain; charset=utf-8", ...extra } });

	if (request.method === "OPTIONS") {
		return new Response(null, {
			status: 204,
			headers: {
				...cors,
				...("access-control-allow-origin" in cors
					? {
							"access-control-allow-methods": "GET, HEAD, OPTIONS",
							"access-control-allow-headers": "Range",
							"access-control-max-age": "600",
						}
					: {}),
			},
		});
	}
	if (request.method !== "GET" && request.method !== "HEAD")
		return text(405, "Method not allowed", { allow: "GET, HEAD, OPTIONS" });

	const parts = url.pathname.slice(ARTIFACT_PATH_PREFIX.length).split("/");
	if (parts.length !== 2) return text(404, "Not found");
	let projectId: string;
	let artifactId: string;
	try {
		projectId = decodeURIComponent(parts[0] as string);
		artifactId = decodeURIComponent(parts[1] as string);
	} catch {
		return text(404, "Not found");
	}
	const disposition = options.signer.verify(projectId, artifactId, url.searchParams.get("token"));
	if (disposition === undefined) return text(403, "Invalid or expired artifact token");

	try {
		const artifact = await options.store.get(projectId, artifactId);
		const file = artifact === undefined ? undefined : Bun.file(options.store.filePath(artifact));
		if (artifact === undefined || file === undefined || !(await file.exists())) return text(404, "No such artifact");

		if (options.signer.verify(projectId, artifactId, url.searchParams.get("token")) === undefined)
			return text(403, "Invalid or expired artifact token");
		const sessionId = options.signer.sessionId(url.searchParams.get("token"));
		const size = file.size;
		const headers: Record<string, string> = {
			...cors,
			"content-type": artifact.mimeType.startsWith("text/") ? `${artifact.mimeType}; charset=utf-8` : artifact.mimeType,
			"content-disposition": contentDisposition(
				["text/html", "image/svg+xml"].includes(artifact.mimeType) ? "attachment" : disposition,
				artifact.name,
			),
			"accept-ranges": "bytes",
			"cache-control": "private, no-store",
			"referrer-policy": "no-referrer",
			"x-content-type-options": "nosniff",
			// An HTML or SVG artifact must not run script on the backend's origin.
			"content-security-policy":
				"sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'",
		};
		const range = parseRange(request.headers.get("range"), size);
		if (range === null) return text(416, "Range not satisfiable", { "content-range": `bytes */${size}` });
		// Read small text responses before committing headers. A disk/read failure must be an HTTP
		// error with CORS, not a rejected body after a promised Content-Length ("Failed to fetch").
		const start = range?.start ?? 0;
		const end = range?.end ?? size - 1;
		const length = Math.max(0, end - start + 1);
		if (artifact.kind === "text" && length <= 256 * 1024 && request.method !== "HEAD") {
			const bytes = await file.slice(start, end + 1).arrayBuffer();
			if (bytes.byteLength !== length) throw new Error("artifact_size_changed");
			if (options.signer.verify(projectId, artifactId, url.searchParams.get("token")) === undefined)
				return text(403, "Invalid or expired artifact token");
			headers["content-length"] = String(bytes.byteLength);
			if (range) headers["content-range"] = `bytes ${start}-${end}/${size}`;
			return new Response(bytes, { status: range ? 206 : 200, headers });
		}
		if (range === undefined) {
			headers["content-length"] = String(size);
			return new Response(request.method === "HEAD" ? null : options.signer.stream(file, sessionId), {
				status: 200,
				headers,
			});
		}
		headers["content-range"] = `bytes ${range.start}-${range.end}/${size}`;
		headers["content-length"] = String(range.end - range.start + 1);
		return new Response(
			request.method === "HEAD" ? null : options.signer.stream(file.slice(range.start, range.end + 1), sessionId),
			{ status: 206, headers },
		);
	} catch {
		options.log?.(`artifacts: could not read ${projectId}/${artifactId}`);
		return text(500, "The backend could not read this artifact. Retry or save the file again.");
	}
}
