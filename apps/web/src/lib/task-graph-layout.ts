import { reconcileGraphPositions, stepGraphLayout, type GraphPosition, type TaskGraph } from './task-graph.ts';
/** Solve before publishing SVG nodes. Existing tasks never move on watch updates, including insertions. */
export function settledGraphPositions(graph:TaskGraph,previous=new Map<string,GraphPosition>(),aspect=1):Map<string,GraphPosition> {
	const positions=reconcileGraphPositions(graph,previous,aspect);
	const pinned=new Set(graph.nodes.filter(n=>previous.has(n.id)&&(n.kind==='task'||previous.get(n.id)?.parentId===n.parent)).map(n=>n.id));
	const retained=new Map([...positions].filter(([id])=>pinned.has(id)).map(([id,p])=>[id,{...p}]));
	for(let tick=0;tick<70;tick++) {const energy=stepGraphLayout(positions,pinned);if(tick>20&&energy<.05)break;}
	for(const [id,p] of retained)positions.set(id,p);
	return positions;
}
/** Cubic ease-out, also used for actual live worker reassignment, never CSS-only edge teleporting. */
export function interpolateGraphPositions(from:Map<string,GraphPosition>,to:Map<string,GraphPosition>,progress:number):Map<string,GraphPosition> {
	const amount=1-Math.pow(1-Math.max(0,Math.min(1,progress)),3);
	return new Map([...to].map(([id,p])=>{const start=from.get(id);return [id,progress>=1 ? {...p} : start?{...p,x:start.x+(p.x-start.x)*amount,y:start.y+(p.y-start.y)*amount}:{...p,y:p.y+(1-amount)*12}];}));
}
