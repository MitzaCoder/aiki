<script lang="ts">
	import type { GraphSearchResult, GraphModel } from '#lib/task-graph-model.js';
	let { query = $bindable(''), results, model, onselect }: { query: string; results: GraphSearchResult[]; model: GraphModel; onselect: (id: string) => void } = $props();
	let open = $state(false);
	let expanded = $state(false);
	let activeIndex = $state(0);
	let input: HTMLInputElement | null = $state(null);
	$effect(() => {query; activeIndex = 0;});
	function choose(index: number) {
		const result = results[index];
		if (!result) return;
		onselect(result.taskId);
		open = false;
		expanded = false;
	}
	function keydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault(); event.stopPropagation(); open = false; expanded = false;
		} else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			const direction = event.key === 'ArrowDown' ? 1 : -1;
			activeIndex = !open ? (direction > 0 ? 0 : Math.max(0, results.length - 1)) : (activeIndex + direction + results.length) % Math.max(1, results.length);
			open = true;
			queueMicrotask(() => document.getElementById(`graph-result-${activeIndex}`)?.scrollIntoView({block:'nearest'}));
		} else if (event.key === 'Enter') {
			event.preventDefault(); choose(activeIndex);
		}
	}
</script>
<svelte:window onpointerdown={(event) => {if (!(event.target instanceof Element) || !event.target.closest('[data-graph-search]')) open = false;}}/>
<div class="graph-search" data-graph-search data-search-open={open} class:expanded>
	<button class="search-toggle" aria-label="Search tasks" aria-expanded={expanded} onclick={() => {expanded = !expanded; if(expanded) queueMicrotask(() => input?.focus());}}>⌕</button>
	<div class="search-field">
		<label for="graph-search" class="sr-only">Find a task, family, worker or thread</label>
		<input bind:this={input} id="graph-search" type="search" role="combobox" bind:value={query} placeholder="Find work…" aria-expanded={open && !!query.trim()} aria-controls="graph-search-results" aria-autocomplete="list" aria-activedescendant={open && results.length ? `graph-result-${activeIndex}` : undefined} oninput={() => open = true} onfocus={() => open = true} onkeydown={keydown}/>
	</div>
	{#if open && query.trim()}
		<div class="results-popover">
			<p role="status">{results.length} results · ↑ ↓ to browse, Enter to focus</p>
			<div id="graph-search-results" role="listbox" aria-label="Matching tasks">
				{#each results as result, index}
					<button id="graph-result-{index}" role="option" aria-selected={activeIndex === index} tabindex="-1" onclick={() => choose(index)} onpointermove={() => activeIndex = index}>
						<strong>{result.taskId}</strong> {model.details.get(result.taskId)?.task.title}<small>{result.matched}</small>
					</button>
				{/each}
			</div>
			{#if !results.length}<p>No matching tasks. Try a task ID, family or worker name.</p>{/if}
		</div>
	{/if}
</div>
<style>
	.graph-search{position:relative;flex:0 1 300px;margin-left:auto;min-width:100px;z-index:10}.search-toggle{display:none}.search-field input{width:100%;min-height:32px;padding:6px 10px;border:1px solid var(--chat-border);border-radius:9px;background:var(--chat-surface);color:var(--chat-fg);font-size:13px}input::placeholder{color:var(--graph-muted)}input:focus-visible,button:focus-visible{outline:3px solid var(--chat-fg);outline-offset:-2px}.results-popover{position:absolute;right:0;top:calc(100% + 6px);width:360px;max-width:calc(100vw - 24px);max-height:min(50vh,380px);overflow:auto;padding:6px;border:1px solid var(--chat-border);border-radius:12px;background:var(--chat-surface);box-shadow:var(--tone-shadow);font-size:13px}.results-popover p{margin:6px;padding:3px;color:var(--graph-muted);font-size:12px}.results-popover button{display:block;text-align:left;width:100%;padding:8px;border-radius:7px;min-height:44px;color:var(--chat-fg)}.results-popover button[aria-selected=true]{background:var(--chat-surface-2);outline:1px solid var(--graph-muted)}small{display:block;color:var(--graph-muted);font-size:11px;margin-top:2px}
	@media(max-width:640px){.graph-search{flex:0 0 44px;min-width:44px}.search-toggle{display:block;width:44px;height:44px;font-size:25px;border:1px solid var(--chat-border);border-radius:9px;background:var(--chat-surface);color:var(--chat-fg)}.search-field{display:none}.expanded .search-field{display:block;position:absolute;right:0;top:0;width:min(360px,calc(100vw - 24px))}.search-field input{min-height:44px}.results-popover{top:50px}}
</style>
