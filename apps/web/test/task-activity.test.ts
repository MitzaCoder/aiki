import { describe, expect, test } from 'bun:test';
import type { BoardTask, BoardTaskActivity } from '@kemiri/protocol';
import { automaticTaskActivity, taskActivityAge, taskActivitySupported, taskActivityTone, taskNowText } from '../src/lib/task-activity.js';
import { rowGist, type TaskRow } from '../src/lib/tasks.js';
import { cardGist, type KanbanCard } from '../src/lib/kanban.js';
import { TaskSearchIndex } from '../src/lib/task-search.js';
const activity: BoardTaskActivity = { kind: 'working', text: 'fern is testing the card view', since: '2026-01-01T12:00:00Z', refs: ['synthetic-run'] };
const task = { id: 'T1', title: 'Card view', status: 'in_progress', description: 'Synthetic task', report: { now: 'Old prose', results: '', next: '' }, activity } as BoardTask;
const now = Date.parse('2026-01-01T12:04:00Z');
describe('automatic Now', () => {
	test('requires the explicit feature and optional field; otherwise preserves old prose', () => {
		expect(taskActivitySupported(undefined)).toBe(false);
		expect(taskActivitySupported(['task-freshness'])).toBe(false);
		expect(taskActivitySupported(['task-activity'])).toBe(true);
		expect(automaticTaskActivity(task, false)).toBeUndefined();
		expect(automaticTaskActivity({ ...task, activity: undefined }, true)).toBeUndefined();
		expect(taskNowText(task, false)).toBe('Old prose');
		expect(taskNowText({ ...task, activity: undefined }, true)).toBe('Old prose');
		expect(taskNowText(task, true)).toBe(activity.text);
	});
	test('ticks phase ages locally, handles invalid times and never duplicates state since text', () => {
		expect(taskActivityAge(activity, now)).toBe('4 min ago');
		expect(taskActivityAge(activity, now + 60_000)).toBe('5 min ago');
		expect(taskActivityAge({ ...activity, since: 'invalid' }, now)).toBe('at an unknown time');
		for (const kind of ['delivery', 'waiting', 'review', 'done', 'dropped', 'idle'] as const) expect(taskActivityAge({ ...activity, kind, text: 'Live since 14:17' }, now)).toBe('');
		for (const kind of ['unknown', 'not_started'] as const) expect(taskActivityAge({ ...activity, kind }, now)).toBe('');
		expect(taskActivityAge({ ...activity, kind: 'review', text: 'Ready for your review' }, now)).toBe('4 min ago');
	});
	test('uses calm kind tones, with failure distinct from attention and active work', () => {
		expect(taskActivityTone('failure')).toBe('error');
		for (const kind of ['question', 'feedback', 'waiting', 'blocked'] as const) expect(taskActivityTone(kind)).toBe('attention');
		for (const kind of ['working', 'deploy'] as const) expect(taskActivityTone(kind)).toBe('active');
		expect(taskActivityTone('review')).toBe('review');
		for (const kind of ['done', 'dropped', 'idle', 'unknown', 'not_started', 'delivery'] as const) expect(taskActivityTone(kind)).toBe('muted');
	});
	test('list and board gists use canonical activity when enabled, with legacy defaults unchanged', () => {
		const row: TaskRow = { task, waiting: [], section: 'working' };
		const card = { task, waiting: [], column: 'working' } as KanbanCard;
		expect(rowGist(row)).toBe('Old prose');
		expect(cardGist(card)).toBe('Old prose');
		expect(rowGist(row, true)).toBe(activity.text);
		expect(cardGist(card, true)).toBe(activity.text);
		expect(rowGist({ ...row, section: 'review' }, true)).toBe(activity.text);
	});
	test('search indexes canonical activity, not displayed ages or superseded prose', () => {
		const index = new TaskSearchIndex();
		index.update([{ id: task.id, title: task.title, parent: null, refs: [], body: taskNowText(task, true) }]);
		expect(index.search('testing', new Set(['T1']))).toHaveLength(1);
		expect(index.search('4 min ago', new Set(['T1']))).toHaveLength(0);
		expect(index.search('Old prose', new Set(['T1']))).toHaveLength(0);
	});
});
