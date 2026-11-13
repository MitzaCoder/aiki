/**
 * The logic behind a task's media carousel, outside the components so it can be tested and ported: which artifacts are
 * media, the tag chips and their counts, filtering, the before/after pairing, slide labels, the keyboard and scroll
 * state of the carousel, the compare divider, and tag completion. Design: docs/DESIGN.md "Artifact tags and the task
 * media carousel".
 */
import { normalizeTag, normalizeTags, SUGGESTED_ARTIFACT_TAGS, type Artifact } from "@kemiri/protocol";
import { artifactTitle } from "./artifacts.ts";

type Tagged = Pick<Artifact, "tags">;

/** The tags that mark a compare pair. */
export const BEFORE_TAG = "before";
export const AFTER_TAG = "after";

/** How many slides on each side of the active one load their full image or mount a video player. */
export const SLIDE_LOAD_RADIUS = 1;

/**
 * How fast the carousel moves, in one place so Android can use the same numbers. `easing` is the CSS curve (an ease-out
 * quart); `easeOut` below is the same curve for code that animates by hand.
 */
export const MEDIA_MOTION = {
	/** A slide change from an arrow, a key or a thumbnail. */
	slideMs: 220,
	/** The thumbnail strip following the current slide. */
	stripMs: 180,
	/** The caption's cross-fade. */
	captionMs: 110,
	/** The picture flying from its place in the task to full screen. */
	viewerOpenMs: 260,
	/** And back. */
	viewerCloseMs: 210,
	easing: "cubic-bezier(0.25, 1, 0.5, 1)"
} as const;

/** Ease-out quart: fast at once, then settling. `progress` is 0..1 and is clamped. */
export function easeOut(progress: number): number {
	const left = 1 - Math.min(1, Math.max(0, progress));
	return 1 - left * left * left * left;
}

/** The scroll position `elapsed` ms into a move of `duration` ms from `from` to `to`; exactly `to` at the end. */
export function scrollPosition(from: number, to: number, elapsed: number, duration: number): number {
	if (duration <= 0 || elapsed >= duration) return to;
	return from + (to - from) * easeOut(elapsed / duration);
}

/** An artifact's tags; none for a row from a server without tags. */
export function tagsOf(artifact: Tagged): readonly string[] {
	return artifact.tags ?? [];
}

/** Photos and videos are shown in the carousel; everything else is a plain file. */
export function isMedia(artifact: Pick<Artifact, "kind">): boolean {
	return artifact.kind === "image" || artifact.kind === "video";
}

function byTimeThenId(left: Pick<Artifact, "createdAt" | "id">, right: Pick<Artifact, "createdAt" | "id">): number {
	const byTime = Date.parse(left.createdAt) - Date.parse(right.createdAt);
	if (byTime !== 0 && Number.isFinite(byTime)) return byTime;
	return left.id.localeCompare(right.id);
}

/**
 * A task's artifacts as the Files section shows them: the media oldest first (save order, so "3 of 8" stays put as new
 * ones arrive at the end) and the other files newest first, as the list reads them.
 */
export function splitMedia<T extends Pick<Artifact, "kind" | "createdAt" | "id">>(artifacts: readonly T[]): { media: T[]; files: T[] } {
	const media = artifacts.filter(isMedia).sort(byTimeThenId);
	const files = artifacts.filter((artifact) => !isMedia(artifact)).sort((left, right) => byTimeThenId(right, left));
	return { media, files };
}

export type TagCount = { tag: string; count: number };

/** Every tag in the list with how many items carry it: most used first, then alphabetical. */
export function tagCounts(items: readonly Tagged[]): TagCount[] {
	const counts = new Map<string, number>();
	for (const item of items) for (const tag of new Set(tagsOf(item))) counts.set(tag, (counts.get(tag) ?? 0) + 1);
	return [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** The items carrying `tag`, or all of them for `null`. */
export function filterByTag<T extends Tagged>(items: readonly T[], tag: string | null): T[] {
	return tag === null ? [...items] : items.filter((item) => tagsOf(item).includes(tag));
}

/** The chosen tag if some item still carries it, else all (`null`): a filter whose last item went away lets go. */
export function resolveTagFilter(counts: readonly TagCount[], tag: string | null): string | null {
	return tag !== null && counts.some((entry) => entry.tag === tag) ? tag : null;
}

/** "Screenshot 3 of 8: Checkout" for a slide; videos are "Video". The position counts the filtered media. */
export function slideLabel(artifact: Pick<Artifact, "kind" | "title" | "name">, index: number, total: number): string {
	const noun = artifact.kind === "video" ? "Video" : "Screenshot";
	return `${noun} ${index + 1} of ${total}: ${artifactTitle(artifact)}`;
}

// --- the carousel's position ---------------------------------------------------------------------------------------

/** The slide nearest the middle of the viewport for a scroll offset, where slides repeat every `pitch` pixels. */
export function nearestSlide(scrollLeft: number, pitch: number, count: number): number {
	if (count <= 0 || !(pitch > 0)) return 0;
	return Math.min(count - 1, Math.max(0, Math.round(scrollLeft / pitch)));
}

/** The index a key moves to, or undefined for a key that does nothing. */
export function stepIndex(index: number, count: number, key: string): number | undefined {
	if (count <= 0) return undefined;
	const last = count - 1;
	if (key === "ArrowLeft" || key === "PageUp") return Math.max(0, index - 1);
	if (key === "ArrowRight" || key === "PageDown") return Math.min(last, index + 1);
	if (key === "Home") return 0;
	if (key === "End") return last;
	return undefined;
}

/** The index to show after the list changed: the same artifact if it is still there, else the nearest position. */
export function keepIndex(previous: readonly Pick<Artifact, "id">[], index: number, next: readonly Pick<Artifact, "id">[]): number {
	if (next.length === 0) return 0;
	const id = previous[index]?.id;
	const found = id === undefined ? -1 : next.findIndex((item) => item.id === id);
	return found >= 0 ? found : Math.min(index, next.length - 1);
}

/** Whether a slide, `distance` steps from the active one, loads its full image or mounts a player. */
export function loadsFull(distance: number): boolean {
	return Math.abs(distance) <= SLIDE_LOAD_RADIUS;
}

/**
 * How a slide looks at `offset` slides from the middle (fractional while scrolling): full size and brightness in the
 * middle, a little smaller and dimmer beside it, never beyond one step's worth.
 */
export function slideLook(offset: number): { scale: number; opacity: number } {
	const distance = Math.min(1, Math.abs(offset));
	return { scale: 1 - 0.07 * distance, opacity: 1 - 0.45 * distance };
}

// --- before and after ----------------------------------------------------------------------------------------------

export type ComparePair<T> = { before: T; after: T };

export type MediaSlide<T> = { artifact: T; pair?: ComparePair<T> };

/** Collapse each filtered pair at its earliest member's position, using the after image for its thumbnail/caption. */
export function mediaSlides<T extends Pick<Artifact, "id" | "kind" | "createdAt" | "tags">>(items: readonly T[], separate = false): MediaSlide<T>[] {
	const pairs = comparePairs(items);
	const seen = new Set<string>();
	const slides: MediaSlide<T>[] = [];
	for (const item of items) {
		const pair = separate ? undefined : pairs.get(item.id);
		if (pair === undefined) slides.push({ artifact: item });
		else if (!seen.has(pair.after.id)) {
			seen.add(pair.after.id);
			slides.push({ artifact: pair.after, pair });
		}
	}
	return slides;
}

export function mediaSlideLabel(slide: MediaSlide<Pick<Artifact, "kind" | "title" | "name">>, index: number, total: number): string {
	return slide.pair === undefined ? slideLabel(slide.artifact, index, total) : `Before and after: ${artifactTitle(slide.artifact)}`;
}

/** The tags besides before and after, sorted: what two items must share to be a pair. */
function otherTagsKey(item: Tagged): string {
	return [...tagsOf(item)]
		.filter((tag) => tag !== BEFORE_TAG && tag !== AFTER_TAG)
		.sort()
		.join("\u0000");
}

/**
 * The before/after pairs among `items`, by artifact ID (both members of a pair map to it). Only images are paired. A
 * `before` and an `after` are a pair when their other tags are the same set; several with the same other tags pair in
 * order (the first before with the first after, by save time). An item with both tags, or whose other tags have no
 * partner, is unpaired. Give the items as filtered: a pair needs both of them in the list.
 */
export function comparePairs<T extends Pick<Artifact, "id" | "kind" | "createdAt" | "tags">>(items: readonly T[]): Map<string, ComparePair<T>> {
	const groups = new Map<string, { befores: T[]; afters: T[] }>();
	for (const item of [...items].sort(byTimeThenId)) {
		if (item.kind !== "image") continue;
		const tags = tagsOf(item);
		const before = tags.includes(BEFORE_TAG);
		const after = tags.includes(AFTER_TAG);
		if (before === after) continue;
		const key = otherTagsKey(item);
		const group = groups.get(key) ?? { befores: [], afters: [] };
		groups.set(key, group);
		(before ? group.befores : group.afters).push(item);
	}
	const pairs = new Map<string, ComparePair<T>>();
	for (const { befores, afters } of groups.values()) {
		for (let index = 0; index < Math.min(befores.length, afters.length); index += 1) {
			const pair = { before: befores[index] as T, after: afters[index] as T };
			pairs.set(pair.before.id, pair);
			pairs.set(pair.after.id, pair);
		}
	}
	return pairs;
}

/** The share of the width the divider sits at, 0 to 100. */
export function clampPercent(value: number): number {
	return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 50;
}

/** The divider's position after a key, or undefined for a key that does nothing. Shift takes a bigger step. */
export function dividerAfterKey(position: number, key: string, shift: boolean): number | undefined {
	const step = shift ? 10 : 2;
	if (key === "ArrowLeft" || key === "ArrowDown") return clampPercent(position - step);
	if (key === "ArrowRight" || key === "ArrowUp") return clampPercent(position + step);
	if (key === "PageDown") return clampPercent(position - 10);
	if (key === "PageUp") return clampPercent(position + 10);
	if (key === "Home") return 0;
	if (key === "End") return 100;
	return undefined;
}

/** The divider position for a pointer at `x` over a box starting at `left` and `width` wide. */
export function dividerAtPointer(x: number, left: number, width: number): number {
	return width > 0 ? clampPercent(((x - left) / width) * 100) : 50;
}

// --- editing tags --------------------------------------------------------------------------------------------------

/** Every tag across artifacts, most used first: what the project already calls things. */
export function projectTags(artifacts: readonly Tagged[]): string[] {
	return tagCounts(artifacts).map((entry) => entry.tag);
}

/**
 * Tags to offer for what was typed: those starting with it first, then those containing it. From the task's tags, then
 * the project's, then the suggested ones; those already on the artifact are left out. An empty query offers the first
 * few in that order.
 */
export function suggestTags(
	query: string,
	sources: { current: readonly string[]; task: readonly string[]; project: readonly string[] },
	limit = 8,
): string[] {
	const typed = normalizeTag(query) ?? "";
	const have = new Set(sources.current);
	const seen = new Set<string>();
	const candidates: string[] = [];
	for (const tag of [...sources.task, ...sources.project, ...SUGGESTED_ARTIFACT_TAGS]) {
		if (have.has(tag) || seen.has(tag)) continue;
		seen.add(tag);
		candidates.push(tag);
	}
	if (typed === "") return candidates.slice(0, limit);
	const starts = candidates.filter((tag) => tag.startsWith(typed));
	const contains = candidates.filter((tag) => !tag.startsWith(typed) && tag.includes(typed));
	return [...starts, ...contains].slice(0, limit);
}

/** The tags after adding what was typed (it may hold several, separated by commas), normalised and capped. */
export function addTags(current: readonly string[], typed: string): string[] {
	return normalizeTags([...current, ...typed.split(/[,;]/)]);
}

export function removeTag(current: readonly string[], tag: string): string[] {
	return current.filter((entry) => entry !== tag);
}

// --- the shared-element flight -------------------------------------------------------------------------------------

export type Rect = { left: number; top: number; width: number; height: number };

/** Where an image of `natural` size shows inside `box` with `object-fit: contain`, not scaled up past its pixels when `cap`. */
export function containedRect(natural: { width: number; height: number }, box: Rect, cap = false): Rect {
	if (natural.width <= 0 || natural.height <= 0 || box.width <= 0 || box.height <= 0) return box;
	const ratio = Math.min(box.width / natural.width, box.height / natural.height, cap ? 1 : Number.POSITIVE_INFINITY);
	const width = natural.width * ratio;
	const height = natural.height * ratio;
	return { left: box.left + (box.width - width) / 2, top: box.top + (box.height - height) / 2, width, height };
}

/**
 * The transform (origin at the element's top left) that makes what is visible at `to` look like it is at `from`: the
 * start of a flight from a slide into the viewer, or the end of one back. `element` is the animated element's own
 * rectangle; it is `to` when the element is the picture itself, and larger when the picture sits inside it (a pane that
 * fills the screen around an image). Scales are separate so a mismatched shape still lands.
 */
export function flightTransform(from: Rect, to: Rect, element: Rect = to): { x: number; y: number; scaleX: number; scaleY: number } {
	const scaleX = to.width > 0 ? from.width / to.width : 1;
	const scaleY = to.height > 0 ? from.height / to.height : 1;
	return {
		x: from.left - element.left - (to.left - element.left) * scaleX,
		y: from.top - element.top - (to.top - element.top) * scaleY,
		scaleX,
		scaleY,
	};
}
