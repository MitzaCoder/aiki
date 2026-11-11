import { describe, expect, it } from 'bun:test';
import { layoutTaskFamilies, familyBoxesOverlap } from '../src/lib/task-graph-families.ts';
import { familyDotAnchors, familyDotTargets, fitFamilyDots, minimumFamilyDotZoom } from '../src/lib/task-graph-family-dots.ts';
import { makeGraphFixture } from './fixtures/task-graph-busy.ts';
const tasks=makeGraphFixture().board.tasks.filter(t=>t.status!=='done').map(t=>({id:t.id,parent:t.parent??null,createdAt:t.createdAt}));
const options={cardWidth:230,cardHeight:88,creatureHeight:12,creaturesAbove:true,gap:24,indent:12,padding:16,headerHeight:88,pillWidth:230,pillHeight:64,aspect:1.6};
const layout=layoutTaskFamilies(tasks,{options});

describe('world-anchored family dots',()=>{
	it('keeps anchors at region centres through camera pan and pointer-anchored zoom',()=>{
		const camera={x:50,y:70,zoom:.4}, anchors=familyDotAnchors(layout), targets=familyDotTargets(layout,camera);
		for(const a of anchors){const family=layout.families.find(f=>f.id===a.id)!;expect(a.x).toBe(family.bounds.x+family.bounds.width/2);expect(a.y).toBe(family.bounds.y+family.bounds.height/2);}
		const panned=familyDotTargets(layout,{...camera,x:camera.x+100,y:camera.y-40});
		for(let i=0;i<targets.length;i++){expect(panned[i]!.anchorX-targets[i]!.anchorX).toBeCloseTo(100);expect(panned[i]!.anchorY-targets[i]!.anchorY).toBeCloseTo(-40);}
		const pointer={x:300,y:200}, zoom=.5;
		const zoomed=familyDotTargets(layout,{zoom,x:pointer.x-(pointer.x-camera.x)*zoom/camera.zoom,y:pointer.y-(pointer.y-camera.y)*zoom/camera.zoom});
		for(let i=0;i<targets.length;i++){expect(zoomed[i]!.anchorX).toBeCloseTo(pointer.x+(targets[i]!.anchorX-pointer.x)*zoom/camera.zoom);expect(zoomed[i]!.anchorY).toBeCloseTo(pointer.y+(targets[i]!.anchorY-pointer.y)*zoom/camera.zoom);}
	});
	it('fits every dot and readable label on desktop and phone without collisions',()=>{
		for(const viewport of [{width:1175,height:831},{width:390,height:642}]){
			const camera=fitFamilyDots(layout,viewport), targets=familyDotTargets(layout,camera);
			expect(camera.zoom).toBeLessThan(.545);
			expect(camera.zoom).toBeGreaterThanOrEqual(minimumFamilyDotZoom(layout,viewport));
			for(const target of targets){
				expect(target.x).toBeGreaterThanOrEqual(0);expect(target.y).toBeGreaterThanOrEqual(0);
				expect(target.x+target.width).toBeLessThanOrEqual(viewport.width);expect(target.y+target.height).toBeLessThanOrEqual(viewport.height);
				for(const other of targets)if(other!==target)expect(familyBoxesOverlap(target,other)).toBe(false);
			}
		}
	});
	it('drops subtitles before neighboring labels collide at minimum zoom',()=>{
		const viewport={width:1175,height:831},zoom=minimumFamilyDotZoom(layout,viewport);
		const targets=familyDotTargets(layout,{x:0,y:0,zoom});
		expect(targets.some(t=>t.compact)).toBe(true);
		for(const target of targets)for(const other of targets)if(other!==target)expect(familyBoxesOverlap(target,other)).toBe(false);
	});
});

describe('compact fixed crew reservation',()=>{
	it('uses a 230×88 body and 100px occupied height with crew above its edge',()=>{
		for(const card of layout.cards.values()){
			expect(card.box.width).toBe(230);expect(card.box.height).toBe(88);expect(card.occupiedBox.height).toBe(100);
			expect(card.box.y-card.occupiedBox.y).toBe(12);expect(card.creatureBox.y).toBe(card.occupiedBox.y);
		}
	});
	it('crew counts and status replacements never alter body, reserved band or pill geometry',()=>{
		const next=layoutTaskFamilies(tasks.map(t=>({...t,status:'review'})),{previous:layout,creatureCounts:new Map(tasks.map(t=>[t.id,10]))});
		for(const [id,card] of layout.cards){expect(next.cards.get(id)?.box).toEqual(card.box);expect(next.cards.get(id)?.creatureBox).toEqual(card.creatureBox);expect(next.cards.get(id)?.occupiedBox).toEqual(card.occupiedBox);expect(next.cards.get(id)?.pillBox).toEqual(card.pillBox);}
	});
});
