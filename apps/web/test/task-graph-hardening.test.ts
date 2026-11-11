import { describe, expect, test } from 'bun:test';
import { Value } from 'typebox/value';
import { PROTOCOL_SCHEMAS } from '@aiki/protocol';
import { makeLargeGraphFixture } from './fixtures/task-graph-large.ts';
import { FIXTURE_NOW } from './fixtures/task-graph-busy.ts';
import { buildGraphModel } from '../src/lib/task-graph-model.ts';
import { familyBoxInViewport, graphModelHoldsUp } from '../src/lib/task-graph-cards.ts';

describe('graph hardening',()=>{
	test('large fixture is protocol-valid with varied sizes, deep ancestry and crowded content',()=>{
		for(const count of [100,500,1000]) {
			const f=makeLargeGraphFixture(count);
			expect([...Value.Errors(PROTOCOL_SCHEMAS.Board,f.board)]).toEqual([]);
			for(const w of f.workers)expect([...Value.Errors(PROTOCOL_SCHEMAS.WorkerSummary,w)]).toEqual([]);
			expect(f.board.tasks.length).toBe(count);
			const m=buildGraphModel(f.board.tasks,f.board.questions,f.workers,f.threads,Date.parse(FIXTURE_NOW));
			expect(m.details.get('T13')!.familyId).toBe('T1');
			expect(m.details.get('T13')!.task.parent).toBe('T12');
			expect(m.details.get('T3')!.questions.length).toBe(36);
			expect(m.details.get('T3')!.workers.length).toBe(12);
			expect(m.details.get('T1')!.progress).toContain('41 subtasks done');
			expect(m.details.get('T3')!.task.title).toContain('https://example.test/');
		}
		expect(()=>makeLargeGraphFixture(50)).toThrow();
		expect(()=>makeLargeGraphFixture(Infinity)).toThrow();
	});
	test('association indexes retain all old matching rules, deduplicate and preserve order',()=>{
		const f=makeLargeGraphFixture(100);
		f.workers[0]!.taskId=null;f.board.tasks[4]!.workerIds=['pip'];
		f.threads[0]!.ownedTasks=['T5','T5','T6'];f.threads[0]!.taskId='T5';
		f.board.tasks[7]!.ownerThreadId=f.threads[0]!.id;
		const m=buildGraphModel(f.board.tasks,f.board.questions,f.workers,f.threads,Date.parse(FIXTURE_NOW));
		for(const task of f.board.tasks){
			const d=m.details.get(task.id)!;
			expect(d.workers).toEqual(f.workers.filter(w=>w.taskId===task.id||(!w.taskId&&task.workerIds.includes(w.id))));
			expect(d.threads).toEqual(f.threads.filter(t=>t.taskId===task.id||t.ownedTasks.includes(task.id)||task.ownerThreadId===t.id));
			expect(d.questions).toEqual(f.board.questions.filter(q=>q.status==='open'&&q.taskId===task.id));
		}
		expect(graphModelHoldsUp(m,'T3')).toBe(graphModelHoldsUp(m,'T3'));
	});
	test('viewport culling uses screen-space overscan at every zoom and retains touching boxes',()=>{
		const box={x:100,y:100,width:230,height:100},viewport={width:500,height:400};
		expect(familyBoxInViewport(box,{x:0,y:0,zoom:1},viewport,0)).toBe(true);
		expect(familyBoxInViewport(box,{x:-330,y:0,zoom:1},viewport,0)).toBe(true);
		expect(familyBoxInViewport(box,{x:-331,y:0,zoom:1},viewport,0)).toBe(false);
		expect(familyBoxInViewport(box,{x:-500,y:0,zoom:1},viewport)).toBe(true);
		expect(familyBoxInViewport(box,{x:600,y:0,zoom:.5},viewport,0)).toBe(false);
		expect(familyBoxInViewport(box,{x:600,y:0,zoom:.5},viewport)).toBe(true);
	});
});
