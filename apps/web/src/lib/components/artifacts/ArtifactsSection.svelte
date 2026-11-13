<script lang="ts">
	import type { ArtifactFilter, HarnessClient } from '@kemiri/client';
	import ArtifactList from './ArtifactList.svelte';

	/**
	 * The Info tab's Artifacts section for one conversation: its artifacts as rows, the newest few until "Show all".
	 * Hidden until there is one, so a conversation without any keeps its Info tab as it was.
	 */
	let {
		client,
		projectId,
		filter
	}: { client: HarnessClient; projectId: string; filter: ArtifactFilter } = $props();

	let count = $state(0);
</script>

<section aria-label="Artifacts" class="flex flex-col gap-1.5" class:hidden={count === 0} data-context-section="artifacts">
	<h3 class="flex items-center gap-1.5 px-1 text-[0.6875rem] font-semibold tracking-wide text-(--chat-fg-subtle) uppercase">
		Artifacts <span class="font-normal normal-case">({count})</span>
	</h3>
	<ArtifactList {client} {projectId} {filter} layout="rows" collapsedCount={4} emptyText="" onloaded={(loaded) => (count = loaded)} />
</section>
