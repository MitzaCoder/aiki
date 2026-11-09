<script lang="ts">
	import DownloadIcon from '@lucide/svelte/icons/download';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import ZoomInIcon from '@lucide/svelte/icons/zoom-in';
	import type { HarnessClient } from '@mihai-harness/client';
	import type { Artifact } from '@mihai-harness/protocol';
	import { artifactTitle, formatBytes, MEDIA_RETRY_LIMIT } from '#lib/artifacts.js';
	import { downloadArtifact, useArtifactSource } from '#lib/artifacts.svelte.js';
	import ArtifactKindIcon from './ArtifactKindIcon.svelte';
	import ArtifactText from './ArtifactText.svelte';
	import ArtifactVideo from './ArtifactVideo.svelte';
	import ImageLightbox from './ImageLightbox.svelte';

	/**
	 * An artifact shown the way its kind wants: a video plays, an image opens in a zoomable lightbox, audio plays, text is
	 * read in place, and any other file is a download.
	 */
	let {
		artifact,
		client,
		autoplay = false,
		compact = false
	}: {
		artifact: Artifact;
		client: HarnessClient;
		autoplay?: boolean;
		/** In the chat or a list: smaller frames. */
		compact?: boolean;
	} = $props();

	const title = $derived(artifactTitle(artifact));
	const media = $derived(artifact.kind === 'image' || artifact.kind === 'audio');
	const source = useArtifactSource(() =>
		media ? { client, projectId: artifact.projectId, artifactId: artifact.id } : undefined
	);
	const url = $derived(source.current?.url);
	let lightbox = $state(false);
	let failures = 0;
	let downloading = $state(false);
	let downloadError = $state<string | undefined>(undefined);

	async function failed(): Promise<void> {
		if (failures >= MEDIA_RETRY_LIMIT) return;
		failures += 1;
		await source.current?.recover();
	}

	async function download(): Promise<void> {
		downloading = true;
		downloadError = undefined;
		try {
			await downloadArtifact(client, artifact);
		} catch (error) {
			downloadError = error instanceof Error ? error.message : String(error);
		} finally {
			downloading = false;
		}
	}
</script>

{#if artifact.kind === 'video'}
	<ArtifactVideo {artifact} {client} {autoplay} {compact} />
{:else if artifact.kind === 'image'}
	<button
		type="button"
		class="image-frame group relative block w-full overflow-hidden rounded-2xl"
		class:compact
		onclick={() => (lightbox = true)}
		aria-label="View {title} full size"
		disabled={url === undefined}
		data-artifact-image
	>
		{#if url !== undefined}
			<img src={url} alt={title} class="mx-auto block max-h-full max-w-full object-contain" onerror={failed} onload={() => (failures = 0)} />
			<span class="zoom-hint absolute right-2 bottom-2 grid size-8 place-items-center rounded-full bg-black/55 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
				<ZoomInIcon class="size-4" />
			</span>
		{:else}
			<span class="grid aspect-video place-items-center text-(--chat-fg-subtle)"><LoaderCircleIcon class="size-5 animate-spin" /></span>
		{/if}
	</button>
	{#if lightbox && url !== undefined}
		<ImageLightbox src={url} alt={title} {title} ondownload={download} onclose={() => (lightbox = false)} />
	{/if}
{:else if artifact.kind === 'audio'}
	<div class="flex flex-col gap-2 rounded-2xl border border-(--chat-border) bg-(--chat-surface)/60 p-3" data-artifact-audio>
		<div class="flex min-w-0 items-center gap-2.5">
			<span class="grid size-9 shrink-0 place-items-center rounded-xl bg-(--accent-2)/12 text-(--accent-2)"><ArtifactKindIcon kind="audio" /></span>
			<span class="min-w-0 flex-1 truncate text-sm font-medium">{title}</span>
		</div>
		{#if url !== undefined}
			<audio src={url} controls preload="metadata" class="w-full" onerror={failed}></audio>
		{/if}
	</div>
{:else if artifact.kind === 'text'}
	<ArtifactText {artifact} {client} {compact} />
{:else}
	<div class="flex min-w-0 items-center gap-3 rounded-2xl border border-(--chat-border) bg-(--chat-surface)/60 p-3" data-artifact-file>
		<span class="grid size-10 shrink-0 place-items-center rounded-xl bg-(--chat-surface-2) text-(--chat-fg-muted)"><ArtifactKindIcon kind="file" class="size-5" /></span>
		<span class="flex min-w-0 flex-1 flex-col">
			<span class="truncate text-sm font-medium">{artifact.name}</span>
			<span class="truncate text-xs text-(--chat-fg-subtle)">{[artifact.mimeType, formatBytes(artifact.size)].filter(Boolean).join(' · ')}</span>
			{#if downloadError}<span class="text-xs text-(--chat-danger)">{downloadError}</span>{/if}
		</span>
		<button
			type="button"
			class="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-(--accent-2)/12 px-3 py-1.5 text-xs font-medium text-(--accent-2) hover:bg-(--accent-2)/20"
			onclick={download}
			disabled={downloading}
		>
			{#if downloading}<LoaderCircleIcon class="size-3.5 animate-spin" />{:else}<DownloadIcon class="size-3.5" />{/if}
			Download
		</button>
	</div>
{/if}

<style>
	.image-frame {
		max-height: min(70dvh, 40rem);
		background:
			repeating-conic-gradient(color-mix(in oklab, var(--chat-fg) 5%, transparent) 0 25%, transparent 0 50%) 0 0 / 16px 16px,
			var(--chat-surface-2);
		box-shadow: 0 0 0 1px var(--chat-border);
		cursor: zoom-in;
	}
	.image-frame.compact {
		max-height: min(50dvh, 20rem);
	}
	.image-frame img {
		max-height: inherit;
	}
	.image-frame:focus-visible {
		outline: 2px solid var(--accent-2);
		outline-offset: 2px;
	}
</style>
