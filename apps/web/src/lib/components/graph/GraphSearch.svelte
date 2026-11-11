<script lang="ts">
	import type { GraphSearchResult, GraphModel } from '#lib/task-graph-model.js';
	let { query = $bindable(''), results, model, onstep, onselect }: { query: string; results: GraphSearchResult[]; model: GraphModel; onstep: (direction: number) => void; onselect: (id: string) => void } = $props();
</script>
<div class="search">
	<label for="graph-search">Find work</label>
	<input id="graph-search" type="search" bind:value={query} placeholder="Task, family, worker or thread" onkeydown={(event) => {if(event.key==='Enter'){event.preventDefault();onstep(event.shiftKey?-1:1);}}}/>
	{#if query.trim()}
		<span role="status">{results.length} results</span>
		<button aria-label="Previous search result" disabled={!results.length} onclick={() => onstep(-1)}>↑</button><button aria-label="Next search result" disabled={!results.length} onclick={() => onstep(1)}>↓</button>
	{/if}
</div>
{#if query.trim()}
	<div class="results" aria-label="Search results">
		{#each results.slice(0, 8) as result}<button onclick={() => onselect(result.taskId)}>{result.taskId} · {model.details.get(result.taskId)?.task.title}<small>{result.matched}</small></button>{/each}
		{#if !results.length}<p role="status">No matching tasks. Try a task ID, family or worker name.</p>{/if}
		{#if results.length > 8}<p>First 8 shown. Enter or arrows visit all {results.length}.</p>{/if}
	</div>
{/if}
<style>
	.search{display:flex;align-items:center;gap:8px;padding:0 22px 10px;font-size:12px}.search label{font-weight:600;white-space:nowrap}input{min-width:80px;flex:1;max-width:420px;border:1px solid var(--chat-border);border-radius:8px;background:var(--chat-surface);color:var(--chat-fg);padding:7px 10px;font-size:13px}input::placeholder{color:var(--chat-fg-muted)}button{min-width:28px;min-height:28px;border:1px solid var(--chat-border);border-radius:7px;background:var(--chat-surface);color:var(--chat-fg)}button:focus-visible,input:focus-visible{outline:3px solid var(--chat-fg);outline-offset:2px}.results{display:flex;gap:6px;overflow:auto;max-height:64px;padding:0 22px 8px;font-size:12px}.results button{max-width:240px;flex-shrink:0;text-align:left;padding:5px 8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.results small{display:block;color:var(--chat-fg-muted)}p{margin:4px 0;color:var(--chat-fg-muted)}
	@media(max-width:640px){.search{padding:0 12px 8px;gap:5px}.search label{position:absolute;width:1px;height:1px;overflow:hidden}.search button{min-width:44px;min-height:44px}input{min-height:44px}.results{padding:0 12px 6px}.results button{min-height:44px}.search span{white-space:nowrap}}
</style>
