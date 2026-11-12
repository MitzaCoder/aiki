import { describe, expect, test } from 'bun:test';
import {
	familyExpansionKey, loadFamilyExpansion, needsFamilyAttention, saveFamilyExpansion, taskFamilies,
	type FamilyExpansion, type TaskFamily
} from '../src/lib/task-families.js';
import { taskSections, type TaskRow } from '../src/lib/tasks.js';

type BoardTask = TaskRow['task'];
type Question = TaskRow['waiting'][number];
function task(id: string, overrides: Partial<BoardTask> = {}): BoardTask {
	return {
		id, title: `Example ${id}`, revision: 1, description: '', acceptance: null, refs: [],
		status: 'todo', blockedBy: [], blockedReason: null, writeScopes: [], workerIds: [], scheduleId: null,
		report: { now: '', results: '', next: '', revision: 0, updatedAt: null, updatedBy: null },
		snapshots: 0, order: Number(id.slice(1)), createdBy: 'user', updatedBy: 'user',
		createdAt: '2026-11-05T10:00:00Z', updatedAt: '2026-11-05T10:00:00Z', settledAt: null, archived: false,
		...overrides
	};
}
function question(taskId: string, kind: 'question' | 'warning' = 'question'): Question {
	return { id: 'Q1', revision: 1, taskId, kind, text: 'Choose a sample label', options: [], status: 'open', answer: null } as Question;
}
function grouped(tasks: BoardTask[], questions: Question[] = [], expansion: FamilyExpansion = {}) {
	return taskSections({ tasks, questions }).map((section) => ({ section, families: taskFamilies(section, expansion) }));
}
function visible(families: TaskFamily[]): string[] {
	return families.flatMap((family) => [family.row.task.id, ...visible(family.children)]);
}
const quietFamily = [task('T1'), task('T2', { parent: 'T1' }), task('T3', { parent: 'T2' }), task('T4')];

describe('collapsible task families', () => {
	test('quiet same-status families start collapsed; counts still include folded tasks', () => {
		const [{ section, families }] = grouped(quietFamily);
		expect(section!.rows).toHaveLength(4);
		expect(visible(families!)).toEqual(['T1', 'T4']);
		expect(families![0]).toMatchObject({ canToggle: true, expanded: false, foldedCount: 2 });
	});
	test('nested expansion is independent and preserved when an ancestor closes', () => {
		expect(visible(grouped(quietFamily, [], { T1: true })[0]!.families)).toEqual(['T1', 'T2', 'T4']);
		expect(visible(grouped(quietFamily, [], { T1: true, T2: true })[0]!.families)).toEqual(['T1', 'T2', 'T3', 'T4']);
		expect(visible(grouped(quietFamily, [], { T1: false, T2: true })[0]!.families)).toEqual(['T1', 'T4']);
	});
	test('parents precede children, while roots and siblings keep their priority', () => {
		const families = grouped([task('T3', { parent: 'T1', order: 0 }), task('T4', { order: 1 }), task('T1', { order: 2 }), task('T2', { parent: 'T1', order: 3 })], [], { T1: true })[0]!.families;
		expect(visible(families)).toEqual(['T4', 'T1', 'T3', 'T2']);
	});
	test('different statuses stay in their own groups at every depth', () => {
		const tasks = [
			task('T1', { status: 'in_progress' }), task('T2', { parent: 'T1', status: 'in_progress' }),
			task('T3', { parent: 'T1', status: 'review' }), task('T4', { parent: 'T2', status: 'blocked' }),
			task('T5', { parent: 'T1', status: 'waiting' }), task('T6', { parent: 'T1', status: 'done' }), task('T7', { parent: 'T1' })
		];
		const sections = grouped(tasks);
		for (const [id, taskId] of [['review', 'T3'], ['blocked', 'T4'], ['waiting', 'T5'], ['closed', 'T6'], ['todo', 'T7']]) {
			const families = sections.find(({ section }) => section.id === id)!.families;
			expect(visible(families)).toEqual([taskId!]);
			expect(families[0]!.row.task.parent).toBeDefined(); // UI renders the parent breadcrumb on root rows.
		}
		expect(visible(sections.find(({ section }) => section.id === 'working')!.families)).toEqual(['T1']);
	});
	for (const status of ['review', 'blocked', 'waiting'] as const) {
		test(`${status} descendants stay visible even when their same-status parent is collapsed`, () => {
			const families = grouped([task('T1', { status }), task('T2', { status, parent: 'T1' }), task('T3', { status, parent: 'T2' })], [], { T1: false, T2: false })[0]!.families;
			expect(visible(families)).toEqual(['T1', 'T2', 'T3']);
			expect(families[0]!.canToggle).toBe(false); // Never offer a toggle that does nothing.
		});
	}
	for (const kind of ['question', 'warning'] as const) {
		test(`an open ${kind} escapes a quiet family into Needs you`, () => {
			const sections = grouped(quietFamily, [question('T3', kind)]);
			expect(visible(sections.find(({ section }) => section.id === 'needs_you')!.families)).toEqual(['T3']);
			expect(visible(sections.find(({ section }) => section.id === 'todo')!.families)).toEqual(['T1', 'T4']);
		});
		test(`same-status nested open ${kind} cannot be folded even with saved false choices`, () => {
			const families = grouped(quietFamily.slice(0, 3), [question('T1', kind), { ...question('T2', kind), id: 'Q2' }, { ...question('T3', kind), id: 'Q3' }], { T1: false, T2: false })[0]!.families;
			expect(visible(families)).toEqual(['T1', 'T2', 'T3']);
		});
	}
	test('different statuses never nest even when both rows are in Needs you', () => {
		const families = grouped([task('T1'), task('T2', { parent: 'T1', status: 'blocked' })], [question('T1'), { ...question('T2'), id: 'Q2' }])[0]!.families;
		expect(families).toHaveLength(2);
		expect(families.every(({ children }) => children.length === 0)).toBe(true);
	});
	test('a status change immediately reveals a formerly folded child', () => {
		const before = grouped(quietFamily);
		expect(before.flatMap(({ families }) => visible(families))).not.toContain('T2');
		const after = grouped(quietFamily.map((entry) => entry.id === 'T2' ? { ...entry, status: 'review' } : entry));
		expect(after.find(({ section }) => section.id === 'review')!.families[0]!.row.task.id).toBe('T2');
	});
	test('archived and unavailable parents do not swallow their children', () => {
		const archived = task('T1', { archived: true });
		expect(visible(grouped([archived, task('T2', { parent: 'T1' })])[0]!.families)).toEqual(['T2']);
		expect(visible(grouped([task('T2', { parent: 'T404' })])[0]!.families)).toEqual(['T2']);
	});
	test('leaf rows have no disclosure, stale cycles and self-links do not lose tasks', () => {
		const families = grouped([task('T1', { parent: 'T2' }), task('T2', { parent: 'T1' }), task('T3', { parent: 'T3' })], [], { T1: true, T2: true })[0]!.families;
		expect(visible(families).sort()).toEqual(['T1', 'T2', 'T3']);
		expect(families.find(({ row }) => row.task.id === 'T3')!.canToggle).toBe(false);
	});
	test('unlinked rows remain flat on backends without task links', () => {
		expect(visible(grouped([task('T1'), task('T2')])[0]!.families)).toEqual(['T1', 'T2']);
	});
	test('attention rules do not treat ordinary work as an alert', () => {
		for (const status of ['todo', 'in_progress', 'done', 'dropped'] as const) expect(needsFamilyAttention({ task: task('T1', { status }), waiting: [], section: 'todo' })).toBe(false);
	});
});

describe('local family choices', () => {
	test('default is collapsed and keys isolate backend and project', () => {
		expect(loadFamilyExpansion('unused', undefined)).toEqual({});
		expect(familyExpansionKey('one', 'p')).not.toBe(familyExpansionKey('two', 'p'));
		expect(familyExpansionKey('one', 'p')).not.toBe(familyExpansionKey('one', 'q'));
	});
	test('keeps explicit false as well as nested true choices after reload', () => {
		const stored = new Map<string, string>();
		const storage = { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => { stored.set(key, value); } };
		const key = familyExpansionKey('one', 'p');
		saveFamilyExpansion(key, { T1: false, T2: true }, storage);
		expect(loadFamilyExpansion(key, storage)).toEqual({ T1: false, T2: true });
		expect(loadFamilyExpansion(familyExpansionKey('two', 'p'), storage)).toEqual({});
	});
	test('corrupt, unavailable or blocked storage cannot break the list', () => {
		for (const text of ['no json', 'null', '[]', 'true']) expect(loadFamilyExpansion('key', { getItem: () => text })).toEqual({});
		expect(loadFamilyExpansion('key', { getItem: () => '{"T1":true,"T2":false,"T3":"yes","other":true}' })).toEqual({ T1: true, T2: false });
		expect(loadFamilyExpansion('key', { getItem: () => { throw new Error('blocked'); } })).toEqual({});
		expect(() => saveFamilyExpansion('key', { T1: true }, { setItem: () => { throw new Error('full'); } })).not.toThrow();
	});
});
