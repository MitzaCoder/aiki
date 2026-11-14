import { expect, test } from 'bun:test';
import type { BoardQuestion } from '@kemiri/protocol';
import { agentFinished, agentWaitingForUser, agentTurnWorking, showsAgentActivityRow } from '../src/lib/agent-activity.ts';
const question = (changes: Partial<BoardQuestion> = {}): BoardQuestion => ({ id:'Q1', revision:1, text:'Proceed?', options:[], taskId:null, status:'open', answer:null, askedAt:'2026-01-01T00:00:00Z', answeredAt:null, ...changes });
test('only blocking user asks/approvals, scoped to the current thread, mean waiting', () => {
 expect(agentWaitingForUser([question()])).toBe(true);
 expect(agentWaitingForUser([question({threadId:'background'})])).toBe(false);
 expect(agentWaitingForUser([question({threadId:'background'})], 'background')).toBe(true);
 for (const q of [question({status:'answered'}),question({status:'withdrawn'}),question({kind:'warning'}),question({blocksWork:false})]) expect(agentWaitingForUser([q])).toBe(false);
 expect(agentWaitingForUser([question({kind:'warning',blocksWork:true})])).toBe(true);
});
test('a worker does not borrow unrelated or unassigned questions from its project', () => {
 expect(agentWaitingForUser([question()],undefined,null,true)).toBe(false);
 expect(agentWaitingForUser([question({taskId:'T1'})],undefined,'T1',true)).toBe(true);
 expect(agentWaitingForUser([question({taskId:'T2'})],undefined,'T1',true)).toBe(false);
 expect(agentWaitingForUser([question({taskId:'T1',threadId:'other'})],undefined,'T1',true)).toBe(false);
});
test('live tool slots animate the reply even after its model message is persisted', () => {
 expect(agentTurnWorking({parts:[{type:'tool',live:true}]},true)).toBe(true);
 expect(agentTurnWorking({parts:[{type:'text',streaming:true}]},true)).toBe(true);
 expect(agentTurnWorking({live:true,parts:[]},true)).toBe(true);
 expect(agentTurnWorking({parts:[{type:'text'}]},true)).toBe(false);
 expect(agentTurnWorking({live:true,parts:[]},false)).toBe(false);
});
test('waiting never adds an activity mascot, even with stale working or completion flags', () => {
 for (const working of [false, true]) for (const completed of [false, true]) {
  expect(showsAgentActivityRow(true, working, completed)).toBe(false);
  expect(showsAgentActivityRow(false, working, completed)).toBe(working || completed);
 }
});
test('Done is one live successful run edge, never history, a question clearing, failure or disconnect', () => {
 expect(agentFinished(true,false,false,true,false)).toBe(true);
 for(const args of [[false,false,false,true,false],[false,true,false,true,false],[true,true,false,true,false],[true,false,true,true,false],[true,false,false,false,false],[true,false,false,true,true]]) expect(agentFinished(...args as [boolean,boolean,boolean,boolean,boolean])).toBe(false);
});
