<script lang="ts">
	import DownloadIcon from '@lucide/svelte/icons/download';
	import MaximizeIcon from '@lucide/svelte/icons/maximize';
	import XIcon from '@lucide/svelte/icons/x';
	import ZoomInIcon from '@lucide/svelte/icons/zoom-in';
	import ZoomOutIcon from '@lucide/svelte/icons/zoom-out';
	import { Dialog as DialogPrimitive } from 'bits-ui';
	import { ZOOM_FIT, ZOOM_MAX, ZOOM_MIN, type Zoom } from '#lib/artifacts.js';
	import ZoomPane from './ZoomPane.svelte';

	/**
	 * An image over the whole page: fitted, zoomed with the wheel, a pinch, a double click or tap, or the buttons, and
	 * panned by dragging (`ZoomPane`). At fit, a swipe down, a click beside the image or Escape closes it. It is a dialog of
	 * its own, so it stacks over the artifact dialog it may be opened from.
	 */
	let {
		src,
		alt,
		title,
		ondownload,
		onclose
	}: {
		src: string;
		alt: string;
		title: string;
		ondownload?: () => void;
		onclose: () => void;
	} = $props();

	let closeButton = $state<HTMLButtonElement>();
	let pane = $state<ZoomPane>();
	let zoom = $state<Zoom>(ZOOM_FIT);
	let pull = $state(0);

	const percent = $derived(Math.round(zoom.scale * 100));
</script>

<DialogPrimitive.Root open={true} onOpenChange={(open) => !open && onclose()}>
	<DialogPrimitive.Portal>
		<DialogPrimitive.Content
			class="lightbox data-open:animate-in data-open:fade-in-0 fixed inset-0 z-[70] flex flex-col outline-none"
			style="--pull: {pull}"
			data-artifact-lightbox
			onOpenAutoFocus={(event) => {
				event.preventDefault();
				closeButton?.focus();
			}}
		>
			<div class="bar relative z-10 flex items-center gap-1 px-2 py-2 sm:px-3" style="padding-top: max(0.5rem, env(safe-area-inset-top))">
				<DialogPrimitive.Title class="min-w-0 flex-1 truncate px-2 text-sm font-medium">{title}</DialogPrimitive.Title>
				<span class="hidden w-12 text-center font-mono text-xs tabular-nums opacity-70 sm:inline" aria-live="polite">{percent}%</span>
				<button type="button" class="bar-button" onclick={() => pane?.step(1 / 1.5)} disabled={zoom.scale <= ZOOM_MIN} aria-label="Zoom out" title="Zoom out (−)">
					<ZoomOutIcon class="size-4" />
				</button>
				<button type="button" class="bar-button" onclick={() => pane?.step(1.5)} disabled={zoom.scale >= ZOOM_MAX} aria-label="Zoom in" title="Zoom in (+)">
					<ZoomInIcon class="size-4" />
				</button>
				<button type="button" class="bar-button" onclick={() => pane?.reset()} disabled={zoom.scale <= ZOOM_MIN} aria-label="Fit" title="Fit (0)">
					<MaximizeIcon class="size-4" />
				</button>
				{#if ondownload}
					<button type="button" class="bar-button" onclick={ondownload} aria-label="Download" title="Download">
						<DownloadIcon class="size-4" />
					</button>
				{/if}
				<button type="button" class="bar-button" bind:this={closeButton} onclick={onclose} aria-label="Close" title="Close (Esc)">
					<XIcon class="size-4" />
				</button>
			</div>

			<div class="relative min-h-0 flex-1">
				<ZoomPane bind:this={pane} {src} {alt} bind:zoom bind:pull ondismiss={() => onclose()} />
			</div>
		</DialogPrimitive.Content>
	</DialogPrimitive.Portal>
</DialogPrimitive.Root>

<style>
	:global(.lightbox) {
		color: white;
		background: rgb(8 8 10 / calc(0.94 - min(var(--pull), 300) / 300 * 0.5));
		backdrop-filter: blur(8px);
	}
	.bar {
		background: linear-gradient(to bottom, rgb(0 0 0 / 0.5), transparent);
	}
	.bar-button {
		display: grid;
		place-items: center;
		width: 2.25rem;
		height: 2.25rem;
		border-radius: 9999px;
		transition: background-color 120ms;
	}
	.bar-button:hover:not(:disabled),
	.bar-button:focus-visible {
		background: rgb(255 255 255 / 0.14);
		outline: none;
	}
	.bar-button:disabled {
		opacity: 0.35;
	}
</style>
