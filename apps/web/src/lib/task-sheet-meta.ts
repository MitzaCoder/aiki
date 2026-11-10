import type { BoardTask } from '@aiki/protocol';
import { waitingSummary } from './task-waiting.js';

/** Context formerly unique to the summary, kept compact in the wrapping header metadata. */
export function taskSheetMeta(task: Pick<BoardTask, 'status' | 'waiting' | 'subtaskCount'>, now = Date.now()): string[] {
	const context: string[] = [];
	if (task.status === 'waiting' && task.waiting) context.push(waitingSummary(task, now));
	if (task.subtaskCount && task.subtaskCount.total > 0)
		context.push(`Subtasks ${task.subtaskCount.done} / ${task.subtaskCount.total} done`);
	return context;
}

export function taskWorkerCount(total: number, running: number): string {
	return running > 0 ? `${total} · ${running} running` : String(total);
}
