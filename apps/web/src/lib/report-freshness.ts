import type { BoardReportSection, BoardTask } from '@aiki/protocol';
import { relativeTime } from './relative-time.js';

export function reportFreshnessEnabled(advertised: boolean, task: BoardTask): boolean {
	return advertised && task.report.freshness !== undefined;
}

export function reportSectionAge(section: BoardReportSection, now: number, emptyResults = false): string {
	const age = emptyResults ? '' : section.writtenAt === null ? 'Not written yet' : `written ${section.approximate ? 'about ' : ''}${relativeTime(section.writtenAt, now)}`;
	const events = section.eventsSince > 0 ? `${section.eventsSince} ${section.eventsSince === 1 ? 'event' : 'events'} since` : '';
	return [age, events].filter(Boolean).join(' · ');
}

export function reportSectionReasons(section: BoardReportSection, emptyResults = false): string[] {
	return section.reasons.filter(reason => !emptyResults || reason.trim().toLowerCase() !== 'work finished');
}

export function emptyFinishedResults(task: BoardTask): boolean {
	return (task.status === 'review' || task.status === 'done') && task.report.results.trim().length === 0;
}
