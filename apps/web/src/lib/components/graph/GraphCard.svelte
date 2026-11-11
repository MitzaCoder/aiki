<script lang="ts">
	import type { GraphModel, GraphTaskDetails } from '#lib/task-graph-model.js';
	import { GRAPH_STATUSES, GRAPH_REASONS } from '#lib/task-graph-model.js';
	import { familyCardLabel, cardProgress } from '#lib/task-graph-cards.js';
	import type { FamilyCard } from '#lib/task-graph-families.js';
	import GraphCreature from './GraphCreature.svelte';
	let {card, details, model, pill=false, selected=false, matching=false, dimmed=false, tabIndex=-1, reports, onselect, onopen, onfocus, onkeydown}: {
		card:FamilyCard; details:GraphTaskDetails; model:GraphModel; pill?:boolean; selected?:boolean; matching?:boolean; dimmed?:boolean;
		tabIndex?:number; reports:Readonly<Record<string,string>>; onselect:(id:string)=>void; onopen:(id:string)=>void;
		onfocus:(id:string)=>void; onkeydown:(event:KeyboardEvent,id:string)=>void;
	} = $props();
	const status=$derived(GRAPH_STATUSES.find(s=>s.key===details.task.status)!);
	const progress=$derived(cardProgress(details,model));
	const box=$derived(pill?card.pillBox:card.box);
	const crew=$derived([
		...details.workers.filter(w=>!['done','stopped'].includes(w.status)).map(w=>({id:w.id,title:w.title,status:w.status,thread:false})),
		...details.threads.filter(t=>!t.main&&!t.archived&&t.status!=='done').map(t=>({id:t.id,title:t.title,status:t.status,thread:true})),
	]);
</script>
<button class="card status-{status.key}" class:pill class:selected class:matching class:dimmed class:closed={['done','dropped'].includes(status.key)}
	style="transform:translate({box.x}px,{box.y}px);width:{box.width}px;height:{box.height}px;--status-tone:{status.tone};--body-height:{card.box.height}px"
	data-card={card.id} data-focus-id={card.id} tabindex={tabIndex} aria-label={familyCardLabel(details,model)} aria-pressed={selected}
	onclick={()=>onselect(card.id)} ondblclick={()=>onopen(card.id)} onfocus={()=>onfocus(card.id)} onkeydown={event=>onkeydown(event,card.id)}>
	{#if pill}
		<span class="pill-mark" aria-hidden="true">{status.mark}</span><span class="pill-title">{card.id} · {details.task.title}</span>
	{:else}
		<div class="body">
			<div class="meta"><b>{card.id}</b><span>{status.mark} {status.label}</span></div>
			<strong class="title">{details.task.title}</strong>
			<div class="reasons">
				{#each details.reasons as reason}{@const mark=GRAPH_REASONS.find(r=>r.key===reason)!}<span title={mark.label} aria-label={mark.label}>{mark.mark}</span>{/each}
				{#if details.quiet}<span title="Quiet: no task update for 48 hours" aria-label="Quiet">◴</span>{/if}
				{#if progress}<span class="progress" title={progress}>{progress.replace(/^(\d+) of (\d+) subtasks done$/, '$1/$2')}</span>{/if}
			</div>
		</div>
		{#if crew.length}<div class="creatures" aria-hidden="true">
			{#each crew.slice(0,3) as creature ((creature.thread?'thread:':'worker:')+creature.id)}<GraphCreature {...creature} reporting={!creature.thread&&!!reports[creature.id]}/>{/each}
			{#if crew.length>3}<span class="extra">+{crew.length-3}</span>{/if}
		</div>{/if}
	{/if}
</button>
<style>
	.card{position:absolute;left:0;top:0;display:block;text-align:left;border:2px solid var(--status-tone);border-left-width:5px;border-radius:13px;padding:0;color:var(--chat-fg);background:color-mix(in srgb,var(--status-tone) 12%,var(--chat-bg));box-shadow:0 2px 7px #0000000a;cursor:pointer;overflow:visible;outline:none;font-size:14px;line-height:1.1}
	.body{height:100%;padding:6px 9px;box-sizing:border-box}.meta{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:14px;line-height:16px}.meta span{font-weight:650}.title{display:-webkit-box;-webkit-line-clamp:2;line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:16px;line-height:17.6px;margin-top:2px;font-weight:650;min-height:35.2px}
	.reasons{display:flex;align-items:center;gap:4px;margin-top:2px;min-height:16px;height:16px}.reasons>span:not(.progress){display:inline-flex;align-items:center;justify-content:center;min-width:16px;height:16px;border:1px solid var(--status-tone);border-radius:4px;background:var(--chat-bg);font-weight:800;box-sizing:border-box}.progress{margin-left:auto;font-size:14px;white-space:nowrap}
	.creatures{position:absolute;top:-12px;right:4px;display:flex;align-items:center;gap:2px;height:24px;pointer-events:none}.creatures :global(.crew){width:22px;height:24px}.creatures :global(.crew.thread){width:27px}.extra{font-weight:700;font-size:14px;padding:2px 3px;border-radius:5px;background:var(--chat-bg)}
	.closed{background:var(--chat-surface);border-style:dashed;box-shadow:none}.dimmed{filter:grayscale(1);box-shadow:none;border-color:var(--chat-fg-muted)}.matching{box-shadow:0 0 0 4px var(--match-tone)}.selected{outline:3px solid var(--chat-fg);outline-offset:5px}.card:focus-visible{outline:4px solid var(--chat-fg);outline-offset:5px;box-shadow:0 0 0 8px var(--chat-bg)}
	.pill{display:flex;align-items:center;gap:10px;padding:0 12px;border-radius:32px;font-size:22px}.pill-mark{font-size:24px;font-weight:800}.pill-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}.card:hover{box-shadow:0 3px 12px #0002}
</style>
