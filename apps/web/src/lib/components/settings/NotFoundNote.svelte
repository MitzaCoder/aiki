<script lang="ts">
	import type { Snippet } from 'svelte';

	/** A settings page that has nothing to show: an unknown backend, a project that is gone, still loading. */
	let { title, children }: { title: string; children: Snippet } = $props();
</script>

<div class="flex flex-col gap-2 rounded-2xl bg-card p-5 text-sm ring-1 ring-foreground/10" role="status">
	<h2 class="text-base font-semibold">{title}</h2>
	<div class="text-muted-foreground">{@render children()}</div>
</div>
