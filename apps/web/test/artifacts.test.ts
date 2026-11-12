/**
 * Artifact logic outside the components: labels and sizes, the kind filter, reading an `artifact_save` call, and the
 * lightbox's zoom and pan.
 */
import { describe, expect, test } from "bun:test";
import type { Artifact } from "@aiki/protocol";
import {
	ZOOM_FIT,
	ZOOM_MAX,
	artifactFromCall,
	artifactBrowserUrl,
	artifactIdFromResult,
	artifactSaveCall,
	artifactTitle,
	artifactsByTask,
	baseName,
	clampZoom,
	filterByKind,
	fittedSize,
	formatBytes,
	formatMediaDuration,
	isDismissSwipe,
	kindCounts,
	kindFromName,
	isMarkdownArtifact,
	savedByLabel,
	toggleZoom,
	wheelFactor,
	zoomAround,
} from "../src/lib/artifacts.ts";

function artifact(overrides: Partial<Artifact> = {}): Artifact {
	return {
		id: "a1",
		projectId: "p1",
		name: "demo.webm",
		title: null,
		note: null,
		kind: "video",
		mimeType: "video/webm",
		size: 1000,
		durationSeconds: 7,
		threadId: "main",
		workerId: null,
		taskId: null,
		sourcePath: "/work/demo.webm",
		createdAt: "2026-11-04T10:00:00.000Z",
		...overrides,
	};
}

test("same-origin artifact capabilities stay relative; remote and alternate loopback origins stay absolute", () => {
	expect(artifactBrowserUrl("http://localhost:7317/artifacts/p/a?token=synthetic", "http://localhost:7317")).toBe("/artifacts/p/a?token=synthetic");
	for (const remote of ["http://127.0.0.1:7317", "http://localhost:7318", "https://backend.example"]) {
		const url = `${remote}/artifacts/p/a?token=synthetic`;
		expect(artifactBrowserUrl(url, "http://localhost:7317")).toBe(url);
	}
});

describe("labels", () => {
	test("a title falls back to the file name", () => {
		expect(artifactTitle(artifact({ title: "Checkout flow" }))).toBe("Checkout flow");
		expect(artifactTitle(artifact({ title: "  " }))).toBe("demo.webm");
	});

	test("sizes and lengths read short", () => {
		expect(formatBytes(820)).toBe("820 B");
		expect(formatBytes(14_200)).toBe("14 KB");
		expect(formatBytes(3_240_000)).toBe("3.2 MB");
		expect(formatBytes(2_000_000)).toBe("2 MB");
		expect(formatBytes(-1)).toBe("");
		expect(formatMediaDuration(7.4)).toBe("0:07");
		expect(formatMediaDuration(750)).toBe("12:30");
		expect(formatMediaDuration(3723)).toBe("1:02:03");
		expect(formatMediaDuration(null)).toBe("");
	});

	test("who saved it", () => {
		expect(savedByLabel(artifact())).toBe("Main");
		expect(savedByLabel(artifact({ threadId: "jira" }))).toBe("Thread jira");
		expect(savedByLabel(artifact({ workerId: "w3" }))).toBe("Worker w3 of main");
		expect(savedByLabel(artifact({ threadId: "jira", workerId: "w1" }))).toBe("Worker w1 of thread jira");
	});

	test("the kind from a file name", () => {
		expect(kindFromName("a.MP4")).toBe("video");
		expect(kindFromName("shot.png")).toBe("image");
		expect(kindFromName("voice.opus")).toBe("audio");
		expect(kindFromName("run.log")).toBe("text");
		expect(kindFromName("bundle.zip")).toBe("file");
		expect(kindFromName("README")).toBe("file");
		expect(baseName("/work/out/demo.webm")).toBe("demo.webm");
		expect(baseName("C:\\out\\demo.webm")).toBe("demo.webm");
	});
});

describe("the kind filter", () => {
	const list = [artifact({ id: "1" }), artifact({ id: "2", kind: "image" }), artifact({ id: "3" })];

	test("counts the kinds present, in order", () => {
		expect(kindCounts(list)).toEqual([
			{ kind: "video", count: 2 },
			{ kind: "image", count: 1 },
		]);
	});

	test("narrows to one kind or keeps all", () => {
		expect(filterByKind(list, "image").map((entry) => entry.id)).toEqual(["2"]);
		expect(filterByKind(list, "all")).toBe(list);
	});

	test("groups by task, leaving out the ones for none", () => {
		const grouped = artifactsByTask([artifact({ id: "1", taskId: "T1" }), artifact({ id: "2" }), artifact({ id: "3", taskId: "T1" })]);
		expect([...grouped.keys()]).toEqual(["T1"]);
		expect(grouped.get("T1")?.map((entry) => entry.id)).toEqual(["1", "3"]);
	});
});

describe("artifact_save calls", () => {
	test("the ID comes from details, JSON or the text", () => {
		expect(artifactIdFromResult("ok", { artifact: { id: "art_1" } })).toBe("art_1");
		expect(artifactIdFromResult("ok", { artifactId: "art_2" })).toBe("art_2");
		expect(artifactIdFromResult('{"id":"art_3","name":"x"}')).toBe("art_3");
		expect(artifactIdFromResult("Saved. Artifact ID: a7f3c9")).toBe("a7f3c9");
		expect(artifactIdFromResult("Saved artifact a7f3c9 (demo.webm, 1.2 MB).")).toBe("a7f3c9");
		expect(artifactIdFromResult("Artifact saved to the store.")).toBeUndefined();
		expect(artifactIdFromResult(undefined)).toBeUndefined();
	});

	test("reads the arguments, and no ID from a failed call", () => {
		const call = artifactSaveCall({
			arguments: { path: "out/demo.webm", title: "Demo", taskId: "T4" },
			output: "artifact id: a1",
		});
		expect(call).toEqual({ artifactId: "a1", path: "out/demo.webm", title: "Demo", note: undefined, taskId: "T4" });
		expect(artifactSaveCall({ arguments: { path: "x" }, output: "id: a1", isError: true }).artifactId).toBeUndefined();
	});

	test("a stand-in record plays by ID", () => {
		const standIn = artifactFromCall("p1", "a1", artifactSaveCall({ arguments: { path: "out/shot.png", title: "Shot" } }));
		expect(standIn).toMatchObject({ id: "a1", projectId: "p1", name: "shot.png", kind: "image", title: "Shot", size: -1 });
	});
});

describe("the lightbox's zoom", () => {
	const viewport = { width: 800, height: 600 };
	const fitted = fittedSize({ width: 1600, height: 900 }, viewport);

	test("fits without enlarging a small image", () => {
		expect(fitted).toEqual({ width: 800, height: 450 });
		expect(fittedSize({ width: 200, height: 100 }, viewport)).toEqual({ width: 200, height: 100 });
		expect(fittedSize({ width: 0, height: 0 }, viewport)).toEqual({ width: 0, height: 0 });
	});

	test("keeps the point under the cursor in place", () => {
		const zoomed = zoomAround(ZOOM_FIT, 2, { x: 200, y: 0 }, fitted, viewport);
		// The image point at screen x=200 was 200px right of its centre; at 2x it is 400px right, so the image moves -200.
		expect(zoomed).toEqual({ scale: 2, x: -200, y: 0 });
	});

	test("clamps the scale and keeps the edges at the viewport's", () => {
		expect(clampZoom({ scale: 20, x: 0, y: 0 }, fitted, viewport).scale).toBe(ZOOM_MAX);
		expect(clampZoom({ scale: 0.2, x: 50, y: 50 }, fitted, viewport)).toEqual(ZOOM_FIT);
		// At 2x the image is 1600×900: it can move 400px sideways and 150px up or down.
		expect(clampZoom({ scale: 2, x: -999, y: 999 }, fitted, viewport)).toEqual({ scale: 2, x: -400, y: 150 });
	});

	test("a double tap zooms in, and again goes back to fit", () => {
		const zoomed = toggleZoom(ZOOM_FIT, { x: 0, y: 0 }, fitted, viewport);
		expect(zoomed.scale).toBeGreaterThan(1);
		expect(toggleZoom(zoomed, { x: 0, y: 0 }, fitted, viewport)).toEqual(ZOOM_FIT);
	});

	test("the wheel zooms in on scrolling up, smoothly and bounded", () => {
		expect(wheelFactor(-100, 0)).toBeGreaterThan(1);
		expect(wheelFactor(100, 0)).toBeLessThan(1);
		expect(wheelFactor(-3, 1)).toBeCloseTo(wheelFactor(-48, 0));
		expect(wheelFactor(-10_000, 0)).toBeCloseTo(wheelFactor(-100, 0));
	});

	test("a swipe down at fit dismisses, not when zoomed or sideways", () => {
		expect(isDismissSwipe(ZOOM_FIT, 10, 120)).toBe(true);
		expect(isDismissSwipe(ZOOM_FIT, 120, 120)).toBe(false);
		expect(isDismissSwipe({ scale: 2, x: 0, y: 0 }, 0, 200)).toBe(false);
		expect(isDismissSwipe(ZOOM_FIT, 0, 40)).toBe(false);
	});
});

describe("isMarkdownArtifact", () => {
	test("knows Markdown by its type or its name", () => {
		expect(isMarkdownArtifact({ name: "report.md", mimeType: "text/markdown" })).toBe(true);
		expect(isMarkdownArtifact({ name: "notes", mimeType: "text/markdown; charset=utf-8" })).toBe(true);
		expect(isMarkdownArtifact({ name: "README.MARKDOWN", mimeType: "application/octet-stream" })).toBe(true);
		expect(isMarkdownArtifact({ name: "server.log", mimeType: "text/plain" })).toBe(false);
		expect(isMarkdownArtifact({ name: "data.json", mimeType: "application/json" })).toBe(false);
	});
});
