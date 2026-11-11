<script lang="ts">
	import { graphSummaryCounters, type GraphModel } from '#lib/task-graph-model.js';
	let { model, active, onchange }: { model: GraphModel; active: string | null; onchange: (key: string) => void } = $props();
	const counters = $derived(graphSummaryCounters(model));
	const description = $derived(`Counts include closed, not archived. Needs-you reasons overlap; do not add them together. Quiet means no task update for 48 hours.${model.unassignedQuestions.length ? ` ${model.unassignedQuestions.length} open questions have no task; see List.` : ''}`);
</script>
<div class="summary" role="group" aria-label="Task counts and needs-you reasons" aria-describedby="graph-count-description" title={description}>
	<span id="graph-count-description" class="sr-only">{description}</span>
	<span class="caption">Needs you</span>
	{#each counters as counter}
		{#if counter.key === 'status:in_progress'}<span class="separator" aria-hidden="true"></span>{/if}
		<button aria-pressed={active === counter.key} aria-label={`${counter.label}: ${counter.count} tasks. Highlight matching tasks`} onclick={() => onchange(counter.key)}>
			<b style:color={counter.tone} aria-hidden="true">{counter.mark}</b> {counter.label} <strong>{counter.count}</strong>
		</button>
	{/each}
</div>
<style>
	.summary{display:flex;align-items:center;gap:6px;flex-shrink:0;overflow-x:auto;scrollbar-width:none;padding:6px 16px;font-size:12px;border-bottom:1px solid var(--chat-border)}
	.summary::-webkit-scrollbar{display:none}.caption{font-weight:600;white-space:nowrap;margin-right:3px}.separator{border-left:1px solid var(--chat-border);height:20px;margin:0 3px}
	button{display:inline-flex;align-items:center;gap:5px;flex-shrink:0;padding:4px 8px;min-height:30px;border:1px solid var(--chat-border);border-radius:8px;background:var(--chat-surface);color:var(--chat-fg)}
	button[aria-pressed=true]{outline:2px solid var(--chat-fg);outline-offset:-2px;background:var(--chat-surface-2)}button:focus-visible{outline:3px solid var(--chat-fg);outline-offset:-3px}b{font-size:15px}
	@media(max-width:640px){.summary{padding:5px 10px}button{min-height:44px}}
</style>
