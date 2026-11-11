<script lang="ts">
	import { GRAPH_STATUSES, GRAPH_REASONS, type GraphModel } from '#lib/task-graph-model.js';
	let { model, active, onchange }: { model: GraphModel; active: string | null; onchange: (key: string) => void } = $props();
</script>
<div class="summary" aria-label="Graph summary">
	<div class="counters" role="group" aria-label="Status counts, including closed tasks, excluding archived">
		<span class="caption">Status</span>
		{#each GRAPH_STATUSES as status}
			<button aria-pressed={active === `status:${status.key}`} aria-label={`${status.label}: ${model.statusCounts[status.key]} tasks, including closed. Highlight matching tasks`} onclick={() => onchange(`status:${status.key}`)}><b style:color={status.tone} aria-hidden="true">{status.mark}</b> {status.label} <strong>{model.statusCounts[status.key]}</strong></button>
		{/each}
	</div>
	<div class="counters" role="group" aria-label="Needs you reasons, overlapping task counts">
		<span class="caption">Needs you</span>
		{#each GRAPH_REASONS as reason}
			<button aria-pressed={active === `reason:${reason.key}`} aria-label={`${reason.label}: ${model.reasonCounts[reason.key]} tasks. Reasons overlap. Highlight matching tasks`} onclick={() => onchange(`reason:${reason.key}`)}><b style:color={reason.tone} aria-hidden="true">{reason.mark}</b> {reason.label} <strong>{model.reasonCounts[reason.key]}</strong></button>
		{/each}
	</div>
	<p>Counts include closed, not archived. Reasons overlap; do not add them together.{#if model.unassignedQuestions.length} {model.unassignedQuestions.length} open questions have no task; see List.{/if}</p>
</div>
<style>
	.summary{padding:0 22px 8px;font-size:12px}.counters{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:6px}.caption{font-weight:600;min-width:72px}button{display:inline-flex;align-items:center;gap:6px;padding:5px 8px;min-height:28px;border:1px solid var(--chat-border);border-radius:8px;background:var(--chat-surface);color:var(--chat-fg)}button[aria-pressed=true]{outline:2px solid var(--chat-fg);outline-offset:0;background:var(--chat-surface-2)}button:focus-visible{outline:3px solid var(--chat-fg);outline-offset:2px}b{font-size:15px}p{margin:2px 0;color:var(--chat-fg-muted);font-size:11px}
	@media(max-width:640px){.summary{padding:0 12px 6px}.counters{flex-wrap:nowrap;overflow-x:auto;padding:3px}.caption{min-width:65px}button{flex-shrink:0;min-height:44px}p{font-size:11px}}
</style>
