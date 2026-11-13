/**
 * The images a composer holds for the message being written, with runes so the thumbnails follow it. Used by the chat
 * composer (whose draft carries them as references, `refs`/`setRefs`) and the task sheet's reply box. Pure decisions are in
 * `images.ts`, decoding in `image-encode.ts`, the bytes cache and upload bookkeeping in `draft-images.ts`.
 */
import { untrack } from "svelte";
import type { DraftAttachment, InputImageMimeType } from "@kemiri/protocol";
import { imageBytes, type BytesCache } from "#lib/draft-images.js";
import { prepareImage } from "./image-encode.ts";
import { base64ToBytes, bytesToBase64, messageLimitError, sha256Hex, type HeldImage } from "./images.ts";
import { INPUT_MAX_IMAGES } from "@kemiri/protocol";

/** One attached image as the box shows it. */
export interface AttachedImage {
	id: string;
	mimeType: InputImageMimeType;
	size: number;
	name?: string;
	/** `loading`: another device's image still being read from the backend. */
	status: "ready" | "loading" | "failed";
	/** An object URL of the bytes, for the thumbnail and the lightbox; absent until `ready`. */
	url?: string;
}

export interface MessageImagesOptions {
	cache?: BytesCache;
	/** Read an image another device attached; absent: only images this device attached can show. */
	fetch?: (id: string) => Promise<{ mimeType: string; data: string }>;
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export class MessageImages {
	items = $state<AttachedImage[]>([]);
	/** What went wrong with the last attach, for a line under the box; cleared by the next attach or a removal. */
	error = $state<string | undefined>(undefined);
	/** Files being read and shrunk. */
	preparing = $state(0);

	readonly #cache: BytesCache;
	readonly #fetch: MessageImagesOptions["fetch"];
	#destroyed = false;

	constructor(options: MessageImagesOptions = {}) {
		this.#cache = options.cache ?? imageBytes;
		this.#fetch = options.fetch;
	}

	/** Nothing is still being read or fetched, and nothing failed to: the message can go. */
	get ready(): boolean {
		return this.preparing === 0 && this.items.every((item) => item.status === "ready");
	}

	get count(): number {
		return this.items.length;
	}

	/** The images as draft references, in order. */
	refs(): DraftAttachment[] {
		return this.items.map((item) => ({ id: item.id, mimeType: item.mimeType, size: item.size, ...(item.name === undefined ? {} : { name: item.name }) }));
	}

	/** The images as a send holds them, with their bytes; the ones that are not ready are left out. */
	held(): HeldImage[] {
		const held: HeldImage[] = [];
		for (const item of this.items) {
			const bytes = this.#cache.get(item.id);
			if (item.status !== "ready" || bytes === undefined) continue;
			held.push({ id: item.id, mimeType: item.mimeType, size: item.size, ...(item.name === undefined ? {} : { name: item.name }), data: bytesToBase64(bytes) });
		}
		return held;
	}

	/** Attach files (a paste, a drop, the picker). What cannot be used is named in `error`; the rest is added. */
	async add(files: readonly File[]): Promise<void> {
		this.error = undefined;
		const problems: string[] = [];
		for (const file of files) {
			const label = file.name === "" ? "An image" : file.name;
			if (this.items.length >= INPUT_MAX_IMAGES) {
				problems.push(`A message holds at most ${INPUT_MAX_IMAGES} images`);
				break;
			}
			this.preparing += 1;
			try {
				const prepared = await prepareImage(file);
				const id = await sha256Hex(prepared.bytes);
				if (this.#destroyed || this.items.some((item) => item.id === id)) continue;
				const bytes = this.items.reduce((sum, item) => sum + item.size, 0);
				const limit = messageLimitError({ count: this.items.length, bytes }, prepared.bytes.length, label);
				if (limit !== undefined) {
					problems.push(limit);
					continue;
				}
				this.#cache.set(id, prepared.bytes);
				this.items = [...this.items, this.#ready({ id, mimeType: prepared.mimeType, size: prepared.bytes.length, ...(prepared.name === undefined ? {} : { name: prepared.name }) })];
			} catch (error) {
				problems.push(`${label} ${messageOf(error)}`);
			} finally {
				this.preparing -= 1;
			}
		}
		if (problems.length > 0) this.error = [...new Set(problems)].join(" ");
	}

	remove(id: string): void {
		const gone = this.items.find((item) => item.id === id);
		if (gone === undefined) return;
		if (gone.url !== undefined) URL.revokeObjectURL(gone.url);
		this.items = this.items.filter((item) => item.id !== id);
		this.error = undefined;
	}

	/** Take the draft's references as what the box holds: keeps what is already shown, reads the rest. */
	setRefs(refs: readonly DraftAttachment[]): void {
		const shown = new Map(this.items.map((item) => [item.id, item]));
		const next: AttachedImage[] = [];
		const toFetch: AttachedImage[] = [];
		for (const ref of refs) {
			const known = shown.get(ref.id);
			if (known !== undefined && known.status !== "failed") {
				next.push(known);
				shown.delete(ref.id);
				continue;
			}
			const base = { id: ref.id, mimeType: ref.mimeType, size: ref.size, ...(ref.name === undefined ? {} : { name: ref.name }) };
			if (this.#cache.has(ref.id)) next.push(this.#ready(base));
			else {
				const loading: AttachedImage = { ...base, status: "loading" };
				next.push(loading);
				toFetch.push(loading);
			}
		}
		for (const gone of shown.values()) if (gone.url !== undefined) URL.revokeObjectURL(gone.url);
		this.items = next;
		for (const item of toFetch) void this.#read(item.id);
	}

	/** Put images that were taken out back (a send that failed, Edit on a waiting message), with their bytes. */
	restore(images: readonly HeldImage[]): void {
		for (const image of images) if (!this.#cache.has(image.id)) this.#cache.set(image.id, base64ToBytes(image.data));
		const have = new Set(this.items.map((item) => item.id));
		const extra = images.filter((image) => !have.has(image.id)).slice(0, Math.max(0, INPUT_MAX_IMAGES - this.items.length));
		if (extra.length === 0) return;
		this.items = [...this.items, ...extra.map(({ data: _data, ...ref }) => this.#ready(ref))];
	}

	/** Read again the images that could not be read (the connection is back). */
	retryFailed(): void {
		const failed = this.items.filter((item) => item.status === "failed");
		if (failed.length === 0) return;
		this.items = this.items.map((item) => (item.status === "failed" ? { ...item, status: "loading" as const } : item));
		for (const item of failed) void this.#read(item.id);
	}

	/** Empty the box (the message was sent). */
	clear(): void {
		// Read without subscribing: an effect that empties the box must not run again because it did.
		for (const item of untrack(() => this.items)) if (item.url !== undefined) URL.revokeObjectURL(item.url);
		this.items = [];
		this.error = undefined;
	}

	destroy(): void {
		this.#destroyed = true;
		for (const item of this.items) if (item.url !== undefined) URL.revokeObjectURL(item.url);
	}

	#ready(base: DraftAttachment): AttachedImage {
		const bytes = this.#cache.get(base.id);
		const blob = bytes === undefined ? undefined : new Blob([bytes as BlobPart], { type: base.mimeType });
		return { ...base, status: bytes === undefined ? "failed" : "ready", ...(blob === undefined ? {} : { url: URL.createObjectURL(blob) }) };
	}

	async #read(id: string): Promise<void> {
		let found: { mimeType: string; data: string } | undefined;
		try {
			found = this.#fetch === undefined ? undefined : await this.#fetch(id);
		} catch {
			found = undefined;
		}
		if (this.#destroyed) return;
		const current = this.items.find((item) => item.id === id);
		if (current === undefined) return;
		if (found === undefined) {
			this.items = this.items.map((item) => (item.id === id ? { ...item, status: "failed" } : item));
			return;
		}
		this.#cache.set(id, base64ToBytes(found.data));
		const { status: _status, url: _url, ...base } = current;
		this.items = this.items.map((item) => (item.id === id ? this.#ready(base) : item));
	}
}
