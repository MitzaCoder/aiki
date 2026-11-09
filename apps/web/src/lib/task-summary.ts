import type { BoardTask } from '@mihai-harness/protocol';
import { openFeedbackCount } from './task-relations.js';

export type TaskSummaryCell = { kind: 'status' | 'subtasks' | 'requests' | 'workers'; label: string; value: string };

/** Omit empty counters rather than reserving dead space in a small task's summary. */
export function taskSummaryCells(
	task: Pick<BoardTask, 'status' | 'subtaskCount' | 'feedback'>,
	openQuestions: number,
	runningWorkers: number
): TaskSummaryCell[] {
	const cells: TaskSummaryCell[] = [{ kind: 'status', label: 'Status', value: task.status }];
	if (task.subtaskCount && task.subtaskCount.total > 0) {
		cells.push({ kind: 'subtasks', label: 'Subtasks done', value: `${task.subtaskCount.done} / ${task.subtaskCount.total}` });
	}
	const requests = openQuestions + openFeedbackCount(task);
	if (requests > 0)
		cells.push({ kind: 'requests', label: 'Needs you', value: `${requests} open ${requests === 1 ? 'request' : 'requests'}` });
	if (runningWorkers > 0) cells.push({ kind: 'workers', label: 'Workers', value: `${runningWorkers} running` });
	return cells;
}
