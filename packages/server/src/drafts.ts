/**
 * Chat drafts: what a user has typed in a chat's composer and not sent, per project and chat (main or a thread),
 * kept so every device sees the same one (feature `chat-drafts`; see "Chat drafts" in docs/DESIGN.md).
 *
 * Layout: `<data>/projects/<id>/drafts.json` holds `{ version: 1, drafts: ChatDraft[] }`, written atomically; a
 * cleared draft stays as an entry with `content: null` (a tombstone) so a device that was away can tell. Entries not
 * changed for 30 days are dropped when the file is read. Images are `<data>/projects/<id>/draft-attachments/<sha256>.<ext>`,
 * uploaded once and referenced by the draft; one nothing references any more, and older than a grace period, is deleted
 * after every write. Writes to one project run one at a time.
 */
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	type ChatDraft,
	DRAFT_ATTACHMENT_MAX_BYTES,
	DRAFT_ATTACHMENT_MIME_TYPES,
	DRAFT_MAX_AGE_MS,
	DRAFTS_MAX_PER_PROJECT,
	type DraftAttachment,
	type DraftAuthor,
	type DraftContent,
	type DraftsChangedEvent,
	draftLimitError,
	isEmptyDraftContent,
	sameDraftContent,
} from "@aiki/protocol";
import { ServerError, errorMessage } from "./errors.ts";
import { readJsonFile, writeJsonFile } from "./fs-json.ts";

export const DRAFTS_FILE = "drafts.json";
export const DRAFT_ATTACHMENTS_DIR = "draft-attachments";
/** An unreferenced upload is kept this long: the upload comes just before the `drafts.set` that names it. */
export const DRAFT_ATTACHMENT_GRACE_MS = 10 * 60 * 1000;

const EXTENSIONS: Record<(typeof DRAFT_ATTACHMENT_MIME_TYPES)[number], string> = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/webp": "webp",
	"image/gif": "gif",
};

interface DraftsFile {
	version: 1;
	drafts: ChatDraft[];
}

export interface DraftStoreOptions {
	dataDir: string;
	now?: () => number;
	/** Called after every change; `origin` is whatever the writer passed to `set`, so its connection can be skipped. */
	onChange?: (event: DraftsChangedEvent, origin: unknown) => void;
	log?: (message: string) => void;
}

export interface DraftSetResult {
	applied: boolean;
	draft: ChatDraft | null;
}

export class DraftStore {
	readonly #dataDir: string;
	readonly #now: () => number;
	readonly #onChange: DraftStoreOptions["onChange"];
	readonly #log: (message: string) => void;
	/** The tail of each project's write queue. */
	readonly #queue = new Map<string, Promise<unknown>>();

	constructor(options: DraftStoreOptions) {
		this.#dataDir = options.dataDir;
		this.#now = options.now ?? Date.now;
		this.#onChange = options.onChange;
		this.#log = options.log ?? (() => undefined);
	}

	/** One chat's entry (an empty list when it has none), or every entry of the project, tombstones included. */
	async get(projectId: string, threadId?: string): Promise<ChatDraft[]> {
		const file = await this.#run(projectId, async () => this.#read(projectId));
		return threadId === undefined ? file.drafts : file.drafts.filter((entry) => entry.threadId === threadId);
	}

	/** Compare-and-set one chat's draft, as `drafts.set` describes. */
	async set(
		projectId: string,
		threadId: string,
		content: DraftContent | null,
		baseRevision: number,
		author: DraftAuthor | undefined,
		origin?: unknown,
	): Promise<DraftSetResult> {
		const stored = content === null || isEmptyDraftContent(content) ? null : content;
		if (stored !== null) {
			const problem = draftLimitError(stored);
			if (problem !== undefined) throw new ServerError("bad_request", problem);
			for (const attachment of stored.attachments ?? []) {
				if ((await this.#attachmentFile(projectId, attachment.id)) === undefined) {
					throw new ServerError("bad_request", `Unknown draft attachment ${attachment.id}; upload it first`);
				}
			}
		}
		const result = await this.#run(projectId, async () => {
			const file = await this.#read(projectId);
			const at = file.drafts.findIndex((entry) => entry.threadId === threadId);
			const current = file.drafts[at];
			// Nothing to clear, or the same content again (a retry after a lost answer): applied, no new revision.
			if (current === undefined ? stored === null : sameDraftContent(current.content, stored)) {
				return { applied: true, draft: current ?? null, changed: false };
			}
			if (baseRevision !== (current?.revision ?? 0)) return { applied: false, draft: current ?? null, changed: false };
			const entry: ChatDraft = {
				projectId,
				threadId,
				revision: (current?.revision ?? 0) + 1,
				updatedAt: new Date(this.#now()).toISOString(),
				...(author === undefined ? {} : { author }),
				content: stored,
			};
			await this.#save(projectId, file, entry);
			return { applied: true, draft: entry, changed: true };
		});
		if (result.changed && result.draft !== null) {
			this.#emit({ type: "drafts.changed", projectId, threadId, draft: result.draft }, origin);
		}
		return { applied: result.applied, draft: result.draft };
	}

	/** The store's clock, in ms. */
	now(): number {
		return this.#now();
	}

	/**
	 * The message to a chat was accepted: its draft is spent. A chat with no draft is left alone, and so is one written
	 * at or after `notAfter` (when the message arrived): that is text typed since sending it.
	 */
	async clear(projectId: string, threadId: string, notAfter?: number): Promise<void> {
		const entry = await this.#run(projectId, async () => {
			const file = await this.#read(projectId);
			const current = file.drafts.find((candidate) => candidate.threadId === threadId);
			if (current === undefined || current.content === null) return undefined;
			if (notAfter !== undefined && Date.parse(current.updatedAt) >= notAfter) return undefined;
			const cleared: ChatDraft = {
				projectId,
				threadId,
				revision: current.revision + 1,
				updatedAt: new Date(this.#now()).toISOString(),
				content: null,
			};
			await this.#save(projectId, file, cleared);
			return cleared;
		});
		if (entry !== undefined) this.#emit({ type: "drafts.changed", projectId, threadId, draft: entry }, undefined);
	}

	/** Store an image once; the same bytes again are the same file. */
	async putAttachment(projectId: string, mimeType: string, data: string, name: string | undefined): Promise<DraftAttachment> {
		const extension = EXTENSIONS[mimeType as keyof typeof EXTENSIONS];
		if (extension === undefined) {
			throw new ServerError("bad_request", `A draft attachment is one of ${DRAFT_ATTACHMENT_MIME_TYPES.join(", ")}`);
		}
		// Base64 is 4 characters per 3 bytes; refuse before decoding what would be too big anyway.
		if (data.length > Math.ceil((DRAFT_ATTACHMENT_MAX_BYTES * 4) / 3) + 4) {
			throw new ServerError("bad_request", `A draft attachment is at most ${DRAFT_ATTACHMENT_MAX_BYTES} bytes`);
		}
		const bytes = Buffer.from(data, "base64");
		if (bytes.length > DRAFT_ATTACHMENT_MAX_BYTES) {
			throw new ServerError("bad_request", `A draft attachment is at most ${DRAFT_ATTACHMENT_MAX_BYTES} bytes`);
		}
		if (bytes.length === 0) throw new ServerError("bad_request", "A draft attachment is empty");
		const id = createHash("sha256").update(bytes).digest("hex");
		await this.#run(projectId, async () => {
			const dir = this.#attachmentsDir(projectId);
			await mkdir(dir, { recursive: true, mode: 0o700 });
			await writeFile(join(dir, `${id}.${extension}`), bytes, { mode: 0o600 });
		});
		return { id, mimeType: mimeType as DraftAttachment["mimeType"], size: bytes.length, ...(name === undefined ? {} : { name }) };
	}

	async getAttachment(projectId: string, attachmentId: string): Promise<{ attachment: DraftAttachment; data: string }> {
		const found = await this.#attachmentFile(projectId, attachmentId);
		if (found === undefined) throw new ServerError("bad_request", `No draft attachment ${attachmentId}`);
		const bytes = await readFile(found.path);
		return { attachment: { id: attachmentId, mimeType: found.mimeType, size: bytes.length }, data: bytes.toString("base64") };
	}

	#path(projectId: string): string {
		return join(this.#dataDir, "projects", projectId, DRAFTS_FILE);
	}

	#attachmentsDir(projectId: string): string {
		return join(this.#dataDir, "projects", projectId, DRAFT_ATTACHMENTS_DIR);
	}

	async #attachmentFile(
		projectId: string,
		attachmentId: string,
	): Promise<{ path: string; mimeType: DraftAttachment["mimeType"] } | undefined> {
		for (const mimeType of DRAFT_ATTACHMENT_MIME_TYPES) {
			const path = join(this.#attachmentsDir(projectId), `${attachmentId}.${EXTENSIONS[mimeType]}`);
			if (await stat(path).then((info) => info.isFile(), () => false)) return { path, mimeType };
		}
		return undefined;
	}

	/** The project's entries with the expired ones left out. A corrupt file is treated as none rather than blocking typing. */
	async #read(projectId: string): Promise<DraftsFile> {
		let value: unknown;
		try {
			value = await readJsonFile(this.#path(projectId));
		} catch (error) {
			this.#log(`project ${projectId}: could not read drafts: ${errorMessage(error)}`);
			return { version: 1, drafts: [] };
		}
		const rows = (value as Partial<DraftsFile> | undefined)?.drafts;
		const now = this.#now();
		const drafts = (Array.isArray(rows) ? rows : []).filter(
			(entry) => entry !== null && typeof entry === "object" && now - Date.parse(entry.updatedAt) <= DRAFT_MAX_AGE_MS,
		);
		return { version: 1, drafts };
	}

	/** Write `entry` into the file (the oldest entries go over the cap) and sweep attachments nothing points to. */
	async #save(projectId: string, file: DraftsFile, entry: ChatDraft): Promise<void> {
		const drafts = file.drafts.filter((candidate) => candidate.threadId !== entry.threadId);
		drafts.push(entry);
		drafts.sort((left, right) => Date.parse(left.updatedAt) - Date.parse(right.updatedAt));
		const kept = drafts.slice(Math.max(0, drafts.length - DRAFTS_MAX_PER_PROJECT));
		await writeJsonFile(this.#path(projectId), { version: 1, drafts: kept } satisfies DraftsFile);
		file.drafts = kept;
		await this.#sweepAttachments(projectId, kept).catch((error: unknown) => {
			this.#log(`project ${projectId}: could not sweep draft attachments: ${errorMessage(error)}`);
		});
	}

	async #sweepAttachments(projectId: string, drafts: readonly ChatDraft[]): Promise<void> {
		const dir = this.#attachmentsDir(projectId);
		let names: string[];
		try {
			names = await readdir(dir);
		} catch {
			return;
		}
		const referenced = new Set(drafts.flatMap((entry) => (entry.content?.attachments ?? []).map((attachment) => attachment.id)));
		const now = this.#now();
		for (const name of names) {
			if (referenced.has(name.split(".")[0] ?? "")) continue;
			const info = await stat(join(dir, name)).catch(() => undefined);
			if (info !== undefined && now - info.mtimeMs >= DRAFT_ATTACHMENT_GRACE_MS) await rm(join(dir, name), { force: true });
		}
	}

	async #run<T>(projectId: string, task: () => Promise<T>): Promise<T> {
		const previous = this.#queue.get(projectId) ?? Promise.resolve();
		const next = previous.catch(() => undefined).then(task);
		this.#queue.set(projectId, next);
		return next;
	}

	#emit(event: DraftsChangedEvent, origin: unknown): void {
		try {
			this.#onChange?.(event, origin);
		} catch (error) {
			this.#log(`drafts: change listener failed: ${errorMessage(error)}`);
		}
	}
}
