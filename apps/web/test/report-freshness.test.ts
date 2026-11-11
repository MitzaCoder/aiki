import { describe, expect, test } from 'bun:test';
import { reportUpdateRequest } from '../src/lib/report-update.js';
import type { BoardReportSection, BoardTask } from '@aiki/protocol';
import { emptyFinishedResults, reportFreshnessEnabled, reportSectionAge, reportSectionReasons } from '../src/lib/report-freshness.js';
const section: BoardReportSection = { writtenAt: '2026-01-01T10:00:00Z', writtenBy: null, version: 1, coveredEventSeq: 0, approximate: false, stale: true, eventsSince: 6, reasons: ['Q121 answered'] };
const task = (status: string, results = '', freshness: unknown = { results: section, next: section }) => ({ status, report: { results, freshness } }) as BoardTask;
describe('report freshness', () => {
	test('one-tap request leaves section choice and reason to the agent', () => {
		expect(reportUpdateRequest('synthetic-project', 'T1')).toEqual({ type: 'board.report.stale', projectId: 'synthetic-project', taskId: 'T1' });
	});
	test('requires both capability and metadata', () => {
		expect(reportFreshnessEnabled(false, task('review'))).toBe(false);
		expect(reportFreshnessEnabled(true, { report: {} } as BoardTask)).toBe(false);
		expect(reportFreshnessEnabled(true, task('review'))).toBe(true);
	});
	test('section ages and uncovered events', () => {
		const now = Date.parse('2026-01-01T12:00:00Z');
		expect(reportSectionAge(section, now)).toBe('written 2 h ago · 6 events since');
		expect(reportSectionAge({ ...section, approximate: true, eventsSince: 1 }, now)).toBe('written about 2 h ago · 1 event since');
		expect(reportSectionAge({ ...section, writtenAt: null, eventsSince: 0 }, now)).toBe('Not written yet');
		expect(reportSectionAge({ ...section, writtenAt: 'invalid', eventsSince: 0 }, now)).toBe('written at an unknown time');
		expect(reportSectionAge(section, now + 3_600_000)).toStartWith('written 3 h ago');
	});
	test('empty finished Results metadata only adds new information', () => {
		const empty = { ...section, writtenAt: null, reasons: ['work finished', 'Q121 answered'] };
		expect(reportSectionAge(empty, Date.now(), true)).toBe('6 events since');
		expect(reportSectionAge({ ...empty, eventsSince: 0 }, Date.now(), true)).toBe('');
		expect(reportSectionReasons(empty, true)).toEqual(['Q121 answered']);
		expect(reportSectionReasons(empty)).toEqual(['work finished', 'Q121 answered']);
	});
	test('finished work needs results, not invented prose', () => {
		for (const status of ['review', 'done']) expect(emptyFinishedResults(task(status, '  '))).toBe(true);
		for (const status of ['todo', 'in_progress', 'waiting', 'dropped']) expect(emptyFinishedResults(task(status))).toBe(false);
		expect(emptyFinishedResults(task('done', 'Proof attached'))).toBe(false);
	});
});
