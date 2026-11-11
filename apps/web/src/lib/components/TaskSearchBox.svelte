<script lang="ts">
	let { query, onchange }: { query: string; onchange: (query: string) => void } = $props();
</script>
<div class="flex items-center gap-2 px-1">
	<input type="search" aria-label="Search tasks" placeholder="Search tasks…" value={query}
		class="h-9 min-w-0 flex-1 rounded-lg border border-(--chat-border) bg-(--chat-bg) px-3 text-base text-(--chat-fg) outline-none focus:border-(--accent-2)"
		oninput={(event) => onchange(event.currentTarget.value)} onkeydown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onchange(''); } }} />
	{#if query}<button type="button" class="text-xs text-(--chat-fg-muted)" onclick={() => onchange('')}>Clear</button>{/if}
</div>
