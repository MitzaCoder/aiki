import { expect, test } from 'bun:test';
import { DEFAULT_WORK_DAY_START, normalizeWorkDayStart, resolveWaitingDate, localWaitingDate, formatWaitingTime } from '../src/lib/work-day.ts';
import { waitingDateIn } from '../src/lib/task-waiting.ts';

test('work day defaults to 08:00 and rejects invalid stored preferences', () => {
 expect(DEFAULT_WORK_DAY_START).toBe('08:00');
 for (const value of [null, '', '24:00', '9:00', '08:60']) expect(normalizeWorkDayStart(value)).toBe('08:00');
 expect(normalizeWorkDayStart('17:45')).toBe('17:45');
});

test('quick picks use local calendar days across zones and both DST transitions', () => {
 const original = process.env.TZ;
 try {
  for (const [zone, clock, expected] of [
   ['America/New_York','2026-03-07T17:00:00Z',['2026-03-08T12:00:00.000Z','2026-03-10T12:00:00.000Z','2026-03-14T12:00:00.000Z']],
   ['America/New_York','2026-10-31T16:00:00Z',['2026-11-01T13:00:00.000Z','2026-11-03T13:00:00.000Z','2026-11-07T13:00:00.000Z']],
   ['Asia/Kathmandu','2026-03-07T17:00:00Z',['2026-03-08T02:15:00.000Z','2026-03-10T02:15:00.000Z','2026-03-14T02:15:00.000Z']],
  ] as const) {
   process.env.TZ=zone;
   const now=new Date(clock);
   for (const [index,days] of [1,3,7].entries()) expect(resolveWaitingDate(waitingDateIn(days,now),'08:00',now)).toBe(expected[index]);
  }
 } finally { if (original === undefined) delete process.env.TZ; else process.env.TZ=original; }
});

test('past dates roll forward at the configured wall time; timestamps display locally', () => {
 const original=process.env.TZ;process.env.TZ='America/New_York';
 try {
  expect(resolveWaitingDate('2026-03-07','08:00',new Date('2026-03-07T17:00:00Z'))).toBe('2026-03-08T12:00:00.000Z');
  expect(resolveWaitingDate('2026-03-08','09:30',new Date('2026-03-07T17:00:00Z'))).toBe('2026-03-08T13:30:00.000Z');
  expect(resolveWaitingDate('2026-03-08','02:30',new Date('2026-03-07T17:00:00Z'))).toBe('2026-03-08T07:30:00.000Z');
  expect(resolveWaitingDate('2026-11-01','01:30',new Date('2026-10-31T16:00:00Z'))).toBe('2026-11-01T05:30:00.000Z');
  expect(localWaitingDate('2026-03-08T02:00:00Z')).toBe('2026-03-07');
  expect(formatWaitingTime('2026-03-08T12:00:00Z')).toContain('08:00');
  expect(resolveWaitingDate('')).toBeUndefined();
 } finally {if (original === undefined) delete process.env.TZ; else process.env.TZ=original;}
});
