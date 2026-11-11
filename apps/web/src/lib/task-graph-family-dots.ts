import { familyDotGeometry, type FamilyBox, type FamilyCamera, type TaskFamilyLayout, type FamilyViewport } from './task-graph-families.ts';

export type FamilyDotTarget = FamilyBox & { id:string; anchorX:number; anchorY:number; compact:boolean };

/** Anchors never depend on the camera or label packing: each is the region's world centre. */
export function familyDotAnchors(layout:TaskFamilyLayout) {
	return layout.families.filter(f=>f.taskIds.length).map(f=>({id:f.id,...familyDotGeometry(f,1).dot}));
}

/** Fit the dot anchors, including screen-sized labels, rather than the now-hidden card rectangles. */
export function fitFamilyDots(layout:TaskFamilyLayout, viewport:FamilyViewport):FamilyCamera {
	const anchors=familyDotAnchors(layout);
	if(!anchors.length)return {x:0,y:0,zoom:.5};
	const left=Math.min(...anchors.map(a=>a.x)), right=Math.max(...anchors.map(a=>a.x));
	const top=Math.min(...anchors.map(a=>a.y)), bottom=Math.max(...anchors.map(a=>a.y));
	const phone=viewport.width<=640, padding=phone?36:100, heading=phone?148:64, footer=112;
	const width=Math.max(1,viewport.width-padding*2),height=Math.max(1,viewport.height-heading-footer);
	const zoom=Math.max(.03,Math.min(.5,width/Math.max(1,right-left),height/Math.max(1,bottom-top)));
	return {zoom,x:padding+(width-(right-left)*zoom)/2-left*zoom,y:heading+(height-(bottom-top)*zoom)/2-top*zoom};
}

/** Stop ordinary zoom-out before even compact labels collide. Explicit Fit can handle denser boards. */
export function minimumFamilyDotZoom(layout:TaskFamilyLayout, viewport:FamilyViewport):number {
	const anchors=familyDotAnchors(layout),width=viewport.width<=640?52:84;
	let minimum=.03;
	for(let i=0;i<anchors.length;i++)for(let j=i+1;j<anchors.length;j++){
		const a=anchors[i]!,b=anchors[j]!;
		const separation=Math.max(Math.abs(a.x-b.x)/width,Math.abs(a.y-b.y)/76);
		if(separation)minimum=Math.max(minimum,1/separation);
	}
	return Math.min(minimum,fitFamilyDots(layout,viewport).zoom);
}

/** Labels remain screen-sized at their world anchor. Narrow neighbors lose subtitles, not spatial identity. */
export function familyDotTargets(layout:TaskFamilyLayout,camera:FamilyCamera):FamilyDotTarget[] {
	const anchors=familyDotAnchors(layout).map(a=>({id:a.id,x:a.x*camera.zoom+camera.x,y:a.y*camera.zoom+camera.y}));
	return anchors.map(a=>{
		let width=180;
		for(const b of anchors){
			if(a===b)continue;
			if(Math.abs(a.y-b.y)<68&&Math.abs(a.x-b.x)>1)width=Math.min(width,Math.abs(a.x-b.x)-12);
		}
		width=Math.max(24,width);
		const compact=width<156||anchors.some(b=>b!==a&&Math.abs(b.y-a.y)<124&&Math.abs(b.x-a.x)<width+12);
		return {id:a.id,anchorX:a.x,anchorY:a.y,x:a.x-width/2,y:a.y-18,width,height:compact?64:112,compact};
	});
}
