import type { FamilyBox, FamilyPoint, TaskFamilyLayout, TaskFamilyRegion } from './task-graph-families.ts';

export type FamilyEdge = {
	id?: string;
	from: string;
	to: string;
	kind: 'subtask' | 'found-while' | 'blocked-by' | 'related';
};
export type RoutedFamilyEdge = FamilyEdge & {
	points: FamilyPoint[];
	d: string;
	/** The tip is on the prerequisite border, never on the blocked task. */
	arrow: { tip: FamilyPoint; from: FamilyPoint } | null;
};

const leftPort = (box: FamilyBox): FamilyPoint => ({ x: box.x, y: box.y + box.height / 2 });

function gateway(family: TaskFamilyRegion, card: FamilyBox, gap: number, padding: number): FamilyPoint[] {
	const port = leftPort(card);
	const gutterX = family.bounds.x + padding / 2;
	const headerY = family.bounds.y + family.header.height / 2;
	return [port, { x: gutterX, y: port.y }, { x: gutterX, y: headerY },
		{ x: family.bounds.x, y: headerY },
		{ x: family.bounds.x - gap / 2, y: headerY },
		{ x: family.bounds.x - gap / 2, y: family.bounds.y - gap / 2 }];
}

function segmentCrossesBox(a: FamilyPoint, b: FamilyPoint, box: FamilyBox): boolean {
	if (a.x === b.x) return a.x > box.x && a.x < box.x + box.width
		&& Math.min(a.y, b.y) < box.y + box.height && Math.max(a.y, b.y) > box.y;
	return a.y > box.y && a.y < box.y + box.height
		&& Math.min(a.x, b.x) < box.x + box.width && Math.max(a.x, b.x) > box.x;
}

/** Static corridor grid outside family rectangles, shared by cross-family routes in this call.
 * Not a force simulation or an obstacle router over every card; local routes use reserved row gutters.
 */
function familyCorridors(families: TaskFamilyRegion[], gap: number) {
	const xs = [...new Set(families.flatMap(({ bounds }) => [bounds.x - gap / 2, bounds.x + bounds.width + gap / 2]))].sort((a, b) => a - b);
	const ys = [...new Set(families.flatMap(({ bounds }) => [bounds.y - gap / 2, bounds.y + bounds.height + gap / 2]))].sort((a, b) => a - b);
	const xIndices = new Map(xs.map((x, i) => [x, i]));
	const yIndices = new Map(ys.map((y, i) => [y, i]));
	const point = (index: number): FamilyPoint => ({ x: xs[index % xs.length]!, y: ys[Math.floor(index / xs.length)]! });
	const blocked = new Map<string, boolean>();
	return (from: FamilyPoint, to: FamilyPoint): FamilyPoint[] => {
		const start = yIndices.get(from.y)! * xs.length + xIndices.get(from.x)!;
		const end = yIndices.get(to.y)! * xs.length + xIndices.get(to.x)!;
		const predecessors = new Map<number, number>([[start, -1]]);
		const queue = [start];
		for (let head = 0; head < queue.length && !predecessors.has(end); head++) {
			const index = queue[head]!;
			const column = index % xs.length, row = Math.floor(index / xs.length);
			const neighbors = [column > 0 ? index - 1 : -1, row > 0 ? index - xs.length : -1,
				column + 1 < xs.length ? index + 1 : -1, row + 1 < ys.length ? index + xs.length : -1];
			for (const neighbor of neighbors) {
				if (neighbor < 0 || predecessors.has(neighbor)) continue;
				const key = `${Math.min(index, neighbor)}:${Math.max(index, neighbor)}`;
				let crosses = blocked.get(key);
				if (crosses === undefined) {
					crosses = families.some(family => segmentCrossesBox(point(index), point(neighbor), family.bounds));
					blocked.set(key, crosses);
				}
				if (crosses) continue;
				predecessors.set(neighbor, index);
				queue.push(neighbor);
			}
		}
		const path: FamilyPoint[] = [];
		for (let index = end; index !== -1; index = predecessors.get(index)!) {
			// Non-overlapping regions with positive corridors always have an exterior path.
			if (!predecessors.has(index)) throw new Error('No family edge corridor');
			path.push(point(index));
		}
		return path.reverse();
	};
}

function simplifyPath(points: FamilyPoint[]): FamilyPoint[] {
	const simplified: FamilyPoint[] = [];
	for (const point of points) {
		const last = simplified.at(-1);
		if (last && last.x === point.x && last.y === point.y) continue;
		// Keep explicit family-border gateways; only drop duplicate points, not collinear border points.
		simplified.push(point);
	}
	return simplified;
}

/** Omit hidden endpoints. Input direction is preserved for every kind, including blocked → prerequisite.
 * Local edges follow row/left gutters; cross edges exit the header border and avoid all other regions.
 * Call for the UI's scoped relationship set, not every all-pairs relation at every animation frame.
 */
export function routeTaskFamilyEdges(
	layout: TaskFamilyLayout, edges: readonly FamilyEdge[], detail: 'cards' | 'pills' = 'cards',
): RoutedFamilyEdge[] {
	const families = new Map(layout.families.map(family => [family.id, family]));
	let corridor: ReturnType<typeof familyCorridors> | undefined;
	const routes: RoutedFamilyEdge[] = [];
	for (const edge of edges) {
		const from = layout.cards.get(edge.from), to = layout.cards.get(edge.to);
		if (!from || !to || edge.from === edge.to) continue;
		const fromBox = detail === 'pills' ? from.pillBox : from.box;
		const toBox = detail === 'pills' ? to.pillBox : to.box;
		const fromFamily = families.get(from.familyId)!, toFamily = families.get(to.familyId)!;
		let points: FamilyPoint[];
		if (from.familyId === to.familyId) {
			const a = leftPort(fromBox), b = leftPort(toBox);
			const parentLink = edge.kind === 'subtask' && (from.parentId === to.id || to.parentId === from.id);
			const exteriorGutter = fromFamily.bounds.x + layout.options.padding / 2;
			let gutter = parentLink ? Math.min(a.x, b.x) - layout.options.padding / 2 : exteriorGutter;
			// Appended children may be below other branches; don't run a deep branch lane through them.
			if (parentLink && fromFamily.taskIds.some(id => {
				const card = layout.cards.get(id)!;
				return segmentCrossesBox({ x: gutter, y: a.y }, { x: gutter, y: b.y },
					detail === 'cards' ? card.occupiedBox : card.pillBox);
			})) gutter = exteriorGutter;
			points = [a, { x: gutter, y: a.y }, { x: gutter, y: b.y }, b];
		} else {
			const gap = layout.options.familyGap;
			const a = gateway(fromFamily, fromBox, gap, layout.options.padding);
			const b = gateway(toFamily, toBox, gap, layout.options.padding);
			corridor ??= familyCorridors(layout.families, gap);
			points = [...a, ...corridor(a.at(-1)!, b.at(-1)!), ...b.reverse()];
		}
		points = simplifyPath(points);
		routes.push({
			...edge, points,
			d: points.map((point, index) => `${index ? 'L' : 'M'}${point.x},${point.y}`).join(' '),
			arrow: edge.kind === 'blocked-by' ? { tip: points.at(-1)!, from: points.at(-2)! } : null,
		});
	}
	return routes;
}
