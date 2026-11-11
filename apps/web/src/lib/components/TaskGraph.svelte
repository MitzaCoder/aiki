<script lang="ts">
	import { onMount, untrack, type Snippet } from 'svelte';
	import { fade } from 'svelte/transition';
	import type { ThreadSummary, WorkerSummary } from '@aiki/protocol';
	import type { ClientState } from '@aiki/client';
	import { connectionView } from '#lib/connection.js';
	import { buildGraphModel, searchGraph, GRAPH_STATUSES, type GraphReason } from '#lib/task-graph-model.js';
	import GraphSummary from './graph/GraphSummary.svelte';
	import GraphSearch from './graph/GraphSearch.svelte';
	import GraphTaskPanel from './graph/GraphTaskPanel.svelte';
	import type { ProjectBoard } from '#lib/board.svelte.js';
	import { buildTaskGraph, graphLabel, graphNeighborhood, type GraphPosition, type TaskGraph } from '#lib/task-graph.js';
	import { settledGraphPositions, interpolateGraphPositions } from '#lib/task-graph-layout.js';
	import { fitGraphCamera, loadGraphCamera, saveGraphCamera, placeGraphLabels, type GraphCamera } from '#lib/task-graph-camera.js';

	let { board, scope, workers = [], threads = [], taskHref, viewSwitch, connection }: {
		board:ProjectBoard | undefined; scope:string; workers?:readonly WorkerSummary[]; threads?:readonly ThreadSummary[];
		taskHref:(id:string)=>string; viewSwitch:Snippet; connection?:ClientState;
	} = $props();
	let showClosed = $state(false);
	let now = $state(Date.now());
	let selectedTaskId = $state<string | null>(null);
	let activeCounter = $state<string | null>(null);
	let query = $state('');
	let pendingFocus = $state<string | null>(null);
	const model = $derived(buildGraphModel(board?.tasks ?? [], board?.board?.questions ?? [], workers, threads, now));
	const searchResults = $derived(searchGraph(model, query));
	const connectionLabel = $derived(connection ? connectionView(connection).label : '');
	const matchingTaskIds = $derived.by(() => {
		if (query.trim()) return new Set(searchResults.map(r => r.taskId));
		if (!activeCounter) return null;
		const [kind, key] = activeCounter.split(':');
		return new Set([...model.details.values()].filter(d => !d.task.archived && (kind === 'status' ? d.task.status === key : d.reasons.includes(key as GraphReason))).map(d => d.task.id));
	});
	$effect(() => {if (query.trim()) activeCounter = null;});
	function toggleCounter(key: string) {
		activeCounter = activeCounter === key ? null : key;
		query = '';
		if (activeCounter === 'status:done' || activeCounter === 'status:dropped') showClosed = true;
	}
	function selectTask(id: string, reveal = true) {
		selectedTaskId = id;
		if (['done', 'dropped'].includes(model.details.get(id)?.task.status ?? '')) showClosed = true;
		if (reveal) pendingFocus = id;
	}
	function stepSearch(direction: number) {
		if (!searchResults.length) return;
		const found = searchResults.findIndex(r => r.taskId === selectedTaskId);
		const index = found < 0 ? (direction > 0 ? -1 : 0) : found;
		selectTask(searchResults[(index + direction + searchResults.length) % searchResults.length]!.taskId);
	}
	function clearGraph(event: KeyboardEvent) {
		if (event.key !== 'Escape') return;
		event.preventDefault(); event.stopImmediatePropagation();
		selectedTaskId = null; activeCounter = null; query = ''; focused = null; pendingFocus = null;
	}
	$effect(() => {
		if (!pendingFocus) return;
		const p = positions.get('task:' + pendingFocus);
		if (!p) return;
		untrack(() => {
			camera = {...camera, x: p.x + (width > 640 ? 170 / camera.zoom : 0), y: p.y + (width <= 640 ? height * .22 / camera.zoom : 0)};
			pendingFocus = null; remember();
		});
	});
	const source = $derived(buildTaskGraph(board?.tasks ?? [], board?.board?.questions ?? [], workers, threads, showClosed));
	let graph = $state<TaskGraph>({nodes:[],edges:[]});
	let positions = $state(new Map<string,GraphPosition>());
	let camera = $state<GraphCamera>({x:0,y:0,zoom:1});
	let svg:SVGSVGElement | null = $state(null);
	let width=$state(0), height=$state(0), reduced=$state(false), mounted=$state(false);
	let framed=false, frame=0;
	let enterDuration=$state(0);
	function arrive(_node:Element,options:{duration:number}) {return {duration:options.duration,css:(t:number)=>`opacity:${t}`};}
	let departureTimer:ReturnType<typeof setTimeout> | undefined;
	let destination=new Map<string,GraphPosition>();
	function storage():Storage | undefined {try{return localStorage;}catch{return undefined;}}
	let focused=$state<string | null>(null);
	const highlighted=$derived.by(() => {
		if (!matchingTaskIds) return graphNeighborhood(graph, focused);
		return new Set(graph.nodes.filter(n => matchingTaskIds.has(n.task?.id ?? n.worker?.taskId ?? n.thread?.taskId ?? '')).map(n => n.id));
	});
	const labels=$derived(placeGraphLabels(graph,positions,camera,width,height));
	const focusNode=$derived(graph.nodes.find(n=>n.id===focused));
	const focusPosition=$derived(focused ? positions.get(focused) : undefined);
	const tooltipX=$derived(focusPosition ? Math.max(130,Math.min(width-130,(focusPosition.x-camera.x)*camera.zoom+width/2)) : 0);
	const tooltipY=$derived(focusPosition ? Math.max(90,(focusPosition.y-camera.y)*camera.zoom+height/2-35) : 0);
	const viewBox=$derived(`${camera.x-width/camera.zoom/2} ${camera.y-height/camera.zoom/2} ${Math.max(1,width)/camera.zoom} ${Math.max(1,height)/camera.zoom}`);
	let reports=$state<Record<string,string>>({});
	const seenReports=new Map<string,string | null>();
	const reportTimers=new Set<ReturnType<typeof setTimeout>>();
	let saveTimer:ReturnType<typeof setTimeout> | undefined;
	let drag:{id:string | null;x:number;y:number;moved:boolean} | null=null;
	const pointers=new Map<number,{x:number;y:number}>();
	let pinchDistance=0;

	function remember() {
		clearTimeout(saveTimer);
		saveTimer=setTimeout(()=>{saveGraphCamera(scope,camera,storage());saveTimer=undefined;},180);
	}
	function fit(rememberChoice=true) {
		camera=fitGraphCamera(positions,width,height);
		if(rememberChoice) remember();
	}
	function frameFirstGraph() {
		if(framed || !width || !height || !positions.size) return;
		camera=loadGraphCamera(scope,storage()) ?? fitGraphCamera(positions,width,height);
		framed=true;
	}
	function publish(next:TaskGraph) {
		cancelAnimationFrame(frame);
		clearTimeout(departureTimer);
		const from=positions;
		const target=settledGraphPositions(next,from,width/Math.max(1,height));
		destination=target;
		positions=target;
		frameFirstGraph();
		enterDuration=reduced || from.size===0 ? 0 : 300;
		graph=next;
		if(reduced || from.size===0) return;
		const departing=[...from].filter(([id])=>!target.has(id));
		const traveling=[...target].some(([id,p])=>{const old=from.get(id);return old && Math.hypot(old.x-p.x,old.y-p.y)>.1;});
		if(!traveling) {
			if(departing.length) {positions=new Map([...departing,...target]);departureTimer=setTimeout(()=>{positions=target;},320);}
			return;
		}
		const start=performance.now();
		const animate=(now:number)=>{
			const progress=Math.min(1,(now-start)/650);
			positions=progress<1 ? new Map([...departing,...interpolateGraphPositions(from,target,progress)]) : target;
			if(progress<1) frame=requestAnimationFrame(animate);
		};
		positions=new Map([...departing,...interpolateGraphPositions(from,target,0)]);
		frame=requestAnimationFrame(animate);
	}
	// Yield the first frame to the view switch. Solve only once, before publishing SVG, not on every paint.
	$effect(()=>{
		const next=source;
		if(!mounted) return;
		const timer=setTimeout(()=>untrack(()=>publish(next)),0);
		return ()=>clearTimeout(timer);
	});
	$effect(()=>{
		for(const worker of workers) {
			if(seenReports.has(worker.id) && worker.lastReport && seenReports.get(worker.id)!==worker.lastReport) {
				untrack(()=>{reports={...reports,[worker.id]:worker.updatedAt};});
				const timer=setTimeout(()=>{const next={...reports};delete next[worker.id];reports=next;reportTimers.delete(timer);},1800);
				reportTimers.add(timer);
			}
			seenReports.set(worker.id,worker.lastReport);
		}
	});
	onMount(()=>{
		const clock = setInterval(() => now = Date.now(), 60000);
		window.addEventListener('keydown', clearGraph, true);
		const media=matchMedia('(prefers-reduced-motion: reduce)');reduced=media.matches;
		const motionChange=()=>{reduced=media.matches;if(reduced) {cancelAnimationFrame(frame);positions=destination;}};
		media.addEventListener('change',motionChange);
		const observer=new ResizeObserver(([entry])=>{if(!entry)return;width=entry.contentRect.width;height=entry.contentRect.height;frameFirstGraph();});
		if(svg) observer.observe(svg);
		mounted=true;
		return ()=>{
			window.removeEventListener('keydown', clearGraph, true);clearInterval(clock);observer.disconnect();media.removeEventListener('change',motionChange);cancelAnimationFrame(frame);clearTimeout(departureTimer);
			if(saveTimer) {clearTimeout(saveTimer);saveGraphCamera(scope,camera,storage());}
			for(const timer of reportTimers)clearTimeout(timer);
		};
	});
	function changeZoom(factor:number) {camera={...camera,zoom:Math.max(.08,Math.min(4,camera.zoom*factor))};remember();}
	function pointerDown(event:PointerEvent) {
		if(event.button!==0)return;
		pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
		if(pointers.size===2) {const [a,b]=[...pointers.values()];pinchDistance=Math.hypot(a!.x-b!.x,a!.y-b!.y);drag=null;return;}
		const id=(event.target as Element).closest('[data-node]')?.getAttribute('data-node') ?? null;
		drag={id,x:event.clientX,y:event.clientY,moved:false};
	}
	function pointerMove(event:PointerEvent) {
		if(!pointers.has(event.pointerId))return;
		pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
		if(pointers.size===2) {const [a,b]=[...pointers.values()];const distance=Math.hypot(a!.x-b!.x,a!.y-b!.y);if(pinchDistance)changeZoom(distance/pinchDistance);pinchDistance=distance;return;}
		if(!drag)return;
		const dx=(event.clientX-drag.x)/camera.zoom,dy=(event.clientY-drag.y)/camera.zoom;
		if(!drag.moved&&Math.hypot(dx,dy)*camera.zoom<4)return;
		if(!drag.moved) {svg?.setPointerCapture(event.pointerId);cancelAnimationFrame(frame);focused=null;}
		drag.moved=true;
		if(drag.id) {for(const [id,p] of positions)if(id===drag.id||p.parentId===drag.id) {p.x+=dx;p.y+=dy;p.anchorX=p.x;p.anchorY=p.y;}positions=new Map(positions);}
		else {camera={...camera,x:camera.x-dx,y:camera.y-dy};remember();}
		drag.x=event.clientX;drag.y=event.clientY;
	}
	function pointerUp(event:PointerEvent) {pointers.delete(event.pointerId);pinchDistance=0;if(drag?.moved)setTimeout(()=>{drag=null;},0);else drag=null;}
	function wheel(event:WheelEvent) {event.preventDefault();changeZoom(Math.exp(-event.deltaY*.0015));}
	function edgePath(from:string,to:string):string {
		const a=positions.get(from),b=positions.get(to);if(!a||!b)return '';
		const dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy)||1;
		return `M ${a.x+dx/d*(a.radius+5)} ${a.y+dy/d*(a.radius+5)} L ${b.x-dx/d*(b.radius+9)} ${b.y-dy/d*(b.radius+9)}`;
	}
</script>

<section class="task-graph" aria-label="Task graph">
	<div class="graph-toolbar">{@render viewSwitch()}<label><input type="checkbox" bind:checked={showClosed}/> Show closed</label><span class="read-only">Read only</span></div>
	<div class="graph-heading"><div><p>YOUR TASKS, ALIVE</p><h2>Bubble club</h2><span>{board?.loaded ? `${graph.nodes.filter(n=>n.kind==='task').length} tasks · ${workers.filter(w=>w.status==='running').length} workers busy` : 'Loading your board…'}</span></div><div class="graph-controls"><button onclick={()=>changeZoom(1.25)} aria-label="Zoom in">+</button><button onclick={()=>changeZoom(.8)} aria-label="Zoom out">−</button><button onclick={()=>fit()}>Fit</button></div></div>
	{#if connection && connection.status !== 'ready'}<p class="connection-banner" role="status">{connectionLabel} · {board?.loaded ? 'Showing the last received board.' : 'Waiting for your board.'}</p>{/if}
	{#if board?.error}<p class="connection-banner" role="status">Could not refresh the board. {board.error}</p>{/if}
	{#if board?.loaded}<GraphSummary {model} active={activeCounter} onchange={toggleCounter}/><GraphSearch bind:query results={searchResults} {model} onstep={stepSearch} onselect={selectTask}/>{/if}
	<div class="graph-stage">
		<!-- Pointer gestures only move the camera or nodes; tasks remain ordinary keyboard links. -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<svg bind:this={svg} class="graph-canvas" {viewBox} role="group" aria-label="Interactive task graph. Drag to pan; pinch or use zoom buttons. Tab to nodes, Enter opens a task. List has all task details." onpointerdown={pointerDown} onpointermove={pointerMove} onpointerup={pointerUp} onpointercancel={pointerUp} onwheel={wheel}>
			<defs><marker id="task-graph-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="var(--graph-blocked)"/></marker><radialGradient id="task-graph-shine" cx="30%" cy="20%"><stop offset="0%" stop-color="white" stop-opacity=".45"/><stop offset="100%" stop-color="white" stop-opacity="0"/></radialGradient></defs>
			{#each graph.nodes.filter(n=>n.kind==='task'&&n.radius>35&&!n.parent) as node (node.id)}
				{@const p=positions.get(node.id)}
				{#if p}<path class="cluster" class:dimmed={!highlighted.has(node.id)} transform="translate({p.x} {p.y}) scale(1.15)" d="M -190 -35 C -220 -190 -45 -215 30 -190 C 210 -225 245 -40 185 60 C 190 215 -20 230 -90 165 C -210 165 -245 60 -190 -35"/>{/if}
			{/each}
			{#each graph.edges as edge (edge.id)}
				<path class="edge {edge.kind}" class:dimmed={!highlighted.has(edge.from)||!highlighted.has(edge.to)} d={edgePath(edge.from,edge.to)} marker-end={edge.kind==='blockedBy'?'url(#task-graph-arrow)':undefined}/>
				{#if edge.kind==='working'&&reports[edge.from.slice(7)]&&!reduced}
					{#key reports[edge.from.slice(7)]}<circle class="report-spark" r="5"><animateMotion dur="1.4s" path={edgePath(edge.from,edge.to)} fill="freeze"/></circle>{/key}
				{/if}
			{/each}
			{#each graph.nodes as node,index (node.id)}
				{@const p=positions.get(node.id)}
				{#if p}
					<g transform="translate({p.x} {p.y})" class="node-position" class:dimmed={!highlighted.has(node.id)} in:arrive|global={{duration:enterDuration}} out:fade|global={{duration:reduced?0:280}}>
						<a href={node.kind==='task'?taskHref(node.task!.id):undefined} role={node.kind==='task'?undefined:'button'} tabindex="0" aria-label={graphLabel(node)} data-node={node.id} onmouseenter={()=>focused=node.id} onmouseleave={()=>focused=null} onfocus={()=>focused=node.id} onblur={()=>focused=null} onclick={(event)=>{event.preventDefault();if(!drag?.moved){const id=node.task?.id??node.worker?.taskId??node.thread?.taskId;if(id)selectTask(id,false);}}} ondblclick={()=>{if(node.task)location.assign(taskHref(node.task.id));}} onkeydown={(event)=>{const id=node.task?.id??node.worker?.taskId??node.thread?.taskId;if(event.key==='Enter'&&id){event.preventDefault();location.assign(taskHref(id));}else if(event.key===' '&&id){event.preventDefault();selectTask(id);}}}>
							<g class="node {node.kind} status-{node.status}" class:closed={node.status==='done'||node.status==='dropped'} class:reporting={!!reports[node.worker?.id??'']} style="--delay:{index*-.37}s">
								{#if node.attention}<circle class="attention-halo" r={node.radius+12}/>{/if}
								{#if node.kind==='task'}
									<circle class="task-body" r={node.radius}/><circle r={node.radius-2} fill="url(#task-graph-shine)"/>
									{#if node.task?.subtaskCount?.total}<circle class="progress-track" r={node.radius+5}/><circle class="progress" r={node.radius+5} pathLength="100" stroke-dasharray="{node.task.subtaskCount.done/node.task.subtaskCount.total*100} 100" transform="rotate(-90)"/>{/if}
									<text class="task-id" y="4">{node.task!.id}</text>
									{#if node.attention}<text class="attention-mark" x={node.radius-1} y={-node.radius+2}>!</text>{/if}
								{:else}
									<g class="creature" class:busy={node.status==='running'} class:resting={node.status==='idle'}>
										<ellipse class="creature-shadow" cy={node.radius+7} rx={node.radius*.8} ry="5"/>
										<path class="antenna" d="M 0 -20 Q -10 -42 3 -39"/><circle class="antenna-tip" cx="3" cy="-39" r="4"/>
										<rect class="creature-body" x={-node.radius} y={-node.radius} width={node.radius*2} height={node.radius*2} rx={node.radius*.7}/>
										{#if node.status==='idle'}<path class="face" d="M -12 -2 q 4 5 8 0 M 4 -2 q 4 5 8 0"/><text class="sleep" x="24" y="-23">z</text>{:else}<ellipse class="eye" cx="-8" cy="-3" rx="3" ry="4"/><ellipse class="eye" cx="8" cy="-3" rx="3" ry="4"/>{/if}
										<path class="face" d="M -4 7 Q 0 11 4 7"/><circle class="cheek" cx="-14" cy="6" r="4"/><circle class="cheek" cx="14" cy="6" r="4"/>
										{#if node.status==='running'}<g class="working-hands"><path d="M -25 15 l 12 7 M 25 15 l -12 7"/><rect x="-16" y="19" width="32" height="11" rx="3"/><path d="M -9 24 h 5 M 0 24 h 5"/></g>{/if}
									</g>
								{/if}
							</g>
						</a>
					</g>
				{/if}
			{/each}
			{#each [...labels] as [id,label] (id)}<text class="graph-label" class:dimmed={!highlighted.has(id)} x={label.x+label.width/2} y={label.y+label.height*.68} font-size={12/camera.zoom} stroke-width={5/camera.zoom}>{label.text}</text>{/each}
		</svg>
		{#if !board?.loaded}<div class="empty-graph" role="status"><span class="loading-shape"></span>Loading your board…</div>
		{:else if !board.tasks.filter(t=>!t.archived).length}<p class="empty-graph">No tasks yet. Ask in chat to create your first task.</p>
		{:else if !graph.nodes.some(n=>n.kind==='task')}<div class="empty-graph">All tasks are closed. <button onclick={()=>showClosed=true}>Show closed</button></div>
		{:else if matchingTaskIds && !graph.nodes.some(n=>n.task&&matchingTaskIds.has(n.task.id))}<p class="empty-graph" role="status">No visible tasks match. {showClosed ? 'Try another search or counter.' : 'Try Show closed or another search.'}</p>{/if}
		{#if selectedTaskId}<GraphTaskPanel taskId={selectedTaskId} {model} {now} {taskHref} onselect={selectTask} onclose={()=>selectedTaskId=null}/>{/if}
		{#if focusNode&&focusPosition}<div class="node-tooltip" role="tooltip" style="left:{tooltipX}px;top:{tooltipY}px"><strong>{focusNode.title}</strong><span>{focusNode.task?.id ?? focusNode.worker?.id ?? focusNode.thread?.id} · {focusNode.status.replaceAll('_',' ')}{focusNode.attention?' · needs you':''}{focusNode.task?.subtaskCount?` · ${focusNode.task.subtaskCount.done}/${focusNode.task.subtaskCount.total} subtasks done`:''}</span></div>{/if}
	</div>
	<div class="graph-footer"><div class="legend" aria-label="Relationship legend"><span><i class="parent"></i>Subtask</span><span><i class="foundWhile"></i>Found while</span><span><i class="blockedBy"></i>Blocked by →</span><span><i class="related"></i>Related</span><span><i class="working"></i>Worker</span></div><div class="legend" aria-label="Status legend">{#each GRAPH_STATUSES as status}<span><b style:color={status.tone}>{status.mark}</b>{status.label}</span>{/each}</div><span class="gesture-hint">Tap to select · Enter / double-click to open</span></div>
</section>

<style>
	.task-graph{--graph-todo:var(--chat-fg-subtle);--graph-working:var(--tone-accent-1);--graph-blocked:var(--tone-danger);--graph-review:var(--tone-ring);--graph-waiting:var(--tone-warning);display:flex;flex-direction:column;min-height:0;height:100%;color:var(--chat-fg);background:var(--chat-bg);overflow:hidden}
	.graph-toolbar{display:flex;align-items:center;gap:18px;padding:10px 16px;border-bottom:1px solid var(--chat-border);font-size:12px}.graph-toolbar label{display:flex;align-items:center;gap:7px;color:var(--chat-fg-muted)}input{accent-color:var(--graph-working)}.read-only{margin-left:auto;font-size:10px;color:var(--chat-fg)}
	.graph-heading{display:flex;justify-content:space-between;gap:12px;padding:20px 28px 12px}.graph-heading p{font-size:9px;letter-spacing:.23em;color:var(--chat-fg-subtle);margin:0 0 3px}.graph-heading h2{font-size:25px;font-weight:650;letter-spacing:-.04em;margin:0}.graph-heading span{font-size:12px;color:var(--chat-fg-muted)}.graph-controls{display:flex;gap:5px;align-items:center}.graph-controls button{height:34px;min-width:34px;border:1px solid var(--chat-border);border-radius:11px;background:var(--chat-surface);font-size:14px;padding:0 8px}.graph-controls button:hover{background:var(--chat-surface-2)}
	.graph-stage{position:relative;flex:1;min-height:220px;overflow:hidden;animation:arrive .5s ease-out}.graph-canvas{width:100%;height:100%;touch-action:none;cursor:grab;user-select:none;background:radial-gradient(ellipse at 40% 35%,color-mix(in srgb,var(--graph-working) 5%,transparent),transparent 65%)}.graph-canvas:active{cursor:grabbing}.dimmed{opacity:.15;transition:opacity .2s}.node-position{transition:opacity .2s}.node{--node-color:var(--graph-todo)}.status-in_progress,.status-running{--node-color:var(--graph-working)}.status-blocked,.status-failed{--node-color:var(--graph-blocked)}.status-review{--node-color:var(--graph-review)}.status-waiting{--node-color:var(--graph-waiting)}.status-done{--node-color:var(--tone-success)}.closed{opacity:.35}
	.cluster{fill:color-mix(in srgb,var(--graph-working) 6%,var(--chat-bg));stroke:color-mix(in srgb,var(--graph-working) 16%,transparent);stroke-width:1}.cluster:nth-of-type(even){fill:color-mix(in srgb,var(--graph-review) 6%,var(--chat-bg));stroke:color-mix(in srgb,var(--graph-review) 18%,transparent)}
	.edge{fill:none;stroke:var(--chat-fg-subtle);stroke-width:1.6;opacity:.45}.edge.parent{stroke:var(--graph-working);stroke-width:2}.edge.foundWhile{stroke:var(--graph-waiting);stroke-dasharray:2 6;stroke-linecap:round}.edge.blockedBy{stroke:var(--graph-blocked);stroke-width:2.4;opacity:1}.edge.related{stroke:var(--graph-review);stroke-dasharray:8 6}.edge.working{stroke:var(--graph-working);stroke-dasharray:4 4;opacity:.8}.edge.owns{stroke:var(--graph-review);stroke-dasharray:1 4}.edge.dimmed{opacity:.08}
	.task-body{fill:color-mix(in srgb,var(--node-color) 23%,var(--chat-bg));stroke:var(--node-color);stroke-width:2}.task-id{font-size:13px;font-weight:700;fill:var(--chat-fg);text-anchor:middle;pointer-events:none}.graph-label{fill:var(--chat-fg);stroke:var(--chat-bg);paint-order:stroke;text-anchor:middle;font-weight:550;pointer-events:none;stroke-linejoin:round}.progress-track{fill:none;stroke:var(--chat-border);stroke-width:3}.progress{fill:none;stroke:var(--graph-working);stroke-width:3;stroke-linecap:round}.attention-halo{fill:color-mix(in srgb,var(--node-color) 4%,transparent);stroke:var(--node-color);stroke-width:2;opacity:.4;animation:attention 4s ease-in-out infinite}.attention-mark{font-size:13px;fill:var(--chat-fg);font-weight:800;paint-order:stroke;stroke:var(--chat-bg);stroke-width:5}
	a{cursor:pointer;outline:none}a:focus-visible .task-body,a:focus-visible .creature-body{stroke:var(--chat-fg);stroke-width:4}a:hover .task-body{stroke-width:3}.report-spark{fill:var(--graph-working);filter:drop-shadow(0 0 6px var(--graph-working));animation:spark 1.6s both}
	.creature-body{fill:color-mix(in srgb,var(--node-color) 60%,var(--chat-bg));stroke:var(--node-color);stroke-width:2}.thread .creature-body{fill:color-mix(in srgb,var(--graph-review) 55%,var(--chat-bg));stroke:var(--graph-review)}.eye{fill:var(--chat-fg);animation:blink 6s infinite;transform-origin:center;transform-box:fill-box}.face,.antenna{fill:none;stroke:var(--chat-fg);stroke-width:2;stroke-linecap:round}.antenna-tip{fill:var(--graph-waiting)}.reporting .antenna-tip{animation:report 1.6s ease-out}.cheek{fill:var(--graph-blocked);opacity:.6}.creature-shadow{fill:var(--chat-fg);opacity:.08}.working-hands{stroke:var(--chat-fg);stroke-width:2;fill:var(--chat-surface-2);animation:typing .55s ease-in-out infinite alternate;transform-origin:center}.busy{animation:busy 2.5s ease-in-out infinite;animation-delay:var(--delay)}.resting{animation:breathe 5s ease-in-out infinite;transform-origin:center}.sleep{font-size:18px;fill:var(--chat-fg-subtle)}
	.node-tooltip{position:absolute;transform:translate(-50%,-100%);width:240px;max-width:calc(100% - 20px);border:1px solid var(--chat-border);border-radius:12px;padding:10px 12px;background:var(--chat-surface);box-shadow:var(--tone-shadow);pointer-events:none;z-index:2;font-size:13px;overflow-wrap:anywhere}.node-tooltip strong{display:block;font-weight:600}.node-tooltip span{display:block;margin-top:4px;font-size:11px;color:var(--chat-fg-muted)}.empty-graph{position:absolute;top:35%;width:100%;text-align:center;font-size:13px;color:var(--chat-fg);padding:16px}.empty-graph button{border:1px solid var(--chat-border);border-radius:8px;padding:8px 12px;min-height:44px;background:var(--chat-surface)}.connection-banner{margin:0;padding:8px 22px;font-size:12px;color:var(--chat-fg);background:var(--chat-surface-2)}.loading-shape{display:block;width:120px;height:32px;margin:0 auto 16px;background:var(--chat-surface-2);border-radius:16px}
	.graph-footer{padding:12px 22px 16px;display:flex;flex-wrap:wrap;justify-content:space-between;gap:12px;font-size:11px;color:var(--chat-fg);border-top:1px solid var(--chat-border)}.legend{display:flex;flex-wrap:wrap;gap:12px}.legend span{display:flex;align-items:center;gap:5px}.legend i{width:18px;border-top:2px solid var(--graph-working)}.legend .foundWhile{border-top:2px dotted var(--graph-waiting)}.legend .blockedBy{border-color:var(--graph-blocked)}.legend .related{border-top:2px dashed var(--graph-review)}.legend .working{border-top:2px dashed var(--graph-working)}
	@keyframes arrive{from{opacity:0}to{opacity:1}}@keyframes busy{0%,100%{transform:rotate(-2deg)}50%{transform:rotate(2deg) translateY(-2px)}}@keyframes typing{to{transform:translateY(1.5px) rotate(2deg)}}@keyframes breathe{50%{transform:scale(1.025) translateY(-1px)}}@keyframes blink{0%,43%,47%,100%{transform:scaleY(1)}45%{transform:scaleY(.15)}}@keyframes attention{50%{opacity:.7;stroke-width:3.5}}@keyframes report{25%{fill:var(--graph-working);r:7}100%{r:4}}@keyframes spark{0%{opacity:0}15%,80%{opacity:1}100%{opacity:0}}
	@media(max-width:640px){.graph-toolbar{gap:10px;padding:10px}.read-only{display:none}.graph-heading{padding:16px 16px 10px}.graph-heading h2{font-size:23px}.graph-heading span{font-size:11px}.graph-controls{gap:3px}.graph-footer{padding:10px 12px;flex-direction:column;gap:6px}.gesture-hint{display:block}.legend{gap:8px;font-size:9px}}
	@media(prefers-reduced-motion:reduce){.graph-stage,.node-position,.busy,.resting,.eye,.working-hands,.attention-halo,.reporting .antenna-tip,.report-spark{animation:none}.dimmed,.node-position{transition:none}.report-spark{display:none}}
</style>
