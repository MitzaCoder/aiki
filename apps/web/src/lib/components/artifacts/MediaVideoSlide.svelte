<script lang="ts">
	import type { HarnessClient } from '@kemiri/client';
	import type { Artifact } from '@kemiri/protocol';
	import ArtifactThumb from './ArtifactThumb.svelte';
	import ArtifactVideo from './ArtifactVideo.svelte';

	/**
	 * A video in a slide: the existing player (resume place, speed, controls) once the slide is near the one showing, its
	 * first frame before that. It pauses when the slide stops being the active one. The parent is a size container
	 * (`container-type: size`) the player fits into.
	 */
	let {
		artifact,
		client,
		active,
		near,
		autoplay = false
	}: {
		artifact: Artifact;
		client: HarnessClient;
		active: boolean;
		/** Close enough to the active slide to mount a player. */
		near: boolean;
		autoplay?: boolean;
	} = $props();

	let video = $state<ArtifactVideo>();

	$effect(() => {
		if (!active) video?.pause();
	});

	/** Whether the video is playing now, for the viewer to carry on. */
	export function isPlaying(): boolean {
		return video?.isPlaying() === true;
	}
</script>

{#if near}
	<ArtifactVideo bind:this={video} {artifact} {client} {autoplay} theater />
{:else}
	<ArtifactThumb {artifact} {client} class="size-full" duration={false} />
{/if}
