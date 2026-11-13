/**
 * Images in a message: which files a paste holds, what happens to an image of a given size, the message's limits, the
 * content a send carries, the bytes cache and upload bookkeeping of drafts, and waiting messages that keep their images.
 */
import { describe, expect, test } from "bun:test";
import { INPUT_IMAGE_MAX_BYTES, INPUT_IMAGES_MAX_BYTES, INPUT_MAX_IMAGES, type DraftContent, type QueuedInput } from "@kemiri/protocol";
import {
	MIN_ENCODE_EDGE,
	base64ToBytes,
	bytesToBase64,
	dragHasFiles,
	fitWithin,
	imageCountLabel,
	imageFilesOf,
	inputContent,
	messageLimitError,
	pasteIsImages,
	planImage,
	sha256Hex,
	type FileLike,
	type HeldImage,
} from "../src/lib/chat/images.ts";
import { BytesCache, UploadTracker } from "../src/lib/draft-images.ts";
import { waitingMessages, withWaiting, type LocalSend } from "../src/lib/waiting.ts";

const MIB = 1024 * 1024;

function file(name: string, type: string, size = 10, lastModified = 1): FileLike {
	return { name, type, size, lastModified };
}

describe("imageFilesOf", () => {
	test("takes the images of a clipboard once, whether they are under files or items", () => {
		const shot = file("image.png", "image/png");
		const items = [
			{ kind: "file", type: "image/png", getAsFile: () => shot },
			{ kind: "string", type: "text/plain", getAsFile: () => null },
		];
		expect(imageFilesOf({ files: [shot], items })).toEqual([shot]);
		expect(imageFilesOf({ items })).toEqual([shot]);
	});

	test("ignores files that are not images, and nothing", () => {
		expect(imageFilesOf({ files: [file("notes.pdf", "application/pdf"), file("a.png", "image/png")] }).map((f) => f.name)).toEqual(["a.png"]);
		expect(imageFilesOf(null)).toEqual([]);
		expect(imageFilesOf({})).toEqual([]);
	});

	test("two different files with one name are both kept", () => {
		const first = file("image.png", "image/png", 10, 1);
		const second = file("image.png", "image/png", 12, 2);
		expect(imageFilesOf({ files: [first, second] })).toHaveLength(2);
	});

	test("keeps types the protocol does not take: the plan decides what to do with them", () => {
		expect(imageFilesOf({ files: [file("a.bmp", "image/bmp")] })).toHaveLength(1);
	});
});

describe("paste and drag", () => {
	const png = file("image.png", "image/png");
	test("an image alone is a paste of images", () => {
		expect(pasteIsImages({ files: [png], types: ["Files"] })).toBe(true);
	});
	test("an image with text is a paste of text (copied spreadsheet cells come with a picture)", () => {
		expect(pasteIsImages({ files: [png], types: ["text/plain", "Files"], getData: () => "a\tb" })).toBe(false);
	});
	test("an image with empty text is images", () => {
		expect(pasteIsImages({ files: [png], types: ["text/plain", "Files"], getData: () => "  " })).toBe(true);
	});
	test("text alone is not", () => {
		expect(pasteIsImages({ files: [], types: ["text/plain"], getData: () => "hi" })).toBe(false);
	});
	test("a drag holds files when its types say so", () => {
		expect(dragHasFiles({ types: ["Files"] })).toBe(true);
		expect(dragHasFiles({ types: ["text/plain"] })).toBe(false);
		expect(dragHasFiles(null)).toBe(false);
	});
});

describe("fitWithin", () => {
	test("keeps the shape and never scales up", () => {
		expect(fitWithin(4000, 2000)).toEqual({ width: 2000, height: 1000 });
		expect(fitWithin(1000, 3000)).toEqual({ width: 667, height: 2000 });
		expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
		expect(fitWithin(1, 100000)).toEqual({ width: 1, height: 2000 });
	});
});

describe("planImage", () => {
	test("a screenshot within the limits goes as it is, PNG stays PNG", () => {
		expect(planImage({ type: "image/png", size: 800_000, width: 1920, height: 1080 })).toEqual({ action: "keep" });
		expect(planImage({ type: "image/png", size: INPUT_IMAGE_MAX_BYTES, width: 2000, height: 1500 })).toEqual({ action: "keep" });
	});

	test("a big screenshot is drawn at 2000 px and stays PNG when that is enough", () => {
		const plan = planImage({ type: "image/png", size: 3 * MIB, width: 3840, height: 2160 });
		if (plan.action !== "encode") throw new Error("expected encode");
		expect(plan.attempts[0]).toEqual({ width: 2000, height: 1125, type: "image/png" });
		// Then JPEG at the same size, then smaller ones, never under the floor.
		expect(plan.attempts[1]).toMatchObject({ width: 2000, height: 1125, type: "image/jpeg" });
		expect(plan.attempts.slice(2).every((attempt) => attempt.type === "image/jpeg")).toBe(true);
		const edges = plan.attempts.map((attempt) => Math.max(attempt.width, attempt.height));
		expect(edges).toEqual([...edges].sort((a, b) => b - a));
		expect(Math.min(...edges)).toBeGreaterThanOrEqual(MIN_ENCODE_EDGE);
	});

	test("a small image over 5 MiB (a lossless screenshot) is encoded again at its size", () => {
		const plan = planImage({ type: "image/png", size: 6 * MIB, width: 1900, height: 1200 });
		if (plan.action !== "encode") throw new Error("expected encode");
		expect(plan.attempts[0]).toEqual({ width: 1900, height: 1200, type: "image/png" });
	});

	test("a big jpeg or webp stays its own format first", () => {
		const jpeg = planImage({ type: "image/jpeg", size: 9 * MIB, width: 6000, height: 4000 });
		const webp = planImage({ type: "image/webp", size: 2 * MIB, width: 5000, height: 2500 });
		if (jpeg.action !== "encode" || webp.action !== "encode") throw new Error("expected encode");
		expect(jpeg.attempts[0]).toMatchObject({ width: 2000, height: 1333, type: "image/jpeg" });
		expect(jpeg.attempts.filter((attempt) => attempt.width === 2000)).toHaveLength(1);
		expect(webp.attempts[0]).toMatchObject({ width: 2000, height: 1000, type: "image/webp" });
		expect(webp.attempts[1]).toMatchObject({ type: "image/jpeg" });
	});

	test("a type the protocol does not take is encoded, as PNG first", () => {
		const plan = planImage({ type: "image/bmp", size: 100_000, width: 300, height: 200 });
		if (plan.action !== "encode") throw new Error("expected encode");
		expect(plan.attempts[0]).toEqual({ width: 300, height: 200, type: "image/png" });
	});

	test("a GIF is kept within 5 MiB at any size, and refused over, never re-encoded", () => {
		expect(planImage({ type: "image/gif", size: MIB, width: 5000, height: 5000 })).toEqual({ action: "keep" });
		const over = planImage({ type: "image/gif", size: 6 * MIB, width: 500, height: 500 });
		expect(over.action).toBe("reject");
		if (over.action === "reject") expect(over.reason).toContain("GIF");
	});
});

describe("messageLimitError", () => {
	test("allows images up to the count and the total", () => {
		expect(messageLimitError({ count: 0, bytes: 0 }, INPUT_IMAGE_MAX_BYTES)).toBeUndefined();
		expect(messageLimitError({ count: INPUT_MAX_IMAGES - 1, bytes: 0 }, 1)).toBeUndefined();
	});
	test("names the count and the total", () => {
		expect(messageLimitError({ count: INPUT_MAX_IMAGES, bytes: 0 }, 1)).toContain(`${INPUT_MAX_IMAGES} images`);
		expect(messageLimitError({ count: 4, bytes: INPUT_IMAGES_MAX_BYTES - 10 }, 11, "big.png")).toContain("big.png");
	});
});

describe("inputContent", () => {
	const image: HeldImage = { id: "a".repeat(64), mimeType: "image/png", size: 3, data: "QUJD" };
	test("no image is the plain text", () => {
		expect(inputContent("hello", [])).toBe("hello");
	});
	test("text then the images, in order", () => {
		expect(inputContent("look", [image, { ...image, mimeType: "image/jpeg" }])).toEqual([
			{ type: "text", text: "look" },
			{ type: "image", data: "QUJD", mimeType: "image/png" },
			{ type: "image", data: "QUJD", mimeType: "image/jpeg" },
		]);
	});
	test("images alone carry no text block", () => {
		expect(inputContent("", [image])).toEqual([{ type: "image", data: "QUJD", mimeType: "image/png" }]);
	});
	test("counts in words", () => {
		expect(imageCountLabel(1)).toBe("1 image");
		expect(imageCountLabel(3)).toBe("3 images");
	});
});

describe("bytes", () => {
	test("base64 round trips, also over the chunk size", () => {
		const bytes = new Uint8Array(100_000).map((_, at) => at % 251);
		expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
	});
	test("the ID is the SHA-256 in hex", async () => {
		expect(await sha256Hex(new TextEncoder().encode("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
	});
});

describe("BytesCache", () => {
	test("drops the oldest bytes past its size, never the one just put", () => {
		const cache = new BytesCache(10);
		cache.set("a", new Uint8Array(6));
		cache.set("b", new Uint8Array(6));
		expect(cache.has("a")).toBe(false);
		expect(cache.has("b")).toBe(true);
		cache.set("c", new Uint8Array(20));
		expect(cache.has("c")).toBe(true);
		expect(cache.has("b")).toBe(false);
	});
});

describe("UploadTracker", () => {
	const ref = (id: string) => ({ id, mimeType: "image/png" as const, size: 3 });
	const content = (...ids: string[]): DraftContent => ({ text: "", quotes: [], attachments: ids.map(ref) });

	test("uploads an image once while the draft keeps naming it, and again after a write left it out", async () => {
		const cache = new BytesCache();
		cache.set("a", new Uint8Array([65, 66, 67]));
		const uploaded: string[] = [];
		const tracker = new UploadTracker(cache, async (attachment, data) => void uploaded.push(`${attachment.id}:${data}`));
		await tracker.ensure(content("a"));
		await tracker.ensure(content("a"));
		expect(uploaded).toEqual(["a:QUJD"]);
		tracker.wrote(content("a"));
		await tracker.ensure(content("a"));
		expect(uploaded).toHaveLength(1);
		tracker.wrote(null);
		await tracker.ensure(content("a"));
		expect(uploaded).toHaveLength(2);
	});

	test("an image this device does not hold came from the backend: nothing to upload", async () => {
		const uploaded: string[] = [];
		const tracker = new UploadTracker(new BytesCache(), async (attachment) => void uploaded.push(attachment.id));
		await tracker.ensure(content("remote"));
		expect(uploaded).toEqual([]);
	});

	test("a failed upload throws, and is tried again next time", async () => {
		const cache = new BytesCache();
		cache.set("a", new Uint8Array([1]));
		let fail = true;
		const tracker = new UploadTracker(cache, async () => {
			if (fail) throw new Error("offline");
		});
		await expect(tracker.ensure(content("a"))).rejects.toThrow("offline");
		fail = false;
		await tracker.ensure(content("a"));
		tracker.reset();
	});
});

describe("waiting messages keep their images", () => {
	const held: HeldImage = { id: "b".repeat(64), mimeType: "image/png", size: 3, name: "shot.png", data: "QUJD" };
	const base: LocalSend = { requestId: "r1", text: "see", state: "sending", at: 1, wasBusy: true };

	test("an image-only queued input from this screen shows its pictures; it is not mistaken for a harness note", () => {
		const queued: QueuedInput = { id: 4, requestId: "r1", mode: "steer", text: "", images: 1 };
		const [message] = waitingMessages({ queued: [queued], sends: [{ ...base, text: "", images: [held], state: "queued", submissionId: 4 }], lost: [] });
		expect(message?.images).toEqual([held]);
		expect(message?.imageCount).toBe(1);
		const [item] = withWaiting([], message ? [message] : []);
		expect(item).toMatchObject({ kind: "user", images: [{ data: "QUJD", mimeType: "image/png" }] });
		expect((item as { imageCount?: number }).imageCount).toBeUndefined();
	});

	test("a failed send keeps its images for Retry and Edit", () => {
		const [message] = waitingMessages({ queued: undefined, sends: [{ ...base, state: "failed", error: "offline", images: [held] }], lost: [] });
		expect(message).toMatchObject({ state: "failed", images: [held], imageCount: 1 });
	});

	test("an input from another device is only a count, and says so", () => {
		const queued: QueuedInput = { id: 9, mode: "steer", text: "look at these", images: 2 };
		const [message] = waitingMessages({ queued: [queued], sends: [], lost: [] });
		expect(message?.images).toBeUndefined();
		const [item] = withWaiting([], message ? [message] : []);
		expect(item).toMatchObject({ kind: "user", images: [], imageCount: 2 });
	});
});
