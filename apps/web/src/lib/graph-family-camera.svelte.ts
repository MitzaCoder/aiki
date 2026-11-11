import { fitTaskFamily, revealFamilyCard, type FamilyCamera, type TaskFamilyLayout } from './task-graph-families.ts';
import { loadFamilyCamera, saveFamilyCamera } from './task-graph-cards.ts';
import { fitFamilyDots } from './task-graph-family-dots.ts';

/** Owns only the viewport. Family/card coordinates are never mutated by gestures. */
export class GraphFamilyCamera {
	camera = $state<FamilyCamera>({x:0,y:0,zoom:1});
	width = $state(0);
	height = $state(0);
	reduced = $state(false);
	touch = $state(false);
	phone = $state(false);
	minimumZoom = $state(.03);
	dragged = false;
	private framed = false;
	private frame = 0;
	private saveTimer: ReturnType<typeof setTimeout> | undefined;
	private destination: FamilyCamera | null = null;
	private pointers = new Map<number,{x:number;y:number}>();
	private origin: {x:number;y:number} | null = null;
	constructor(private scope: string) {}
	private storage() {try {return localStorage;} catch {return undefined;}}
	remember() {
		clearTimeout(this.saveTimer);
		this.saveTimer = setTimeout(()=>saveFamilyCamera(this.scope,this.camera,this.storage()),180);
	}
	stop() {cancelAnimationFrame(this.frame); this.destination=null;}
	move(target: FamilyCamera, interpolate=true) {
		this.stop();
		if (this.reduced||!interpolate) {this.camera=target;this.remember();return;}
		this.destination=target;
		const from=this.camera, start=performance.now();
		const animate=(time:number)=>{
			const progress=Math.min(1,(time-start)/200), ease=1-Math.pow(1-progress,3);
			this.camera={x:from.x+(target.x-from.x)*ease,y:from.y+(target.y-from.y)*ease,zoom:from.zoom+(target.zoom-from.zoom)*ease};
			if(progress<1)this.frame=requestAnimationFrame(animate);
			else {this.destination=null;this.remember();}
		};
		this.frame=requestAnimationFrame(animate);
	}
	family(layout:TaskFamilyLayout,id:string, animate=true) {
		const target=fitTaskFamily(layout,id,this,20,1);
		const family=layout.families.find(f=>f.id===id);
		if(!family)return;
		// Tall families scroll vertically rather than shrinking their text to fit the phone.
		target.zoom=Math.max(1,target.zoom);
		target.x=(this.phone?(this.width-family.bounds.width*target.zoom)/2:24)-family.bounds.x*target.zoom;
		target.y=(this.phone?120:64)-family.bounds.y*target.zoom;
		if(animate)this.move(target);else this.camera=target;
	}
	first(layout:TaskFamilyLayout,id:string) {
		if(this.framed||!this.width||!this.height||!layout.cards.size)return;
		this.family(layout,id,false);
		if(!this.phone)this.camera=loadFamilyCamera(this.scope,this.storage())??this.camera;
		this.framed=true;
	}
	fit(layout:TaskFamilyLayout) {this.move(fitFamilyDots(layout,this));}
	reveal(layout:TaskFamilyLayout,id:string, panel=false, animate=true) {
		const viewport={width:Math.max(280,this.width-(panel&&!this.phone?330:0)),height:this.height*(panel&&this.phone?.6:1)};
		const zoom=Math.max(1,this.camera.zoom);
		const target=revealFamilyCard(layout,id,{...this.camera,zoom},viewport,24);
		const card=layout.cards.get(id);
		if(this.phone&&card&&card.box.y*zoom+target.y<120)target.y=120-card.box.y*zoom;
		this.move(target,animate);
	}
	zoom(factor:number,x=this.width/2,y=this.height/2) {
		this.stop();
		const from=this.camera, zoom=Math.max(this.minimumZoom,Math.min(4,from.zoom*factor));
		this.camera={zoom,x:x-(x-from.x)*zoom/from.zoom,y:y-(y-from.y)*zoom/from.zoom};
		this.remember();
	}
	wheel(event:WheelEvent) {
		event.preventDefault();
		const rect=(event.currentTarget as HTMLElement).getBoundingClientRect();
		this.zoom(Math.exp(-event.deltaY*.0015),event.clientX-rect.left,event.clientY-rect.top);
	}
	pointerDown(event:PointerEvent) {
		if(event.button!==0)return;
		this.stop(); this.dragged=false;
		this.pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
		this.origin={x:event.clientX,y:event.clientY};
		// Do not capture a click before its button has had a chance to select.
	}
	pointerMove(event:PointerEvent) {
		const previous=this.pointers.get(event.pointerId);
		if(!previous)return;
		const before=[...this.pointers.values()];
		this.pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
		if(this.pointers.size===2) {
			const after=[...this.pointers.values()];
			const distance=(points:{x:number;y:number}[])=>Math.hypot(points[0]!.x-points[1]!.x,points[0]!.y-points[1]!.y);
			const rect=(event.currentTarget as HTMLElement).getBoundingClientRect();
			this.zoom(distance(after)/Math.max(1,distance(before)),(after[0]!.x+after[1]!.x)/2-rect.left,(after[0]!.y+after[1]!.y)/2-rect.top);
			this.dragged=true;return;
		}
		if(!this.dragged&&this.origin&&Math.hypot(event.clientX-this.origin.x,event.clientY-this.origin.y)<4)return;
		this.dragged=true;
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		this.camera={...this.camera,x:this.camera.x+event.clientX-previous.x,y:this.camera.y+event.clientY-previous.y};
		this.remember();
	}
	pointerUp(event:PointerEvent) {this.pointers.delete(event.pointerId);this.origin=null;}
	mount(element:HTMLElement) {
		const motion=matchMedia('(prefers-reduced-motion: reduce)'), touch=matchMedia('(hover: none) and (pointer: coarse)'), phone=matchMedia('(max-width: 640px)');
		const update=()=>{
			this.reduced=motion.matches;this.touch=touch.matches;this.phone=phone.matches;
			if(this.reduced&&this.destination){this.camera=this.destination;this.stop();}
		};
		update();motion.addEventListener('change',update);touch.addEventListener('change',update);phone.addEventListener('change',update);
		const observer=new ResizeObserver(([entry])=>{if(entry){this.width=entry.contentRect.width;this.height=entry.contentRect.height;}});
		observer.observe(element);
		return ()=>{observer.disconnect();motion.removeEventListener('change',update);touch.removeEventListener('change',update);phone.removeEventListener('change',update);this.stop();clearTimeout(this.saveTimer);if(this.framed)saveFamilyCamera(this.scope,this.camera,this.storage());};
	}
}
