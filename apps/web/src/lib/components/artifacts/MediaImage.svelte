<script lang="ts">
	import type { HarnessClient } from '@aiki/client';
	import type { Artifact } from '@aiki/protocol';
	import { artifactTitle, MEDIA_RETRY_LIMIT } from '#lib/artifacts.js';
	import { useArtifactSource } from '#lib/artifacts.svelte.js';
	import ArtifactKindIcon from './ArtifactKindIcon.svelte';

	/**
	 * An image in a carousel slide, fitted into the slide and faded in when it has loaded. Slides far from the active one
	 * (`near` false) do not ask for it and show a tinted tile, so a long carousel loads a handful of images, not all.
	 * A click on the active one calls `onopen` (the viewer); the keyboard has the slide's expand button.
	 */
	let {
		artifact,
		client,
		near,
		active,
		onopen
	}: {
		artifact: Artifact;
		client: HarnessClient;
		near: boolean;
		active: boolean;
		onopen: () => void;
	} = $props();

	const source = useArtifactSource(() => (near ? { client, projectId: artifact.projectId, artifactId: artifact.id } : undefined));
	const url = $derived(source.current?.url);
	let ready = $state(false);
	let failures = 0;

	async function failed(): Promise<void> {
		ready = false;
		if (failures >= MEDIA_RETRY_LIMIT) return;
		failures += 1;
		await source.current?.recover();
	}
</script>

<!-- A pointer shortcut for what the slide's expand button does for a keyboard. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="frame" class:active onclick={onopen} data-media-image>
	{#if !ready}
		<span class="tile grid place-items-center" aria-hidden="true"><ArtifactKindIcon kind="image" class="size-8 opacity-60" /></span>
	{/if}
	{#if url !== undefined}
		<img
			src={url}
			alt={artifactTitle(artifact)}
			class="picture"
			class:ready
			draggable="false"
			decoding="async"
			fetchpriority={active ? 'high' : 'low'}
			data-slide-image
			onload={() => {
				ready = true;
				failures = 0;
			}}
			onerror={failed}
		/>
	{/if}
</div>

<style>
	.frame {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
	}
	.frame.active {
		cursor: zoom-in;
	}
	.tile {
		position: absolute;
		inset: 0;
		color: var(--accent-3, var(--accent-2));
		background: radial-gradient(120% 90% at 20% 10%, color-mix(in oklab, var(--accent-3, var(--accent-2)) 18%, transparent), transparent 70%);
	}
	.picture {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: contain;
		opacity: 0;
		transition: opacity 260ms ease;
	}
	.picture.ready {
		opacity: 1;
	}
</style>
