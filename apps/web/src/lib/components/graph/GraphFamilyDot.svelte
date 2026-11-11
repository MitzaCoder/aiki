<script lang="ts">
	import type { familySummary } from '#lib/task-graph-cards.js';
	import type { FamilyDotTarget } from '#lib/task-graph-family-dots.js';
	let {target,summary,tabIndex=-1,matching=false,dimmed=false,onenter,onfocus,onkeydown}: {
		target:FamilyDotTarget;summary:ReturnType<typeof familySummary>;tabIndex?:number;matching?:boolean;dimmed?:boolean;
		onenter:()=>void;onfocus:(id:string)=>void;onkeydown:(event:KeyboardEvent,id:string)=>void;
	}=$props();
</script>
<button class="family-dot" class:matching class:dimmed class:compact={target.compact}
	style="transform:translate({target.x}px,{target.y}px);width:{target.width}px;height:{target.height}px"
	data-family-dot={target.id} data-anchor-x={target.anchorX} data-anchor-y={target.anchorY} data-focus-id={'family:'+target.id} tabindex={tabIndex}
	onclick={onenter} onfocus={()=>onfocus('family:'+target.id)} onkeydown={e=>onkeydown(e,'family:'+target.id)}
	aria-label={`${summary.title}, ${summary.count} tasks, ${summary.progress}, ${summary.needsYou} need you. Zoom into family.`}>
	<span class="blob" aria-hidden="true">{summary.count}<i title={`${summary.needsYou} need you`}>{summary.needsYou}</i></span>
	<strong>{summary.title}</strong>
	{#if !target.compact}<span>{summary.progress}</span><span>{summary.needsYou} need you</span>
		<div class="status-bar" aria-hidden="true">{#each summary.statuses.filter(s=>s.count) as status}<i style="flex:{status.count};background:{status.tone}"></i>{/each}</div>
	{/if}
</button>
<style>
	.family-dot{position:absolute;left:0;top:0;border:0;border-radius:12px;padding:0;background:transparent;color:var(--chat-fg);cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:3px;font-size:12px;line-height:15px;outline:none;touch-action:none}
	.blob{display:grid;place-items:center;position:relative;width:36px;height:36px;flex-shrink:0;box-sizing:border-box;border-radius:46% 54% 60% 40%;border:2px solid var(--tone-accent-1);background:color-mix(in srgb,var(--tone-accent-1) 16%,var(--chat-bg));font-size:16px;font-weight:700}.blob i{position:absolute;right:-8px;top:-7px;border-radius:50%;background:var(--chat-bg);border:2px solid var(--tone-ring);font-style:normal;min-width:20px;height:20px;display:grid;place-items:center;font-size:12px;box-sizing:border-box}
	.family-dot strong{display:block;width:100%;font-size:14px;line-height:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:650;text-shadow:0 1px var(--chat-bg)}.family-dot>span:not(.blob){white-space:nowrap}.family-dot.matching .blob{outline:3px solid var(--match-tone);outline-offset:4px}.family-dot.dimmed .blob{filter:grayscale(1)}.family-dot:focus-visible{outline:3px solid var(--chat-fg);outline-offset:3px}.family-dot:hover .blob{outline:2px solid var(--chat-fg);outline-offset:2px}.status-bar{display:flex;gap:2px;width:85px;height:4px;margin-top:1px;border-radius:4px;overflow:hidden;flex-shrink:0}
</style>
