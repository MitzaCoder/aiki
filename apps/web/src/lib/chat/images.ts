/**
 * Images in a message, the pure parts: which files a paste or drop holds, whether an image goes as it is or is shrunk,
 * what a message's limits allow, and the content a send carries. The limits are the protocol's (`images.ts` there);
 * `image-encode.ts` does the decoding and re-encoding in the browser and follows the plan made here.
 */
import {
	INPUT_IMAGE_MAX_BYTES,
	INPUT_IMAGE_MAX_EDGE,
	INPUT_IMAGES_MAX_BYTES,
	INPUT_MAX_IMAGES,
	isInputImageMimeType,
	type ContentBlock,
	type DraftAttachment,
	type InputContent,
	type InputImageMimeType,
} from "@kemiri/protocol";

/** The smallest long edge a shrunk image is stepped down to before giving up. */
export const MIN_ENCODE_EDGE = 800;

/** The part of a `File` this file reads (so tests need no DOM). */
export interface FileLike {
	name: string;
	size: number;
	type: string;
	lastModified?: number;
}

/** The part of a `DataTransfer` this file reads. */
export interface TransferLike<F extends FileLike = FileLike> {
	files?: ArrayLike<F> | null;
	items?: ArrayLike<{ kind: string; type: string; getAsFile(): F | null }> | null;
	types?: ArrayLike<string> | null;
	getData?(format: string): string;
}

function isImageType(type: string): boolean {
	return type.toLowerCase().startsWith("image/");
}

/**
 * The image files in a paste, a drop or a file picker, each once (browsers list one clipboard image under both `files`
 * and `items`). Anything of image type counts, also ones the protocol does not take (bmp, avif): `planImage` decides
 * what to do with those.
 */
export function imageFilesOf<F extends FileLike>(data: TransferLike<F> | null | undefined): F[] {
	if (data === null || data === undefined) return [];
	const found: F[] = [];
	const add = (file: F | null | undefined): void => {
		if (file === null || file === undefined || !isImageType(file.type)) return;
		const same = found.some((other) => other === file || (other.name === file.name && other.size === file.size && other.type === file.type && other.lastModified === file.lastModified));
		if (!same) found.push(file);
	};
	for (const file of Array.from(data.files ?? [])) add(file);
	for (const item of Array.from(data.items ?? [])) {
		if (item.kind === "file" && isImageType(item.type)) add(item.getAsFile());
	}
	return found;
}

/** Whether a drag holds files, so a box can light up while one is over it (the files themselves are hidden until the drop). */
export function dragHasFiles(data: TransferLike | null | undefined): boolean {
	return Array.from(data?.types ?? []).includes("Files");
}

/**
 * Whether a paste is images and not text. A clipboard with an image and no text (a screenshot, "Copy image") is. One with
 * both (cells copied from a spreadsheet come with a picture of them) is text: pasting words the user copied as words
 * is what they expect, and the attach button is there for the picture.
 */
export function pasteIsImages(data: TransferLike | null | undefined): boolean {
	if (imageFilesOf(data).length === 0) return false;
	const text = Array.from(data?.types ?? []).includes("text/plain") ? (data?.getData?.("text/plain") ?? "") : "";
	return text.trim().length === 0;
}

/** Scale a size so its long edge is at most `maxEdge`, keeping the shape; never up. */
export function fitWithin(width: number, height: number, maxEdge: number = INPUT_IMAGE_MAX_EDGE): { width: number; height: number } {
	const long = Math.max(width, height);
	if (long <= maxEdge) return { width, height };
	const scale = maxEdge / long;
	return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export type EncodeType = "image/png" | "image/jpeg" | "image/webp";

/** One way to encode an image: its size, type and quality (0-1, for jpeg and webp). */
export interface EncodeAttempt {
	width: number;
	height: number;
	type: EncodeType;
	quality?: number;
}

export type ImagePlan =
	/** Send the bytes as they are. */
	| { action: "keep" }
	/** Draw and encode in these ways, in order, until one is at most 5 MiB. */
	| { action: "encode"; attempts: EncodeAttempt[] }
	| { action: "reject"; reason: string };

function ownType(type: string): EncodeType | undefined {
	switch (type.toLowerCase()) {
		case "image/png":
			return "image/png";
		case "image/jpeg":
		case "image/jpg":
			return "image/jpeg";
		case "image/webp":
			return "image/webp";
		default:
			return undefined;
	}
}

/**
 * What to do with one image. It goes as it is when it is one of the four types, within 5 MiB and at most 2000 px on its
 * long edge (a PNG screenshot stays a PNG, a GIF stays animated). Otherwise it is shrunk to 2000 px and encoded in its
 * own format; when that is still over 5 MiB, or the format is not one the protocol takes, the attempts go on to JPEG
 * and step the size down by a quarter until the image fits or would be under `MIN_ENCODE_EDGE`. A GIF over the limit
 * is refused: drawing it would keep one frame.
 */
export function planImage(input: { type: string; size: number; width: number; height: number }): ImagePlan {
	const { type, size, width, height } = input;
	const long = Math.max(width, height);
	if (type.toLowerCase() === "image/gif") {
		return size <= INPUT_IMAGE_MAX_BYTES
			? { action: "keep" }
			: { action: "reject", reason: `is a GIF over ${megabytes(INPUT_IMAGE_MAX_BYTES)} MB, and shrinking it would lose the animation` };
	}
	if (isInputImageMimeType(type) && size <= INPUT_IMAGE_MAX_BYTES && long <= INPUT_IMAGE_MAX_EDGE) return { action: "keep" };
	const first = fitWithin(width, height);
	const own = ownType(type) ?? "image/png";
	const attempts: EncodeAttempt[] = [{ ...first, type: own, ...(own === "image/png" ? {} : { quality: 0.92 }) }];
	if (own !== "image/jpeg") attempts.push({ ...first, type: "image/jpeg", quality: 0.9 });
	let edge = Math.max(first.width, first.height);
	for (;;) {
		edge = Math.round(edge * 0.75);
		if (edge < MIN_ENCODE_EDGE) break;
		attempts.push({ ...fitWithin(width, height, edge), type: "image/jpeg", quality: 0.85 });
	}
	return { action: "encode", attempts };
}

function megabytes(bytes: number): string {
	return String(Math.round((bytes / (1024 * 1024)) * 10) / 10);
}

/** What is already in a message when more is added: how many images and their bytes together. */
export interface MessageImageTotals {
	count: number;
	bytes: number;
}

/** The image ready to add, as a number of bytes; or the reason it does not fit in the message (undefined when it does). */
export function messageLimitError(held: MessageImageTotals, size: number, name?: string): string | undefined {
	const label = name === undefined || name === "" ? "This image" : name;
	if (held.count + 1 > INPUT_MAX_IMAGES) return `A message holds at most ${INPUT_MAX_IMAGES} images`;
	if (held.bytes + size > INPUT_IMAGES_MAX_BYTES) {
		return `${label} would take the message's images over ${megabytes(INPUT_IMAGES_MAX_BYTES)} MB together`;
	}
	return undefined;
}

/** A message's images as sent. */
export interface SentImage {
	mimeType: string;
	/** Base64. */
	data: string;
}

/** What a send carries: the plain text when there is no image, else the text (if any) and then the images, as blocks (Android's order). */
export function inputContent(text: string, images: readonly SentImage[]): InputContent {
	if (images.length === 0) return text;
	const blocks: ContentBlock[] = text.length > 0 ? [{ type: "text", text }] : [];
	for (const image of images) blocks.push({ type: "image", data: image.data, mimeType: image.mimeType });
	return blocks;
}

/** A short word for the count, for places that have no room for the pictures: "1 image", "3 images". */
export function imageCountLabel(count: number): string {
	return count === 1 ? "1 image" : `${count} images`;
}

export function isSupportedType(type: string): type is InputImageMimeType {
	return isInputImageMimeType(type);
}

/** An image a message holds: its draft reference and its bytes as base64 (what a send puts in the `image` block). */
export type HeldImage = DraftAttachment & { data: string };

export function bytesToBase64(bytes: Uint8Array): string {
	let binary = "";
	for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
	return btoa(binary);
}

export function base64ToBytes(data: string): Uint8Array {
	const binary = atob(data);
	const bytes = new Uint8Array(binary.length);
	for (let at = 0; at < binary.length; at += 1) bytes[at] = binary.charCodeAt(at);
	return bytes;
}

/** The SHA-256 of some bytes in lowercase hex: an attachment's ID. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The `data:` URL of a held image or a transcript image, for an `<img>` or the lightbox. */
export function dataUrl(image: { mimeType: string; data: string }): string {
	return `data:${image.mimeType};base64,${image.data}`;
}
