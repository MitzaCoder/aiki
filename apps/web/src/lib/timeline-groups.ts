import type { BoardTimelineFact, BoardTimelineGroup, BoardTimelineGroupKind, BoardTimelineKind } from '@kemiri/protocol';
import type { TimelineOrder } from './task-timeline.js';

export function timelineGroupsSupported(features: readonly string[] | undefined): boolean {
	return features?.includes('task-timeline-groups') ?? false;
}
export const timelineGroupNames: Record<BoardTimelineGroupKind, string> = { work: 'Work', decisions: 'Decisions and feedback', delivery: 'Delivery' };

export function timelineClock(at: string): string {
	return Number.isFinite(Date.parse(at)) ? new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) : 'Unknown time';
}
export function timelineGroupRange(group: BoardTimelineGroup): string {
	return `${timelineClock(group.range.start)}–${timelineClock(group.range.end)}`;
}
export function timelineGroupTone(group: BoardTimelineGroup): string {
	if (group.entries.some(entry => entry.outcome === 'failed' || entry.outcome === 'rolled_back')) return 'danger';
	if (group.entries.some(entry => entry.kind === 'question' && entry.outcome === 'open')) return 'warning';
	return group.kind === 'delivery' ? 'success' : group.kind === 'work' ? 'activity' : 'accent';
}

/** Recompute only filtered summaries; unfiltered server labels remain authoritative. */
export function filteredGroupLabel(group: BoardTimelineGroup): string {
	const latest = [...group.entries].sort((a, b) => b.endAt.localeCompare(a.endAt) || b.id.localeCompare(a.id));
	const clean = (label: string) => label.replace(/\s+/g, ' ').trim();
	const failure = latest.find(entry => entry.outcome === 'failed' || entry.outcome === 'rolled_back');
	if (failure) return clean(failure.label);
	const open = latest.filter(entry => entry.kind === 'question' && entry.outcome === 'open');
	if (open.length) return `${open.map(entry => entry.ref).join(', ')} awaiting answer`;
	if (group.kind === 'decisions') return [latest.find(entry => entry.kind === 'question'), latest.find(entry => entry.kind === 'feedback')].filter((entry): entry is BoardTimelineFact => !!entry).map(entry => clean(entry.label)).join('; ') || clean(latest[0]?.label ?? '');
	if (group.kind === 'delivery') {
		const landed = latest.reduce((count, entry) => count + Number(/^(\d+) changes? landed/i.exec(entry.label)?.[1] ?? 0), 0);
		const deploy = latest.find(entry => entry.source === 'deploy');
		return [landed ? `${landed} change${landed === 1 ? '' : 's'} landed` : '', deploy ? clean(deploy.label) : ''].filter(Boolean).join('; ') || clean(latest[0]?.label ?? '');
	}
	const workers = latest.filter(entry => entry.source === 'worker' && entry.outcome === 'reported').length;
	const status = latest.find(entry => entry.kind === 'status');
	return [workers ? `${workers} worker${workers === 1 ? '' : 's'} reported` : '', status ? /→ review$/.test(status.label) ? 'ready for review' : clean(status.label) : ''].filter(Boolean).join('; ') || clean(latest[0]?.label ?? '');
}

/** Keep opaque IDs and starting-hour anchors when filtering; never rebucket by an evolving end time. */
export function visibleTimelineGroups(groups: readonly BoardTimelineGroup[], hidden: ReadonlySet<BoardTimelineKind>, order: TimelineOrder): BoardTimelineGroup[] {
	const filtered = groups.flatMap(group => {
		const entries = group.entries.filter(entry => !hidden.has(entry.kind));
		if (!entries.length) return [];
		if (entries.length === group.entries.length) return [group];
		const next = { ...group, entries,
			range: { start: entries.reduce((at, entry) => entry.at < at ? entry.at : at, entries[0]!.at), end: entries.reduce((at, entry) => entry.endAt > at ? entry.endAt : at, entries[0]!.endAt) },
			factCount: entries.reduce((count, entry) => count + entry.factCount, 0), revision: entries.reduce((count, entry) => count + entry.revision, 0) };
		return [{ ...next, label: filteredGroupLabel(next) }];
	}).sort((a, b) => a.hour.localeCompare(b.hour) || a.range.start.localeCompare(b.range.start) || a.kind.localeCompare(b.kind));
	return order === 'newest' ? filtered.reverse() : filtered;
}
