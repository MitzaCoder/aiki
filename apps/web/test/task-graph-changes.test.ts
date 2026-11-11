import { describe, expect, test } from 'bun:test';
import { makeGraphFixture, FIXTURE_NOW } from './fixtures/task-graph-busy.ts';
import { GraphChangeBaseline, GraphAnnouncementQueue, graphSnapshot, diffGraphSnapshots, batchGraphChanges, graphChangeText, graphAnnouncement, graphHoldsUp, graphWaitingDate, quietGraphAge } from '../src/lib/task-graph-changes.ts';
const now=Date.parse(FIXTURE_NOW);
const fixture=()=>makeGraphFixture();
const snapshot=(f:ReturnType<typeof fixture>)=>graphSnapshot(f.board.tasks,f.board.questions,f.workers,f.threads);

describe('graph changes',()=>{
	test('first load and identical replacements have no events',()=>{
		const f=fixture(),base=snapshot(f),tracker=new GraphChangeBaseline();
		expect(diffGraphSnapshots(null,base)).toEqual([]);
		expect(tracker.read(base)).toEqual([]);
		expect(tracker.read(snapshot(f))).toEqual([]);
	});
	test('reconnect resets the baseline instead of inventing missed events',()=>{
		const f=fixture(),tracker=new GraphChangeBaseline();tracker.read(snapshot(f));
		f.board.tasks[2]!.status='done';f.workers[0]!.lastReport='While disconnected';
		expect(tracker.read(snapshot(f),true)).toEqual([]);
		expect(tracker.read(snapshot(f))).toEqual([]);
		f.workers[0]!.lastReport='After reconnect';
		expect(tracker.read(snapshot(f)).map(c=>c.kind)).toEqual(['report']);
	});
	test('snapshots do not alias input; status completion and arrival are meaningful',()=>{
		const f=fixture(),before=snapshot(f);f.board.tasks[2]!.status='done';
		f.board.tasks.push({...f.board.tasks[2]!,id:'T999',status:'todo'});
		const changes=diffGraphSnapshots(before,snapshot(f));
		expect(changes.map(c=>c.text)).toEqual(['T3 moved to Done','T999 arrived']);
	});
	test('worker reassignment includes old and new task, report only on changed nonempty text',()=>{
		const f=fixture(),before=snapshot(f),w=f.workers[0]!;const old=w.taskId;
		w.taskId='T8';w.lastReport='Checked sample';
		const changes=diffGraphSnapshots(before,snapshot(f));
		expect(changes.find(c=>c.kind==='reassigned')?.taskIds).toEqual([old!,'T8']);
		expect(changes.find(c=>c.kind==='report')?.workerId).toBe(w.id);
		const reported=snapshot(f);w.lastReport='  ';
		expect(diffGraphSnapshots(reported,snapshot(f))).toEqual([]);
	});
	test('worker finish, failure, removal and arrival',()=>{
		const f=fixture(),before=snapshot(f);
		f.workers[0]!.status='done';f.workers[1]!.status='failed';
		f.workers.splice(2,1);f.workers.push({...f.workers[0]!,id:'sprout',status:'running'});
		const changes=diffGraphSnapshots(before,snapshot(f));
		expect(changes.some(c=>c.text.endsWith('finished'))).toBe(true);
		expect(changes.some(c=>c.text.endsWith('failed'))).toBe(true);
		expect(changes.some(c=>c.text.endsWith('started'))).toBe(true);
	});
	test('new questions/warnings, answers, withdrawal and reopening',()=>{
		const f=fixture(),before=snapshot(f),q=f.board.questions[0]!;
		q.status='answered';f.board.questions.push({...q,id:'Q999',kind:'warning',status:'open'});
		let changes=diffGraphSnapshots(before,snapshot(f));
		expect(changes.some(c=>c.text.includes('question answered'))).toBe(true);
		expect(changes.some(c=>c.text.includes('new warning'))).toBe(true);
		const answered=snapshot(f);q.status='open';
		expect(diffGraphSnapshots(answered,snapshot(f))[0]!.kind).toBe('question');
		const reopened=snapshot(f);q.status='withdrawn';
		expect(diffGraphSnapshots(reopened,snapshot(f))[0]!.text).toContain('closed');
	});
	test('thread status, reports and reassignments use the same event semantics',()=>{
		const f=fixture(),t=f.threads.find(t=>!t.main)!;
		const before=snapshot(f);t.status='failed';t.taskId='T8';t.summary='Sample thread stopped';t.current=null;
		const changes=diffGraphSnapshots(before,snapshot(f));
		expect(changes.some(c=>c.key==='Thread:failed')).toBe(true);
		expect(changes.some(c=>c.kind==='reassigned')).toBe(true);
		expect(changes.filter(c=>c.kind==='report').every(c=>!c.workerId)).toBe(true);
	});
	test('burst batching has fixed windows, unique focus targets and last 50 entries',()=>{
		const f=fixture(),before=snapshot(f);for(const t of f.board.tasks.slice(0,3))t.status='review';
		const changes=diffGraphSnapshots(before,snapshot(f));let entries=batchGraphChanges([],changes,now,0);
		expect(entries).toHaveLength(1);expect(graphChangeText(entries[0]!)).toBe('2 tasks moved to Review');
		expect(entries[0]!.taskIds).toEqual(['T1','T3']);
		entries=batchGraphChanges(entries,changes.slice(0,1),now+999,2);expect(entries[0]!.count).toBe(3);
		entries=batchGraphChanges(entries,changes.slice(0,1),now+1000,3);expect(entries).toHaveLength(2);
		for(let i=0;i<60;i++)entries=batchGraphChanges(entries,changes.slice(0,1),now+2000+i*1000,4+i);
		expect(entries).toHaveLength(50);expect(new Set(entries.map(e=>e.id)).size).toBe(50);
	});
	test('announcements summarize meaning, not creatures or report tokens',()=>{
		const f=fixture(),before=snapshot(f);f.board.tasks[0]!.status='review';f.board.tasks[2]!.status='review';f.workers[0]!.status='failed';
		expect(graphAnnouncement(diffGraphSnapshots(before,snapshot(f)))).toBe('2 tasks moved to Review; 1 worker failed');
		expect(graphAnnouncement([])).toBe('');
	});
	test('announcements are throttled, bounded and pause while the tab is hidden',()=>{
		const f=fixture(),before=snapshot(f);f.board.tasks[0]!.status='review';
		const changes=diffGraphSnapshots(before,snapshot(f)),queue=new GraphAnnouncementQueue();
		queue.add(changes);expect(queue.flush(now,false)).toBeNull();
		expect(queue.flush(now,true)).toBe('1 task moved to Review');
		queue.add(changes);expect(queue.flush(now+4999,true)).toBeNull();
		expect(queue.flush(now+5000,true)).toBe('1 task moved to Review');
		queue.add(changes);queue.clear();expect(queue.flush(now+10000,true)).toBeNull();
		for(let i=0;i<110;i++)queue.add(changes);
		expect(queue.flush(now+10000,true)).toBe('100 tasks moved to Review');
	});
	test('holds-up counts exclude settled/archived work and defend diamonds and cycles',()=>{
		const seed=fixture().board.tasks[0]!;
		const tasks=[{...seed,id:'A',blockedBy:['C']},{...seed,id:'B',blockedBy:['A']},{...seed,id:'C',blockedBy:['A','B']},{...seed,id:'D',blockedBy:['B'],status:'done' as const},{...seed,id:'E',blockedBy:['A'],archived:true}];
		expect(graphHoldsUp(tasks,'A')).toEqual({direct:2,total:2});
		expect(graphHoldsUp(tasks,'B')).toEqual({direct:1,total:2});
		expect(graphHoldsUp(tasks,'missing')).toEqual({direct:0,total:0});
	});
	test('waiting is overdue only after the date; quiet is a whole-day age',()=>{
		expect(graphWaitingDate(FIXTURE_NOW,now)).toStartWith('until ');
		expect(graphWaitingDate(FIXTURE_NOW,now+1)).toBe('overdue');
		expect(graphWaitingDate(null,now)).toBe('');expect(graphWaitingDate('bad',now)).toBe('');
		expect(quietGraphAge(new Date(now-3.5*86400000).toISOString(),now)).toBe('quiet 3 d');
	});
});
