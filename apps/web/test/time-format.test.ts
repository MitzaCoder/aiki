import { afterEach, describe, expect, test } from 'bun:test';
import { formatDateTime, formatTime, formatWallTime, loadTimeFormat, parseTimeFormat, saveTimeFormat, setTimeFormat, timeFormat, TIME_FORMAT_KEY } from '../src/lib/time-format.ts';
afterEach(() => setTimeFormat('automatic'));
const options = { hour:'2-digit', minute:'2-digit', timeZone:'UTC' } as const;
describe('device clock preference', () => {
 test('missing and unknown stored preferences follow locale', () => {
  for (const raw of [undefined, null, '', 'future']) expect(parseTimeFormat(raw)).toBe('automatic');
  expect(parseTimeFormat('12-hour')).toBe('12-hour');
  expect(formatTime('2026-01-01T17:04Z', options, 'en-US')).toBe('05:04 PM');
  expect(formatTime('2026-01-01T17:04Z', options, 'en-GB')).toBe('17:04');
 });
 test('explicit modes override locale, including midnight and noon', () => {
  for (const locale of ['en-US','en-GB']) {
   expect(formatTime('2026-01-01T00:04Z', options, locale, '24-hour')).toBe('00:04');
   expect(formatTime('2026-01-01T12:04Z', options, locale, '12-hour')).toBe('12:04 pm'.replace('pm',locale==='en-US'?'PM':'pm'));
  }
 });
 test('date fields, seconds and named zones survive', () => {
  const at = '2026-01-01T17:04:05Z';
  const full = { year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit', second:'2-digit', timeZone:'America/New_York' } as const;
  expect(formatTime(at,full,'en-US','24-hour')).toContain('12:04:05');
  expect(formatTime(at,full,'en-US','24-hour')).toContain('2026');
 });
 test('stores one browser-local key and tolerates blocked storage', () => {
  const saved = new Map<string, string>();
  const storage = { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => { saved.set(key, value); } };
  expect(loadTimeFormat(storage)).toBe('automatic');
  saveTimeFormat('12-hour', storage);
  expect(saved.get(TIME_FORMAT_KEY)).toBe('12-hour');
  expect(loadTimeFormat(storage)).toBe('12-hour');
  const blocked = { getItem: () => { throw Error('blocked'); }, setItem: () => { throw Error('blocked'); } };
  expect(loadTimeFormat(blocked)).toBe('automatic');
  expect(() => saveTimeFormat('24-hour', blocked)).not.toThrow();
 });
 test('default date-time preserves the existing date fields and seconds', () => {
  const at = new Date(2026, 0, 1, 17, 4, 5);
  expect(formatDateTime(at)).toBe(at.toLocaleString());
 });
 test('changes are live, wall-time values are display-only, storage may be unavailable', () => {
  setTimeFormat('24-hour');expect(timeFormat.current).toBe('24-hour');expect(formatWallTime('17:04')).toBe('17:04');
  setTimeFormat('12-hour');expect(formatTime('2026-01-01T17:04Z',options,'en-US')).toBe('05:04 PM');
  expect(formatWallTime('not a time')).toBe('not a time');
 });
});
