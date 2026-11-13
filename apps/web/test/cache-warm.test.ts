import { expect, test } from 'bun:test';
import { cacheWarmByAnchor, cacheWarmDetail, cacheWarmLabel } from '../src/lib/chat/cache-warm.js';
import { buildTranscript } from '../src/lib/transcript.js';
import type { CacheWarmStretch } from '@kemiri/protocol';
const stretch: CacheWarmStretch = { id: 's', anchorEntryId: 2, startedAt: 100, lastAt: 200, attempts: 1, refreshes: 1, cachedTokens: 100, cost: .04 };
test('one line per stretch, deduplicated between pages and live updates', () => {
 const grouped = cacheWarmByAnchor([stretch, {...stretch, lastAt: 300, attempts: 3, refreshes: 3}], new Set([2]));
 expect(grouped.get(2)).toHaveLength(1); expect(grouped.get(2)?.[0]?.refreshes).toBe(3);
});
test('no attempts or unloaded anchor means no line; loading earlier restores it', () => {
 expect(cacheWarmByAnchor([{...stretch, attempts: 0}], new Set([2])).size).toBe(0);
 expect(cacheWarmByAnchor([stretch], new Set([3])).size).toBe(0);
 expect(cacheWarmByAnchor([stretch], new Set([2,3])).size).toBe(1);
});
test('different stretches at the same anchor stay separate and ordered', () => {
 expect(cacheWarmByAnchor([{...stretch,id:'later',startedAt:150},stretch],new Set([2])).get(2)?.map(s=>s.id)).toEqual(['s','later']);
});
test('cold attempt is not labelled kept warm; stop reason is in detail', () => {
 const cold = {...stretch, refreshes:0,stopped:'Cache refresh stopped: no cache read'};
 expect(cacheWarmLabel(cold)).toStartWith('Cache refresh stopped'); expect(cacheWarmDetail(cold)).toContain(cold.stopped);
 expect(cacheWarmLabel({...stretch,refreshes:3})).toBe('Cache kept warm · 3 refreshes · ~$0.04');
});
test('summary follows the real response, not the next user, without changing input entries', () => {
 const entries = [{id:1,conversationId:1,kind:'pi.user',model:[{role:'user',content:'Hi',timestamp:100}]},
  {id:2,conversationId:1,kind:'pi.assistant',model:[{role:'assistant',content:[{type:'text',text:'Ready'}],timestamp:120,stopReason:'stop'}]},
  {id:3,conversationId:1,kind:'pi.user',model:[{role:'user',content:'Next',timestamp:400}]}];
 const before=structuredClone(entries);
 expect(buildTranscript(entries,undefined,{keepWarm:[stretch]}).map(item=>item.kind)).toEqual(['user','turn','cacheWarm','user']);
 expect(entries).toEqual(before);
});
