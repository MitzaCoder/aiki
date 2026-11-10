<script lang="ts">
	import type { HarnessClient } from '@aiki/client';
	import type { Artifact } from '@aiki/protocol';
	import { splitMedia } from '#lib/media-gallery.js';
	import ArtifactDialog from './ArtifactDialog.svelte';
	import ArtifactList from './ArtifactList.svelte';
	import MediaGallery from './MediaGallery.svelte';

	/**
	 * The body of a task's Files section: its photos and videos as the media carousel (`MediaGallery`) and every other file
	 * (logs, text, reports) as the simple list under it. `onupdatetags` is given only when the backend can change tags.
	 */
	let {
		artifacts,
		client,
		projectId,
		onupdatetags
	}: {
		artifacts: readonly Artifact[];
		client: HarnessClient;
		projectId: string;
		onupdatetags?: (artifact: Artifact, tags: string[]) => Promise<void>;
	} = $props();

	const split = $derived(splitMedia(artifacts));
	let detailsId = $state<string | undefined>(undefined);
	let detailsOpen = $state(false);
	const details = $derived(artifacts.find((artifact) => artifact.id === detailsId));
</script>

<div class="flex min-w-0 flex-col gap-3" data-task-files>
	{#if split.media.length > 0}
		<MediaGallery
			media={split.media}
			{client}
			{projectId}
			canEditTags={onupdatetags !== undefined}
			{onupdatetags}
			ondetails={(artifact) => {
				detailsId = artifact.id;
				detailsOpen = true;
			}}
		/>
	{/if}
	{#if split.files.length > 0}
		<ArtifactList {client} {projectId} items={split.files} layout="rows" collapsedCount={4} emptyText="" />
	{/if}
</div>

<ArtifactDialog artifact={details} {client} bind:open={detailsOpen} />
