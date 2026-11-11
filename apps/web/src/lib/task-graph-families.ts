/** Pure, deterministic geometry. No status, report, watch or DOM dependency. */
export type LayoutTask = {
	id: string;
	parent: string | null;
	/** Resolve against the full board when ancestors are hidden; otherwise inferred from visible parents. */
	familyId?: string;
	order?: number;
	createdAt?: string;
};

export type FamilyPoint = { x: number; y: number };
export type FamilyBox = FamilyPoint & { width: number; height: number };
export type FamilyLayoutOptions = {
	cardWidth: number;
	cardHeight: number;
	/** A fixed badge/count band, reserved even for tasks with no workers or threads. */
	creatureHeight: number;
	/** Reserve crew space above the body, allowing creatures to overlap its top edge. */
	creaturesAbove: boolean;
	gap: number;
	indent: number;
	padding: number;
	headerHeight: number;
	familyGap: number;
	reserveSlots: number;
	reserveDepth: number;
	aspect: number;
	pillWidth: number;
	pillHeight: number;
};

export const DEFAULT_FAMILY_LAYOUT_OPTIONS: Readonly<FamilyLayoutOptions> = {
	cardWidth: 236,
	cardHeight: 100,
	creatureHeight: 40,
	creaturesAbove: false,
	gap: 24,
	indent: 36,
	padding: 24,
	headerHeight: 64,
	familyGap: 48,
	reserveSlots: 2,
	reserveDepth: 2,
	aspect: 1.5,
	pillWidth: 184,
	pillHeight: 64,
};

/** Coordinates are family-local. A hidden task keeps its named slot; only null slots accept new IDs. */
export type FamilySlot = FamilyPoint & { taskId: string | null; parentId: string | null; depth: number };
export type TaskFamilyRegion = {
	id: string;
	bounds: FamilyBox;
	header: FamilyBox;
	slots: FamilySlot[];
	/** Visible tasks only, in slot order. Entirely hidden families remain reserved. */
	taskIds: string[];
};
export type FamilyCard = {
	id: string;
	familyId: string;
	parentId: string | null;
	depth: number;
	box: FamilyBox;
	/** Includes the fixed creature band. Render excess creatures as a count, never grow this box. */
	occupiedBox: FamilyBox;
	creatureBox: FamilyBox;
	creatureCount: number;
	/** Separate compressed slot geometry, not a small-font card. */
	pillBox: FamilyBox;
};
export type TaskFamilyLayout = {
	families: TaskFamilyRegion[];
	cards: Map<string, FamilyCard>;
	bounds: FamilyBox;
	options: FamilyLayoutOptions;
	/** Sticky until explicit regroup: overflow or changed ancestry warrants a compact fresh layout. */
	needsRegroup: boolean;
	/** Only unavoidable collision displacements on this update; never status/worker-driven. */
	movedFamilyIds: string[];
};
export type FamilyLayoutInput = {
	previous?: TaskFamilyLayout;
	/** Combined worker/thread counts. Counts change badges, not geometry. */
	creatureCounts?: ReadonlyMap<string, number>;
	/** Geometry options take effect on first layout or regroup only, not on resize/watch replacement. */
	options?: Partial<FamilyLayoutOptions>;
};

type TaskTree = {
	tasks: Map<string, LayoutTask>;
	parents: Map<string, string | null>;
	families: Map<string, string>;
	depths: Map<string, number>;
	ordered: LayoutTask[];
};

const compareIds = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const compareTasks = (a: LayoutTask, b: LayoutTask) =>
	(a.order ?? 0) - (b.order ?? 0) || compareIds(a.createdAt ?? '', b.createdAt ?? '') || compareIds(a.id, b.id);

/** Iterative chain walks avoid stack overflow and cut a cycle at its lexically smallest ID. */
function buildTaskTree(input: readonly LayoutTask[]): TaskTree {
	const tasks = new Map<string, LayoutTask>();
	for (const task of input) {
		if (tasks.has(task.id)) throw new Error(`Duplicate layout task: ${task.id}`);
		tasks.set(task.id, task);
	}
	const parents = new Map(input.map(task => [task.id, tasks.has(task.parent ?? '') ? task.parent : null]));
	const roots = new Map<string, string>();
	for (const task of input) {
		if (roots.has(task.id)) continue;
		const chain: string[] = [];
		const visiting = new Map<string, number>();
		let id = task.id;
		let root: string;
		while (true) {
			const known = roots.get(id);
			if (known !== undefined) {
				root = known;
				break;
			}
			const cycleStart = visiting.get(id);
			if (cycleStart !== undefined) {
				root = chain.slice(cycleStart).sort(compareIds)[0]!;
				parents.set(root, null);
				break;
			}
			visiting.set(id, chain.length);
			chain.push(id);
			const parent = parents.get(id);
			if (!parent) {
				// A direct missing parent is still a useful shared family ID for orphan siblings.
				root = tasks.get(id)!.parent ?? id;
				break;
			}
			id = parent;
		}
		for (const member of chain) roots.set(member, root);
	}
	const families = new Map(input.map(task => [task.id, task.familyId ?? roots.get(task.id)!]));
	for (const [id, parent] of parents) {
		if (parent && families.get(parent) !== families.get(id)) parents.set(id, null);
	}
	const children = new Map<string, LayoutTask[]>();
	const top: LayoutTask[] = [];
	for (const task of input) {
		const parent = parents.get(task.id);
		if (!parent) top.push(task);
		else {
			const siblings = children.get(parent) ?? [];
			siblings.push(task);
			children.set(parent, siblings);
		}
	}
	top.sort(compareTasks);
	for (const siblings of children.values()) siblings.sort(compareTasks);
	const stack = top.reverse().map(task => ({ task, depth: 0 }));
	const ordered: LayoutTask[] = [];
	const depths = new Map<string, number>();
	while (stack.length) {
		const { task, depth } = stack.pop()!;
		ordered.push(task);
		depths.set(task.id, depth);
		const descendants = children.get(task.id) ?? [];
		for (let i = descendants.length - 1; i >= 0; i--) stack.push({ task: descendants[i]!, depth: depth + 1 });
	}
	return { tasks, parents, families, depths, ordered };
}

function layoutOptions(input?: Partial<FamilyLayoutOptions>): FamilyLayoutOptions {
	const options = { ...DEFAULT_FAMILY_LAYOUT_OPTIONS, ...input };
	for (const [name, amount] of Object.entries(options)) {
		if (name === 'creaturesAbove') {
			if (typeof amount !== 'boolean') throw new Error(`Invalid family layout option: ${name}`);
			continue;
		}
		if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) throw new Error(`Invalid family layout option: ${name}`);
	}
	for (const name of ['cardWidth', 'cardHeight', 'pillWidth', 'pillHeight', 'aspect'] as const) {
		if (options[name] === 0) throw new Error(`Invalid family layout option: ${name}`);
	}
	options.pillWidth = Math.min(options.pillWidth, options.cardWidth);
	options.pillHeight = Math.min(options.pillHeight, options.cardHeight + options.creatureHeight);
	options.reserveSlots = Math.ceil(options.reserveSlots);
	options.reserveDepth = Math.ceil(options.reserveDepth);
	return options;
}

function slotAt(row: number, depth: number, options: FamilyLayoutOptions): FamilyPoint {
	return {
		x: options.padding + depth * options.indent,
		y: options.headerHeight + options.padding + row * (options.cardHeight + options.creatureHeight + options.gap),
	};
}

function freshFamily(id: string, tasks: LayoutTask[], tree: TaskTree, options: FamilyLayoutOptions): TaskFamilyRegion {
	const slots: FamilySlot[] = tasks.map((task, row) => ({
		taskId: task.id, parentId: task.parent, depth: tree.depths.get(task.id)!, ...slotAt(row, tree.depths.get(task.id)!, options),
	}));
	for (let i = 0; i < options.reserveSlots; i++) {
		slots.push({ taskId: null, parentId: null, depth: 0, ...slotAt(slots.length, 0, options) });
	}
	let depth = 0;
	for (const slot of slots) depth = Math.max(depth, slot.depth);
	const width = options.padding * 2 + options.cardWidth + (depth + options.reserveDepth) * options.indent;
	const height = options.headerHeight + options.padding * 2
		+ slots.length * (options.cardHeight + options.creatureHeight + options.gap) - options.gap;
	return {
		id, bounds: { x: 0, y: 0, width, height },
		header: { x: 0, y: 0, width, height: options.headerHeight }, slots, taskIds: [],
	};
}

export function familyBoxesOverlap(a: FamilyBox, b: FamilyBox): boolean {
	return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function familyBounds(families: TaskFamilyRegion[]): FamilyBox {
	if (!families.length) return { x: 0, y: 0, width: 0, height: 0 };
	let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
	for (const { bounds } of families) {
		left = Math.min(left, bounds.x);
		top = Math.min(top, bounds.y);
		right = Math.max(right, bounds.x + bounds.width);
		bottom = Math.max(bottom, bounds.y + bounds.height);
	}
	return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Deterministic shelves whose target width follows the supplied viewport aspect. */
function packFamilies(families: TaskFamilyRegion[], options: FamilyLayoutOptions): void {
	const area = families.reduce((sum, family) =>
		sum + (family.bounds.width + options.familyGap) * (family.bounds.height + options.familyGap), 0);
	const targetWidth = Math.sqrt(area * options.aspect);
	let x = 0, y = 0, rowHeight = 0;
	for (const family of families) {
		if (x && x + family.bounds.width > targetWidth) {
			x = 0;
			y += rowHeight + options.familyGap;
			rowHeight = 0;
		}
		family.bounds.x = x;
		family.bounds.y = y;
		x += family.bounds.width + options.familyGap;
		rowHeight = Math.max(rowHeight, family.bounds.height);
	}
}

/** Keep expanded anchors first. Move another region only if its old rectangle now collides. */
function clearGrowthCollisions(families: TaskFamilyRegion[], grown: Set<string>, gap: number): string[] {
	const placed: TaskFamilyRegion[] = [];
	const moved: string[] = [];
	const priority = [...families].sort((a, b) => Number(grown.has(b.id)) - Number(grown.has(a.id)) || compareIds(a.id, b.id));
	for (const family of priority) {
		const originalY = family.bounds.y;
		let collision: boolean;
		do {
			collision = false;
			for (const other of placed) {
				const expanded = { ...other.bounds, x: other.bounds.x - gap, y: other.bounds.y - gap,
					width: other.bounds.width + gap * 2, height: other.bounds.height + gap * 2 };
				if (!familyBoxesOverlap(family.bounds, expanded)) continue;
				family.bounds.y = other.bounds.y + other.bounds.height + gap;
				collision = true;
			}
		} while (collision);
		if (family.bounds.y !== originalY) moved.push(family.id);
		placed.push(family);
	}
	return moved;
}

/**
 * Reconcile visible tasks. Hidden/closed task slots and even empty families are retained until regroup.
 * Existing slots never change local coordinates. Status/report/creature updates never change any coordinates.
 * Overflow expands only that family; unavoidable neighboring displacements are explicitly reported.
 * A reparented task stays in its old family until regroup (needsRegroup becomes true).
 * Never mutate the previous layout. Keep it between updates; do not call regroup on every watch/resize.
 */
export function layoutTaskFamilies(tasks: readonly LayoutTask[], input: FamilyLayoutInput = {}): TaskFamilyLayout {
	const previous = input.previous;
	const options = previous ? { ...previous.options } : layoutOptions(input.options);
	const tree = buildTaskTree(tasks);
	const groups = new Map<string, LayoutTask[]>();
	const previousMembership = new Map<string, string>();
	for (const family of previous?.families ?? []) {
		for (const slot of family.slots) if (slot.taskId !== null) previousMembership.set(slot.taskId, family.id);
	}
	let needsRegroup = previous?.needsRegroup ?? false;
	for (const task of tree.ordered) {
		const inferred = tree.families.get(task.id)!;
		const familyId = previousMembership.get(task.id) ?? inferred;
		if (familyId !== inferred) needsRegroup = true;
		const members = groups.get(familyId) ?? [];
		members.push(task);
		groups.set(familyId, members);
	}
	const families: TaskFamilyRegion[] = [];
	const grown = new Set<string>();
	for (const old of previous?.families ?? []) {
		const family = { ...old, bounds: { ...old.bounds }, header: { ...old.header },
			slots: old.slots.map(slot => ({ ...slot })), taskIds: [] };
		const members = groups.get(family.id) ?? [];
		groups.delete(family.id);
		const assigned = new Map(family.slots.map(slot => [slot.taskId, slot]));
		let freeIndex = 0;
		for (const task of members) {
			const retained = assigned.get(task.id);
			if (retained) {
				if (retained.parentId !== task.parent) needsRegroup = true;
				continue;
			}
			while (freeIndex < family.slots.length && family.slots[freeIndex]!.taskId !== null) freeIndex++;
			const depth = tree.depths.get(task.id)!;
			const slot = { taskId: task.id, parentId: task.parent, depth, ...slotAt(freeIndex, depth, options) };
			if (freeIndex < family.slots.length) family.slots[freeIndex] = slot;
			else family.slots.push(slot);
			const width = slot.x + options.cardWidth + options.padding;
			const height = slot.y + options.cardHeight + options.creatureHeight + options.padding;
			if (width > family.bounds.width || height > family.bounds.height) {
				family.bounds.width = Math.max(family.bounds.width, width);
				family.bounds.height = Math.max(family.bounds.height, height);
				grown.add(family.id);
				needsRegroup = true;
			}
		}
		families.push(family);
	}
	const arrivals = [...groups].sort(([a], [b]) => compareIds(a, b))
		.map(([id, members]) => freshFamily(id, members, tree, options));
	let movedFamilyIds: string[] = [];
	if (!previous) {
		families.push(...arrivals);
		packFamilies(families, options);
	} else {
		if (grown.size) movedFamilyIds = clearGrowthCollisions(families, grown, options.familyGap);
		// New families append below the old bounds, never repack the old shelves.
		packFamilies(arrivals, options);
		const oldBounds = familyBounds(families);
		const offset = families.length ? oldBounds.y + oldBounds.height + options.familyGap : 0;
		for (const family of arrivals) family.bounds.y += offset;
		families.push(...arrivals);
	}
	const cards = new Map<string, FamilyCard>();
	for (const family of families) {
		family.header = { ...family.bounds, height: options.headerHeight };
		family.taskIds = [];
		for (let row = 0; row < family.slots.length; row++) {
			const slot = family.slots[row]!;
			if (slot.taskId === null || !tree.tasks.has(slot.taskId)) continue;
			family.taskIds.push(slot.taskId);
			const x = family.bounds.x + slot.x, y = family.bounds.y + slot.y;
			const box = { x, y: y + (options.creaturesAbove ? options.creatureHeight : 0), width: options.cardWidth, height: options.cardHeight };
			const parent = tree.parents.get(slot.taskId) ?? null;
			cards.set(slot.taskId, {
				id: slot.taskId, familyId: family.id, parentId: parent, depth: slot.depth, box,
				occupiedBox: { x, y, width: options.cardWidth, height: options.cardHeight + options.creatureHeight },
				creatureBox: { x, y: options.creaturesAbove ? y : y + options.cardHeight, width: options.cardWidth, height: options.creatureHeight },
				creatureCount: Math.max(0, input.creatureCounts?.get(slot.taskId) ?? 0),
				pillBox: {
					x: family.bounds.x + options.padding + slot.depth * options.indent * Math.min(1, options.pillWidth / options.cardWidth),
					y: family.bounds.y + options.headerHeight + options.padding + row * (options.pillHeight + options.gap / 2),
					width: Math.min(options.cardWidth, options.pillWidth),
					height: Math.min(options.cardHeight + options.creatureHeight, options.pillHeight),
				},
			});
		}
	}
	return { families, cards, bounds: familyBounds(families), options, needsRegroup, movedFamilyIds };
}

/** Explicitly discard reservations and changed-ancestry pins; compact deterministically. */
export function regroupTaskFamilies(tasks: readonly LayoutTask[], input: Omit<FamilyLayoutInput, 'previous'> = {}): TaskFamilyLayout {
	return layoutTaskFamilies(tasks, input);
}

export * from './task-graph-families-view.ts';
export * from './task-graph-families-edges.ts';
