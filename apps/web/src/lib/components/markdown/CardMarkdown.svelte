<script lang="ts">
	import Markdown from './Markdown.svelte';

	let { source }: { source: string } = $props();
	let expanded = $state(false);
	const contentId = $props.id();
	const long = $derived(source.length > 600 || source.split('\n').length > 12);
</script>

<div class="min-w-0 max-w-full">
	<div id={contentId} class:card-markdown-folded={long && !expanded}>
		<Markdown {source} userMessage class="md-card" />
	</div>
	{#if long}
		<button type="button" class="mt-1 text-xs font-medium text-(--accent-2) underline-offset-2 hover:underline" aria-expanded={expanded} aria-controls={contentId} onclick={() => expanded = !expanded}>
			{expanded ? 'Show less' : 'Show more'}
		</button>
	{/if}
</div>

<style>
	.card-markdown-folded { max-height: 18rem; overflow: auto; }
</style>
