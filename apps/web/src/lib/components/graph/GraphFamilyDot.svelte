<script lang="ts">
	import type { familySummary } from '#lib/task-graph-cards.js';
	let {id,summary,tabIndex=-1,matching=false,dimmed=false,onenter,onfocus,onkeydown}: {id:string; summary:ReturnType<typeof familySummary>;tabIndex?:number;matching?:boolean;dimmed?:boolean;onenter:()=>void;onfocus:(id:string)=>void;onkeydown:(event:KeyboardEvent,id:string)=>void}=$props();
</script>
<button class="family-dot" class:matching class:dimmed data-focus-id={'family:'+id} tabindex={tabIndex} onclick={onenter} onfocus={()=>onfocus('family:'+id)} onkeydown={e=>onkeydown(e,'family:'+id)} aria-label={`${summary.title}, ${summary.count} tasks, ${summary.progress}, ${summary.needsYou} need you. Zoom into family.`}>
	<span class="blob" aria-hidden="true">{summary.count}<i>{summary.needsYou}</i></span>
	<strong>{summary.title}</strong><span>{summary.progress}</span><span>{summary.needsYou} need you</span>
	<div class="status-bar" aria-hidden="true">{#each summary.statuses.filter(s=>s.count) as status}<i style="flex:{status.count};background:{status.tone}"></i>{/each}</div>
</button>
<style>
	.family-dot{border:0;border-radius:28px;padding:14px 10px;background:transparent;color:var(--chat-fg);cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:4px;min-height:150px;min-width:0;font-size:12px;line-height:1.35}.blob{display:grid;place-items:center;position:relative;width:52px;height:48px;border-radius:46% 54% 60% 40%;border:2px solid var(--tone-accent-1);background:color-mix(in srgb,var(--tone-accent-1) 16%,var(--chat-bg));font-size:18px;font-weight:700}.blob i{position:absolute;right:-8px;top:-7px;border-radius:50%;background:var(--chat-bg);border:2px solid var(--tone-ring);font-style:normal;min-width:24px;min-height:24px;display:grid;place-items:center;font-size:12px}.family-dot.matching .blob{outline:3px solid var(--match-tone);outline-offset:4px}.family-dot.dimmed .blob{filter:grayscale(1)}.family-dot strong{font-size:14px;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.family-dot:hover{background:color-mix(in srgb,var(--tone-accent-1) 7%,var(--chat-bg))}.family-dot:focus-visible{outline:3px solid var(--chat-fg);outline-offset:-3px}.status-bar{display:flex;gap:2px;width:85px;height:4px;margin-top:3px;border-radius:4px;overflow:hidden}
</style>
