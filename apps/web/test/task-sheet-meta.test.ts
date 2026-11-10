import { describe, expect, it } from 'bun:test';
import { taskSheetMeta, taskWorkerCount } from '../src/lib/task-sheet-meta.js';
import { waitingSummary } from '../src/lib/task-waiting.js';
import { openFeedbackCount } from '../src/lib/task-relations.js';

describe('task sheet compact context', () => {
	it('does not repeat status or reserve space for absent counters', () => {
		for (const status of ['todo', 'in_progress', 'review', 'blocked', 'waiting', 'done', 'dropped'] as const)
			expect(taskSheetMeta({ status })).toEqual([]);
	});
	it('keeps zero done and progress even without related links', () => {
		expect(taskSheetMeta({ status: 'review', subtaskCount: { done: 0, total: 3 } })).toEqual(['Subtasks 0 / 3 done']);
		expect(taskSheetMeta({ status: 'done', subtaskCount: { done: 3, total: 3 } })).toEqual(['Subtasks 3 / 3 done']);
		expect(taskSheetMeta({ status: 'todo', subtaskCount: { done: 0, total: 0 } })).toEqual([]);
	});
	it('retains the complete waiting note, since and optional return date', () => {
		const now = Date.parse('2026-11-16T12:00:00Z');
		const waiting = { note: 'PR approval', since: '2026-11-16T11:00:00Z', until: '2026-11-17T08:00:00Z' };
		for (const wait of [waiting, { ...waiting, until: undefined }]) {
			const task = { status: 'waiting' as const, waiting: wait };
			expect(taskSheetMeta(task, now)).toEqual([waitingSummary(task, now)]);
			expect(taskSheetMeta(task, now)[0]).toContain('Waiting for PR approval · since');
		}
		expect(taskSheetMeta({ status: 'done', waiting }, now)).toEqual([]);
	});
	it('keeps total and running worker counts distinct', () => {
		expect(taskWorkerCount(3, 2)).toBe('3 · 2 running');
		expect(taskWorkerCount(3, 0)).toBe('3');
	});
	it('feedback navigation uses stored open and handling totals before timeline loading', () => {
		expect(openFeedbackCount({ feedback: { open: 2, handling: 1, addressed: 4, dismissed: 5 } })).toBe(3);
		expect(openFeedbackCount({})).toBe(0);
	});
});
