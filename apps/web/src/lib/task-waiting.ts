import type { BoardTask } from '@kemiri/protocol';
import { formatWaitingTime } from './work-day.ts';
import { compactRelativeTime } from './relative-time.ts';

export function waitingSummary(task: Pick<BoardTask, 'waiting'>, now = Date.now()): string {
 const wait = task.waiting;
 if (!wait) return '';
 const note = /^\s*waiting for/i.test(wait.note) ? wait.note : `Waiting for ${wait.note}`;
 return `${note} · since ${compactRelativeTime(wait.since, now)}${wait.until ? ` · back on ${formatWaitingTime(wait.until)}` : ''}`;
}

/** Local calendar dates, so quick picks and the native date input agree across time zones. */
export function waitingDateIn(days: number, now = new Date()): string {
 const date = new Date(now); date.setDate(date.getDate() + days);
 return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

export const TASK_STATUS_CHOICES = [
 {status:'todo',label:'To do',hint:'Not started'},
 {status:'in_progress',label:'In progress',hint:'Start or resume the work'},
 {status:'blocked',label:'Blocked',hint:'Work cannot continue'},
 {status:'review',label:'Ready for review',hint:'Ready for you to check'},
 {status:'waiting',label:'Waiting',hint:'Work done; an external dependency remains'},
 {status:'done',label:'Done',hint:'Close the task'},
 {status:'dropped',label:'Dropped',hint:'This will not be done'},
] as const;
