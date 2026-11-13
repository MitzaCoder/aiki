import { describe, expect, it } from 'bun:test';
import type { SubscriptionResetCredit } from '@kemiri/protocol';
import { groupResets, resetExplanation, resetExpiry, resetUnavailableReason } from '../src/lib/subscription-resets.ts';
const fable: SubscriptionResetCredit = { id: 'synthetic-fable', label: 'Fable reset', program: 'cedar_ember', remaining: 1, usable: true, expiresAt: '2027-03-09T23:59:59Z', clears: ['five_hour', 'seven_day_overage_included'], givesBackWeekly: true };
describe('limit reset rows', () => {
 it('groups matching grants while preserving one opaque spend ID', () => {
  const groups = groupResets([fable, {...fable, id:'second'}, {...fable, id:'third'}, {...fable, id:'full', label:'Full reset', clears:['five_hour','seven_day'], givesBackWeekly:false}]);
  expect(groups.map(g=>[g.credit.id,g.remaining])).toEqual([['synthetic-fable',3],['full',1]]);
 });
 it('never groups different expiry, scope or usability and omits spent grants', () => {
  expect(groupResets([fable,{...fable,expiresAt:null},{...fable,usable:false},{...fable,clears:['five_hour']},{...fable,remaining:0}])).toHaveLength(4);
 });
 it('explains the exact Fable scopes and weekly give-back, not a full weekly refill', () => {
  expect(resetExplanation(fable)).toBe('This refills your 5-hour limit and your Fable allowance and gives back what Fable used on your weekly limit.');
  expect(resetExplanation({...fable,clears:['five_hour','seven_day'],givesBackWeekly:false})).toBe('This refills your 5-hour limit and your weekly limit.');
 });
 it('formats expiry, unknown scopes and disabled reasons', () => {
  expect(resetExpiry(fable.expiresAt,3)).toStartWith('all expire ');
  expect(resetExpiry(null,1)).toBe('No expiry reported');
  expect(resetUnavailableReason({...fable,unavailableReason:'weekly_limit_not_reached'})).toBe('weekly limit not reached');
  expect(resetExplanation({...fable,clears:['future_scope'],givesBackWeekly:false})).toContain('future scope');
 });
});
