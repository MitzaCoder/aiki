import { markdownText, type BoardTimelineEntry } from '@aiki/protocol';

export const TIMELINE_ORDER_STORAGE_KEY = 'aiki.timeline-order.v1';
export type TimelineOrder = 'newest' | 'oldest';
export function parseTimelineOrder(stored: string | null): TimelineOrder {
	return stored === 'oldest' ? 'oldest' : 'newest';
}
export function loadTimelineOrder(storage?: Pick<Storage, 'getItem'>): TimelineOrder {
	try { return parseTimelineOrder(storage?.getItem(TIMELINE_ORDER_STORAGE_KEY) ?? null); } catch { return 'newest'; }
}
export function saveTimelineOrder(storage: Pick<Storage, 'setItem'> | undefined, order: TimelineOrder): void {
	try { storage?.setItem(TIMELINE_ORDER_STORAGE_KEY, order); } catch { /* Private browsers still allow a session choice. */ }
}
export function orderedTimeline(entries: readonly BoardTimelineEntry[], order: TimelineOrder): BoardTimelineEntry[] {
	const sorted = [...entries].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
	return order === 'newest' ? sorted.reverse() : sorted;
}
/** Local calendar boundaries, not elapsed 24-hour periods (including DST). */
export function timelineDay(at: string, now = Date.now()): string {
	const date = new Date(at), today = new Date(now), yesterday = new Date(now);
	yesterday.setDate(today.getDate() - 1);
	if (date.toDateString() === today.toDateString()) return 'Today';
	if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
	return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
export function timelineStatus(label: string): string[] | undefined {
	const states = label.split(' → ');
	return states.length === 2 ? states.map(state => state.replaceAll('_', ' ')) : undefined;
}
export function timelineDetail(detail: string): string {
	return markdownText(detail).replace(/\s+/g, ' ').trim();
}
export function timelineTone(entry: BoardTimelineEntry): string {
	if (/\bfailed\b/i.test(entry.label)) return 'danger';
	if (/\breported\b/i.test(entry.label)) return 'success';
	if (entry.kind === 'question') return 'warning';
	if (entry.kind === 'status' || entry.kind === 'worker') return 'activity';
	if (entry.kind === 'milestone') return 'success';
	return 'accent';
}
