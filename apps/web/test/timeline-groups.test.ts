import { describe, expect, test } from 'bun:test';
import type { BoardTimelineFact, BoardTimelineGroup, BoardTimelineKind } from '@kemiri/protocol';
import { filteredGroupLabel, timelineClock, timelineGroupNames, timelineGroupRange, timelineGroupTone, timelineGroupsSupported, visibleTimelineGroups } from '../src/lib/timeline-groups.js';
const at = (minute: number) => new Date(2026, 0, 1, 14, minute).toISOString();
const fact = (id: string, kind: BoardTimelineKind, label: string, outcome = 'recorded', minute = 0): BoardTimelineFact => ({ id, kind, label, outcome, at: at(minute), endAt: at(minute + 10), revision: 2, factCount: 2, group: 'work' });
const group = (entries: BoardTimelineFact[], kind: BoardTimelineGroup['kind'] = 'work'): BoardTimelineGroup => ({ id: 'opaque-group-id', kind, hour: at(0), range: { start: at(0), end: at(36) }, revision: 4, factCount: 4, label: 'Server summary', entries });
describe('hourly timeline presentation', () => {
	test('requires an explicit capability and names all group kinds', () => {
		expect(timelineGroupsSupported(undefined)).toBe(false);
		expect(timelineGroupsSupported(['task-links'])).toBe(false);
		expect(timelineGroupsSupported(['task-timeline-groups'])).toBe(true);
		expect(Object.values(timelineGroupNames)).toEqual(['Work', 'Decisions and feedback', 'Delivery']);
	});
	test('localises ranges without regrouping cross-hour runs', () => {
		const cross = group([fact('worker', 'worker', 'Worker fern reported', 'reported')]);
		cross.range.end = at(88);
		expect(timelineGroupRange(cross)).toBe('14:00–15:28');
		expect(timelineClock('invalid')).toBe('Unknown time');
		expect(visibleTimelineGroups([cross], new Set(), 'newest')[0]?.hour).toBe(at(0));
	});
	test('keeps server labels and IDs, reorders copies and treats an empty groups array as empty', () => {
		const first = group([fact('a', 'worker', 'Worker fern reported')]);
		const second = { ...first, id: 'another-opaque-id', hour: at(60) };
		const snapshot = JSON.stringify([first, second]);
		expect(visibleTimelineGroups([first, second], new Set(), 'newest').map(g => g.id)).toEqual(['another-opaque-id', 'opaque-group-id']);
		expect(visibleTimelineGroups([first, second], new Set(), 'oldest').map(g => g.id)).toEqual(['opaque-group-id', 'another-opaque-id']);
		expect(visibleTimelineGroups([first], new Set(), 'newest')[0]?.label).toBe('Server summary');
		expect(visibleTimelineGroups([], new Set(), 'newest')).toEqual([]);
		expect(JSON.stringify([first, second])).toBe(snapshot);
	});
	test('orders an hour by group starts, not category names or evolving end times', () => {
		const early = group([fact('worker', 'worker', 'Worker fern reported')]);
		const later = { ...group([fact('deploy', 'milestone', 'Deploy queued')], 'delivery'), id: 'delivery-id', range: { start: at(38), end: at(47) } };
		early.range.end = at(88);
		expect(visibleTimelineGroups([early, later], new Set(), 'newest').map(g => g.id)).toEqual(['delivery-id', 'opaque-group-id']);
		expect(visibleTimelineGroups([early, later], new Set(), 'oldest').map(g => g.id)).toEqual(['opaque-group-id', 'delivery-id']);
	});
	test('filters entries inside groups and recalculates label, count, range and revision without mutation', () => {
		const worker = { ...fact('worker', 'worker', 'Worker fern failed', 'failed'), source: 'worker' };
		const status = { ...fact('status', 'status', 'in_progress → review', 'review', 30), factCount: 1, revision: 1 };
		const original = group([worker, status]);
		const shown = visibleTimelineGroups([original], new Set(['worker']), 'newest')[0]!;
		expect(shown).toMatchObject({ id: original.id, hour: original.hour, label: 'ready for review', factCount: 1, revision: 1, range: { start: at(30), end: at(40) } });
		expect(shown.entries).toEqual([status]);
		expect(original.entries).toHaveLength(2);
		expect(visibleTimelineGroups([original], new Set(['worker', 'status']), 'newest')).toEqual([]);
	});
	test('failures and open questions retain emphasis over newer routine success', () => {
		const failure = fact('failed', 'worker', 'Worker fern failed', 'failed');
		const success = fact('reported', 'worker', 'Worker moss reported', 'reported', 20);
		expect(filteredGroupLabel(group([failure, success]))).toBe('Worker fern failed');
		expect(timelineGroupTone(group([failure, success]))).toBe('danger');
		const open = { ...fact('q1', 'question', 'Q1 open', 'open'), ref: 'Q1' };
		const feedback = fact('f1', 'feedback', 'F1 addressed', 'addressed', 20);
		const decisions = group([open, feedback], 'decisions');
		expect(filteredGroupLabel(decisions)).toBe('Q1 awaiting answer');
		expect(timelineGroupTone(decisions)).toBe('warning');
		const filtered = visibleTimelineGroups([decisions], new Set(['question']), 'newest')[0]!;
		expect(filtered.label).toBe('F1 addressed');
		expect(timelineGroupTone(filtered)).toBe('accent');
	});
	test('filtered summaries retain worker, question/feedback and delivery outcomes', () => {
		const worker = { ...fact('worker', 'worker', 'Worker fern reported', 'reported'), source: 'worker' };
		const status = fact('status', 'status', 'in_progress → review');
		expect(filteredGroupLabel(group([worker, status]))).toBe('1 worker reported; ready for review');
		expect(filteredGroupLabel(group([fact('q', 'question', 'Q1 answered', 'answered'), fact('f', 'feedback', 'F1 addressed', 'addressed')], 'decisions'))).toBe('Q1 answered; F1 addressed');
		const deploy = { ...fact('deploy', 'milestone', 'live on 3/3 targets', 'ok'), source: 'deploy' };
		expect(filteredGroupLabel(group([fact('change', 'milestone', '3 changes landed on main'), deploy], 'delivery'))).toBe('3 changes landed; live on 3/3 targets');
	});
});
