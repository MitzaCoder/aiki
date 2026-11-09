/**
 * The images a user message may carry (`conversation.submit` content, `image` blocks) and a draft may hold. One set of
 * limits for every client: the server refuses a submit that breaks them (`bad_request`), clients check first and say
 * what is wrong in the composer. The model's own view of an image is smaller still (providers scale to about 1.5k px),
 * so `INPUT_IMAGE_MAX_EDGE` is the size clients shrink to, not a refusal.
 */
import type { InputContent } from "./common.ts";

export const INPUT_IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export type InputImageMimeType = (typeof INPUT_IMAGE_MIME_TYPES)[number];
/** One image's bytes, decoded. */
export const INPUT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
/** Images in one message. Drafts hold the same number of references. */
export const INPUT_MAX_IMAGES = 8;
/** All images of one message together, decoded (base64 makes it a third more: the 32 MiB WebSocket frame stays clear). */
export const INPUT_IMAGES_MAX_BYTES = 20 * 1024 * 1024;
/** Clients scale a larger image down to this many pixels on the long edge before sending. */
export const INPUT_IMAGE_MAX_EDGE = 2000;

export function isInputImageMimeType(value: string): value is InputImageMimeType {
	return (INPUT_IMAGE_MIME_TYPES as readonly string[]).includes(value);
}

/** The decoded size of a base64 string, without decoding it. */
export function base64ByteLength(data: string): number {
	const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
	return Math.max(0, Math.floor((data.length * 3) / 4) - padding);
}

/** Why a message's images break the limits, or undefined. Text-only content is always fine. */
export function inputImagesError(content: InputContent): string | undefined {
	if (typeof content === "string") return undefined;
	let count = 0;
	let total = 0;
	for (const block of content) {
		if (block.type !== "image") continue;
		count += 1;
		if (!isInputImageMimeType(block.mimeType)) {
			return `An image is one of ${INPUT_IMAGE_MIME_TYPES.join(", ")}, not ${block.mimeType}`;
		}
		const bytes = base64ByteLength(block.data);
		if (bytes > INPUT_IMAGE_MAX_BYTES) return `An image is at most ${INPUT_IMAGE_MAX_BYTES} bytes`;
		total += bytes;
	}
	if (count > INPUT_MAX_IMAGES) return `A message holds at most ${INPUT_MAX_IMAGES} images`;
	if (total > INPUT_IMAGES_MAX_BYTES) return `A message's images are at most ${INPUT_IMAGES_MAX_BYTES} bytes together`;
	return undefined;
}
