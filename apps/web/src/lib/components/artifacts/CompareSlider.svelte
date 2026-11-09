<script lang="ts">
	import ChevronsLeftRightIcon from '@lucide/svelte/icons/chevrons-left-right';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import type { HarnessClient } from '@mihai-harness/client';
	import type { Artifact } from '@mihai-harness/protocol';
	import { onMount } from 'svelte';
	import { artifactTitle, MEDIA_RETRY_LIMIT } from '#lib/artifacts.js';
	import { useArtifactSource } from '#lib/artifacts.svelte.js';
	import { clampPercent, dividerAfterKey, dividerAtPointer } from '#lib/media-gallery.js';

	/**
	 * Two images of the same thing, one over the other, with a divider to drag: the before on the left of it, the after on
	 * the right. Dragging starts only on the handle's strip, so a swipe elsewhere still changes
	 * slide. The handle is a slider (←/→, Shift for bigger steps, Home and End). On opening the divider sweeps from the
	 * right edge to the middle, unless motion is reduced. It fills its parent.
	 */
	let {
		before,
		after,
		client,
		near = true,
		onopen
	}: {
		before: Artifact;
		after: Artifact;
		client: HarnessClient;
		/** Whether to load the images yet. */
		near?: boolean;
		onopen?: () => void;
	} = $props();

	const beforeSource = useArtifactSource(() => (near ? { client, projectId: before.projectId, artifactId: before.id } : undefined));
	const afterSource = useArtifactSource(() => (near ? { client, projectId: after.projectId, artifactId: after.id } : undefined));
	const beforeUrl = $derived(beforeSource.current?.url);
	const afterUrl = $derived(afterSource.current?.url);

	let box = $state<HTMLDivElement | null>(null);
	let position = $state(100);
	let dragging = $state(false);
	let sweeping = $state(true);
	let loaded = $state({ before: false, after: false });
	let failures = 0;

	onMount(() => {
		const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		if (reduced) {
			sweeping = false;
			position = 50;
			return;
		}
		const frame = requestAnimationFrame(() => (position = 50));
		const done = setTimeout(() => (sweeping = false), 470);
		return () => {
			cancelAnimationFrame(frame);
			clearTimeout(done);
		};
	});

	async function failed(which: 'before' | 'after'): Promise<void> {
		loaded[which] = false;
		if (failures >= MEDIA_RETRY_LIMIT) return;
		failures += 1;
		await (which === 'before' ? beforeSource : afterSource).current?.recover();
	}

	let tapStart: { x: number; y: number } | undefined;
	function onpointerdown(event: PointerEvent): void {
		if (event.button !== 0) return;
		tapStart = { x: event.clientX, y: event.clientY };
		if (!(event.target as HTMLElement).closest('[data-grip]')) return;
		if (box == null) return;
		sweeping = false;
		dragging = true;
		box.setPointerCapture(event.pointerId);
		const rect = box.getBoundingClientRect();
		position = dividerAtPointer(event.clientX, rect.left, rect.width);
		(event.target as HTMLElement).closest<HTMLElement>('[data-grip]')?.focus({ preventScroll: true });
		event.preventDefault();
	}

	function onpointermove(event: PointerEvent): void {
		if (!dragging || box == null) return;
		const rect = box.getBoundingClientRect();
		position = dividerAtPointer(event.clientX, rect.left, rect.width);
	}

	function onpointerup(event: PointerEvent): void {
		if (!dragging && tapStart !== undefined && Math.hypot(event.clientX - tapStart.x, event.clientY - tapStart.y) < 8) onopen?.();
		dragging = false;
		tapStart = undefined;
	}

	function onkeydown(event: KeyboardEvent): void {
		if (event.ctrlKey || event.metaKey || event.altKey) return;
		const next = dividerAfterKey(position, event.key, event.shiftKey);
		if (next === undefined) return;
		// The carousel's arrows would change slide; here they move the divider.
		event.preventDefault();
		event.stopPropagation();
		sweeping = false;
		position = next;
	}

	const ready = $derived(loaded.before && loaded.after);
	const percent = $derived(Math.round(clampPercent(position)));
</script>

<div
	bind:this={box}
	class="compare absolute inset-0 overflow-hidden rounded-[inherit] select-none"
	class:sweeping
	class:dragging
	style="--position: {position}%"
	role="group"
	aria-label="Before and after: {artifactTitle(before)} and {artifactTitle(after)}"
	{onpointerdown}
	{onpointermove}
	{onpointerup}
	onpointercancel={() => { dragging = false; tapStart = undefined; }}
	data-compare
>
	{#if beforeUrl !== undefined}
		<img
			src={beforeUrl}
			alt="Before: {artifactTitle(before)}"
			class="layer"
			draggable="false"
			decoding="async"
			onload={() => ((loaded.before = true), (failures = 0))}
			onerror={() => failed('before')}
		/>
	{/if}
	{#if afterUrl !== undefined}
		<img
			src={afterUrl}
			alt="After: {artifactTitle(after)}"
			class="layer after"
			draggable="false"
			decoding="async"
			onload={() => ((loaded.after = true), (failures = 0))}
			onerror={() => failed('after')}
		/>
	{/if}
	{#if !ready}
		<span class="absolute inset-0 grid place-items-center text-white/70" role="status" aria-label="Loading the images">
			<LoaderCircleIcon class="size-5 animate-spin" />
		</span>
	{/if}

	<span class="pill pill-before" class:faded={percent < 16} aria-hidden="true">Before</span>
	<span class="pill pill-after" class:faded={percent > 84} aria-hidden="true">After</span>

	<div class="divider" aria-hidden="true"></div>
	<div class="grip-strip" data-grip>
		<span
			class="grip"
			role="slider"
			tabindex="0"
			aria-label="Compare before and after"
			aria-orientation="horizontal"
			aria-valuemin="0"
			aria-valuemax="100"
			aria-valuenow={percent}
			aria-valuetext="{percent}% before, {100 - percent}% after"
			{onkeydown}
			data-compare-handle
		>
			<ChevronsLeftRightIcon class="size-4" />
		</span>
	</div>
</div>

<style>
	.compare {
		background:
			repeating-conic-gradient(color-mix(in oklab, var(--chat-fg) 5%, transparent) 0 25%, transparent 0 50%) 0 0 / 16px 16px,
			var(--chat-surface-2);
		touch-action: pan-x pan-y;
		cursor: ew-resize;
	}
	.layer {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: contain;
		pointer-events: none;
	}
	.after {
		clip-path: inset(0 0 0 var(--position));
	}
	.divider {
		position: absolute;
		top: 0;
		bottom: 0;
		left: var(--position);
		width: 2px;
		margin-left: -1px;
		background: white;
		box-shadow: 0 0 0 1px rgb(0 0 0 / 0.25);
		pointer-events: none;
	}
	.grip-strip {
		position: absolute;
		top: 0;
		bottom: 0;
		left: var(--position);
		width: 3.25rem;
		margin-left: -1.625rem;
		display: grid;
		place-items: center;
		touch-action: none;
		cursor: ew-resize;
	}
	.grip {
		display: grid;
		place-items: center;
		width: 2.5rem;
		height: 2.5rem;
		border-radius: 9999px;
		color: #1a1a1a;
		background: white;
		box-shadow:
			0 0 0 1px rgb(0 0 0 / 0.2),
			0 4px 14px rgb(0 0 0 / 0.4);
		transition: scale 120ms ease;
	}
	.dragging .grip {
		scale: 1.12;
	}
	.grip:focus-visible {
		outline: 2px solid var(--accent-2);
		outline-offset: 3px;
	}
	.pill {
		position: absolute;
		top: 0.5rem;
		padding: 0.125rem 0.5rem;
		border-radius: 9999px;
		font-size: 0.6875rem;
		font-weight: 600;
		letter-spacing: 0.02em;
		color: white;
		background: rgb(0 0 0 / 0.55);
		backdrop-filter: blur(6px);
		pointer-events: none;
		transition: opacity 160ms ease;
	}
	.pill-before {
		left: 0.5rem;
	}
	/* The carousel's expand button sits in the top right corner: it sets how far in the label goes. */
	.pill-after {
		right: var(--compare-pill-inset, 0.5rem);
	}
	.pill.faded {
		opacity: 0;
	}
	/* The opening sweep, and a short ease for keyboard steps; dragging follows the pointer exactly. */
	.compare:not(.dragging) .after,
	.compare:not(.dragging) .divider,
	.compare:not(.dragging) .grip-strip {
		transition:
			clip-path 90ms ease-out,
			left 90ms ease-out;
	}
	.compare.sweeping .after,
	.compare.sweeping .divider,
	.compare.sweeping .grip-strip {
		transition:
			clip-path 420ms cubic-bezier(0.22, 0.8, 0.2, 1),
			left 420ms cubic-bezier(0.22, 0.8, 0.2, 1) !important;
	}
</style>
