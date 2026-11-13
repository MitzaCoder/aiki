<script lang="ts">
	import PlayIcon from '@lucide/svelte/icons/play';
	import type { HarnessClient } from '@kemiri/client';
	import type { Artifact } from '@kemiri/protocol';
	import { formatMediaDuration, MEDIA_RETRY_LIMIT } from '#lib/artifacts.js';
	import { useArtifactSource } from '#lib/artifacts.svelte.js';
	import { inView } from '#lib/in-view.js';
	import ArtifactKindIcon from './ArtifactKindIcon.svelte';

	/**
	 * A small picture of an artifact: the image itself, a video's first frame (a muted `<video preload=metadata>` paused
	 * at its start), or the kind's icon for the rest. It asks for its URL only once it scrolls near the viewport.
	 */
	let {
		artifact,
		client,
		class: className = '',
		duration = true,
		play = true
	}: {
		artifact: Artifact;
		client: HarnessClient;
		class?: string;
		/** A video's or audio's length in the corner. */
		duration?: boolean;
		/** A play glyph over a video. */
		play?: boolean;
	} = $props();

	let visible = $state(false);
	let failures = $state(0);
	let ready = $state(false);
	const pictured = $derived(artifact.kind === 'image' || artifact.kind === 'video');
	const source = useArtifactSource(() =>
		visible && pictured ? { client, projectId: artifact.projectId, artifactId: artifact.id } : undefined
	);
	const url = $derived(source.current?.url);
	const length = $derived(duration ? formatMediaDuration(artifact.durationSeconds) : '');

	async function failed(): Promise<void> {
		ready = false;
		if (failures >= MEDIA_RETRY_LIMIT) return;
		failures += 1;
		await source.current?.recover();
	}
</script>

<span
	class="artifact-thumb relative grid shrink-0 place-items-center overflow-hidden {className}"
	data-kind={artifact.kind}
	use:inView={() => (visible = true)}
>
	{#if !ready || !pictured}
		<ArtifactKindIcon kind={artifact.kind} class="size-[38%] max-h-7 max-w-7 min-h-3.5 min-w-3.5 opacity-80" />
	{/if}
	{#if url !== undefined && artifact.kind === 'image'}
		<img
			src={url}
			alt=""
			loading="lazy"
			decoding="async"
			draggable="false"
			class="absolute inset-0 size-full object-cover transition-opacity duration-300"
			class:opacity-0={!ready}
			onload={() => {
				ready = true;
				failures = 0;
			}}
			onerror={failed}
		/>
	{:else if url !== undefined && artifact.kind === 'video'}
		<!-- A fragment start makes mobile browsers paint the first frame instead of black. -->
		<video
			src="{url}#t=0.1"
			preload="metadata"
			muted
			playsinline
			disablepictureinpicture
			disableremoteplayback
			tabindex="-1"
			aria-hidden="true"
			class="pointer-events-none absolute inset-0 size-full object-cover transition-opacity duration-300"
			class:opacity-0={!ready}
			onloadeddata={() => {
				ready = true;
				failures = 0;
			}}
			onerror={failed}
		></video>
	{/if}
	{#if artifact.kind === 'video' && play}
		<span class="play-glyph absolute grid place-items-center rounded-full"><PlayIcon class="size-[55%] translate-x-[6%] fill-current" /></span>
	{/if}
	{#if length}
		<span class="duration absolute right-1 bottom-1 rounded px-1 font-mono text-[0.625rem] leading-4 tabular-nums">{length}</span>
	{/if}
</span>

<style>
	.artifact-thumb {
		color: var(--kind-color);
		background:
			radial-gradient(120% 90% at 20% 10%, color-mix(in oklab, var(--kind-color) 22%, transparent), transparent 70%),
			color-mix(in oklab, var(--kind-color) 8%, var(--chat-surface-2));
		--kind-color: var(--accent-2);
	}
	.artifact-thumb[data-kind='image'] {
		--kind-color: var(--accent-3, var(--accent-2));
	}
	.artifact-thumb[data-kind='audio'] {
		--kind-color: var(--accent-4, var(--accent-2));
	}
	.artifact-thumb[data-kind='text'],
	.artifact-thumb[data-kind='file'] {
		--kind-color: var(--chat-fg-muted);
	}
	.play-glyph {
		width: min(2.25rem, 42%);
		aspect-ratio: 1;
		color: white;
		background: rgb(0 0 0 / 0.45);
		backdrop-filter: blur(6px);
		box-shadow: 0 0 0 1px rgb(255 255 255 / 0.25);
	}
	.duration {
		color: white;
		background: rgb(0 0 0 / 0.6);
	}
</style>
