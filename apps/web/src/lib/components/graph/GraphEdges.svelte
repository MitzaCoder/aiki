<script lang="ts">
	import { untrack } from 'svelte';
	import { routeTaskFamilyEdges, type TaskFamilyLayout, type FamilyEdge } from '#lib/task-graph-families.js';
	let {layout, edges, detail}: {layout:TaskFamilyLayout; edges:FamilyEdge[]; detail:'cards'|'pills'}=$props();
	const edgeRevision=$derived(JSON.stringify(edges));
	const routes=$derived.by(()=>{edgeRevision;return routeTaskFamilyEdges(layout,untrack(()=>edges),detail);});
</script>
<svg class="edges" aria-hidden="true" width={Math.max(1,layout.bounds.width+100)} height={Math.max(1,layout.bounds.height+100)}>
	<defs><marker id="family-blocker-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="var(--graph-blocked)"/></marker></defs>
	{#each routes as route (route.id)}<path class={route.kind} d={route.d} marker-end={route.arrow?'url(#family-blocker-arrow)':undefined}/>{/each}
</svg>
<style>
	.edges{position:absolute;left:0;top:0;overflow:visible;pointer-events:none}path{fill:none;stroke:var(--graph-muted);stroke-width:1.5;vector-effect:non-scaling-stroke}.subtask{stroke:var(--graph-subtask);stroke-width:1.4}.found-while{stroke:var(--chat-fg);stroke-dasharray:1 5;stroke-linecap:round}.blocked-by{stroke:var(--graph-blocked);stroke-width:2.5;stroke-dasharray:7 4}.related{stroke:var(--chat-fg);stroke-dasharray:9 4 2 4}
</style>
