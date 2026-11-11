<script lang="ts">
	import { onMount, untrack, type Snippet } from 'svelte';
	import type { ThreadSummary, WorkerSummary } from '@aiki/protocol';
	import type { ClientState } from '@aiki/client';
	import { graphSnapshot } from '#lib/task-graph-changes.js';
	import { taskGraphSession } from '#lib/task-graph-session.svelte.js';
	import GraphChanges from './graph/GraphChanges.svelte';
	import { buildGraphModel, searchGraph, GRAPH_STATUSES, GRAPH_REASONS, type GraphReason } from '#lib/task-graph-model.js';
	import type { ProjectBoard } from '#lib/board.svelte.js';
	import GraphSummary from './graph/GraphSummary.svelte';
	import GraphSearch from './graph/GraphSearch.svelte';
	import GraphTaskPanel from './graph/GraphTaskPanel.svelte';
	import GraphLegend from './graph/GraphLegend.svelte';
	import GraphFamilyCanvas from './graph/GraphFamilyCanvas.svelte';
	let {board,scope,workers=[],threads=[],taskHref,viewSwitch,connection,snapshotsReady=true}: {
		board:ProjectBoard|undefined;scope:string;workers?:readonly WorkerSummary[];threads?:readonly ThreadSummary[];
		taskHref:(id:string)=>string;viewSwitch:Snippet;connection?:ClientState;snapshotsReady?:boolean;
	}=$props();
	let showClosed=$state(false), now=$state(Date.now());
	const session=taskGraphSession(untrack(()=>scope));
	let activeCounter=$state<string|null>(null), pendingFocus=$state<string|null>(null);
	let selectedTaskId=$derived(session.selectedTaskId);
	let baselineReady=false, baselineVersion=-1;
	let tabVisible=$state(true);
	$effect(()=>{
		const snapshot=graphSnapshot(board?.tasks??[],board?.board?.questions??[],workers,threads);
		const ready=snapshotsReady&&(!connection||connection.status==='ready')&&!!board?.loaded;
		const version=board?.readyVersion??0, receivedAt=board?.receivedAt??0;
		untrack(()=>{
			if(!ready){session.lastReceivedAt=Math.max(session.lastReceivedAt,receivedAt);baselineReady=false;baselineVersion=version;return;}
			if(!baselineReady||version!==baselineVersion){
				baselineVersion=version;
				// All authoritative lists, not a timeout: delayed worker/thread hydration is never an event.
				session.resetBaseline(snapshot,Math.max(session.lastReceivedAt,receivedAt));baselineReady=true;
			}else session.receive(snapshot,Date.now(),Date.now());
		});
	});
	let query=$state('');
	const model=$derived(buildGraphModel(board?.tasks??[],board?.board?.questions??[],workers,threads,now));
	const searchResults=$derived(searchGraph(model,query));
	const connectionLabel=$derived(!connection||connection.status==='ready'?'Live':connection.status==='closed'?`Offline, showing data from ${session.lastReceivedAt?new Date(session.lastReceivedAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):'—'}`:'Reconnecting…');
	const matchingTaskIds=$derived.by(()=>{
		if(query.trim())return new Set(searchResults.map(r=>r.taskId));
		if(!activeCounter)return null;
		const [kind,key]=activeCounter.split(':');
		return new Set([...model.details.values()].filter(d=>!d.task.archived&&(activeCounter==='quiet'?d.quiet:kind==='status'?d.task.status===key:d.reasons.includes(key as GraphReason))).map(d=>d.task.id));
	});
	const visibleTasks=$derived([...model.details.values()].filter(d=>!d.task.archived&&(showClosed||!['done','dropped'].includes(d.task.status)||(session.closedUntil[d.task.id]??0)>now||(d.task.id===selectedTaskId&&!!session.closedUntil[d.task.id]))));
	const matchTone=$derived(activeCounter?.startsWith('reason:')?GRAPH_REASONS.find(r=>r.key===activeCounter?.slice(7))?.tone:activeCounter?.startsWith('status:')?GRAPH_STATUSES.find(s=>s.key===activeCounter?.slice(7))?.tone:'var(--graph-quiet)');
	$effect(()=>{if(query.trim())activeCounter=null;});
	function toggleCounter(key:string){activeCounter=activeCounter===key?null:key;query='';if(key==='status:done'||key==='status:dropped')showClosed=true;}
	function selectTask(id:string,reveal=true){session.selectedTaskId=id;if(['done','dropped'].includes(model.details.get(id)?.task.status??'')&&!(session.closedUntil[id]??0))showClosed=true;if(reveal)pendingFocus=id;}
	function clearGraph(event:KeyboardEvent){
		if(event.key!=='Escape')return;
		if(event.target instanceof Element&&event.target.closest('[data-search-open="true"], #graph-changes, .canvas'))return;
		event.preventDefault();event.stopImmediatePropagation();
		if(selectedTaskId)session.selectedTaskId=null;else {activeCounter=null;query='';}
		pendingFocus=null;
	}
	onMount(()=>{
		const visibility=()=>{tabVisible=document.visibilityState==='visible';if(tabVisible)now=Date.now();};visibility();
		const clock=setInterval(()=>{if(!tabVisible)return;now=Date.now();session.announce(now,true);},1000);
		document.addEventListener('visibilitychange',visibility);window.addEventListener('keydown',clearGraph,true);
		return()=>{clearInterval(clock);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('keydown',clearGraph,true);};
	});
</script>
<section class="task-graph" class:tab-hidden={!tabVisible} aria-label="Task graph">
	<div class="sr-only" aria-live="polite" aria-atomic="true">{session.announcement}</div>
	<div class="graph-toolbar">{@render viewSwitch()}<label><input type="checkbox" bind:checked={showClosed}/> Show closed</label>{#if board?.loaded}<GraphSearch bind:query results={searchResults} {model} onselect={selectTask}/>{/if}</div>
	{#if board?.error}<p class="connection-banner" role="status">Could not refresh the board. {board.error}</p>{/if}
	{#if board?.loaded}<div class="summary-row"><GraphSummary {model} active={activeCounter} onchange={toggleCounter} freshness={connectionLabel} freshnessTitle={session.lastReceivedAt?`Updated ${Math.max(0,Math.floor((now-session.lastReceivedAt)/1000))} s ago`:'Waiting for the first board'}/><GraphChanges {session} {now} onselect={selectTask}/></div>{/if}
	<div class="graph-stage" style="--match-tone:{matchTone??'var(--graph-quiet)'}">
		<GraphFamilyCanvas {model} {session} {now} {tabVisible} {scope} {showClosed} {selectedTaskId} matches={matchingTaskIds} focusRequest={pendingFocus} onrevealed={()=>pendingFocus=null} onselect={id=>selectTask(id,false)} onclear={()=>session.selectedTaskId=null} {taskHref}/>
		{#if !board?.loaded}<div class="empty-graph" role="status">Loading your board…</div>
		{:else if !board.tasks.filter(t=>!t.archived).length}<p class="empty-graph">No tasks yet. Ask in chat to create your first task.</p>
		{:else if !visibleTasks.length}<div class="empty-graph">All tasks are closed. <button onclick={()=>showClosed=true}>Show closed</button></div>
		{:else if matchingTaskIds&&!visibleTasks.some(d=>matchingTaskIds.has(d.task.id))}<p class="empty-graph" role="status">No visible tasks match. {showClosed?'Try another search or counter.':'Try Show closed or another search.'}</p>{/if}
		{#if selectedTaskId}<GraphTaskPanel taskId={selectedTaskId} {model} {now} {taskHref} onselect={selectTask} onclose={()=>session.selectedTaskId=null}/>{/if}
	</div>
	<GraphLegend/>
</section>
<style>
	.task-graph{--graph-muted:light-dark(color-mix(in srgb,var(--chat-fg-muted) 88%,var(--chat-fg)),var(--chat-fg-muted));--graph-working:light-dark(#08788a,var(--tone-accent-1));--graph-review:light-dark(#7041c6,color-mix(in srgb,var(--tone-ring) 80%,var(--chat-fg)));--graph-blocked:light-dark(#c0143e,var(--tone-danger));--graph-waiting:light-dark(#975700,var(--tone-warning));--graph-done:light-dark(#07764f,var(--tone-success));--graph-quiet:light-dark(#514bd1,var(--tone-primary));--graph-subtask:color-mix(in srgb,var(--chat-fg) 60%,var(--chat-bg));display:flex;flex-direction:column;min-height:0;height:100%;color:var(--chat-fg);background:var(--chat-bg);overflow:hidden}.graph-toolbar{position:relative;z-index:8;display:flex;flex-wrap:wrap;align-items:center;gap:10px;flex-shrink:0;padding:7px 16px;border-bottom:1px solid var(--chat-border);font-size:12px}.graph-toolbar label{display:flex;align-items:center;gap:6px;white-space:nowrap;color:var(--chat-fg)}input{accent-color:var(--tone-accent-1)}.graph-stage{position:relative;flex:1;min-height:220px;overflow:hidden}.empty-graph{position:absolute;top:35%;width:100%;text-align:center;font-size:14px;color:var(--chat-fg);padding:16px;pointer-events:none}.empty-graph button{pointer-events:auto;border:1px solid var(--chat-border);border-radius:8px;padding:8px 12px;min-height:44px;background:var(--chat-surface)}.connection-banner{margin:0;padding:8px 22px;font-size:12px;color:var(--chat-fg);background:var(--chat-surface-2)}
	.summary-row{position:relative;z-index:7;display:flex;align-items:center;gap:10px;flex-shrink:0;padding-right:10px;border-bottom:1px solid var(--chat-border)}.summary-row :global(.summary){flex:1;min-width:0;border-bottom:0}.summary-row :global(.changes-toggle){flex-shrink:0;margin-right:2px;box-shadow:-8px 0 0 var(--chat-bg)}.graph-toolbar :global([aria-label="Show the tasks as"] button){color:var(--chat-fg)}.graph-toolbar :global(button:focus-visible){outline:3px solid var(--chat-fg);outline-offset:2px}.graph-toolbar label:focus-within{outline:3px solid var(--chat-fg);outline-offset:2px}
	.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}.tab-hidden :global(*){animation-play-state:paused!important}
	@media (hover:none) and (pointer:coarse){.graph-toolbar :global(button){min-height:44px;min-width:44px}.graph-toolbar :global([aria-label="Show the tasks as"]){height:auto;min-height:44px}.graph-toolbar label{min-height:44px}}
	@media(max-width:640px){.graph-toolbar :global(button){min-height:44px;min-width:44px}.graph-toolbar :global([aria-label="Show the tasks as"]){height:auto;min-height:44px}.graph-toolbar{gap:6px;padding:6px 10px}.graph-toolbar label{font-size:12px;min-height:44px}}
</style>
