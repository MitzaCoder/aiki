import { DEFAULT_WORK_DAY_START, normalizeWorkDayStart } from './work-day.ts';

const STORAGE_KEY = 'mihai-harness.work-day-start.v1';
/** General settings are device-local, like the theme, not owned by any backend. */
class WorkDaySettings {
 start = $state(DEFAULT_WORK_DAY_START);
 constructor() {
  if (typeof localStorage !== 'undefined') {
   try { this.start = normalizeWorkDayStart(localStorage.getItem(STORAGE_KEY)); } catch { /* Storage unavailable. */ }
  }
 }
 set(start: string) {
  this.start = normalizeWorkDayStart(start);
  try { localStorage.setItem(STORAGE_KEY, this.start); } catch { /* Keep the in-memory preference. */ }
 }
}
export const workDay = new WorkDaySettings();
