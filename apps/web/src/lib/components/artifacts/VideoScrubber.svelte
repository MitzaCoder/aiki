<script lang="ts">
	import { formatClock, timeAtPointer } from '#lib/video-player.js';
	import type { VideoPlayer } from '#lib/video-player.svelte.js';

	/**
	 * The video's timeline: what is loaded, what was played, and the time under the pointer while it hovers. Dragging
	 * seeks as it goes. A slider for keyboards and screen readers: the player's ←/→ move it; Home and End go to the ends.
	 */
	let { player, onscrub }: { player: VideoPlayer; onscrub?: (scrubbing: boolean) => void } = $props();

	let track = $state<HTMLDivElement | null>(null);
	let hoverX = $state<number | undefined>(undefined);
	let dragging = $state(false);

	const duration = $derived(Number.isFinite(player.duration) && player.duration > 0 ? player.duration : 0);
	const played = $derived(duration > 0 ? Math.min(1, player.time / duration) : 0);
	const hoverTime = $derived(hoverX === undefined || track == null ? undefined : timeAtPointer(hoverX, 0, track.clientWidth, duration));
	const label = $derived(`${formatClock(player.time, duration)} of ${formatClock(duration)}`);

	function localX(event: PointerEvent): number {
		return event.clientX - (track?.getBoundingClientRect().left ?? 0);
	}

	function seekToPointer(event: PointerEvent): void {
		if (track == null || duration === 0) return;
		player.seekTo(timeAtPointer(localX(event), 0, track.clientWidth, duration));
	}

	function onpointerdown(event: PointerEvent): void {
		if (event.button !== 0) return;
		track?.setPointerCapture(event.pointerId);
		dragging = true;
		onscrub?.(true);
		seekToPointer(event);
	}

	function onpointermove(event: PointerEvent): void {
		if (event.pointerType === 'mouse' || dragging) hoverX = Math.min(Math.max(0, localX(event)), track?.clientWidth ?? 0);
		if (dragging) seekToPointer(event);
	}

	function stop(): void {
		if (!dragging) return;
		dragging = false;
		if (hoverX !== undefined && !matchesHover()) hoverX = undefined;
		onscrub?.(false);
	}

	function matchesHover(): boolean {
		return track?.matches(':hover') ?? false;
	}

	function onkeydown(event: KeyboardEvent): void {
		if (event.key === 'Home') player.seekTo(0);
		else if (event.key === 'End') player.seekTo(duration);
		else return;
		event.preventDefault();
		event.stopPropagation();
	}
</script>

<div
	bind:this={track}
	class="scrubber group/scrub relative flex h-5 cursor-pointer touch-none items-center"
	class:dragging
	role="slider"
	tabindex="0"
	aria-label="Seek"
	aria-valuemin={0}
	aria-valuemax={Math.round(duration)}
	aria-valuenow={Math.round(player.time)}
	aria-valuetext={label}
	{onpointerdown}
	{onpointermove}
	onpointerup={stop}
	onpointercancel={stop}
	onpointerleave={() => {
		if (!dragging) hoverX = undefined;
	}}
	{onkeydown}
>
	<div class="rail relative h-1 w-full overflow-hidden rounded-full">
		{#if duration > 0}
			{#each player.buffered as range (range.start)}
				<div class="buffered absolute inset-y-0" style:left="{(range.start / duration) * 100}%" style:width="{((range.end - range.start) / duration) * 100}%"></div>
			{/each}
		{/if}
		{#if hoverX !== undefined && track != null}
			<div class="hovered absolute inset-y-0 left-0" style:width="{hoverX}px"></div>
		{/if}
		<div class="played absolute inset-y-0 left-0" style:width="{played * 100}%"></div>
	</div>
	<div class="thumb pointer-events-none absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full" style:left="{played * 100}%"></div>
	{#if hoverTime !== undefined && duration > 0}
		<div
			class="preview pointer-events-none absolute bottom-full mb-1.5 -translate-x-1/2 rounded-md px-1.5 py-0.5 font-mono text-[0.6875rem] tabular-nums"
			style:left="clamp(1.75rem, {hoverX}px, calc(100% - 1.75rem))"
		>
			{formatClock(hoverTime, duration)}
		</div>
	{/if}
</div>

<style>
	.rail {
		background: color-mix(in oklab, var(--chat-fg) 18%, transparent);
		transition: height 120ms ease;
	}
	.scrubber:hover .rail,
	.scrubber.dragging .rail,
	.scrubber:focus-visible .rail {
		height: 0.375rem;
	}
	.buffered {
		background: color-mix(in oklab, var(--chat-fg) 22%, transparent);
	}
	.hovered {
		background: color-mix(in oklab, var(--chat-fg) 16%, transparent);
	}
	.played {
		background: var(--accent-2);
	}
	.thumb {
		background: var(--accent-2);
		box-shadow: 0 0 0 2px var(--chat-surface);
		scale: 0;
		transition: scale 120ms ease;
	}
	.scrubber:hover .thumb,
	.scrubber.dragging .thumb,
	.scrubber:focus-visible .thumb {
		scale: 1;
	}
	.scrubber:focus-visible {
		outline: 2px solid var(--accent-2);
		outline-offset: 2px;
		border-radius: 0.25rem;
	}
	.preview {
		background: var(--chat-fg);
		color: var(--chat-surface);
		box-shadow: 0 4px 12px rgb(0 0 0 / 0.25);
	}
	@media (pointer: coarse) {
		/* A finger needs the thumb to find it. */
		.thumb {
			scale: 1;
		}
	}
</style>
