import type { FamilyBox, FamilyPoint, TaskFamilyLayout, TaskFamilyRegion } from './task-graph-families.ts';

export type FamilyDetail = 'cards' | 'pills' | 'dots';
export type FamilyDetailOptions = {
	touch?: boolean;
	cardTitleSize?: number;
	pillLabelSize?: number;
	/** Must match the actual pill geometry/font the renderer uses. */
	pillHeight?: number;
	hysteresis?: number;
};

/**
 * Text never drops below 12 screen px. Pills also require 24px desktop / 44px touch height.
 * Enter a more detailed level 8% above its eligibility threshold; leave at the threshold.
 * This asymmetric hysteresis never keeps illegible text on screen just to prevent flicker.
 */
export function chooseFamilyDetail(zoom: number, previous?: FamilyDetail, options: FamilyDetailOptions = {}): FamilyDetail {
	const cardThreshold = 12 / (options.cardTitleSize ?? 16);
	const pillThreshold = Math.max(12 / (options.pillLabelSize ?? 20), (options.touch ? 44 : 24) / (options.pillHeight ?? 64));
	const margin = 1 + Math.max(0, options.hysteresis ?? .08);
	const cardEntry = previous === undefined || previous === 'cards' ? cardThreshold : cardThreshold * margin;
	if (zoom >= cardEntry) return 'cards';
	const pillEntry = previous === undefined || previous !== 'dots' ? pillThreshold : pillThreshold * margin;
	if (zoom >= pillEntry) return 'pills';
	return 'dots';
}

/** Translation camera: screen = world * zoom + {x,y}, not a world-centre camera. */
export type FamilyCamera = FamilyPoint & { zoom: number };
export type FamilyViewport = { width: number; height: number };

function fitBox(box: FamilyBox, viewport: FamilyViewport, padding: number, maxZoom: number): FamilyCamera {
	if (!box.width || !box.height) return { x: 0, y: 0, zoom: 1 };
	const zoom = Math.max(Number.EPSILON, Math.min(maxZoom,
		Math.max(1, viewport.width - padding * 2) / box.width,
		Math.max(1, viewport.height - padding * 2) / box.height));
	return {
		x: (viewport.width - box.width * zoom) / 2 - box.x * zoom,
		y: (viewport.height - box.height * zoom) / 2 - box.y * zoom,
		zoom,
	};
}

/** Fit visible families, including their reserved compound bounds; no watch update calls this implicitly. */
export function fitTaskFamilies(layout: TaskFamilyLayout, viewport: FamilyViewport, padding = 24, maxZoom = 1): FamilyCamera {
	const visible = layout.families.filter(family => family.taskIds.length);
	if (!visible.length) return { x: 0, y: 0, zoom: 1 };
	const left = Math.min(...visible.map(family => family.bounds.x));
	const top = Math.min(...visible.map(family => family.bounds.y));
	const right = Math.max(...visible.map(family => family.bounds.x + family.bounds.width));
	const bottom = Math.max(...visible.map(family => family.bounds.y + family.bounds.height));
	return fitBox({ x: left, y: top, width: right - left, height: bottom - top }, viewport, padding, maxZoom);
}

/** Phone family navigation can frame one region without re-laying out its neighbors. */
export function fitTaskFamily(layout: TaskFamilyLayout, id: string, viewport: FamilyViewport, padding = 24, maxZoom = 1): FamilyCamera {
	const family = layout.families.find(family => family.id === id);
	return family ? fitBox(family.bounds, viewport, padding, maxZoom) : { x: 0, y: 0, zoom: 1 };
}

function revealAxis(start: number, size: number, translation: number, zoom: number, available: number, padding: number): number {
	const screenStart = start * zoom + translation;
	const screenEnd = screenStart + size * zoom;
	if (screenStart >= padding && screenEnd <= available - padding) return translation;
	if (size * zoom > available - padding * 2) return padding - start * zoom;
	if (screenStart < padding) return translation + padding - screenStart;
	return translation + available - padding - screenEnd;
}

/** Pan the minimum distance only if off screen; preserve zoom, even for oversized cards. */
export function revealFamilyCard(
	layout: TaskFamilyLayout, id: string, camera: FamilyCamera, viewport: FamilyViewport, padding = 24,
	detail: 'cards' | 'pills' = 'cards',
): FamilyCamera {
	const card = layout.cards.get(id);
	if (!card) return camera;
	const box = detail === 'pills' ? card.pillBox : card.occupiedBox;
	const x = revealAxis(box.x, box.width, camera.x, camera.zoom, viewport.width, padding);
	const y = revealAxis(box.y, box.height, camera.y, camera.zoom, viewport.height, padding);
	return x === camera.x && y === camera.y ? camera : { x, y, zoom: camera.zoom };
}

/** One overview dot per family. Heading is the target; dimensions/font stay readable in screen pixels.
 * Title is rendered in a screen-space overlay (not clipped to the world family region).
 */
export function familyDotGeometry(family: TaskFamilyRegion, zoom: number, touch = false): {
	dot: FamilyPoint & { radius: number };
	titleBox: FamilyBox;
	titleFontSize: number;
} {
	const scale = Math.max(Number.EPSILON, zoom);
	const x = family.bounds.x + family.bounds.width / 2;
	const y = family.bounds.y + family.bounds.height / 2;
	const height = (touch ? 44 : 24) / scale;
	return {
		dot: { x, y, radius: 10 / scale },
		titleBox: { x: x - 100 / scale, y: y + 14 / scale, width: 200 / scale, height },
		titleFontSize: 14 / scale,
	};
}
