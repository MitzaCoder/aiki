<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import type { ThreadSummary, WorkerSummary } from '@aiki/protocol';
	import type { ClientState } from '@aiki/client';
	import { connectionView } from '#lib/connection.js';
	import { buildGraphModel, searchGraph, GRAPH_STATUSES, GRAPH_REASONS, type GraphReason } from '#lib/task-graph-model.js';
	import type { ProjectBoard } from '#lib/board.svelte.js';
	import GraphSummary from './graph/GraphSummary.svelte';
	import GraphSearch from './graph/GraphSearch.svelte';
	import GraphTaskPanel from './graph/GraphTaskPanel.svelte';
	import GraphLegend from './graph/GraphLegend.svelte';
	import GraphFamilyCanvas from './graph/GraphFamilyCanvas.svelte';
	let {board,scope,workers=[],threads=[],taskHref,viewSwitch,connection}: {
		board:ProjectBoard|undefined;scope:string;workers?:readonly WorkerSummary[];threads?:readonly ThreadSummary[];
		taskHref:(id:string)=>string;viewSwitch:Snippet;connection?:ClientState;
	}=$props();
	let showClosed=$state(false), now=$state(Date.now());
	let selectedTaskId=$state<string|null>(null), activeCounter=$state<string|null>(null), pendingFocus=$state<string|null>(null);
	let query=$state('');
	const model=$derived(buildGraphModel(board?.tasks??[],board?.board?.questions??[],workers,threads,now));
	const searchResults=$derived(searchGraph(model,query));
	const connectionLabel=$derived(connection?connectionView(connection).label:'');
	const matchingTaskIds=$derived.by(()=>{
		if(query.trim())return new Set(searchResults.map(r=>r.taskId));
		if(!activeCounter)return null;
		const [kind,key]=activeCounter.split(':');
		return new Set([...model.details.values()].filter(d=>!d.task.archived&&(activeCounter==='quiet'?d.quiet:kind==='status'?d.task.status===key:d.reasons.includes(key as GraphReason))).map(d=>d.task.id));
	});
	const visibleTasks=$derived([...model.details.values()].filter(d=>!d.task.archived&&(showClosed||!['done','dropped'].includes(d.task.status))));
	const matchTone=$derived(activeCounter?.startsWith('reason:')?GRAPH_REASONS.find(r=>r.key===activeCounter?.slice(7))?.tone:activeCounter?.startsWith('status:')?GRAPH_STATUSES.find(s=>s.key===activeCounter?.slice(7))?.tone:'var(--tone-primary)');
	$effect(()=>{if(query.trim())activeCounter=null;});
	function toggleCounter(key:string){activeCounter=activeCounter===key?null:key;query='';if(key==='status:done'||key==='status:dropped')showClosed=true;}
	function selectTask(id:string,reveal=true){selectedTaskId=id;if(['done','dropped'].includes(model.details.get(id)?.task.status??''))showClosed=true;if(reveal)pendingFocus=id;}
	function clearGraph(event:KeyboardEvent){
		if(event.key!=='Escape')return;
		if(event.target instanceof Element&&event.target.closest('[data-search-open="true"], .canvas'))return;
		event.preventDefault();event.stopImmediatePropagation();
		if(selectedTaskId)selectedTaskId=null;else {activeCounter=null;query='';}
		pendingFocus=null;
	}
	onMount(()=>{const clock=setInterval(()=>now=Date.now(),60000);window.addEventListener('keydown',clearGraph,true);return()=>{clearInterval(clock);window.removeEventListener('keydown',clearGraph,true);};});
</script>
<section class="task-graph" aria-label="Task graph">
	<div class="graph-toolbar">{@render viewSwitch()}<label><input type="checkbox" bind:checked={showClosed}/> Show closed</label>{#if board?.loaded}<GraphSearch bind:query results={searchResults} {model} onselect={selectTask}/>{/if}</div>
	{#if connection&&connection.status!=='ready'}<p class="connection-banner" role="status">{connectionLabel} · {board?.loaded?'Showing the last received board.':'Waiting for your board.'}</p>{/if}
	{#if board?.error}<p class="connection-banner" role="status">Could not refresh the board. {board.error}</p>{/if}
	{#if board?.loaded}<GraphSummary {model} active={activeCounter} onchange={toggleCounter}/>{/if}
	<div class="graph-stage" style="--match-tone:{matchTone??'var(--tone-primary)'}">
		<GraphFamilyCanvas {model} {scope} {showClosed} {selectedTaskId} matches={matchingTaskIds} focusRequest={pendingFocus} onrevealed={()=>pendingFocus=null} onselect={id=>selectTask(id,false)} onclear={()=>selectedTaskId=null} {taskHref}/>
		{#if !board?.loaded}<div class="empty-graph" role="status">Loading your board…</div>
		{:else if !board.tasks.filter(t=>!t.archived).length}<p class="empty-graph">No tasks yet. Ask in chat to create your first task.</p>
		{:else if !visibleTasks.length}<div class="empty-graph">All tasks are closed. <button onclick={()=>showClosed=true}>Show closed</button></div>
		{:else if matchingTaskIds&&!visibleTasks.some(d=>matchingTaskIds.has(d.task.id))}<p class="empty-graph" role="status">No visible tasks match. {showClosed?'Try another search or counter.':'Try Show closed or another search.'}</p>{/if}
		{#if selectedTaskId}<GraphTaskPanel taskId={selectedTaskId} {model} {now} {taskHref} onselect={selectTask} onclose={()=>selectedTaskId=null}/>{/if}
	</div>
	<GraphLegend/>
</section>
<style>
	.task-graph{display:flex;flex-direction:column;min-height:0;height:100%;color:var(--chat-fg);background:var(--chat-bg);overflow:hidden}.graph-toolbar{position:relative;z-index:8;display:flex;align-items:center;gap:16px;flex-shrink:0;padding:7px 16px;border-bottom:1px solid var(--chat-border);font-size:12px}.graph-toolbar label{display:flex;align-items:center;gap:6px;white-space:nowrap;color:var(--chat-fg)}input{accent-color:var(--tone-accent-1)}.graph-stage{position:relative;flex:1;min-height:220px;overflow:hidden}.empty-graph{position:absolute;top:35%;width:100%;text-align:center;font-size:14px;color:var(--chat-fg);padding:16px;pointer-events:none}.empty-graph button{pointer-events:auto;border:1px solid var(--chat-border);border-radius:8px;padding:8px 12px;min-height:44px;background:var(--chat-surface)}.connection-banner{margin:0;padding:8px 22px;font-size:12px;color:var(--chat-fg);background:var(--chat-surface-2)}
	@media(max-width:640px){.graph-toolbar{gap:6px;padding:6px 10px}.graph-toolbar label{font-size:12px;min-height:44px}}
</style>
