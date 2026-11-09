<script lang="ts">
	import { Button } from '#lib/components/ui/button/index.js';
	import Banner from '#lib/components/Banner.svelte';
	import { harness } from '#lib/harness.svelte.js';
	import type { PublishedBackend } from '#lib/published-backends.js';

	/**
	 * The published backends this browser does not have yet, each one tap away. Adding starts the connection at once;
	 * a backend already added is skipped, so "Add all" is safe to press twice.
	 */
	let { backends }: { backends: readonly PublishedBackend[] } = $props();

	let error = $state<string | undefined>(undefined);

	function addOne(entry: PublishedBackend): void {
		addAll([entry]);
	}

	function addAll(entries: readonly PublishedBackend[]): void {
		error = undefined;
		for (const entry of entries) {
			if (harness.backends.some((backend) => backend.url === entry.url)) continue;
			try {
				harness.addBackend(entry.name, entry.url);
			} catch (value) {
				error = value instanceof Error ? value.message : String(value);
			}
		}
	}
</script>

<div class="flex flex-col gap-2" data-testid="suggested-backends">
	{#each backends as entry (entry.url)}
		<div class="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2">
			<div class="flex min-w-0 flex-1 flex-col">
				<span class="font-medium" data-testid="suggested-name">{entry.name}</span>
				<span class="font-mono text-xs break-words text-muted-foreground" data-testid="suggested-url">{entry.url}</span>
			</div>
			<Button size="sm" type="button" onclick={() => addOne(entry)}>Add</Button>
		</div>
	{/each}
	{#if backends.length > 1}
		<div>
			<Button variant="outline" size="sm" type="button" onclick={() => addAll(backends)}>
				Add all ({backends.length})
			</Button>
		</div>
	{/if}
	{#if error}
		<Banner tone="error">{error}</Banner>
	{/if}
</div>
