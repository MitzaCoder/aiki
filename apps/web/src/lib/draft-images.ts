/**
 * The bytes of images in drafts, and getting them to the backend. A draft holds references (`DraftAttachment`, the
 * SHA-256 of the bytes); the bytes stay here, on the device that attached them, until a write of the draft needs them
 * uploaded (`drafts.attachment.put`, once per image per time it is in the draft) and until another device asks for them
 * (`drafts.attachment.get`, which `MessageImages` does).
 */
import type { DraftAttachment, DraftContent } from "@aiki/protocol";
import { bytesToBase64 } from "./chat/images.ts";

/** Bytes by attachment ID, oldest dropped first once the total passes `maxBytes`. */
export class BytesCache {
	readonly #entries = new Map<string, Uint8Array>();
	#total = 0;
	readonly #maxBytes: number;

	constructor(maxBytes = 96 * 1024 * 1024) {
		this.#maxBytes = maxBytes;
	}

	get(id: string): Uint8Array | undefined {
		return this.#entries.get(id);
	}

	has(id: string): boolean {
		return this.#entries.has(id);
	}

	set(id: string, bytes: Uint8Array): void {
		const old = this.#entries.get(id);
		if (old !== undefined) {
			this.#total -= old.length;
			this.#entries.delete(id);
		}
		this.#entries.set(id, bytes);
		this.#total += bytes.length;
		for (const [oldest, held] of this.#entries) {
			if (this.#total <= this.#maxBytes || oldest === id) break;
			this.#entries.delete(oldest);
			this.#total -= held.length;
		}
	}
}

/** The device's one cache: every composer on the page shares it, so a message sent, failed and edited keeps its bytes. */
export const imageBytes = new BytesCache();

/**
 * Which of a chat's attachments the backend is known to hold. An image is uploaded the first time a write names it and
 * not again while every write since has named it; once a write leaves it out the backend may sweep it (10 minutes
 * after it is unreferenced), so naming it later uploads it again. The same bytes are one file there, so that is cheap.
 */
export class UploadTracker {
	#held = new Set<string>();

	constructor(
		private readonly cache: BytesCache,
		private readonly upload: (attachment: DraftAttachment, data: string) => Promise<unknown>,
	) {}

	/** Upload what `content` names that is not held yet. Throws when an upload does (the write is tried again later). */
	async ensure(content: DraftContent | null): Promise<void> {
		for (const attachment of content?.attachments ?? []) {
			if (this.#held.has(attachment.id)) continue;
			const bytes = this.cache.get(attachment.id);
			// Not here: it came from the backend, which therefore has it.
			if (bytes !== undefined) await this.upload(attachment, bytesToBase64(bytes));
			this.#held.add(attachment.id);
		}
	}

	/** Forget what is held, after a failed write: the backend may not have what was uploaded. */
	reset(): void {
		this.#held = new Set();
	}

	/** A write of `content` was accepted: what it leaves out is no longer held. */
	wrote(content: DraftContent | null): void {
		const named = new Set((content?.attachments ?? []).map((attachment) => attachment.id));
		this.#held = new Set([...this.#held].filter((id) => named.has(id)));
	}
}
