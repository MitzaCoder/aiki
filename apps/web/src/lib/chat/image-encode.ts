/**
 * Reading an image the user attached and shrinking it if the limits ask (the decisions are `planImage`'s, in
 * `images.ts`). Browser only: it decodes with `createImageBitmap` and draws on a canvas.
 */
import { INPUT_IMAGE_MAX_BYTES, type InputImageMimeType } from "@aiki/protocol";
import { planImage, type EncodeAttempt, type FileLike } from "./images.ts";

/** An image ready to go in a message. */
export interface PreparedImage {
	mimeType: InputImageMimeType;
	bytes: Uint8Array;
	name?: string;
}

/** Why an image cannot be used, in words for the user (the file's name goes in front). */
export class ImageProblem extends Error {}

const EXTENSIONS: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

function renamed(name: string | undefined, type: string): string | undefined {
	if (name === undefined || name === "") return undefined;
	const extension = EXTENSIONS[type];
	if (extension === undefined) return name;
	const stem = name.replace(/\.[^./\\]+$/, "");
	return `${stem}.${extension}`;
}

async function encodeCanvas(bitmap: ImageBitmap, attempt: EncodeAttempt): Promise<Blob | undefined> {
	const canvas = typeof OffscreenCanvas === "undefined" ? document.createElement("canvas") : new OffscreenCanvas(attempt.width, attempt.height);
	canvas.width = attempt.width;
	canvas.height = attempt.height;
	const context = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
	if (context === null) return undefined;
	// JPEG has no transparency: what shows through is white, not black.
	if (attempt.type === "image/jpeg") {
		context.fillStyle = "#fff";
		context.fillRect(0, 0, attempt.width, attempt.height);
	}
	context.imageSmoothingQuality = "high";
	context.drawImage(bitmap, 0, 0, attempt.width, attempt.height);
	const blob =
		canvas instanceof HTMLCanvasElement
			? await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, attempt.type, attempt.quality))
			: await canvas.convertToBlob({ type: attempt.type, ...(attempt.quality === undefined ? {} : { quality: attempt.quality }) });
	// A browser that cannot encode the type answers with a PNG: that is not what was asked for.
	return blob === null || blob.type !== attempt.type ? undefined : blob;
}

/** Read an attached file: as it is when it fits the limits, else shrunk. Throws `ImageProblem` when it cannot be used. */
export async function prepareImage(file: File & FileLike): Promise<PreparedImage> {
	let bitmap: ImageBitmap;
	try {
		bitmap = await createImageBitmap(file);
	} catch {
		throw new ImageProblem("could not be read as an image");
	}
	try {
		const plan = planImage({ type: file.type, size: file.size, width: bitmap.width, height: bitmap.height });
		if (plan.action === "reject") throw new ImageProblem(plan.reason);
		if (plan.action === "keep") {
			return { mimeType: file.type as InputImageMimeType, bytes: new Uint8Array(await file.arrayBuffer()), ...(file.name === "" ? {} : { name: file.name }) };
		}
		for (const attempt of plan.attempts) {
			const blob = await encodeCanvas(bitmap, attempt);
			if (blob === undefined || blob.size > INPUT_IMAGE_MAX_BYTES) continue;
			const name = renamed(file.name, attempt.type);
			return { mimeType: attempt.type, bytes: new Uint8Array(await blob.arrayBuffer()), ...(name === undefined ? {} : { name }) };
		}
		throw new ImageProblem("is too large, even shrunk");
	} finally {
		bitmap.close();
	}
}
