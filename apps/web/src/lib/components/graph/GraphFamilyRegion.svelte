<script lang="ts">
	import type { TaskFamilyRegion } from '#lib/task-graph-families.js';
	import type { familySummary } from '#lib/task-graph-cards.js';
	let {family, summary, zoom, tabIndex=-1, onfocus, onkeydown, onenter}: {
		family:TaskFamilyRegion; summary:ReturnType<typeof familySummary>; zoom:number; tabIndex?:number;
		onfocus:(id:string)=>void; onkeydown:(event:KeyboardEvent,id:string)=>void; onenter:()=>void;
	} = $props();
</script>
<div class="region" style="transform:translate({family.bounds.x}px,{family.bounds.y}px);width:{family.bounds.width}px;height:{family.bounds.height}px" aria-hidden="true"></div>
<button class="family-header" style="transform:translate({family.header.x+16}px,{family.header.y+8}px);width:{family.header.width-32}px;height:{family.header.height-8}px"
	data-focus-id={'family:'+family.id} tabindex={tabIndex} aria-label={`${summary.title}, ${summary.progress}, ${summary.needsYou} need you`}
	onfocus={()=>onfocus('family:'+family.id)} onkeydown={e=>onkeydown(e,'family:'+family.id)} onclick={onenter}>
	<strong style:font-size="{Math.max(16,14/zoom)}px">{summary.title}</strong>
	<span style:font-size="{Math.max(14,12/zoom)}px">{summary.progress} · {summary.needsYou} need you</span>
	<div class="status-bar" aria-hidden="true">{#each summary.statuses.filter(s=>s.count) as status}<i style="flex:{status.count};background:{status.tone}"></i>{/each}</div>
</button>
<style>
	.region{position:absolute;top:0;left:0;border-radius:40px;background:color-mix(in srgb,var(--tone-accent-1) 5%,var(--chat-bg));border:1px solid color-mix(in srgb,var(--tone-accent-1) 16%,transparent);pointer-events:none}.region:nth-of-type(even){background:color-mix(in srgb,var(--tone-ring) 5%,var(--chat-bg))}.family-header{position:absolute;top:0;left:0;border:0;background:transparent;color:var(--chat-fg);padding:0;text-align:left;cursor:pointer;border-radius:12px;line-height:1.3}.family-header strong{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:700}.family-header span{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:3px}.status-bar{display:flex;gap:2px;height:5px;margin-top:8px;overflow:hidden;border-radius:4px}.family-header:focus-visible{outline:4px solid var(--chat-fg);outline-offset:4px}
</style>
