import type { BoardTask, BoardTaskActivity } from '@aiki/protocol';
import { relativeTime } from './relative-time.js';

export function taskActivitySupported(features: readonly string[] | undefined): boolean {
	return features?.includes('task-activity') ?? false;
}

export function automaticTaskActivity(task: BoardTask, enabled: boolean): BoardTaskActivity | undefined {
	return enabled ? task.activity : undefined;
}

/** Canonical text only: used by search and gists, never a locally formatted age. */
export function taskNowText(task: BoardTask, enabled: boolean): string {
	return automaticTaskActivity(task, enabled)?.text ?? task.report.now;
}

export function taskActivityAge(activity: BoardTaskActivity, now: number): string {
	if (activity.kind === 'unknown' || activity.kind === 'not_started') return '';
	// Delivery/state summaries may already include a verified “since” clock. Never add a second age.
	if (['delivery', 'waiting', 'review', 'done', 'dropped', 'idle'].includes(activity.kind) && /\bsince\b/i.test(activity.text)) return '';
	return relativeTime(activity.since, now);
}

export function taskActivityTone(kind: BoardTaskActivity['kind']): 'error' | 'attention' | 'active' | 'review' | 'muted' {
	if (kind === 'failure') return 'error';
	if (['question', 'feedback', 'blocked', 'waiting'].includes(kind)) return 'attention';
	if (kind === 'working' || kind === 'deploy') return 'active';
	if (kind === 'review') return 'review';
	return 'muted';
}
