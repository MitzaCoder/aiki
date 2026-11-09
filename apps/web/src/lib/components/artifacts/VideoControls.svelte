<script lang="ts">
	import CheckIcon from '@lucide/svelte/icons/check';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import MaximizeIcon from '@lucide/svelte/icons/maximize';
	import MinimizeIcon from '@lucide/svelte/icons/minimize';
	import PauseIcon from '@lucide/svelte/icons/pause';
	import PictureInPictureIcon from '@lucide/svelte/icons/picture-in-picture-2';
	import PlayIcon from '@lucide/svelte/icons/play';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import RotateCwIcon from '@lucide/svelte/icons/rotate-cw';
	import Volume2Icon from '@lucide/svelte/icons/volume-2';
	import VolumeXIcon from '@lucide/svelte/icons/volume-x';
	import { PLAYBACK_RATES, SKIP_SECONDS, formatClock, formatRate } from '#lib/video-player.js';
	import type { VideoPlayer } from '#lib/video-player.svelte.js';
	import VideoScrubber from './VideoScrubber.svelte';

	/**
	 * The player's bar: the timeline, then play, ±10s, volume (only for a video with sound), the clock, speed, picture in
	 * picture, download and fullscreen. `full` is off for the small players in the chat: they keep play, the clock, volume
	 * and fullscreen. The bar narrows with its frame (a container query on `video-bar`) and drops ±10s and download on a phone, where a
	 * double tap skips and the dialog has its own download button.
	 */
	let {
		player,
		full,
		downloading = false,
		ondownload,
		onhold
	}: {
		player: VideoPlayer;
		full: boolean;
		downloading?: boolean;
		ondownload?: () => void;
		/** True while the bar must stay up: a menu is open or the timeline is dragged. */
		onhold?: (holding: boolean) => void;
	} = $props();

	let speedOpen = $state(false);
	let scrubbing = $state(false);
	let speedButton = $state<HTMLButtonElement>();
	let speedMenu = $state<HTMLDivElement>();

	$effect(() => onhold?.(speedOpen || scrubbing));

	$effect(() => {
		if (!speedOpen) return;
		speedMenu?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
		const close = (event: PointerEvent): void => {
			const target = event.target as Node;
			if (!speedMenu?.contains(target) && !speedButton?.contains(target)) speedOpen = false;
		};
		document.addEventListener('pointerdown', close, true);
		return () => document.removeEventListener('pointerdown', close, true);
	});

	const atEnd = $derived(player.ended);
	const clock = $derived(`${formatClock(player.time, player.duration)} / ${formatClock(player.duration)}`);

	function pick(rate: number): void {
		player.setRate(rate);
		speedOpen = false;
		speedButton?.focus();
	}

	function menuKeys(event: KeyboardEvent): void {
		const items = [...(speedMenu?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [])];
		const index = items.indexOf(document.activeElement as HTMLButtonElement);
		if (event.key === 'Escape') {
			speedOpen = false;
			speedButton?.focus();
		} else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
			const next = (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
			items[next]?.focus();
		} else if (event.key === 'Tab') {
			speedOpen = false;
			return;
		} else if (event.key !== 'Enter' && event.key !== ' ') {
			return;
		} else {
			// Enter and space press the focused item themselves.
			event.stopPropagation();
			return;
		}
		event.preventDefault();
		event.stopPropagation();
	}
</script>

<div class="controls flex flex-col gap-0.5 rounded-xl px-2.5 pt-1 pb-1.5" data-video-controls>
	<VideoScrubber
		{player}
		onscrub={(value) => {
			scrubbing = value;
		}}
	/>
	<div class="flex items-center gap-0.5">
		<button type="button" class="control" onclick={() => player.toggle()} aria-label={atEnd ? 'Replay' : player.paused ? 'Play' : 'Pause'} title={player.paused ? 'Play (k)' : 'Pause (k)'}>
			{#if atEnd}
				<RotateCcwIcon class="size-4" />
			{:else if player.paused}
				<PlayIcon class="size-4 fill-current" />
			{:else}
				<PauseIcon class="size-4 fill-current" />
			{/if}
		</button>
		{#if full}
			<button type="button" class="control skip" onclick={() => player.seekBy(-SKIP_SECONDS)} aria-label="Back {SKIP_SECONDS} seconds" title="Back {SKIP_SECONDS}s (j)">
				<RotateCcwIcon class="size-4" /><span class="skip-label">{SKIP_SECONDS}</span>
			</button>
			<button type="button" class="control skip" onclick={() => player.seekBy(SKIP_SECONDS)} aria-label="Forward {SKIP_SECONDS} seconds" title="Forward {SKIP_SECONDS}s (l)">
				<RotateCwIcon class="size-4" /><span class="skip-label">{SKIP_SECONDS}</span>
			</button>
		{/if}
		{#if player.hasAudio}
			<div class="volume group/volume flex items-center">
				<button type="button" class="control" onclick={() => player.toggleMute()} aria-label={player.muted ? 'Unmute' : 'Mute'} title={player.muted ? 'Unmute (m)' : 'Mute (m)'}>
					{#if player.muted || player.volume === 0}<VolumeXIcon class="size-4" />{:else}<Volume2Icon class="size-4" />{/if}
				</button>
				<input
					type="range"
					class="volume-slider"
					min="0"
					max="1"
					step="0.05"
					value={player.muted ? 0 : player.volume}
					oninput={(event) => player.setVolume(Number(event.currentTarget.value))}
					aria-label="Volume"
				/>
			</div>
		{/if}
		<span class="clock px-1.5 font-mono text-xs whitespace-nowrap tabular-nums" aria-hidden="true">{clock}</span>
		<span class="flex-1"></span>
		{#if full}
			<div class="relative">
				<button
					bind:this={speedButton}
					type="button"
					class="control speed font-mono text-xs tabular-nums"
					onclick={() => (speedOpen = !speedOpen)}
					aria-haspopup="menu"
					aria-expanded={speedOpen}
					aria-label="Speed {formatRate(player.rate)}"
					title="Speed (< >)"
				>
					{formatRate(player.rate)}
				</button>
				{#if speedOpen}
					<!-- svelte-ignore a11y_interactive_supports_focus -->
					<div bind:this={speedMenu} class="menu absolute right-0 bottom-full mb-2 flex min-w-24 flex-col rounded-lg p-1" role="menu" aria-label="Speed" tabindex="-1" onkeydown={menuKeys}>
						{#each PLAYBACK_RATES as rate (rate)}
							<button type="button" role="menuitemradio" aria-checked={rate === player.rate} class="menu-item flex items-center justify-between gap-3 rounded-md px-2 py-1 text-left font-mono text-xs tabular-nums" onclick={() => pick(rate)}>
								{formatRate(rate)}
								{#if rate === player.rate}<CheckIcon class="size-3.5" />{/if}
							</button>
						{/each}
					</div>
				{/if}
			</div>
			{#if player.canPictureInPicture}
				<button type="button" class="control" onclick={() => player.togglePictureInPicture()} aria-label="Picture in picture" aria-pressed={player.pictureInPicture} title="Picture in picture">
					<PictureInPictureIcon class="size-4" />
				</button>
			{/if}
			{#if ondownload}
				<button type="button" class="control download" onclick={ondownload} disabled={downloading} aria-label="Download" title="Download">
					{#if downloading}<LoaderCircleIcon class="size-4 animate-spin" />{:else}<DownloadIcon class="size-4" />{/if}
				</button>
			{/if}
		{/if}
		<button type="button" class="control" onclick={() => player.toggleFullscreen()} aria-label={player.fullscreen ? 'Exit fullscreen' : 'Fullscreen'} title={player.fullscreen ? 'Exit fullscreen (f)' : 'Fullscreen (f)'}>
			{#if player.fullscreen}<MinimizeIcon class="size-4" />{:else}<MaximizeIcon class="size-4" />{/if}
		</button>
	</div>
</div>

<style>
	.controls {
		color: var(--chat-fg);
		/* See-through and unblurred: burnt-in captions under the bar stay readable. */
		background: color-mix(in oklab, var(--chat-surface) 45%, transparent);
		box-shadow: 0 0 0 1px color-mix(in oklab, var(--chat-border) 60%, transparent);
		text-shadow: 0 0 3px color-mix(in oklab, var(--chat-surface) 90%, transparent), 0 1px 2px color-mix(in oklab, var(--chat-surface) 70%, transparent);
	}
	.controls :global(svg) {
		filter: drop-shadow(0 0 2px color-mix(in oklab, var(--chat-surface) 90%, transparent));
	}
	.control {
		position: relative;
		display: inline-grid;
		place-items: center;
		min-width: 2rem;
		height: 2rem;
		padding-inline: 0.25rem;
		border-radius: 0.5rem;
		color: var(--chat-fg);
		transition:
			background-color 120ms ease,
			color 120ms ease;
	}
	.control:hover,
	.control[aria-expanded='true'],
	.control[aria-pressed='true'] {
		color: var(--chat-fg);
		background: color-mix(in oklab, var(--chat-fg) 9%, transparent);
	}
	.control:focus-visible,
	.menu-item:focus-visible,
	.volume-slider:focus-visible {
		outline: 2px solid var(--accent-2);
		outline-offset: 1px;
	}
	.control:disabled {
		opacity: 0.6;
	}
	.speed {
		min-width: 3rem;
		color: var(--chat-fg);
	}
	/* The "10" sits inside the circular arrow. */
	.skip-label {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		font-size: 0.45rem;
		font-weight: 700;
		padding-top: 0.05rem;
	}
	.clock {
		color: var(--chat-fg-muted);
	}
	.volume-slider {
		width: 0;
		opacity: 0;
		accent-color: var(--accent-2);
		transition:
			width 160ms ease,
			opacity 160ms ease;
	}
	.volume:hover .volume-slider,
	.volume:focus-within .volume-slider {
		width: 4.5rem;
		opacity: 1;
		margin-inline: 0.25rem;
	}
	.menu {
		color: var(--chat-fg);
		background: var(--chat-surface);
		box-shadow:
			0 0 0 1px var(--chat-border),
			0 12px 30px -8px rgb(0 0 0 / 0.45);
		z-index: 2;
	}
	.menu-item:hover,
	.menu-item:focus-visible {
		background: color-mix(in oklab, var(--chat-fg) 9%, transparent);
	}
	.menu-item[aria-checked='true'] {
		color: var(--accent-2);
		font-weight: 600;
	}
	@container video-bar (max-width: 29rem) {
		.skip,
		.download {
			display: none;
		}
		.volume-slider {
			display: none;
		}
	}
</style>
