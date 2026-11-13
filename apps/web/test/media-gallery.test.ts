import { describe, expect, it } from "bun:test";
import type { Artifact } from "@kemiri/protocol";
import {
	addTags,
	clampPercent,
	comparePairs,
	mediaSlides,
	mediaSlideLabel,
	containedRect,
	dividerAfterKey,
	dividerAtPointer,
	filterByTag,
	flightTransform,
	isMedia,
	keepIndex,
	loadsFull,
	nearestSlide,
	projectTags,
	removeTag,
	resolveTagFilter,
	slideLabel,
	slideLook,
	MEDIA_MOTION,
	easeOut,
	scrollPosition,
	splitMedia,
	stepIndex,
	suggestTags,
	tagCounts,
} from "../src/lib/media-gallery.ts";

let counter = 0;
function artifact(overrides: Partial<Artifact> = {}): Artifact {
	counter += 1;
	return {
		id: `a${counter}`,
		projectId: "p1",
		name: `shot${counter}.png`,
		title: null,
		note: null,
		kind: "image",
		mimeType: "image/png",
		size: 1000,
		durationSeconds: null,
		threadId: "main",
		workerId: null,
		taskId: "T1",
		sourcePath: "/work/shot.png",
		createdAt: new Date(Date.UTC(2026, 10, 8, 10, 0, counter)).toISOString(),
		...overrides,
	};
}

describe("splitMedia", () => {
	it("keeps images and videos oldest first and the rest newest first", () => {
		const log = artifact({ kind: "text", name: "run.log" });
		const clip = artifact({ kind: "video", name: "clip.webm" });
		const shot = artifact();
		const report = artifact({ kind: "file", name: "r.pdf" });
		const { media, files } = splitMedia([report, shot, clip, log]);
		expect(media.map((item) => item.id)).toEqual([clip.id, shot.id]);
		expect(files.map((item) => item.id)).toEqual([report.id, log.id]);
		expect(isMedia(clip) && isMedia(shot) && !isMedia(log)).toBe(true);
	});
});

describe("tags: counts, filter and fallback", () => {
	const items = [
		artifact({ tags: ["web", "phone", "dark"] }),
		artifact({ tags: ["web", "desktop"] }),
		artifact({ tags: ["android", "phone"] }),
		artifact(),
	];

	it("counts each tag once per item, most used first, then alphabetical", () => {
		expect(tagCounts(items)).toEqual([
			{ tag: "phone", count: 2 },
			{ tag: "web", count: 2 },
			{ tag: "android", count: 1 },
			{ tag: "dark", count: 1 },
			{ tag: "desktop", count: 1 },
		]);
		expect(tagCounts([artifact({ tags: ["a", "a"] })])).toEqual([{ tag: "a", count: 1 }]);
		expect(tagCounts([])).toEqual([]);
	});

	it("filters by one tag, or keeps everything for null", () => {
		expect(filterByTag(items, "phone")).toHaveLength(2);
		expect(filterByTag(items, "nope")).toHaveLength(0);
		expect(filterByTag(items, null)).toHaveLength(4);
		expect(filterByTag(items, null)).not.toBe(items);
	});

	it("lets go of a tag nothing carries any more", () => {
		const counts = tagCounts(items);
		expect(resolveTagFilter(counts, "web")).toBe("web");
		expect(resolveTagFilter(counts, "gone")).toBeNull();
		expect(resolveTagFilter(counts, null)).toBeNull();
	});
});

describe("slideLabel", () => {
	it("says the kind, the position among the shown media and the title or name", () => {
		expect(slideLabel(artifact({ title: "Checkout" }), 2, 8)).toBe("Screenshot 3 of 8: Checkout");
		expect(slideLabel(artifact({ kind: "video", name: "run.webm" }), 0, 1)).toBe("Video 1 of 1: run.webm");
	});
});

describe("carousel position", () => {
	it("finds the nearest slide for a scroll offset and clamps it", () => {
		expect(nearestSlide(0, 300, 5)).toBe(0);
		expect(nearestSlide(149, 300, 5)).toBe(0);
		expect(nearestSlide(151, 300, 5)).toBe(1);
		expect(nearestSlide(5000, 300, 5)).toBe(4);
		expect(nearestSlide(-40, 300, 5)).toBe(0);
		expect(nearestSlide(100, 0, 5)).toBe(0);
		expect(nearestSlide(100, 300, 0)).toBe(0);
	});

	it("moves with the arrows, Home and End, stopping at the ends", () => {
		expect(stepIndex(2, 5, "ArrowRight")).toBe(3);
		expect(stepIndex(2, 5, "ArrowLeft")).toBe(1);
		expect(stepIndex(0, 5, "ArrowLeft")).toBe(0);
		expect(stepIndex(4, 5, "ArrowRight")).toBe(4);
		expect(stepIndex(2, 5, "Home")).toBe(0);
		expect(stepIndex(2, 5, "End")).toBe(4);
		expect(stepIndex(2, 5, "a")).toBeUndefined();
		expect(stepIndex(0, 0, "ArrowRight")).toBeUndefined();
	});

	it("keeps the same artifact in view when the list changes", () => {
		const [a, b, c, d] = [artifact(), artifact(), artifact(), artifact()] as [Artifact, Artifact, Artifact, Artifact];
		expect(keepIndex([a, b, c], 1, [a, b, c, d])).toBe(1);
		expect(keepIndex([a, b, c], 2, [c, a, b])).toBe(0);
		// The shown one went away: the nearest position, clamped.
		expect(keepIndex([a, b, c], 2, [a, b])).toBe(1);
		expect(keepIndex([a, b, c], 1, [])).toBe(0);
	});

	it("loads full images only near the active slide", () => {
		expect([-2, -1, 0, 1, 2].map(loadsFull)).toEqual([false, true, true, true, false]);
	});

	it("dims and shrinks slides beside the middle, no further than one step", () => {
		expect(slideLook(0)).toEqual({ scale: 1, opacity: 1 });
		expect(slideLook(1).scale).toBeLessThan(1);
		expect(slideLook(-1)).toEqual(slideLook(1));
		expect(slideLook(3)).toEqual(slideLook(1));
		expect(slideLook(0.5).opacity).toBeGreaterThan(slideLook(1).opacity);
	});
});

describe("comparePairs", () => {
	it("pairs a before with the after that has the same other tags, in either order", () => {
		const after = artifact({ tags: ["after", "web", "phone"] });
		const before = artifact({ tags: ["web", "phone", "before"] });
		const pairs = comparePairs([after, before]);
		expect(pairs.get(before.id)).toEqual({ before, after });
		expect(pairs.get(after.id)).toBe(pairs.get(before.id));
		expect(pairs.size).toBe(2);
	});

	it("does not pair items whose other tags differ", () => {
		const items = [
			artifact({ tags: ["web", "phone", "before"] }),
			artifact({ tags: ["web", "desktop", "after"] }),
			artifact({ tags: ["web", "before"] }),
			artifact({ tags: ["web", "phone", "dark", "after"] }),
		];
		expect(comparePairs(items).size).toBe(0);
	});

	it("pairs a bare before with a bare after", () => {
		const before = artifact({ tags: ["before"] });
		const after = artifact({ tags: ["after"] });
		expect(comparePairs([before, after]).get(before.id)?.after).toBe(after);
	});

	it("pairs several of a kind in order of save time and leaves the extra one out", () => {
		const b1 = artifact({ tags: ["web", "before"] });
		const b2 = artifact({ tags: ["web", "before"] });
		const a1 = artifact({ tags: ["web", "after"] });
		const a2 = artifact({ tags: ["web", "after"] });
		const b3 = artifact({ tags: ["web", "before"] });
		const pairs = comparePairs([a2, b3, a1, b2, b1]);
		expect(pairs.get(b1.id)?.after).toBe(a1);
		expect(pairs.get(b2.id)?.after).toBe(a2);
		expect(pairs.has(b3.id)).toBe(false);
	});

	it("ignores videos, items with both tags, and untagged items", () => {
		const items = [
			artifact({ kind: "video", tags: ["web", "before"] }),
			artifact({ kind: "video", tags: ["web", "after"] }),
			artifact({ tags: ["web", "before", "after"] }),
			artifact({ tags: ["web", "after"] }),
			artifact(),
		];
		expect(comparePairs(items).size).toBe(0);
	});

	it("needs both members in the list it is given", () => {
		const before = artifact({ tags: ["web", "before"] });
		const after = artifact({ tags: ["web", "after"] });
		expect(comparePairs(filterByTag([before, after], "before")).size).toBe(0);
		expect(comparePairs(filterByTag([before, after], "web")).size).toBe(2);
	});
});

describe("the compare divider", () => {
	it("clamps to 0..100 and falls back to the middle for nonsense", () => {
		expect(clampPercent(-5)).toBe(0);
		expect(clampPercent(130)).toBe(100);
		expect(clampPercent(Number.NaN)).toBe(50);
	});

	it("moves with the arrows (Shift for more), Home and End, and stops at the ends", () => {
		expect(dividerAfterKey(50, "ArrowRight", false)).toBe(52);
		expect(dividerAfterKey(50, "ArrowLeft", true)).toBe(40);
		expect(dividerAfterKey(99, "ArrowRight", true)).toBe(100);
		expect(dividerAfterKey(50, "Home", false)).toBe(0);
		expect(dividerAfterKey(50, "End", false)).toBe(100);
		expect(dividerAfterKey(50, "x", false)).toBeUndefined();
	});

	it("reads the pointer's place over the box", () => {
		expect(dividerAtPointer(150, 100, 200)).toBe(25);
		expect(dividerAtPointer(50, 100, 200)).toBe(0);
		expect(dividerAtPointer(500, 100, 200)).toBe(100);
		expect(dividerAtPointer(500, 100, 0)).toBe(50);
	});
});

describe("tag editing", () => {
	it("suggests from the task, then the project, then the suggested tags, minus the ones already on", () => {
		const sources = { current: ["web"], task: ["dark", "web"], project: ["storybook", "phone"] };
		expect(suggestTags("", sources, 4)).toEqual(["dark", "storybook", "phone", "android"]);
		expect(suggestTags("pho", sources)).toEqual(["phone"]);
		// Starting with it first, then merely containing it.
		expect(suggestTags("p", sources)).toEqual(["phone", "desktop"]);
		expect(suggestTags("ar", sources)).toEqual(["dark"]);
		expect(suggestTags("zzz", sources)).toEqual([]);
		expect(suggestTags("  DAR ", sources)).toEqual(["dark"]);
	});

	it("puts what starts with the text before what only contains it", () => {
		const sources = { current: [], task: ["xdark", "dark2"], project: [] };
		expect(suggestTags("dark", sources)).toEqual(["dark2", "dark", "xdark"]);
	});

	it("adds typed tags normalised, several at once, without duplicates", () => {
		expect(addTags(["web"], " Phone, DARK ,web")).toEqual(["web", "phone", "dark"]);
		expect(addTags(["web"], "  ")).toEqual(["web"]);
		expect(removeTag(["web", "phone"], "web")).toEqual(["phone"]);
	});

	it("lists the project's tags most used first", () => {
		expect(projectTags([artifact({ tags: ["b", "a"] }), artifact({ tags: ["b"] })])).toEqual(["b", "a"]);
	});
});

describe("the shared-element flight", () => {
	it("finds where a picture shows inside a box", () => {
		const box = { left: 10, top: 20, width: 400, height: 200 };
		expect(containedRect({ width: 100, height: 100 }, box)).toEqual({ left: 110, top: 20, width: 200, height: 200 });
		expect(containedRect({ width: 800, height: 100 }, box)).toEqual({ left: 10, top: 95, width: 400, height: 50 });
		// Capped: a small picture is not blown up.
		expect(containedRect({ width: 100, height: 50 }, box, true)).toEqual({ left: 160, top: 95, width: 100, height: 50 });
		expect(containedRect({ width: 0, height: 0 }, box)).toBe(box);
	});

	it("makes the end rectangle look like the start one", () => {
		const slide = { left: 100, top: 300, width: 200, height: 100 };
		const full = { left: 0, top: 50, width: 400, height: 200 };
		expect(flightTransform(slide, full)).toEqual({ x: 100, y: 250, scaleX: 0.5, scaleY: 0.5 });
		expect(flightTransform(full, full)).toEqual({ x: 0, y: 0, scaleX: 1, scaleY: 1 });
		expect(flightTransform(slide, { left: 0, top: 0, width: 0, height: 0 }).scaleX).toBe(1);
		// The picture sits inside a bigger element: the transform still lands the picture on the start rectangle.
		const pane = { left: 0, top: 0, width: 400, height: 300 };
		const picture = { left: 50, top: 50, width: 300, height: 200 };
		const from = { left: 120, top: 400, width: 150, height: 100 };
		const t = flightTransform(from, picture, pane);
		expect(50 * t.scaleX + t.x).toBeCloseTo(from.left);
		expect(50 * t.scaleY + t.y).toBeCloseTo(from.top);
		expect(350 * t.scaleX + t.x).toBeCloseTo(from.left + from.width);
	});
});

describe("carousel motion", () => {
	it("the timings are short", () => {
		expect(MEDIA_MOTION.slideMs).toBeLessThanOrEqual(240);
		expect(MEDIA_MOTION.captionMs).toBeLessThanOrEqual(120);
		expect(MEDIA_MOTION.viewerOpenMs).toBeLessThanOrEqual(280);
		expect(MEDIA_MOTION.viewerCloseMs).toBeLessThanOrEqual(220);
	});

	it("easeOut starts at 0, ends at 1, is fast first and never goes back", () => {
		expect(easeOut(0)).toBe(0);
		expect(easeOut(1)).toBe(1);
		expect(easeOut(-1)).toBe(0);
		expect(easeOut(2)).toBe(1);
		expect(easeOut(0.25)).toBeGreaterThan(0.6);
		let last = 0;
		for (let step = 1; step <= 20; step += 1) {
			const value = easeOut(step / 20);
			expect(value).toBeGreaterThanOrEqual(last);
			last = value;
		}
	});

	it("scrollPosition ends exactly on the target, in either direction", () => {
		expect(scrollPosition(0, 500, 0, 220)).toBe(0);
		expect(scrollPosition(0, 500, 220, 220)).toBe(500);
		expect(scrollPosition(0, 500, 999, 220)).toBe(500);
		expect(scrollPosition(900, 300, 220, 220)).toBe(300);
		expect(scrollPosition(900, 300, 55, 220)).toBeLessThan(600);
		expect(scrollPosition(10, 20, 5, 0)).toBe(20);
	});
});


describe("mediaSlides", () => {
	it("collapses a pair at its earliest position with the after thumbnail and one count", () => {
		const before = artifact({ tags: ["web", "before"] });
		const video = artifact({ kind: "video" });
		const after = artifact({ tags: ["after", "web"], title: "Checkout" });
		const slides = mediaSlides([before, video, after]);
		expect(slides.map((slide) => slide.artifact.id)).toEqual([after.id, video.id]);
		expect(slides[0]?.pair).toEqual({ before, after });
		expect(mediaSlideLabel(slides[0]!, 0, slides.length)).toBe("Before and after: Checkout");
		expect(mediaSlideLabel(slides[1]!, 1, slides.length)).toStartWith("Video 2 of 2:");
	});
	it("preserves order when after arrives first and pairs repeated tag sets in save order", () => {
		const after1 = artifact({ tags: ["after"] });
		const before1 = artifact({ tags: ["before"] });
		const before2 = artifact({ tags: ["before"] });
		const after2 = artifact({ tags: ["after"] });
		const solo = artifact();
		const slides = mediaSlides([after1, before1, before2, solo, after2]);
		expect(slides.map((slide) => slide.artifact.id)).toEqual([after1.id, after2.id, solo.id]);
		expect(slides.map((slide) => slide.pair?.before.id)).toEqual([before1.id, before2.id, undefined]);
	});
	it("pairs only within the filter and restores individual pages in separate mode", () => {
		const before = artifact({ tags: ["web", "before"] });
		const after = artifact({ tags: ["web", "after"] });
		const items = [before, after];
		expect(mediaSlides(filterByTag(items, "before"))).toEqual([{ artifact: before }]);
		expect(mediaSlides(filterByTag(items, "web"))).toHaveLength(1);
		expect(mediaSlides(items, true)).toEqual(items.map((artifact) => ({ artifact })));
	});
	it("leaves unpaired, ambiguous and video media alone, including empty lists", () => {
		const items = [artifact({ tags: ["before"] }), artifact({ tags: ["before", "after"] }), artifact({ kind: "video", tags: ["after"] })];
		expect(mediaSlides(items)).toEqual(items.map((artifact) => ({ artifact })));
		expect(mediaSlides([])).toEqual([]);
	});
});
