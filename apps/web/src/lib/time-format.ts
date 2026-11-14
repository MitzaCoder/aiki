import { fromStore, writable } from 'svelte/store';

export type TimeFormat = 'automatic' | '24-hour' | '12-hour';
export const TIME_FORMAT_KEY = 'aiki.time-format.v1';
export const TIME_FORMAT_OPTIONS = [
 { value: 'automatic', label: 'Automatic' },
 { value: '24-hour', label: '24-hour' },
 { value: '12-hour', label: '12-hour' },
] as const;
export function parseTimeFormat(raw: unknown): TimeFormat {
 return raw === '24-hour' || raw === '12-hour' ? raw : 'automatic';
}
function browserStorage(): Storage | undefined {
 try { return globalThis.localStorage; } catch { return undefined; }
}
export function loadTimeFormat(storage: Pick<Storage, 'getItem'> | undefined = browserStorage()): TimeFormat {
 try { return parseTimeFormat(storage?.getItem(TIME_FORMAT_KEY)); } catch { return 'automatic'; }
}
export function saveTimeFormat(format: TimeFormat, storage: Pick<Storage, 'setItem'> | undefined = browserStorage()): void {
 try { storage?.setItem(TIME_FORMAT_KEY, format); } catch { /* Session choice still applies. */ }
}
const preference = writable<TimeFormat>(loadTimeFormat());
/** fromStore keeps formatter calls reactive, including inside derived labels and tooltips. */
export const timeFormat = fromStore(preference);
export function setTimeFormat(format: TimeFormat): void {
 preference.set(format);
 saveTimeFormat(format);
}
const formatters = new Map<string, Intl.DateTimeFormat>();
/** All displayed clock times pass here. Date fields and timezone remain the caller's choice. */
export function formatTime(
 at: Date | number | string,
 options: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' },
 locale?: string,
 format: TimeFormat = timeFormat.current,
): string {
 const adjusted = { ...options };
 // Explicit modes override legacy per-surface hour cycles; midnight is 00, never 24.
 if (format !== 'automatic') {
  delete adjusted.hour12;
  adjusted.hourCycle = format === '24-hour' ? 'h23' : 'h12';
 }
 // Include the current defaults: a device timezone change must not reuse an old clock.
 const defaults = new Intl.DateTimeFormat().resolvedOptions();
 adjusted.timeZone ??= defaults.timeZone;
 const resolvedLocale = locale ?? defaults.locale;
 const key = JSON.stringify([resolvedLocale, adjusted]);
 let formatter = formatters.get(key);
 if (!formatter) {
  formatter = new Intl.DateTimeFormat(resolvedLocale, adjusted);
  if (formatters.size >= 128) formatters.clear();
  formatters.set(key, formatter);
 }
 return formatter.format(new Date(at));
}
export function formatDateTime(at: Date | number | string): string {
 // The same date fields and seconds as Date.toLocaleString(), without a short-style two-digit year.
 return formatTime(at, { year:'numeric', month:'numeric', day:'numeric', hour:'numeric', minute:'2-digit', second:'2-digit' });
}
/** Protocol/editor wall times remain HH:mm; only their displayed labels change. */
export function formatWallTime(time: string): string {
 const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
 if (!match) return time;
 return formatTime(Date.UTC(2000, 0, 1, Number(match[1]), Number(match[2])), { hour:'2-digit', minute:'2-digit', timeZone:'UTC' });
}
