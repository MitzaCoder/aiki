<script lang="ts">
	import ArrowLeftRightIcon from '@lucide/svelte/icons/arrow-left-right';
	import ExpandIcon from '@lucide/svelte/icons/maximize-2';
	import type { HarnessClient } from '@aiki/client';
	import type { Artifact } from '@aiki/protocol';
	import { onMount, untrack } from 'svelte';
	import { artifactTitle } from '#lib/artifacts.js';
	import { useArtifactFeed } from '#lib/artifacts.svelte.js';
	import {
		comparePairs,
		containedRect,
		filterByTag,
		loadsFull,
		projectTags,
		resolveTagFilter,
		mediaSlides,
		mediaSlideLabel,
		tagCounts,
		type Rect
	} from '#lib/media-gallery.js';
	import CompareSlider from './CompareSlider.svelte';
	import MediaImage from './MediaImage.svelte';
	import MediaCaption from './MediaCaption.svelte';
	import MediaCarousel from './MediaCarousel.svelte';
	import MediaStrip from './MediaStrip.svelte';
	import MediaVideoSlide from './MediaVideoSlide.svelte';
	import MediaViewer from './MediaViewer.svelte';

	/**
	 * A task's photos and videos as a carousel (design: docs/DESIGN.md "Artifact tags and the task media carousel"): tag chips
	 * that filter it, one large slide at a time with the neighbours peeking, a thumbnail strip, and a caption with the title,
	 * tags and note. An image opens in the full-screen viewer with a shared-element zoom; a video plays in place. A before
	 * slide and its after (`comparePairs`) collapse into a compare view by default. With `canEditTags` the caption edits the tags.
	 * `media` is oldest first (`splitMedia`).
	 */
	let {
		media,
		client,
		projectId,
		canEditTags = false,
		onupdatetags,
		ondetails
	}: {
		media: readonly Artifact[];
		client: HarnessClient;
		projectId: string;
		canEditTags?: boolean;
		/** Replace an artifact's tags on the backend. */
		onupdatetags?: (artifact: Artifact, tags: string[]) => Promise<void>;
		/** The Info button in the caption: open the artifact's full dialog. */
		ondetails?: (artifact: Artifact) => void;
	} = $props();

	let filter = $state<string | null>(null);
	let index = $state(0);
	let anchorId = $state<string | undefined>(undefined);
	let viewerOpen = $state(false);
	let viewerAutoplay = $state(false);
	let separate = $state(false);
	onMount(() => {
		try { separate = localStorage.getItem('aiki.media-separate.v1') === 'true'; } catch { /* Storage can be unavailable. */ }
	});
	let carousel = $state<MediaCarousel | null>(null);
	let videoSlides = $state<Record<number, MediaVideoSlide | undefined>>({});

	// Tags changed here show at once; the pushed row confirms them.
	let pending = $state<Record<string, string[]>>({});
	let busy = $state(false);
	let problem = $state<string | undefined>(undefined);
	let projectWanted = $state(false);

	const tagged = $derived(media.map((item) => (pending[item.id] === undefined ? item : { ...item, tags: pending[item.id] })));
	const counts = $derived(tagCounts(tagged));
	const activeFilter = $derived(resolveTagFilter(counts, filter));
	const filtered = $derived(filterByTag(tagged, activeFilter));
	const slides = $derived(mediaSlides(filtered, separate));
	const shown = $derived(slides.map((slide) => slide.artifact));
	const pairs = $derived(comparePairs(filtered));
	const comparing = $derived(new Set(slides.filter((slide) => slide.pair !== undefined).map((slide) => slide.artifact.id)));
	const pairedIds = $derived(new Set(pairs.keys()));
	const current = $derived(shown[index]);
	const keys = $derived(shown.map((item) => item.id));
	const labels = $derived(slides.map((slide, at) => mediaSlideLabel(slide, at, slides.length)));

	const projectFeed = useArtifactFeed(() => (projectWanted ? { client, projectId, limit: 100 } : undefined));
	const taskTagNames = $derived(counts.map((entry) => entry.tag));
	const projectTagNames = $derived(projectTags(projectFeed.current?.artifacts ?? []));

	// The slide in view stays in view when the list changes (a save at the end, a delete, a tag change under a filter).
	$effect(() => {
		const id = untrack(() => anchorId);
		const list = shown;
		untrack(() => {
			if (list.length === 0) {
				index = 0;
				return;
			}
			const at = id === undefined ? -1 : list.findIndex((item) => item.id === id || (!separate && pairs.get(id)?.after.id === item.id));
			if (at >= 0) {
				if (at !== index) index = at;
			} else if (index > list.length - 1) {
				index = list.length - 1;
			}
		});
	});
	$effect(() => {
		anchorId = shown[index]?.id;
	});

	function setFilter(tag: string | null): void {
		const keep = current?.id;
		const next = mediaSlides(filterByTag(tagged, tag), separate).map((slide) => slide.artifact);
		filter = tag;
		const at = keep === undefined ? -1 : next.findIndex((item) => item.id === keep);
		index = at >= 0 ? at : 0;
		anchorId = next[index]?.id;
	}

	async function editTags(artifact: Artifact, tags: string[]): Promise<void> {
		if (onupdatetags === undefined) return;
		busy = true;
		problem = undefined;
		pending[artifact.id] = tags;
		try {
			await onupdatetags(artifact, tags);
		} catch (error) {
			problem = error instanceof Error ? error.message : String(error);
		} finally {
			delete pending[artifact.id];
			busy = false;
		}
	}

	function toggleCompare(id: string): void {
		anchorId = id;
		separate = !separate;
		try { localStorage.setItem('aiki.media-separate.v1', String(separate)); } catch { /* Keep the session choice. */ }
	}

	function openViewer(at: number): void {
		index = at;
		viewerAutoplay = videoSlides[at]?.isPlaying() === true;
		viewerOpen = true;
	}

	/** Where a slide's picture is on screen, for the viewer's flight in and out. */
	function originRect(artifactId: string): Rect | undefined {
		const at = shown.findIndex((item) => item.id === artifactId);
		const element = at < 0 ? undefined : carousel?.slideElement(at);
		if (element === undefined) return undefined;
		const picture = element.querySelector<HTMLImageElement>('[data-slide-image]');
		const frame = element.getBoundingClientRect();
		if (frame.right < 0 || frame.left > window.innerWidth || frame.bottom < 0 || frame.top > window.innerHeight) return undefined;
		if (picture !== null) {
			const box = picture.getBoundingClientRect();
			return picture.naturalWidth > 0
				? containedRect({ width: picture.naturalWidth, height: picture.naturalHeight }, box)
				: { left: box.left, top: box.top, width: box.width, height: box.height };
		}
		const video = element.querySelector<HTMLElement>('[data-artifact-video]');
		const box = (video ?? element.querySelector<HTMLElement>('[data-slide-stage]') ?? element).getBoundingClientRect();
		return { left: box.left, top: box.top, width: box.width, height: box.height };
	}
</script>

<div class="gallery flex min-w-0 flex-col gap-2.5" data-media-gallery>
	{#if counts.length > 0}
		<div class="chips flex gap-1 overflow-x-auto py-0.5" role="group" aria-label="Filter the media by tag">
			<button type="button" class="chip" aria-pressed={activeFilter === null} onclick={() => setFilter(null)}>All <span>{tagged.length}</span></button>
			{#each counts as entry (entry.tag)}
				<button type="button" class="chip" aria-pressed={activeFilter === entry.tag} onclick={() => setFilter(activeFilter === entry.tag ? null : entry.tag)}>
					{entry.tag} <span>{entry.count}</span>
				</button>
			{/each}
		</div>
	{/if}

	<MediaCarousel
		bind:this={carousel}
		bind:index
		count={shown.length}
		{keys}
		{labels}
		label="Photos and videos"
		instant={viewerOpen}
	>
		{#snippet slide(at, active)}
			{@const item = shown[at]}
			{#if item !== undefined}
				{@const pair = pairs.get(item.id)}
				{@const near = loadsFull(at - index)}
				<div class="stage" data-slide-stage>
					{#if item.kind === 'video'}
						<MediaVideoSlide bind:this={videoSlides[at]} artifact={item} {client} {active} {near} />
					{:else if pair !== undefined && comparing.has(item.id) && near}
						<CompareSlider before={pair.before} after={pair.after} {client} onopen={() => active && openViewer(at)} />
					{:else}
						<MediaImage artifact={item} {client} {near} {active} onopen={() => openViewer(at)} />
					{/if}

					{#if item.kind === 'image' && pair !== undefined}
						<button
							type="button"
							class="overlay-button compare-button"
							tabindex={active ? 0 : -1}
							aria-pressed={comparing.has(item.id)}
							onclick={(event) => {
								event.stopPropagation();
								toggleCompare(item.id);
							}}
							data-compare-toggle
						>
							<ArrowLeftRightIcon class="size-3.5" />
							{separate ? 'Compare pairs' : 'Show singly'}
						</button>
					{/if}
					<button
						type="button"
						class="overlay-button expand-button"
						tabindex={active ? 0 : -1}
						aria-label="Open {artifactTitle(item)} full screen"
						title="Full screen"
						onclick={(event) => {
							event.stopPropagation();
							openViewer(at);
						}}
						data-open-viewer
					>
						<ExpandIcon class="size-4" />
					</button>
				</div>
			{/if}
		{/snippet}
	</MediaCarousel>

	{#if shown.length > 1}
		<MediaStrip items={shown} {index} {client} paired={pairedIds} onselect={(at) => carousel?.goTo(at)} />
	{/if}

	<MediaCaption
		artifact={current}
		task={taskTagNames}
		project={projectTagNames}
		canEdit={canEditTags && onupdatetags !== undefined}
		{busy}
		{problem}
		onedit={(artifact, tags) => void editTags(artifact, tags)}
		onfilter={(tag) => setFilter(tag)}
		{ondetails}
		onstartedit={() => (projectWanted = true)}
	/>
</div>

{#if viewerOpen}
	<MediaViewer
		items={shown}
		bind:index
		{client}
		{keys}
		{labels}
		{pairs}
		{comparing}
		autoplay={viewerAutoplay}
		task={taskTagNames}
		project={projectTagNames}
		canEdit={canEditTags && onupdatetags !== undefined}
		{busy}
		{problem}
		{originRect}
		ontogglecompare={toggleCompare}
		onedit={(artifact, tags) => void editTags(artifact, tags)}
		onstartedit={() => (projectWanted = true)}
		onclose={() => (viewerOpen = false)}
	/>
{/if}

<style>
	.chips {
		scrollbar-width: none;
		mask-image: linear-gradient(to right, black calc(100% - 1.5rem), transparent);
	}
	.chips::-webkit-scrollbar {
		display: none;
	}
	.chip {
		display: inline-flex;
		flex: none;
		align-items: center;
		gap: 0.3rem;
		border-radius: 9999px;
		border: 1px solid var(--chat-border);
		padding: 0.1875rem 0.65rem;
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--chat-fg-muted);
		transition:
			background-color 120ms,
			border-color 120ms,
			color 120ms,
			scale 120ms;
	}
	.chip span {
		color: var(--chat-fg-subtle);
		font-variant-numeric: tabular-nums;
	}
	.chip:hover {
		background: var(--chat-surface-2);
	}
	.chip:active {
		scale: 0.96;
	}
	.chip[aria-pressed='true'] {
		border-color: color-mix(in oklab, var(--accent-2) 45%, var(--chat-border));
		background: color-mix(in oklab, var(--accent-2) 12%, transparent);
		color: var(--chat-fg);
	}
	.chip:focus-visible {
		outline: 2px solid var(--accent-2);
		outline-offset: 1px;
	}
	.stage {
		--compare-pill-inset: 3.25rem;
		container-type: size;
		position: relative;
		display: grid;
		place-items: center;
		width: 100%;
		height: 100%;
		overflow: hidden;
		border-radius: 1rem;
		background:
			repeating-conic-gradient(color-mix(in oklab, var(--chat-fg) 5%, transparent) 0 25%, transparent 0 50%) 0 0 / 16px 16px,
			var(--chat-surface-2);
		box-shadow:
			0 0 0 1px var(--chat-border),
			0 14px 30px -18px rgb(0 0 0 / 0.5);
	}
	.overlay-button {
		position: absolute;
		z-index: 2;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.375rem;
		color: white;
		background: rgb(0 0 0 / 0.5);
		backdrop-filter: blur(6px);
		box-shadow: 0 0 0 1px rgb(255 255 255 / 0.18);
		transition:
			background-color 120ms,
			opacity 160ms,
			scale 120ms;
	}
	/* Only the slide in the middle has controls; the peeking neighbours are just pictures. */
	:global([data-slide][data-active='false']) .overlay-button {
		opacity: 0;
		pointer-events: none;
	}
	.overlay-button:hover {
		background: rgb(0 0 0 / 0.72);
	}
	.overlay-button:active {
		scale: 0.95;
	}
	.overlay-button:focus-visible {
		outline: 2px solid var(--accent-2);
		outline-offset: 2px;
	}
	.expand-button {
		top: 0.5rem;
		right: 0.5rem;
		width: 2.25rem;
		height: 2.25rem;
		border-radius: 9999px;
	}
	.compare-button {
		left: 0.5rem;
		bottom: 0.5rem;
		min-height: 2.25rem;
		padding: 0 0.75rem;
		border-radius: 9999px;
		font-size: 0.75rem;
		font-weight: 600;
	}
	.compare-button[aria-pressed='true'] {
		background: var(--accent-2);
		color: var(--accent-2-fg, white);
	}
</style>
