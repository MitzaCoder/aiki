<script lang="ts">
	import ArrowLeftRightIcon from '@lucide/svelte/icons/arrow-left-right';
	import type { HarnessClient } from '@kemiri/client';
	import type { Artifact } from '@kemiri/protocol';
	import { onDestroy, tick } from 'svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import { MEDIA_MOTION, scrollPosition, stepIndex } from '#lib/media-gallery.js';
	import { artifactTitle } from '#lib/artifacts.js';
	import ArtifactThumb from './ArtifactThumb.svelte';

	/**
	 * The row of small pictures under the carousel: one per slide, the current one outlined and kept in view, a tap jumps to
	 * it. One tab stop (the current one); ←/→ move along it. A small mark shows the items that have a before/after partner.
	 */
	let {
		items,
		index,
		client,
		paired,
		onselect
	}: {
		items: readonly Artifact[];
		index: number;
		client: HarnessClient;
		/** IDs of the items that are half of a compare pair. */
		paired: ReadonlySet<string>;
		onselect: (index: number) => void;
	} = $props();

	let strip = $state<HTMLElement>();
	const reduced = new MediaQuery('(prefers-reduced-motion: reduce)');

	let moveFrame = 0;
	onDestroy(() => cancelAnimationFrame(moveFrame));

	/** Scrolls the row to `left` in `stripMs` with the carousel's ease-out; native smooth scrolling lags behind the slide. */
	function moveTo(row: HTMLElement, left: number): void {
		cancelAnimationFrame(moveFrame);
		if (reduced.current || Math.abs(row.scrollLeft - left) < 1) {
			row.scrollLeft = left;
			return;
		}
		const from = row.scrollLeft;
		const started = performance.now();
		const step = (now: number): void => {
			row.scrollLeft = scrollPosition(from, left, now - started, MEDIA_MOTION.stripMs);
			moveFrame = now - started < MEDIA_MOTION.stripMs ? requestAnimationFrame(step) : 0;
		};
		moveFrame = requestAnimationFrame(step);
	}

	$effect(() => {
		const at = index;
		const row = strip;
		if (!row) return;
		const button = row.querySelector<HTMLElement>(`[data-thumb="${at}"]`);
		if (button === null) return;
		const left = button.offsetLeft - row.clientWidth / 2 + button.offsetWidth / 2;
		moveTo(row, Math.max(0, left));
	});

	async function onkeydown(event: KeyboardEvent): Promise<void> {
		const next = stepIndex(index, items.length, event.key);
		if (next === undefined || event.key === 'PageUp' || event.key === 'PageDown') return;
		event.preventDefault();
		event.stopPropagation();
		onselect(next);
		await tick();
		strip?.querySelector<HTMLElement>(`[data-thumb="${next}"]`)?.focus({ preventScroll: true });
	}
</script>

<div
	bind:this={strip}
	class="strip flex gap-1.5 overflow-x-auto px-1 py-1.5"
	role="group"
	aria-label="Thumbnails"
	data-media-strip
>
	{#each items as item, at (item.id)}
		<button
			type="button"
			class="thumb relative shrink-0 overflow-hidden rounded-lg"
			class:current={at === index}
			data-thumb={at}
			tabindex={at === index ? 0 : -1}
			aria-label="Go to {at + 1} of {items.length}: {artifactTitle(item)}"
			aria-current={at === index ? 'true' : undefined}
			title={artifactTitle(item)}
			{onkeydown}
			onclick={() => onselect(at)}
		>
			<ArtifactThumb artifact={item} {client} class="h-full w-full" duration={false} play={false} />
			{#if paired.has(item.id)}
				<span class="pair absolute top-0.5 left-0.5 grid size-4 place-items-center rounded-full" title="Has a before/after partner" aria-hidden="true">
					<ArrowLeftRightIcon class="size-2.5" />
				</span>
			{/if}
		</button>
	{/each}
</div>

<style>
	.strip {
		scrollbar-width: none;
		overscroll-behavior-x: contain;
	}
	.strip::-webkit-scrollbar {
		display: none;
	}
	.thumb {
		width: 3.25rem;
		height: 2.375rem;
		opacity: 0.62;
		box-shadow: 0 0 0 1px var(--chat-border);
		transition:
			opacity 120ms ease,
			box-shadow 120ms ease,
			transform 120ms ease;
	}
	.thumb:hover {
		opacity: 0.9;
	}
	.thumb.current {
		opacity: 1;
		transform: translateY(-1px);
		box-shadow:
			0 0 0 2px var(--accent-2),
			0 4px 12px -4px rgb(0 0 0 / 0.5);
	}
	.thumb:focus-visible {
		outline: 2px solid var(--accent-2);
		outline-offset: 2px;
	}
	.pair {
		color: white;
		background: rgb(0 0 0 / 0.6);
	}
	@media (min-width: 40rem) {
		.thumb {
			width: 4rem;
			height: 2.875rem;
		}
	}
</style>
