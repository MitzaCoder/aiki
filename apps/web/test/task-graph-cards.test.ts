import { describe, expect, it } from 'bun:test';
import { buildGraphModel } from '../src/lib/task-graph-model.ts';
import { cardProgress, familyCardLabel, familySummary, familyRelationships, spatialFamilyNeighbor, loadFamilyCamera, saveFamilyCamera, fitFamilyCardMatches } from '../src/lib/task-graph-cards.ts';
import { layoutTaskFamilies, chooseFamilyDetail } from '../src/lib/task-graph-families.ts';
import { makeGraphFixture, FIXTURE_NOW, advanceGraphFixture } from './fixtures/task-graph-busy.ts';
const build=(fixture=makeGraphFixture())=>buildGraphModel(fixture.board.tasks,fixture.board.questions,fixture.workers,fixture.threads,Date.parse(FIXTURE_NOW));
const geometry=(model:ReturnType<typeof build>)=>layoutTaskFamilies([...model.details.values()].map(d=>({id:d.task.id,parent:d.task.parent??null,familyId:d.familyId})));

describe('family card presentation',()=>{
	it('labels status, distinct reasons, quiet, descendant progress and crew in words',()=>{
		const model=build();
		expect(familyCardLabel(model.details.get('T2')!,model)).toContain('Review, Review, Question / warning');
		expect(familyCardLabel(model.details.get('T39')!,model)).toContain('Worker failed');
		expect(familyCardLabel(model.details.get('T3')!,model)).toContain('Worker');
		expect(familyCardLabel(model.details.get('T7')!,model)).toContain('Quiet');
		expect(familyCardLabel(model.details.get('T1')!,model)).toContain('1 of 8 subtasks done');
	});
	it('counts descendants of each parent rather than copying whole-family progress',()=>{
		const fixture=makeGraphFixture(9), model=build(fixture);
		expect(cardProgress(model.details.get('T1')!,model)).toBe('1 of 8 subtasks done');
		expect(cardProgress(model.details.get('T5')!,model)).toBe('0 of 2 subtasks done');
		expect(cardProgress(model.details.get('T3')!,model)).toBe('');
		fixture.board.tasks[6]!.status='done';fixture.board.tasks[7]!.status='dropped';
		expect(cardProgress(build(fixture).details.get('T5')!,build(fixture))).toBe('1 of 1 subtasks done');
	});
	it('summarizes unique needs-you tasks, not overlapping reasons',()=>{
		const summary=familySummary(build(),'T1');
		expect(summary.title).toBe('Access & identity');
		expect(summary.progress).toBe('1 of 8 subtasks done');
		expect(summary.needsYou).toBe(4);
		expect(summary.statuses.reduce((n,s)=>n+s.count,0)).toBe(9);
	});
	it('always retains subtask lines but scopes other routes to selection and matches',()=>{
		const model=build(),layout=geometry(model);
		expect(familyRelationships(model,layout,null,null).every(e=>e.kind==='subtask')).toBe(true);
		const selected=familyRelationships(model,layout,'T3',null);
		expect(selected.some(e=>e.kind==='blocked-by')).toBe(true);
		for(const edge of selected.filter(e=>e.kind!=='subtask'))expect([layout.cards.get(edge.from)!.familyId,layout.cards.get(edge.to)!.familyId]).toContain('T1');
		const matched=familyRelationships(model,layout,null,new Set(['T22']));
		expect(matched.some(e=>e.kind==='blocked-by'&&e.from==='T22')).toBe(true);
		expect(new Set(selected.map(e=>e.id)).size).toBe(selected.length);
	});
	it('keeps every retained card transform and pill slot on status/report replacement',()=>{
		const fixture=makeGraphFixture(), first=build(fixture), before=geometry(first), next=build(advanceGraphFixture(fixture));
		const after=layoutTaskFamilies([...next.details.values()].map(d=>({id:d.task.id,parent:d.task.parent??null,familyId:d.familyId})),{previous:before});
		for(const [id,card] of before.cards){expect(after.cards.get(id)?.box).toEqual(card.box);expect(after.cards.get(id)?.pillBox).toEqual(card.pillBox);}
	});
	it('chooses only levels with readable smallest text and touch targets',()=>{
		for(const touch of [false,true])for(const zoom of [.1,.4,.55,.68,.7,.85,.86,1,2]){
			const detail=chooseFamilyDetail(zoom,undefined,{touch,cardTitleSize:14,pillLabelSize:22,pillHeight:64});
			if(detail==='cards')expect(14*zoom).toBeGreaterThanOrEqual(12);
			if(detail==='pills'){expect(22*zoom).toBeGreaterThanOrEqual(12);expect(64*zoom).toBeGreaterThanOrEqual(touch?44:24);}
		}
		expect(chooseFamilyDetail(.7,undefined,{touch:false,cardTitleSize:14,pillLabelSize:22})).toBe('pills');
	});
	it('fits all matching card bounds, and has no camera for empty matches',()=>{
		const layout=geometry(build()), ids=new Set(['T1','T90']), viewport={width:1000,height:800};
		const camera=fitFamilyCardMatches(layout,ids,viewport)!;
		for(const id of ids){const b=layout.cards.get(id)!.occupiedBox;expect(b.x*camera.zoom+camera.x).toBeGreaterThanOrEqual(23.9);expect((b.x+b.width)*camera.zoom+camera.x).toBeLessThanOrEqual(976.1);}
		expect(fitFamilyCardMatches(layout,new Set(),viewport)).toBeNull();
	});
});

describe('graph spatial navigation and camera persistence',()=>{
	const boxes=new Map([['a',{x:0,y:0,width:100,height:60}],['b',{x:150,y:0,width:100,height:60}],['c',{x:0,y:100,width:100,height:60}],['diagonal',{x:120,y:90,width:100,height:60}]]);
	it('moves in the requested direction with alignment preference',()=>{
		expect(spatialFamilyNeighbor(boxes,'a','ArrowRight')).toBe('b');
		expect(spatialFamilyNeighbor(boxes,'a','ArrowDown')).toBe('c');
		expect(spatialFamilyNeighbor(boxes,'a','ArrowLeft')).toBeNull();
		expect(spatialFamilyNeighbor(boxes,'c','ArrowUp')).toBe('a');
		expect(spatialFamilyNeighbor(boxes,'missing','ArrowDown')).toBe('a');
	});
	it('ignores v1 cameras, validates v2, and tolerates denied storage',()=>{
		const stored=new Map([['task-graph.camera.v1:demo',{x:3,y:4,zoom:1}]]);
		const storage={getItem:(key:string)=>JSON.stringify(stored.get(key)??null),setItem:(key:string,json:string)=>{stored.set(key,JSON.parse(json));}};
		expect(loadFamilyCamera('demo',storage)).toBeNull();
		saveFamilyCamera('demo',{x:10,y:20,zoom:.8},storage);
		expect(loadFamilyCamera('demo',storage)).toEqual({x:10,y:20,zoom:.8});
		storage.setItem('task-graph.camera.v2:demo','{"x":0,"y":0,"zoom":0}');
		expect(loadFamilyCamera('demo',storage)).toBeNull();
		expect(loadFamilyCamera('demo',{getItem:()=>{throw Error('denied');}})).toBeNull();
	});
});
