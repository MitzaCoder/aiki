import { formatTime } from '#lib/time-format.ts';
export const DEFAULT_WORK_DAY_START = '08:00';
export function normalizeWorkDayStart(start: unknown): string {
 return typeof start === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(start) ? start : DEFAULT_WORK_DAY_START;
}

/** Resolve a calendar date on this device, using calendar arithmetic across DST.
 * Gaps shift forward; overlaps choose the earlier instant (native Date semantics).
 * Past choices advance by calendar days until the next occurrence.
 */
export function resolveWaitingDate(date: string, start = DEFAULT_WORK_DAY_START, now = new Date()): string | undefined {
 if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
 const [year, month, day] = date.split('-').map(Number) as [number, number, number];
 const [hour, minute] = normalizeWorkDayStart(start).split(':').map(Number) as [number, number];
 const resolved = new Date(year, month - 1, day, hour, minute);
 if (!Number.isFinite(resolved.getTime())) return undefined;
 while (resolved.getTime() <= now.getTime()) {
  // Reset the requested wall time after advancing (a previous DST gap may have shifted it).
  resolved.setDate(resolved.getDate() + 1);
  resolved.setHours(hour, minute, 0, 0);
 }
 return resolved.toISOString();
}

export function localWaitingDate(timestamp: string): string {
 const date = new Date(timestamp);
 return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

export function formatWaitingTime(timestamp: string): string {
 return formatTime(timestamp, { weekday:'short', day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' }, undefined);
}
