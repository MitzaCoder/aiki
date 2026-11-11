import { describe, expect, it } from 'bun:test';
import {
	chooseFamilyDetail, familyBoxesOverlap, familyDotGeometry, fitTaskFamilies, fitTaskFamily,
	layoutTaskFamilies, regroupTaskFamilies, revealFamilyCard, routeTaskFamilyEdges,
	type FamilyBox, type FamilyEdge, type FamilyPoint, type LayoutTask, type TaskFamilyLayout,
} from '../src/lib/task-graph-families.ts';

function task(id: string, parent: string | null = null): LayoutTask {
	return { id, parent, createdAt: '2026-01-01T00:00:00Z' };
}

/** Ten invented families of nine; each contains a chain four edges deep. */
function busyTasks(): LayoutTask[] {
	return Array.from({ length: 10 }, (_, family) => Array.from({ length: 9 }, (_, child) => {
		const id = `F${family}-${child}`;
		return task(id, child === 0 ? null : child <= 4 ? `F${family}-${child - 1}` : `F${family}-0`);
	})).flat();
}

function inside(box: FamilyBox, region: FamilyBox): boolean {
	return box.x >= region.x && box.y >= region.y
		&& box.x + box.width <= region.x + region.width && box.y + box.height <= region.y + region.height;
}

function assertNoOverlaps(layout: TaskFamilyLayout): void {
	const cards = [...layout.cards.values()];
	for (let i = 0; i < cards.length; i++) {
		const card = cards[i]!;
		const family = layout.families.find(family => family.id === card.familyId)!;
		expect(inside(card.occupiedBox, family.bounds)).toBe(true);
		expect(inside(card.pillBox, family.bounds)).toBe(true);
		expect(familyBoxesOverlap(card.occupiedBox, family.header)).toBe(false);
		for (let j = i + 1; j < cards.length; j++) {
			expect(familyBoxesOverlap(card.occupiedBox, cards[j]!.occupiedBox)).toBe(false);
			expect(familyBoxesOverlap(card.pillBox, cards[j]!.pillBox)).toBe(false);
		}
	}
	for (let i = 0; i < layout.families.length; i++) {
		for (let j = i + 1; j < layout.families.length; j++) {
			expect(familyBoxesOverlap(layout.families[i]!.bounds, layout.families[j]!.bounds)).toBe(false);
		}
	}
}

function positions(layout: TaskFamilyLayout) {
	return [...layout.cards].map(([id, card]) => [id, card.familyId, card.box, card.occupiedBox, card.pillBox]);
}

function onBorder(point: FamilyPoint, box: FamilyBox): boolean {
	return (point.x === box.x || point.x === box.x + box.width) && point.y >= box.y && point.y <= box.y + box.height
		|| (point.y === box.y || point.y === box.y + box.height) && point.x >= box.x && point.x <= box.x + box.width;
}

function crossesInterior(a: FamilyPoint, b: FamilyPoint, box: FamilyBox): boolean {
	if (a.x === b.x) return a.x > box.x && a.x < box.x + box.width
		&& Math.min(a.y, b.y) < box.y + box.height && Math.max(a.y, b.y) > box.y;
	return a.y > box.y && a.y < box.y + box.height
		&& Math.min(a.x, b.x) < box.x + box.width && Math.max(a.x, b.x) > box.x;
}

describe('compound family geometry', () => {
	it('contains 90 readable cards, creature bands and pills with no card or region overlap', () => {
		const layout = layoutTaskFamilies(busyTasks());
		expect(layout.cards.size).toBe(90);
		expect(layout.families).toHaveLength(10);
		expect(layout.cards.get('F0-4')!.depth).toBe(4);
		assertNoOverlaps(layout);
	});

	it('grows measured bounds for forty siblings, a twelve-level chain and singleton regions', () => {
		const wide = [task('wide'), ...Array.from({ length: 40 }, (_, i) => task(`wide-${i}`, 'wide'))];
		const deep = Array.from({ length: 12 }, (_, i) => task(`deep-${i}`, i ? `deep-${i - 1}` : null));
		const layout = layoutTaskFamilies([...wide, ...deep, task('loose-a'), task('loose-b')]);
		expect(layout.families).toHaveLength(4);
		expect(layout.cards.get('deep-11')!.depth).toBe(11);
		expect(layout.families.find(family => family.id === 'wide')!.slots).toHaveLength(43);
		assertNoOverlaps(layout);
	});

	it('cuts cycles deterministically, including self cycles, without dropping descendants', () => {
		const tasks = [task('c', 'a'), task('a', 'b'), task('b', 'c'), task('leaf', 'c'), task('self', 'self')];
		const layout = layoutTaskFamilies(tasks);
		expect(layout.cards.size).toBe(5);
		expect(layout.cards.get('a')!.parentId).toBeNull();
		expect(layout.cards.get('leaf')!.familyId).toBe('a');
		expect(layout).toEqual(layoutTaskFamilies([...tasks].reverse()));
		assertNoOverlaps(layout);
	});

	it('uses a full-board familyId across hidden ancestors, and missing parents group siblings', () => {
		const tasks = [task('root'), { ...task('deep', 'hidden-parent'), familyId: 'root' },
			{ ...task('deeper', 'deep'), familyId: 'root' }, task('orphan-a', 'missing'), task('orphan-b', 'missing')];
		const layout = layoutTaskFamilies(tasks);
		expect(layout.families.map(family => family.id)).toEqual(['missing', 'root']);
		expect(layout.cards.get('deeper')!.familyId).toBe('root');
		assertNoOverlaps(layout);
	});

	it('has deterministic order and packing, honoring order then creation time then ID', () => {
		const tasks = [{ ...task('root'), order: 9 }, { ...task('z', 'root'), order: 1 },
			{ ...task('b', 'root'), order: 0, createdAt: '2026-01-02' }, { ...task('a', 'root'), order: 0 }];
		const layout = layoutTaskFamilies(tasks);
		expect(layout.families[0]!.taskIds).toEqual(['root', 'a', 'b', 'z']);
		expect(layout).toEqual(regroupTaskFamilies([...tasks].reverse()));
	});

	it('adapts only first packing to the viewport aspect, and accepts custom measured dimensions', () => {
		const tasks = Array.from({ length: 16 }, (_, i) => task(`loose-${i}`));
		const narrow = layoutTaskFamilies(tasks, { options: { aspect: .4 } });
		const wide = layoutTaskFamilies(tasks, { options: { aspect: 4 } });
		expect(wide.bounds.width).toBeGreaterThan(narrow.bounds.width);
		expect(wide.bounds.height).toBeLessThan(narrow.bounds.height);
		const custom = layoutTaskFamilies(busyTasks(), {
			options: { cardWidth: 310, cardHeight: 130, creatureHeight: 60, gap: 32, padding: 36, indent: 50 },
		});
		assertNoOverlaps(custom);
	});

	it('rejects duplicate IDs and invalid geometry; handles an empty graph', () => {
		expect(() => layoutTaskFamilies([task('a'), task('a')])).toThrow('Duplicate');
		expect(() => layoutTaskFamilies([], { options: { aspect: 0 } })).toThrow('Invalid');
		expect(() => layoutTaskFamilies([], { options: { gap: NaN } })).toThrow('Invalid');
		expect(layoutTaskFamilies([]).bounds).toEqual({ x: 0, y: 0, width: 0, height: 0 });
	});
});

describe('incremental stability and explicit regroup', () => {
	it('status/report-only and worker/thread-only replacements change zero coordinates', () => {
		const tasks = busyTasks();
		const first = layoutTaskFamilies(tasks);
		const status = layoutTaskFamilies(tasks.map(task => ({ ...task, status: 'review', report: 'Ready' })), { previous: first });
		const workers = layoutTaskFamilies(tasks, {
			previous: status, creatureCounts: new Map(tasks.map(task => [task.id, 1_000])), options: { aspect: .1, cardHeight: 500 },
		});
		expect(positions(status)).toEqual(positions(first));
		expect(positions(workers)).toEqual(positions(first));
		expect(workers.families).toEqual(first.families);
		expect(workers.cards.get('F0-0')!.creatureCount).toBe(1_000);
		expect(workers.needsRegroup).toBe(false);
	});

	it('arrivals occupy free family slots without moving any retained card, pill or family', () => {
		const tasks = busyTasks();
		const first = layoutTaskFamilies(tasks);
		const old = structuredClone(first);
		const next = layoutTaskFamilies([...tasks, task('arrival', 'F0-1')], { previous: first });
		expect(positions(next).filter(([id]) => id !== 'arrival')).toEqual(positions(first));
		expect(next.families.map(family => family.bounds)).toEqual(first.families.map(family => family.bounds));
		expect(next.needsRegroup).toBe(false);
		const reserved = first.families[0]!.slots.find(slot => slot.taskId === null)!;
		expect(next.cards.get('arrival')!.box.y).toBe(first.families[0]!.bounds.y + reserved.y);
		expect(next.movedFamilyIds).toEqual([]);
		expect(first).toEqual(old);
		assertNoOverlaps(next);
	});

	it('removal and show-closed toggles reserve named slots and never move open cards', () => {
		const tasks = busyTasks();
		const first = layoutTaskFamilies(tasks);
		const hiddenId = 'F0-2';
		const hidden = layoutTaskFamilies(tasks.filter(task => task.id !== hiddenId), { previous: first });
		const arrived = layoutTaskFamilies([...tasks.filter(task => task.id !== hiddenId), task('arrival', 'F0-0')], { previous: hidden });
		expect(arrived.families[0]!.slots.some(slot => slot.taskId === hiddenId)).toBe(true);
		expect(arrived.cards.has(hiddenId)).toBe(false);
		const restored = layoutTaskFamilies([...tasks, task('arrival', 'F0-0')], { previous: arrived });
		for (const task of tasks) {
			expect(restored.cards.get(task.id)!.box).toEqual(first.cards.get(task.id)!.box);
			if (task.id !== hiddenId) expect(hidden.cards.get(task.id)!.box).toEqual(first.cards.get(task.id)!.box);
		}
	});

	it('keeps entirely hidden families and appends new families without repacking old ones', () => {
		const tasks = [task('a'), task('b')];
		const first = layoutTaskFamilies(tasks);
		const hidden = layoutTaskFamilies([task('b')], { previous: first });
		expect(hidden.families.find(family => family.id === 'a')!.taskIds).toEqual([]);
		const next = layoutTaskFamilies([task('a'), task('b'), task('c')], { previous: hidden });
		expect(next.cards.get('a')!.box).toEqual(first.cards.get('a')!.box);
		expect(next.cards.get('b')!.box).toEqual(first.cards.get('b')!.box);
		assertNoOverlaps(next);
	});

	it('grows locally, reports unavoidable displacement and stays collision-free after overflow', () => {
		const initial = [task('a'), task('b'), task('c'), task('d')];
		const first = layoutTaskFamilies(initial, { options: { aspect: .1, reserveSlots: 1 } });
		const additions = Array.from({ length: 10 }, (_, i) => task(`a-child-${i}`, 'a'));
		const grown = layoutTaskFamilies([...initial, ...additions], { previous: first });
		expect(grown.needsRegroup).toBe(true);
		expect(grown.movedFamilyIds.length).toBeGreaterThan(0);
		const aBefore = first.families.find(family => family.id === 'a')!;
		const aAfter = grown.families.find(family => family.id === 'a')!;
		expect(aAfter.bounds.x).toBe(aBefore.bounds.x);
		expect(aAfter.bounds.y).toBe(aBefore.bounds.y);
		for (const oldFamily of first.families) {
			const family = grown.families.find(family => family.id === oldFamily.id)!;
			for (const slot of oldFamily.slots.filter(slot => slot.taskId !== null)) {
				expect(family.slots.find(next => next.taskId === slot.taskId)).toEqual(slot);
			}
			if (grown.movedFamilyIds.includes(family.id)) {
				expect(family.bounds.y).toBeGreaterThan(oldFamily.bounds.y);
			}
		}
		assertNoOverlaps(grown);
	});

	it('grows width for deeper arrivals without moving old local slots', () => {
		const tasks = [task('root')];
		const first = layoutTaskFamilies(tasks, { options: { reserveDepth: 0, reserveSlots: 8 } });
		const arrivals = Array.from({ length: 6 }, (_, i) => task(`deep-${i}`, i ? `deep-${i - 1}` : 'root'));
		const next = layoutTaskFamilies([...tasks, ...arrivals], { previous: first });
		expect(next.needsRegroup).toBe(true);
		expect(next.cards.get('root')!.box).toEqual(first.cards.get('root')!.box);
		expect(next.families[0]!.bounds.width).toBeGreaterThan(first.families[0]!.bounds.width);
		assertNoOverlaps(next);
	});

	it('flags reparenting within the same family while preserving the original slot', () => {
		const tasks = busyTasks();
		const first = layoutTaskFamilies(tasks);
		const changed = tasks.map(task => task.id === 'F0-4' ? { ...task, parent: 'F0-0' } : task);
		const next = layoutTaskFamilies(changed, { previous: first });
		expect(next.needsRegroup).toBe(true);
		expect(positions(next)).toEqual(positions(first));
		expect(regroupTaskFamilies(changed).cards.get('F0-4')!.depth).toBe(1);
	});

	it('only explicit regroup discards hidden slots and changed-ancestry pins', () => {
		const tasks = busyTasks();
		const first = layoutTaskFamilies(tasks);
		const kept = tasks.filter(task => !['F0-1', 'F0-2', 'F0-3', 'F0-4'].includes(task.id));
		const changed = kept.map(task => task.id === 'F0-8' ? { ...task, parent: 'F1-0' } : task);
		const retained = layoutTaskFamilies(changed, { previous: first });
		expect(retained.cards.get('F0-8')!.familyId).toBe('F0-0');
		expect(retained.needsRegroup).toBe(true);
		const regrouped = regroupTaskFamilies(changed);
		expect(regrouped.needsRegroup).toBe(false);
		expect(regrouped.cards.get('F0-8')!.familyId).toBe('F1-0');
		expect(regrouped.families.find(family => family.id === 'F0-0')!.bounds.height)
			.toBeLessThan(retained.families.find(family => family.id === 'F0-0')!.bounds.height);
		expect(regrouped).toEqual(regroupTaskFamilies([...changed].reverse()));
		assertNoOverlaps(regrouped);
	});
});

describe('semantic zoom and framing', () => {
	it('has legibility-safe hysteresis at both detail thresholds', () => {
		expect(chooseFamilyDetail(.75)).toBe('cards');
		expect(chooseFamilyDetail(.749, 'cards')).toBe('pills');
		expect(chooseFamilyDetail(.76, 'pills')).toBe('pills');
		expect(chooseFamilyDetail(.82, 'pills')).toBe('cards');
		expect(chooseFamilyDetail(.599, 'pills')).toBe('dots');
		expect(chooseFamilyDetail(.61, 'dots')).toBe('dots');
		expect(chooseFamilyDetail(.65, 'dots')).toBe('pills');
		for (const touch of [false, true]) {
			for (const previous of ['cards', 'pills', 'dots'] as const) {
				for (const zoom of [.1, .5, .6, .68, .7, .75, .8, 1]) {
					const level = chooseFamilyDetail(zoom, previous, { touch });
					if (level === 'cards') expect(16 * zoom).toBeGreaterThanOrEqual(12);
					if (level === 'pills') {
						expect(20 * zoom).toBeGreaterThanOrEqual(12);
						expect(64 * zoom).toBeGreaterThanOrEqual(touch ? 44 : 24);
					}
				}
			}
		}
		expect(chooseFamilyDetail(.68, undefined, { touch: true })).toBe('dots');
		expect(chooseFamilyDetail(.7, undefined, { touch: true })).toBe('pills');
	});

	it('pills have compact independent geometry, and dots have a screen-sized heading target', () => {
		const layout = layoutTaskFamilies(busyTasks());
		const cards = [...layout.cards.values()];
		expect(cards[1]!.pillBox.y - cards[0]!.pillBox.y).toBeLessThan(cards[1]!.box.y - cards[0]!.box.y);
		for (const zoom of [.05, .2, .5]) {
			for (const touch of [false, true]) {
				const overview = familyDotGeometry(layout.families[0]!, zoom, touch);
				expect(overview.titleBox.height * zoom).toBeGreaterThanOrEqual(touch ? 44 : 24);
				expect(overview.titleFontSize * zoom).toBe(14);
			}
		}
	});

	it('fits all regions and one family with padding on desktop and phone', () => {
		const layout = layoutTaskFamilies(busyTasks());
		for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
			const all = fitTaskFamilies(layout, viewport);
			for (const family of layout.families) {
				for (const [box, camera] of [[family.bounds, all], [family.bounds, fitTaskFamily(layout, family.id, viewport)]] as const) {
					expect(box.x * camera.zoom + camera.x).toBeGreaterThanOrEqual(23.999999);
					expect(box.y * camera.zoom + camera.y).toBeGreaterThanOrEqual(23.999999);
					expect((box.x + box.width) * camera.zoom + camera.x).toBeLessThanOrEqual(viewport.width - 23.999999);
					expect((box.y + box.height) * camera.zoom + camera.y).toBeLessThanOrEqual(viewport.height - 23.999999);
				}
			}
		}
		expect(fitTaskFamilies(layoutTaskFamilies([]), { width: 390, height: 844 })).toEqual({ x: 0, y: 0, zoom: 1 });
	});

	it('reveal preserves camera identity when visible, and pans only when offscreen without zooming', () => {
		const layout = layoutTaskFamilies(busyTasks());
		const viewport = { width: 390, height: 844 };
		const camera = { x: 0, y: 0, zoom: 1 };
		expect(revealFamilyCard(layout, 'F0-0', camera, viewport)).toBe(camera);
		const moved = revealFamilyCard(layout, 'F9-8', camera, viewport);
		expect(moved.zoom).toBe(camera.zoom);
		expect(moved).not.toEqual(camera);
		const box = layout.cards.get('F9-8')!.occupiedBox;
		expect(box.x + moved.x).toBeGreaterThanOrEqual(24);
		expect(box.y + moved.y).toBeGreaterThanOrEqual(24);
		expect(box.x + box.width + moved.x).toBeLessThanOrEqual(366);
		expect(box.y + box.height + moved.y).toBeLessThanOrEqual(820);
		expect(revealFamilyCard(layout, 'missing', camera, viewport)).toBe(camera);
	});
});

describe('relationship routes', () => {
	it('uses card/pill border endpoints and points blocked arrows at the prerequisite', () => {
		const layout = layoutTaskFamilies(busyTasks());
		const edges: FamilyEdge[] = [
			{ from: 'F0-4', to: 'F0-3', kind: 'subtask' },
			{ from: 'F0-8', to: 'F0-1', kind: 'found-while' },
			{ from: 'F0-4', to: 'F5-2', kind: 'blocked-by' },
			{ from: 'F7-2', to: 'F3-1', kind: 'related' },
			{ from: 'F0-0', to: 'hidden', kind: 'related' },
		];
		for (const detail of ['cards', 'pills'] as const) {
			const routes = routeTaskFamilyEdges(layout, edges, detail);
			expect(routes).toHaveLength(4);
			for (const route of routes) {
				const from = layout.cards.get(route.from)!, to = layout.cards.get(route.to)!;
				expect(onBorder(route.points[0]!, detail === 'cards' ? from.box : from.pillBox)).toBe(true);
				expect(onBorder(route.points.at(-1)!, detail === 'cards' ? to.box : to.pillBox)).toBe(true);
				expect(route.d.startsWith('M')).toBe(true);
				if (route.kind === 'blocked-by') expect(route.arrow!.tip).toEqual(route.points.at(-1));
				else expect(route.arrow).toBeNull();
				for (let i = 1; i < route.points.length; i++) {
					const a = route.points[i - 1]!, b = route.points[i]!;
					expect(a.x === b.x || a.y === b.y).toBe(true);
					for (const card of layout.cards.values()) {
						expect(crossesInterior(a, b, detail === 'cards' ? card.occupiedBox : card.pillBox)).toBe(false);
					}
				}
				if (from.familyId !== to.familyId) {
					for (const id of [from.familyId, to.familyId]) {
						const family = layout.families.find(family => family.id === id)!;
						expect(route.points.some(point => onBorder(point, family.bounds))).toBe(true);
					}
				}
			}
		}
	});

	it('routes a newly appended deep child around intervening shallower branches', () => {
		const tasks = busyTasks();
		const first = layoutTaskFamilies(tasks);
		const next = layoutTaskFamilies([...tasks, task('arrival', 'F0-4')], { previous: first });
		for (const detail of ['cards', 'pills'] as const) {
			const route = routeTaskFamilyEdges(next, [{ from: 'arrival', to: 'F0-4', kind: 'subtask' }], detail)[0]!;
			for (let i = 1; i < route.points.length; i++) {
				for (const card of next.cards.values()) {
					expect(crossesInterior(route.points[i - 1]!, route.points[i]!, detail === 'cards' ? card.occupiedBox : card.pillBox)).toBe(false);
				}
			}
		}
	});

	it('keeps parent routes short and avoids intermediate branch cards', () => {
		const tasks = busyTasks();
		const layout = layoutTaskFamilies(tasks);
		const edges = tasks.filter(task => task.parent).map(task => ({ from: task.id, to: task.parent!, kind: 'subtask' as const }));
		for (const route of routeTaskFamilyEdges(layout, edges)) {
			expect(route.points).toHaveLength(4);
			for (let i = 1; i < route.points.length; i++) {
				for (const card of layout.cards.values()) {
					expect(crossesInterior(route.points[i - 1]!, route.points[i]!, card.occupiedBox)).toBe(false);
				}
			}
		}
	});
});

it('lays out 1,000 synthetic tasks comfortably under the generous 150ms regression budget', () => {
	const tasks = Array.from({ length: 1_000 }, (_, i) => task(`load-${i}`, i % 100 ? `load-${i - 1}` : null));
	const initialTimes: number[] = [], updateTimes: number[] = [];
	for (let sample = 0; sample < 5; sample++) {
		const start = performance.now();
		const layout = layoutTaskFamilies(tasks);
		initialTimes.push(performance.now() - start);
		const updateStart = performance.now();
		const next = layoutTaskFamilies(tasks, { previous: layout, creatureCounts: new Map([['load-1', 20]]) });
		updateTimes.push(performance.now() - updateStart);
		expect(next.cards.size).toBe(1_000);
	}
	initialTimes.sort((a, b) => a - b);
	updateTimes.sort((a, b) => a - b);
	console.info(`Family layout 1,000 tasks: median ${initialTimes[2]!.toFixed(2)}ms fresh, ${updateTimes[2]!.toFixed(2)}ms incremental`);
	expect(initialTimes[2]!).toBeLessThan(150);
	expect(updateTimes[2]!).toBeLessThan(150);
});
