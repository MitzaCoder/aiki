import type { GraphPosition, TaskGraph } from './task-graph.ts';

export type GraphCamera = { x:number; y:number; zoom:number };
export const GRAPH_CAMERA_KEY = 'task-graph.camera.v1:';
export function loadGraphCamera(scope:string, storage?:Pick<Storage,'getItem'>):GraphCamera | null {
	try {
		const camera = JSON.parse(storage?.getItem(GRAPH_CAMERA_KEY+encodeURIComponent(scope)) ?? 'null');
		return camera && [camera.x,camera.y,camera.zoom].every(Number.isFinite) && camera.zoom >= 0.08 && camera.zoom <= 4 ? camera : null;
	} catch { return null; }
}
export function saveGraphCamera(scope:string, camera:GraphCamera, storage?:Pick<Storage,'setItem'>):void {
	try { storage?.setItem(GRAPH_CAMERA_KEY+encodeURIComponent(scope),JSON.stringify(camera)); } catch { /* Optional device preference. */ }
}
export function fitGraphCamera(positions:Map<string,GraphPosition>,width:number,height:number):GraphCamera {
	if (!positions.size) return {x:0,y:0,zoom:1};
	const points=[...positions.values()];
	const left=Math.min(...points.map(p=>p.x-p.radius))-30, right=Math.max(...points.map(p=>p.x+p.radius))+30;
	const top=Math.min(...points.map(p=>p.y-p.radius))-48, bottom=Math.max(...points.map(p=>p.y+p.radius))+60;
	const padding=width<600 ? 24 : 48;
	return {x:(left+right)/2,y:(top+bottom)/2,zoom:Math.max(.08,Math.min(1.4,(width-padding*2)/(right-left),(height-padding*2)/(bottom-top)))};
}
export type GraphLabelBox = {x:number;y:number;width:number;height:number;text:string};
export function boxesOverlap(a:Omit<GraphLabelBox,'text'>,b:Omit<GraphLabelBox,'text'>):boolean {
	return a.x < b.x+b.width && a.x+a.width > b.x && a.y < b.y+b.height && a.y+a.height > b.y;
}
export function truncatedGraphTitle(title:string):string {return title.length>23 ? title.slice(0,22)+'…' : title;}
/** Screen-sized captions, placed only in genuinely free slots. Full titles remain in focus/hover tooltips. */
export function placeGraphLabels(graph:TaskGraph,positions:Map<string,GraphPosition>,camera:GraphCamera,width:number,height:number):Map<string,GraphLabelBox> {
	const labels=new Map<string,GraphLabelBox>();
	const occupied=[...positions.values()].map(p=>({x:p.x-p.radius-8,y:p.y-p.radius-8,width:p.radius*2+16,height:p.radius*2+16}));
	const viewport={x:camera.x-width/camera.zoom/2,y:camera.y-height/camera.zoom/2,width:width/camera.zoom,height:height/camera.zoom};
	const priority=(n:TaskGraph['nodes'][number])=>n.radius>35 ? 0 : n.attention ? 1 : n.kind!=='task' ? 2 : 3;
	for(const node of [...graph.nodes].sort((a,b)=>priority(a)-priority(b)||a.id.localeCompare(b.id))) {
		if(camera.zoom<.55 && node.radius<=35 && (!node.attention || camera.zoom<.35)) continue;
		if(camera.zoom<.7 && node.kind!=='task') continue;
		const p=positions.get(node.id);if(!p)continue;
		const title=node.kind==='task'?node.title:node.worker?.id??node.thread?.id??node.title;
		const text=camera.zoom<.55 && title.length>11 ? title.slice(0,10)+'…' : truncatedGraphTitle(title);
		const w=Math.min(156,text.length*6.4+12)/camera.zoom, h=22/camera.zoom, gap=10/camera.zoom;
		const slots=[{x:p.x-w/2,y:p.y+p.radius+gap},{x:p.x-w/2,y:p.y-p.radius-gap-h},{x:p.x+p.radius+gap,y:p.y-h/2},{x:p.x-p.radius-gap-w,y:p.y-h/2}, {x:p.x+p.radius+gap,y:p.y+p.radius+gap}, {x:p.x-p.radius-gap-w,y:p.y+p.radius+gap}, {x:p.x+p.radius+gap,y:p.y-p.radius-gap-h}, {x:p.x-p.radius-gap-w,y:p.y-p.radius-gap-h}];
		const slot=slots.find(s=>s.x>=viewport.x&&s.y>=viewport.y&&s.x+w<=viewport.x+viewport.width&&s.y+h<=viewport.y+viewport.height&&!occupied.some(b=>boxesOverlap({...s,width:w,height:h},b)));
		if(slot) {const box={...slot,width:w,height:h,text};labels.set(node.id,box);occupied.push(box);}
	}
	return labels;
}
