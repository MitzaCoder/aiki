import { describe, expect, it } from 'bun:test';
import { taskSummaryCells } from '../src/lib/task-summary.js';

describe('task summary', () => {
	it('keeps only status when a task has no counters, including older backends', () => {
		expect(taskSummaryCells({ status: 'todo' }, 0, 0)).toEqual([{ kind: 'status', label: 'Status', value: 'todo' }]);
	});

	it('shows zero done when there are subtasks, but hides a zero total', () => {
		expect(taskSummaryCells({ status: 'in_progress', subtaskCount: { done: 0, total: 3 } }, 0, 0)[1]).toEqual({
			kind: 'subtasks',
			label: 'Subtasks done',
			value: '0 / 3'
		});
		expect(taskSummaryCells({ status: 'todo', subtaskCount: { done: 0, total: 0 } }, 0, 0)).toHaveLength(1);
	});

	it('counts open questions plus open and handling feedback, not settled feedback', () => {
		const cells = taskSummaryCells({ status: 'review', feedback: { open: 2, handling: 1, addressed: 4, dismissed: 5 } }, 2, 0);
		expect(cells.find((cell) => cell.kind === 'requests')?.value).toBe('5 open requests');
		expect(taskSummaryCells({ status: 'todo' }, 1, 0)[1]?.value).toBe('1 open request');
		expect(taskSummaryCells({ status: 'done', feedback: { open: 0, handling: 0, addressed: 4, dismissed: 1 } }, 0, 0)).toHaveLength(1);
	});

	it('shows running workers only when there are some', () => {
		expect(taskSummaryCells({ status: 'in_progress' }, 0, 2)[1]).toEqual({ kind: 'workers', label: 'Workers', value: '2 running' });
	});

	it('keeps a stable status / progress / requests / workers reading order', () => {
		const cells = taskSummaryCells({ status: 'blocked', subtaskCount: { done: 1, total: 2 } }, 1, 1);
		expect(cells.map((cell) => cell.kind)).toEqual(['status', 'subtasks', 'requests', 'workers']);
	});
});
