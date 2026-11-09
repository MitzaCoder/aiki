import { describe, expect, test } from 'bun:test';
import { TASK_SHEET_REPORT_SECTIONS, taskSectionIndex, taskSectionScrollTop, taskSectionSelection, type TaskSectionSelection } from '../src/lib/task-sections.js';

describe('task sheet navigation', () => {
	test('puts Next before Now and Results without changing report history', () => {
		expect(TASK_SHEET_REPORT_SECTIONS.map(({ key }) => key)).toEqual(['next', 'now', 'results']);
	});
	test('has no current section on an empty body', () => {
		expect(taskSectionIndex([], 80)).toBe(-1);
	});
	test('keeps the first section current while the summary is visible', () => {
		expect(taskSectionIndex([200, 500, 900], 80)).toBe(0);
	});
	test('tracks a long section until the following section crosses the sticky nav', () => {
		expect(taskSectionIndex([-400, 81, 500], 80)).toBe(1);
		expect(taskSectionIndex([-400, 82, 500], 80)).toBe(0);
	});
	test('reaches folded final sections at the bottom of the body', () => {
		expect(taskSectionIndex([-400, 200, 300], 80, true)).toBe(2);
	});
	test('only picks visible starts at the bottom', () => {
		expect(taskSectionIndex([-400, 200, 300, 600], 80, true, 500)).toBe(2);
		expect(taskSectionIndex([-400, 200, 500], 80, true, 500)).toBe(1);
	});
	test('selects immediately and ignores spy during and after animation', () => {
		let state = taskSectionSelection({ pinned: false, scrolling: false }, { type: 'select', kind: 'decisions' });
		expect(state).toEqual({ kind: 'decisions', pinned: true, scrolling: true });
		state = taskSectionSelection(state, { type: 'spy', kind: 'workers' });
		expect(state.kind).toBe('decisions');
		state = taskSectionSelection(state, { type: 'scroll-end' });
		expect(state.scrolling).toBe(false);
		expect(taskSectionSelection(state, { type: 'spy', kind: 'brief' }).kind).toBe('decisions');
	});
	test('user scroll releases a pin even when it interrupts the animation', () => {
		for (const scrolling of [false, true]) {
			const state: TaskSectionSelection = { kind: 'history', pinned: true, scrolling };
			const released = taskSectionSelection(state, { type: 'user-scroll' });
			expect(taskSectionSelection(released, { type: 'spy', kind: 'brief' }).kind).toBe('brief');
		}
	});
	test('another click replaces the pin, including a no-distance selection', () => {
		const state = taskSectionSelection({ kind: 'brief', pinned: true, scrolling: false }, { type: 'select', kind: 'history' });
		expect(taskSectionSelection(taskSectionSelection(state, { type: 'scroll-end' }), { type: 'spy', kind: 'brief' }).kind).toBe('history');
	});
	test('clamps short end sections and accounts for the sticky chip inset', () => {
		expect(taskSectionScrollTop(0, 900, 100, 48, 600)).toBe(600);
		expect(taskSectionScrollTop(200, 400, 100, 48, 1000)).toBe(452);
		expect(taskSectionScrollTop(100, 0, 100, 48, 1000)).toBe(0);
	});
});
