<script lang="ts">
	import ArrowLeftRightIcon from '@lucide/svelte/icons/arrow-left-right';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import MaximizeIcon from '@lucide/svelte/icons/maximize';
	import XIcon from '@lucide/svelte/icons/x';
	import ZoomInIcon from '@lucide/svelte/icons/zoom-in';
	import ZoomOutIcon from '@lucide/svelte/icons/zoom-out';
	import type { HarnessClient } from '@aiki/client';
	import type { Artifact } from '@aiki/protocol';
	import { Dialog as DialogPrimitive } from 'bits-ui';
	import { onMount, tick } from 'svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import { artifactTitle, ZOOM_FIT, ZOOM_MAX, ZOOM_MIN, type Zoom } from '#lib/artifacts.js';
	import { downloadArtifact } from '#lib/artifacts.svelte.js';
	import { artifactVersions, selectedArtifactVersion } from '#lib/artifact-versions.js';
	import { exactTime, relativeTime } from '#lib/relative-time.js';
	import { flightTransform, loadsFull, MEDIA_MOTION, stepIndex, type ComparePair, type Rect } from '#lib/media-gallery.js';
	import CompareSlider from './CompareSlider.svelte';
	import MediaCaption from './MediaCaption.svelte';
	import MediaCarousel from './MediaCarousel.svelte';
	import MediaStrip from './MediaStrip.svelte';
	import MediaVideoSlide from './MediaVideoSlide.svelte';
	import MediaZoomImage from './MediaZoomImage.svelte';
	import type ZoomPane from './ZoomPane.svelte';

	/**
	 * The media carousel full screen (design: docs/DESIGN.md "Artifact tags and the task media carousel"): one slide per
	 * screen width, an image zoomed and panned (`ZoomPane`), a video playing, a before/after compare, a caption with the
	 * tags (editable) and the thumbnail strip. It opens with a shared-element flight: the picture grows from where it was in
	 * the slide (`originRect`) to its fitted place, and goes back there on close: Escape, the close button, a click beside the
	 * image, or a swipe down at fit, which carries the picture on from where the finger let go. The slide index is shared
	 * with the carousel behind, so closing lands on the slide the viewer ended on. With reduced motion it only fades.
	 */
	let {
		items,
		index = $bindable(0),
		client,
		keys,
		labels,
		pairs,
		comparing,
		autoplay = false,
		task,
		project,
		canEdit = false,
		busy = false,
		problem,
		originRect,
		ontogglecompare,
		onedit,
		onstartedit,
		onclose
	}: {
		items: readonly Artifact[];
		index?: number;
		client: HarnessClient;
		keys: readonly string[];
		labels: readonly string[];
		pairs: ReadonlyMap<string, ComparePair<Artifact>>;
		comparing: ReadonlySet<string>;
		/** The slide's video was playing: carry on in the viewer. */
		autoplay?: boolean;
		task: readonly string[];
		project: readonly string[];
		canEdit?: boolean;
		busy?: boolean;
		problem?: string | undefined;
		/** Where the artifact's picture is on screen behind the viewer, if it is. */
		originRect: (artifactId: string) => Rect | undefined;
		ontogglecompare: (artifactId: string) => void;
		onedit: (artifact: Artifact, tags: string[]) => void;
		onstartedit?: () => void;
		onclose: () => void;
	} = $props();

	const reduced = new MediaQuery('(prefers-reduced-motion: reduce)');
	let content = $state<HTMLElement | null>(null);
	let carousel = $state<MediaCarousel | null>(null);
	let zooms = $state<Record<number, Zoom | undefined>>({});
	let panes: Record<number, ZoomPane | null> = {};
	let pull = $state(0);
	let revealed = $state(false);
	let closing = $state(false);
	let flownIn = false;
	/** The slide the viewer opened on, the only one whose video may carry on playing. */
	// svelte-ignore state_referenced_locally
	const startIndex = index;

	let selectedVersions = $state<Record<string, number | undefined>>({});
	const viewedItems = $derived(items.map((item) => selectedArtifactVersion(item, selectedVersions[item.id])));
	const latestCurrent = $derived(items[index]);
	const current = $derived(viewedItems[index]);
	const versions = $derived(latestCurrent === undefined ? [] : artifactVersions(latestCurrent));
	const versionIndex = $derived(versions.findIndex((snapshot) => snapshot.id === current?.id));
	const viewingLatest = $derived(current?.version === latestCurrent?.version);

	function selectVersion(version: number | undefined): void {
		if (latestCurrent !== undefined) selectedVersions[latestCurrent.id] = version;
	}
	const zoom = $derived(zooms[index] ?? ZOOM_FIT);
	const pair = $derived(latestCurrent === undefined || !viewingLatest ? undefined : pairs.get(latestCurrent.id));
	const inCompare = $derived(latestCurrent !== undefined && pair !== undefined && comparing.has(latestCurrent.id));
	const zoomable = $derived(current?.kind === 'image' && !inCompare);

	function rectOf(element: Element): Rect {
		const box = element.getBoundingClientRect();
		return { left: box.left, top: box.top, width: box.width, height: box.height };
	}

	/** What flies: the element to animate and the picture's rectangle in it, for the slide in view. */
	function flightTarget(): { element: HTMLElement; picture: Rect; frame: Rect } | undefined {
		const slide = content?.querySelector<HTMLElement>(`[data-slide="${index}"]`);
		if (slide === null || slide === undefined) return undefined;
		const pane = slide.querySelector<HTMLElement>('[data-zoom-pane]');
		const image = slide.querySelector<HTMLElement>('[data-zoom-image]');
		if (pane !== null && image !== null) return { element: pane, picture: rectOf(image), frame: rectOf(pane) };
		const other = slide.querySelector<HTMLElement>('[data-artifact-video], [data-compare]');
		if (other === null) return undefined;
		const box = rectOf(other);
		return { element: other, picture: box, frame: box };
	}

	function css(transform: { x: number; y: number; scaleX: number; scaleY: number }): string {
		return `translate(${transform.x}px, ${transform.y}px) scale(${transform.scaleX}, ${transform.scaleY})`;
	}

	async function flyIn(): Promise<void> {
		if (flownIn || current === undefined) return;
		flownIn = true;
		await tick();
		const from = originRect(latestCurrent?.id ?? current.id);
		const target = flightTarget();
		if (reduced.current || from === undefined || target === undefined) {
			revealed = true;
			return;
		}
		const start = flightTransform(from, target.picture, target.frame);
		target.element.animate(
			[
				{ transformOrigin: '0 0', transform: css(start) },
				{ transformOrigin: '0 0', transform: 'translate(0px, 0px) scale(1, 1)' }
			],
			{ duration: MEDIA_MOTION.viewerOpenMs, easing: MEDIA_MOTION.easing }
		);
		revealed = true;
	}

	async function close(): Promise<void> {
		if (closing) return;
		closing = true;
		await tick();
		const item = current;
		const from = item === undefined ? undefined : originRect(latestCurrent?.id ?? item.id);
		const target = flightTarget();
		if (reduced.current || from === undefined || target === undefined) {
			setTimeout(onclose, reduced.current ? 0 : 160);
			return;
		}
		const end = flightTransform(from, target.picture, target.frame);
		const flight = target.element.animate(
			[
				{ transformOrigin: '0 0', transform: 'translate(0px, 0px) scale(1, 1)' },
				{ transformOrigin: '0 0', transform: css(end) }
			],
			{ duration: MEDIA_MOTION.viewerCloseMs, easing: MEDIA_MOTION.easing, fill: 'forwards' }
		);
		flight.finished.then(onclose, onclose);
	}

	onMount(() => {
		// An image flies once it is measured; anything else, or an image that is slow, as soon as it is on screen.
		const timer = setTimeout(() => void flyIn(), 450);
		if (current?.kind !== 'image') void flyIn();
		return () => clearTimeout(timer);
	});

	$effect(() => {
		// The dialog itself holds the focus: its keys are the window handler's.
		if (revealed) content?.focus({ preventScroll: true });
	});

	/** ←/→, Home and End change slide from anywhere in the viewer, unless a control that uses the key took it. */
	function onwindowkeydown(event: KeyboardEvent): void {
		if (closing || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
		const target = event.target as HTMLElement | null;
		if (target?.closest('input, textarea, select, [role="slider"], [role="menu"], [data-artifact-video], [contenteditable="true"]')) return;
		// A focused button takes Enter and Space; arrows are still ours.
		const next = stepIndex(index, items.length, event.key);
		if (next === undefined || event.key === 'PageUp' || event.key === 'PageDown') return;
		event.preventDefault();
		if (next !== index) carousel?.goTo(next);
	}

	async function download(): Promise<void> {
		if (current !== undefined) await downloadArtifact(client, current).catch(() => undefined);
	}

	const percent = $derived(Math.round(zoom.scale * 100));
</script>

<svelte:window onkeydown={onwindowkeydown} />

<DialogPrimitive.Root open={true} onOpenChange={(open) => !open && void close()}>
	<DialogPrimitive.Portal>
		<DialogPrimitive.Content
			bind:ref={content}
			class="media-viewer fixed inset-0 z-[70] flex flex-col text-white outline-none {closing ? 'closing' : ''} {revealed ? 'revealed' : ''}"
			style="--pull: {pull}"
			data-media-viewer
			onEscapeKeydown={(event) => {
				event.preventDefault();
				void close();
			}}
			onInteractOutside={(event) => event.preventDefault()}
			onOpenAutoFocus={(event) => event.preventDefault()}
		>
			<div class="backdrop" aria-hidden="true"></div>
			<DialogPrimitive.Description class="sr-only">
				Photos and videos of the task: swipe or use the arrow keys to move, swipe down or press Escape to close.
			</DialogPrimitive.Description>
			<div class="chrome bar relative z-10 flex items-center gap-1 px-2 py-2 sm:px-3" style="padding-top: max(0.5rem, env(safe-area-inset-top))">
				<DialogPrimitive.Title class="min-w-0 flex-1 truncate px-2 text-sm font-medium">
					{current === undefined ? 'Media' : artifactTitle(current)}
					<span class="ml-1 font-mono text-xs font-normal tabular-nums opacity-60 max-sm:sr-only">{index + 1} / {items.length}</span>
				</DialogPrimitive.Title>
				{#if current !== undefined && pair !== undefined}
					<button
						type="button"
						class="bar-text"
						aria-pressed={inCompare}
						onclick={() => latestCurrent && ontogglecompare(latestCurrent.id)}
						title="Compare before and after"
						data-compare-toggle
					>
						<ArrowLeftRightIcon class="size-4" />
						<span class="hidden sm:inline">{inCompare ? 'Show singly' : 'Compare pairs'}</span>
						<span class="sr-only sm:hidden">{inCompare ? 'Show singly' : 'Compare pairs'}</span>
					</button>
				{/if}
				{#if zoomable}
					<span class="hidden w-12 text-center font-mono text-xs tabular-nums opacity-70 sm:inline" aria-live="polite">{percent}%</span>
					<button type="button" class="bar-button" onclick={() => panes[index]?.step(1 / 1.5)} disabled={zoom.scale <= ZOOM_MIN} aria-label="Zoom out" title="Zoom out (−)">
						<ZoomOutIcon class="size-4" />
					</button>
					<button type="button" class="bar-button" onclick={() => panes[index]?.step(1.5)} disabled={zoom.scale >= ZOOM_MAX} aria-label="Zoom in" title="Zoom in (+)">
						<ZoomInIcon class="size-4" />
					</button>
					<button type="button" class="bar-button" onclick={() => panes[index]?.reset()} disabled={zoom.scale <= ZOOM_MIN} aria-label="Fit" title="Fit (0)">
						<MaximizeIcon class="size-4" />
					</button>
				{/if}
				<button type="button" class="bar-button" onclick={() => void download()} aria-label="Download" title="Download">
					<DownloadIcon class="size-4" />
				</button>
				<button type="button" class="bar-button" onclick={() => void close()} aria-label="Close" title="Close (Esc)" data-viewer-close>
					<XIcon class="size-4" />
				</button>
			</div>

			{#if current !== undefined && versions.length > 1}
				<div class="chrome relative flex items-center justify-center gap-2 pb-1 text-xs" data-artifact-versions>
					<button type="button" class="bar-button w-9" aria-label="Previous version" disabled={versionIndex <= 0} onclick={() => selectVersion(versions[versionIndex - 1]?.version)}>←</button>
					<span aria-live="polite" title={exactTime(current.createdAt)}>v{current.version ?? 1} of {latestCurrent?.versionCount ?? versions.length} · {relativeTime(current.createdAt, Date.now())}</span>
					<button type="button" class="bar-button w-9" aria-label="Next version" disabled={versionIndex >= versions.length - 1} onclick={() => selectVersion(versions[versionIndex + 1]?.version)}>→</button>
				</div>
			{/if}

			<div class="deck relative min-h-0 flex-1">
				<MediaCarousel bind:this={carousel} bind:index count={items.length} {keys} {labels} label="Photos and videos, full screen" variant="viewer">
					{#snippet slide(at, active)}
						{@const item = viewedItems[at]}
						{#if item !== undefined}
							{@const near = loadsFull(at - index)}
							{@const root = items[at]!}
							{@const slidePair = item.version === root.version ? pairs.get(root.id) : undefined}
							<div class="vstage" data-slide-stage>
								{#if item.kind === 'video'}
									<div class="video-stage">
										<MediaVideoSlide artifact={item} {client} {active} {near} autoplay={autoplay && at === startIndex} />
									</div>
								{:else if slidePair !== undefined && comparing.has(root.id)}
									{#if near}<div class="compare-stage"><CompareSlider before={slidePair.before} after={slidePair.after} {client} /></div>{/if}
								{:else if near}
									<MediaZoomImage
										artifact={item}
										{client}
										{near}
										{active}
										bind:pull
										onzoom={(next) => (zooms[at] = next)}
										onpane={(next) => (panes[at] = next)}
										onready={() => at === index && void flyIn()}
										ondismiss={() => void close()}
									/>
								{/if}
							</div>
						{/if}
					{/snippet}
				</MediaCarousel>
			</div>

			<div class="chrome foot flex flex-col gap-1 px-3 pt-2 sm:px-4" style="padding-bottom: max(0.5rem, env(safe-area-inset-bottom))">
				<div class="caption-box min-h-0 overflow-y-auto overscroll-contain">
					<MediaCaption artifact={current} {task} {project} canEdit={canEdit && viewingLatest} {busy} {problem} onedit={(_, tags) => latestCurrent && onedit(latestCurrent, tags)} {onstartedit} />
				</div>
				{#if items.length > 1}
					<MediaStrip {items} {index} {client} paired={new Set(pairs.keys())} onselect={(at) => (index = at)} />
				{/if}
			</div>
		</DialogPrimitive.Content>
	</DialogPrimitive.Portal>
</DialogPrimitive.Root>

<style>
	:global(.media-viewer) {
		/* Always dark, whatever the theme: the app's tokens are redefined for what is inside. */
		--chat-fg: #f4f4f5;
		--chat-fg-muted: rgb(255 255 255 / 0.74);
		--chat-fg-subtle: rgb(255 255 255 / 0.56);
		--chat-border: rgb(255 255 255 / 0.16);
		--chat-border-strong: rgb(255 255 255 / 0.3);
		--chat-surface: rgb(255 255 255 / 0.08);
		--chat-surface-2: rgb(255 255 255 / 0.12);
	}
	:global(.media-viewer:not(.revealed)) {
		visibility: hidden;
	}
	.backdrop {
		position: absolute;
		inset: 0;
		background: rgb(8 8 10 / calc(0.95 - min(var(--pull), 300) / 300 * 0.5));
		animation: viewer-in 180ms ease-out;
		transition: background-color 120ms linear;
	}
	:global(.media-viewer.closing) .backdrop {
		opacity: 0;
		transition: opacity 200ms ease-in;
	}
	@keyframes viewer-in {
		from {
			opacity: 0;
		}
	}
	.chrome {
		position: relative;
		z-index: 1;
		opacity: calc(1 - min(var(--pull), 140) / 140);
	}
	:global(.media-viewer.closing) .chrome {
		opacity: 0;
		transition: opacity 200ms ease;
	}
	.bar {
		background: linear-gradient(to bottom, rgb(0 0 0 / 0.5), transparent);
	}
	.foot {
		background: linear-gradient(to top, rgb(0 0 0 / 0.5), transparent);
		max-height: 44dvh;
	}
	.caption-box {
		max-height: 24dvh;
	}
	.bar-button,
	.bar-text {
		display: inline-grid;
		place-items: center;
		height: 2.25rem;
		border-radius: 9999px;
		transition: background-color 120ms;
	}
	.bar-button {
		width: 2.25rem;
	}
	.bar-text {
		grid-auto-flow: column;
		gap: 0.375rem;
		padding: 0 0.75rem;
		font-size: 0.75rem;
		font-weight: 600;
	}
	.bar-text[aria-pressed='true'] {
		background: var(--accent-2);
	}
	.bar-button:hover:not(:disabled),
	.bar-text:hover,
	.bar-button:focus-visible,
	.bar-text:focus-visible {
		background: rgb(255 255 255 / 0.16);
		outline: none;
	}
	.bar-text[aria-pressed='true']:hover,
	.bar-text[aria-pressed='true']:focus-visible {
		background: var(--accent-2);
		outline: 2px solid white;
		outline-offset: 1px;
	}
	.bar-button:disabled {
		opacity: 0.35;
	}
	.vstage {
		container-type: size;
		position: absolute;
		inset: 0;
	}
	.video-stage {
		position: absolute;
		inset: 0;
		container-type: size;
		display: grid;
		place-items: center;
		padding: 0.5rem;
	}
	.compare-stage {
		position: absolute;
		inset: 0.5rem;
		border-radius: 0.75rem;
		overflow: hidden;
	}
</style>
