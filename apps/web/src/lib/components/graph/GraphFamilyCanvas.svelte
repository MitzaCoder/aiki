<script lang="ts">
	import { onMount, untrack, tick } from 'svelte';
	import { fade } from 'svelte/transition';
	import type { GraphModel } from '#lib/task-graph-model.js';
	import { layoutTaskFamilies, regroupTaskFamilies, chooseFamilyDetail, type TaskFamilyLayout, type FamilyDetail, type FamilyBox } from '#lib/task-graph-families.js';
	import { familySummary, familyRelationships, spatialFamilyNeighbor, fitFamilyCardMatches } from '#lib/task-graph-cards.js';
	import { familyDotTargets, minimumFamilyDotZoom } from '#lib/task-graph-family-dots.js';
	import { GraphFamilyCamera } from '#lib/graph-family-camera.svelte.js';
	import GraphCard from './GraphCard.svelte';
	import GraphFamilyRegion from './GraphFamilyRegion.svelte';
	import GraphFamilyDot from './GraphFamilyDot.svelte';
	import GraphEdges from './GraphEdges.svelte';
	let {model,scope,showClosed,selectedTaskId,matches,focusRequest,onrevealed,onselect,onclear,taskHref}: {
		model:GraphModel;scope:string;showClosed:boolean;selectedTaskId:string|null;matches:ReadonlySet<string>|null;focusRequest:string|null;
		onrevealed:()=>void;onselect:(id:string)=>void;onclear:()=>void;taskHref:(id:string)=>string;
	}=$props();
	const view=new GraphFamilyCamera(untrack(()=>scope));
	let host:HTMLDivElement|null=$state(null);
	let layout=$state.raw<TaskFamilyLayout>();
	let detail=$state<FamilyDetail>('cards');
	let familyId=$state<string|null>(null);
	let focusId=$state<string|null>(null);
	let reports=$state<Record<string,string>>({});
	const seenReports=new Map<string,string|null>();
	const reportTimers=new Set<ReturnType<typeof setTimeout>>();
	const tasks=$derived([...model.details.values()].filter(d=>!d.task.archived&&(showClosed||!['done','dropped'].includes(d.task.status))).map(d=>({id:d.task.id,parent:d.task.parent??null,createdAt:d.task.createdAt,familyId:d.familyId})));
	const families=$derived(layout?.families.filter(f=>f.taskIds.length)??[]);
	const phone=$derived(view.phone);
	const shownFamilies=$derived(phone&&detail!=='dots'?families.filter(f=>f.id===familyId):families);
	const shownCards=$derived([...(layout?.cards.values()??[])].filter(c=>!phone||c.familyId===familyId));
	const summaries=$derived(new Map(families.map(f=>[f.id,familySummary(model,f.id)])));
	const dotTargets=$derived(new Map((layout?familyDotTargets(layout,view.camera):[]).map(target=>[target.id,target])));
	const edges=$derived(layout?familyRelationships(model,layout,selectedTaskId,matches):[]);
	const tabStop=$derived(focusId??(detail==='dots'?'family:'+families[0]?.id:shownCards[0]?.id));
	$effect(()=>{
		const next=tasks;
		layout=layoutTaskFamilies(next,{previous:untrack(()=>layout),options:{cardWidth:230,cardHeight:88,creatureHeight:12,creaturesAbove:true,gap:24,indent:12,padding:16,headerHeight:88,pillWidth:230,pillHeight:64,aspect:1.6}});
	});
	$effect(()=>{if(layout&&view.width&&view.height)view.minimumZoom=minimumFamilyDotZoom(layout,view);});
	$effect(()=>{detail=chooseFamilyDetail(view.camera.zoom,untrack(()=>detail),{touch:view.touch||phone,cardTitleSize:14,pillLabelSize:22,pillHeight:64});});
	$effect(()=>{
		if(!layout||!families.length||!view.width)return;
		untrack(()=>{
			if(!familyId||!families.some(f=>f.id===familyId))familyId=layout!.cards.get(selectedTaskId??'')?.familyId??(phone?[...families].sort((a,b)=>(summaries.get(b.id)?.needsYou??0)-(summaries.get(a.id)?.needsYou??0))[0]!.id:families[0]!.id);
			view.first(layout!,familyId!);
		});
	});
	$effect(()=>{
		if(!focusRequest||!layout?.cards.has(focusRequest))return;
		const id=focusRequest;
		untrack(()=>{familyId=layout!.cards.get(id)!.familyId;focusId=id;view.reveal(layout!,id,true);onrevealed();});
	});
	$effect(()=>{
		for(const d of model.details.values())for(const w of d.workers){
			if(seenReports.has(w.id)&&w.lastReport&&seenReports.get(w.id)!==w.lastReport){
				untrack(()=>reports={...reports,[w.id]:w.updatedAt});
				const timer=setTimeout(()=>{const next={...reports};delete next[w.id];reports=next;reportTimers.delete(timer);},1800);reportTimers.add(timer);
			}
			seenReports.set(w.id,w.lastReport);
		}
	});
	// A level/family change must not leave every rendered target at tabindex=-1.
	$effect(()=>{const targets=detail==='dots'?families.map(f=>'family:'+f.id):[...shownCards.map(c=>c.id),...shownFamilies.map(f=>'family:'+f.id)];if(!targets.includes(focusId??''))focusId=targets[0]??null;});
	onMount(()=>{const cleanup=host?view.mount(host):()=>{};return()=>{cleanup();for(const timer of reportTimers)clearTimeout(timer);};});
	function enterFamily(id:string){if(!layout)return;familyId=id;focusId='family:'+id;view.family(layout,id);}
	function switchFamily(direction:number){const index=families.findIndex(f=>f.id===familyId);const family=families[(index+direction+families.length)%families.length];if(family)enterFamily(family.id);}
	function open(id:string){location.assign(taskHref(id));}
	function focusCard(id:string){
		focusId=id;
		if(layout&&host?.querySelector(`[data-card="${CSS.escape(id)}"]`)?.matches(':focus-visible'))view.reveal(layout,id,!!selectedTaskId);
	}
	function select(id:string){if(!view.dragged){focusId=id;onselect(id);}}
	async function focusTarget(id:string){
		focusId=id;
		if(layout){if(!id.startsWith('family:'))view.reveal(layout,id,!!selectedTaskId);else if(detail!=='dots')view.family(layout,id.slice(7));}
		await tick();host?.querySelector<HTMLElement>(`[data-focus-id="${CSS.escape(id)}"]`)?.focus({preventScroll:true});
	}
	function keyboard(event:KeyboardEvent,id:string){
		if(event.key==='Enter'){event.preventDefault();if(id.startsWith('family:'))enterFamily(id.slice(7));else open(id);return;}
		if(event.key===' '){event.preventDefault();if(id.startsWith('family:'))enterFamily(id.slice(7));else onselect(id);return;}
		if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(selectedTaskId)onclear();else if(detail!=='dots'&&layout)view.fit(layout);return;}
		if(event.key==='Home'){event.preventDefault();void focusTarget('family:'+(layout?.cards.get(id)?.familyId??familyId));return;}
		if(!event.key.startsWith('Arrow'))return;
		event.preventDefault();
		const boxes=new Map<string,FamilyBox>();
		for(const target of host?.querySelectorAll<HTMLElement>('[data-focus-id]')??[]){const rect=target.getBoundingClientRect();boxes.set(target.dataset.focusId!,{x:rect.x,y:rect.y,width:rect.width,height:rect.height});}
		const next=spatialFamilyNeighbor(boxes,id,event.key);if(next)void focusTarget(next);
	}
	function fitMatches(){
		if(!layout||!matches?.size)return;
		const target=fitFamilyCardMatches(layout,matches,view);
		if(target)view.move(target);
	}
</script>
<div class="canvas-host" bind:this={host}>
	<p id="family-graph-instructions" class="sr-only">Arrow keys move between tasks and families. Space selects, Enter opens a task. Home focuses the family header. Escape clears selection, then returns to families. Drag the background to pan; wheel or pinch to zoom. List has every task.</p>
	<div class="controls"><button onclick={()=>view.zoom(1.25)} aria-label="Zoom in">+</button><button onclick={()=>view.zoom(.8)} aria-label="Zoom out">−</button><button onclick={()=>layout&&view.fit(layout)}>Fit</button>{#if matches?.size}<button onclick={fitMatches}>Fit matches</button>{/if}{#if layout?.needsRegroup}<button onclick={()=>layout=regroupTaskFamilies(tasks,{options:layout?.options})}>Regroup</button>{/if}</div>
	{#if phone&&families.length}<nav class="family-switcher" aria-label="Task families"><button onclick={()=>switchFamily(-1)} aria-label="Previous family">‹</button><span>{summaries.get(familyId??'')?.title??'Families'}<small>{families.findIndex(f=>f.id===familyId)+1} / {families.length}</small></span><button onclick={()=>switchFamily(1)} aria-label="Next family">›</button></nav>{/if}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="canvas" role="group" aria-label="Connected task families" aria-describedby="family-graph-instructions" data-detail={detail}
		onpointerdown={e=>view.pointerDown(e)} onpointermove={e=>view.pointerMove(e)} onpointerup={e=>view.pointerUp(e)} onpointercancel={e=>view.pointerUp(e)} onwheel={e=>view.wheel(e)}>
		{#if layout}
			{#key detail}
				<div class="detail-layer" in:fade={{duration:view.reduced?0:120}} out:fade={{duration:view.reduced?0:100}}>
					{#if detail==='dots'}
						<div class="family-overview">{#each families as family (family.id)}<GraphFamilyDot target={dotTargets.get(family.id)!} summary={summaries.get(family.id)!} matching={!!matches&&family.taskIds.some(id=>matches.has(id))} dimmed={!!matches&&!family.taskIds.some(id=>matches.has(id))} tabIndex={tabStop==='family:'+family.id?0:-1} onfocus={id=>focusId=id} onkeydown={keyboard} onenter={()=>enterFamily(family.id)}/>{/each}</div>
					{:else}
						<div class="world" style="transform:translate({view.camera.x}px,{view.camera.y}px) scale({view.camera.zoom})">
							{#each shownFamilies as family (family.id)}<GraphFamilyRegion {family} summary={summaries.get(family.id)!} zoom={view.camera.zoom} tabIndex={tabStop==='family:'+family.id?0:-1} onfocus={id=>focusId=id} onkeydown={keyboard} onenter={()=>enterFamily(family.id)}/>{/each}
							<GraphEdges {layout} {edges} {detail}/>
							{#each shownCards as card (card.id)}{@const details=model.details.get(card.id)!}<GraphCard {card} {details} {model} pill={detail==='pills'} selected={selectedTaskId===card.id} matching={!!matches?.has(card.id)} dimmed={!!matches&&!matches.has(card.id)} tabIndex={tabStop===card.id?0:-1} {reports} onselect={select} onopen={open} onfocus={focusCard} onkeydown={keyboard}/>{/each}
						</div>
					{/if}
				</div>
			{/key}
		{/if}
	</div>
</div>
<style>
	.canvas-host{position:absolute;inset:0}.canvas{position:absolute;inset:0;touch-action:none;user-select:none;overflow:hidden;cursor:grab;background:radial-gradient(ellipse at 40% 35%,color-mix(in srgb,var(--tone-accent-1) 5%,transparent),transparent 65%)}.canvas:active{cursor:grabbing}.world{position:absolute;left:0;top:0;transform-origin:0 0}.detail-layer{position:absolute;inset:0}.controls{position:absolute;top:12px;right:12px;z-index:3;display:flex;gap:5px}.controls button,.family-switcher button{height:36px;min-width:36px;border:1px solid var(--chat-border);border-radius:10px;background:var(--chat-surface);color:var(--chat-fg);font-size:14px;padding:0 9px;box-shadow:var(--tone-shadow);cursor:pointer}.controls button:focus-visible,.family-switcher button:focus-visible{outline:3px solid var(--chat-fg);outline-offset:2px}.family-overview{position:absolute;inset:0}.family-switcher{position:absolute;top:62px;left:8px;right:8px;z-index:3;display:flex;align-items:center;justify-content:space-between;gap:10px;border:1px solid var(--chat-border);border-radius:14px;background:var(--chat-bg);padding:2px 4px;color:var(--chat-fg)}.family-switcher>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px}.family-switcher small{font-size:12px;margin-left:8px}.sr-only{position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
	@media(max-width:640px){.controls{top:8px;right:8px}.controls button,.family-switcher button{min-height:44px;min-width:44px}}
	@media(prefers-reduced-motion:reduce){.detail-layer{transition:none}}
</style>
