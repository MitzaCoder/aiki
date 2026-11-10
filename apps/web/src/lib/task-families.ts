import type { TaskRow, TaskSection } from './tasks.js';

export type FamilyExpansion = Readonly<Record<string, boolean>>;
export type TaskFamily = {
	row: TaskRow;
	children: TaskFamily[];
	canToggle: boolean;
	expanded: boolean;
	foldedCount: number;
};

/** Only quiet same-status work may fold away. Questions and warnings always remain visible. */
export function needsFamilyAttention(row: TaskRow): boolean {
	return row.waiting.length > 0 || ['review', 'blocked', 'waiting'].includes(row.task.status);
}

/**
 * Nest only within the same status AND section. Cross-status children keep their own row/group.
 * Input order remains the priority order among roots and siblings; nesting makes parents precede children.
 */
export function taskFamilies(section: TaskSection, expansion: FamilyExpansion): TaskFamily[] {
	const byId = new Map(section.rows.map((row) => [row.task.id, row]));
	const parents = new Map<string, string>();
	for (const row of section.rows) {
		const parent = row.task.parent == null ? undefined : byId.get(row.task.parent);
		if (parent && parent.task.status === row.task.status && parent.task.id !== row.task.id) parents.set(row.task.id, parent.task.id);
	}
	// A partial/stale board must not lose tasks to a cycle, even though the server rejects cycles.
	for (const id of parents.keys()) {
		const seen = new Set([id]);
		let ancestor = parents.get(id);
		while (ancestor !== undefined) {
			if (seen.has(ancestor)) { parents.delete(id); break; }
			seen.add(ancestor);
			ancestor = parents.get(ancestor);
		}
	}
	const children = new Map<string, TaskRow[]>();
	for (const row of section.rows) {
		const parent = parents.get(row.task.id);
		if (parent !== undefined) children.set(parent, [...(children.get(parent) ?? []), row]);
	}
	const attention = new Map<string, boolean>();
	function mustShow(row: TaskRow): boolean {
		const cached = attention.get(row.task.id);
		if (cached !== undefined) return cached;
		const required = needsFamilyAttention(row) || (children.get(row.task.id) ?? []).some(mustShow);
		attention.set(row.task.id, required);
		return required;
	}
	function branchCount(row: TaskRow): number {
		return 1 + (children.get(row.task.id) ?? []).reduce((count, child) => count + branchCount(child), 0);
	}
	function family(row: TaskRow): TaskFamily {
		const nested = children.get(row.task.id) ?? [];
		const canToggle = nested.some((child) => !mustShow(child));
		const expanded = canToggle && expansion[row.task.id] === true;
		const visible = nested.filter((child) => expanded || mustShow(child));
		return {
			row, canToggle, expanded,
			children: visible.map(family),
			foldedCount: nested.filter((child) => !expanded && !mustShow(child)).reduce((count, child) => count + branchCount(child), 0)
		};
	}
	return section.rows.filter((row) => !parents.has(row.task.id)).map(family);
}

export const FAMILY_EXPANSION_KEY = 'aiki.task-families.v1';

/** Scope choices to backend/project, not just T1, which exists on every board. */
export function familyExpansionKey(backendId: string, projectId: string): string {
	return `${FAMILY_EXPANSION_KEY}:${encodeURIComponent(backendId)}:${encodeURIComponent(projectId)}`;
}

export function loadFamilyExpansion(key: string, storage: Pick<Storage, 'getItem'> | undefined): Record<string, boolean> {
	try {
		const parsed: unknown = JSON.parse(storage?.getItem(key) ?? '{}');
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
		return Object.fromEntries(Object.entries(parsed).filter(([id, expanded]) => /^T\d+$/.test(id) && typeof expanded === 'boolean'));
	} catch { return {}; }
}

export function saveFamilyExpansion(key: string, expansion: FamilyExpansion, storage: Pick<Storage, 'setItem'> | undefined): void {
	try { storage?.setItem(key, JSON.stringify(expansion)); } catch { /* Keep in-memory choices when storage is unavailable. */ }
}
