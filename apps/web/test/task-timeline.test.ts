import { expect, test } from 'bun:test';
import type { BoardTimelineEntry } from '@aiki/protocol';
import { loadTimelineOrder, orderedTimeline, saveTimelineOrder, timelineDay, timelineDetail, timelineStatus, timelineTone, TIMELINE_ORDER_STORAGE_KEY } from '../src/lib/task-timeline.js';

const entries: BoardTimelineEntry[] = [
	{ at: '2026-11-02T14:00:00Z', kind: 'status', label: 'todo → in_progress' },
	{ at: '2026-11-03T14:00:00Z', kind: 'worker', label: 'Worker lens reported' },
	{ at: '2026-11-03T14:00:00Z', kind: 'milestone', label: 'Preview ready' }
];
test('orders a copy, including equal-time events, in both directions', () => {
	expect(orderedTimeline(entries, 'newest')).toEqual([entries[2]!, entries[1]!, entries[0]!]);
	expect(orderedTimeline([entries[1]!, entries[0]!], 'oldest')).toEqual(entries.slice(0, 2));
	expect(entries[0]!.label).toBe('todo → in_progress');
	expect(orderedTimeline([], 'newest')).toEqual([]);
});
test('defaults to newest and persists a global choice with unavailable-storage fallback', () => {
	let stored: string | null = null;
	const storage = { getItem: (key: string) => { expect(key).toBe(TIMELINE_ORDER_STORAGE_KEY); return stored; }, setItem: (key: string, value: string) => { expect(key.startsWith('aiki.')).toBe(true); stored = value; } };
	expect(loadTimelineOrder(storage)).toBe('newest');
	saveTimelineOrder(storage, 'oldest');
	expect(loadTimelineOrder(storage)).toBe('oldest');
	saveTimelineOrder(storage, 'newest');
	expect(loadTimelineOrder(storage)).toBe('newest');
	expect(loadTimelineOrder({ getItem: () => { throw Error('Unavailable'); } })).toBe('newest');
	expect(() => saveTimelineOrder({ setItem: () => { throw Error('Unavailable'); } }, 'oldest')).not.toThrow();
	stored = 'invalid'; expect(loadTimelineOrder(storage)).toBe('newest');
});
test('groups by local calendar day, not elapsed hours', () => {
	const now = new Date(2026, 10, 3, 0, 5).getTime();
	expect(timelineDay(new Date(2026, 10, 3).toISOString(), now)).toBe('Today');
	expect(timelineDay(new Date(2026, 10, 2, 23, 59).toISOString(), now)).toBe('Yesterday');
	expect(timelineDay(new Date(2026, 9, 1).toISOString(), now)).not.toBe('Yesterday');
});
test('status chips, secondary summaries and event tones keep meaning', () => {
	expect(timelineStatus(entries[0]!.label)).toEqual(['todo', 'in progress']);
	expect(timelineStatus('Imported history')).toBeUndefined();
	expect(timelineDetail('**Checked** the map.\n\nNext: contrast.')).toBe('Checked the map. Next: contrast.');
	expect(timelineTone(entries[1]!)).toBe('success');
	expect(timelineTone({ ...entries[1]!, label: 'Worker lens failed' })).toBe('danger');
});
test('timeline body order also drives section navigation', async () => {
	const source = await Bun.file(new URL('../src/lib/components/TaskSheet.svelte', import.meta.url)).text();
	expect(source.indexOf('{@render reportSection()}')).toBeLessThan(source.indexOf('{@render timelineSection()}'));
	expect(source.indexOf('{@render timelineSection()}')).toBeLessThan(source.indexOf('{@render feedbackSection()}'));
});
