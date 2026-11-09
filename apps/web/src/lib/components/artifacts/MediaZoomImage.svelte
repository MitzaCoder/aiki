<script lang="ts">
	import type { HarnessClient } from '@mihai-harness/client';
	import type { Artifact } from '@mihai-harness/protocol';
	import { MEDIA_RETRY_LIMIT, ZOOM_FIT, type Zoom } from '#lib/artifacts.js';
	import { useArtifactSource } from '#lib/artifacts.svelte.js';
	import ArtifactKindIcon from './ArtifactKindIcon.svelte';
	import ZoomPane from './ZoomPane.svelte';

	/** An image in a viewer slide: asks for its URL when `near`, then a `ZoomPane` (zoom, pan, swipe down to dismiss). */
	let {
		artifact,
		client,
		near,
		active,
		pull = $bindable(0),
		onzoom,
		onpane,
		onready,
		ondismiss
	}: {
		artifact: Artifact;
		client: HarnessClient;
		near: boolean;
		active: boolean;
		pull?: number;
		/** The zoom changed (the viewer's toolbar shows it). */
		onzoom?: (zoom: Zoom) => void;
		/** The pane to zoom with the toolbar's buttons; null when it goes away. */
		onpane?: (pane: ZoomPane | null) => void;
		onready?: () => void;
		ondismiss?: (pull: number) => void;
	} = $props();

	const source = useArtifactSource(() => (near ? { client, projectId: artifact.projectId, artifactId: artifact.id } : undefined));
	const url = $derived(source.current?.url);
	let failures = 0;
	let ready = $state(false);
	let zoom = $state<Zoom>(ZOOM_FIT);
	let pane = $state<ZoomPane | null>(null);

	$effect(() => onzoom?.(zoom));
	$effect(() => {
		const current = pane;
		onpane?.(current);
		return () => onpane?.(null);
	});

	async function failed(): Promise<void> {
		if (failures >= MEDIA_RETRY_LIMIT) return;
		failures += 1;
		await source.current?.recover();
	}
</script>

{#if url !== undefined}
	<ZoomPane
		bind:this={pane}
		src={url}
		alt={artifact.title?.trim() || artifact.name}
		{active}
		swipeAcross
		bind:zoom
		bind:pull
		onready={() => {
			ready = true;
			failures = 0;
			onready?.();
		}}
		onerror={failed}
		{ondismiss}
	/>
{/if}
{#if !ready}
	<span class="absolute inset-0 grid place-items-center text-white/50" aria-hidden="true"><ArtifactKindIcon kind="image" class="size-8" /></span>
{/if}
