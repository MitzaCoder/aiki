<script lang="ts">
	import GaugeIcon from '@lucide/svelte/icons/gauge';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import MaximizeIcon from '@lucide/svelte/icons/maximize';
	import MinimizeIcon from '@lucide/svelte/icons/minimize';
	import PauseIcon from '@lucide/svelte/icons/pause';
	import PlayIcon from '@lucide/svelte/icons/play';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import RotateCwIcon from '@lucide/svelte/icons/rotate-cw';
	import StepBackIcon from '@lucide/svelte/icons/step-back';
	import StepForwardIcon from '@lucide/svelte/icons/step-forward';
	import Volume1Icon from '@lucide/svelte/icons/volume-1';
	import Volume2Icon from '@lucide/svelte/icons/volume-2';
	import VolumeXIcon from '@lucide/svelte/icons/volume-x';
	import type { HarnessClient } from '@aiki/client';
	import type { Artifact } from '@aiki/protocol';
	import { onDestroy, type Component } from 'svelte';
	import { artifactTitle, formatMediaDuration, MEDIA_RETRY_LIMIT } from '#lib/artifacts.js';
	import { downloadArtifact, useArtifactSource } from '#lib/artifacts.svelte.js';
	import {
		CONTROLS_IDLE_MS,
		CUE_MS,
		DOUBLE_TAP_MS,
		SKIP_SECONDS,
		accumulateSeek,
		classifyTap,
		formatRate,
		formatSeekCue,
		formatVolume,
		formatClock,
		loadVideoMemory,
		playerKeyAction,
		rememberPosition,
		resumeTime,
		saveVideoMemory,
		tapZone,
		videoKey,
		type PlayerAction,
		type Tap,
		type TapZone
	} from '#lib/video-player.js';
	import { VideoPlayer } from '#lib/video-player.svelte.js';
	import VideoControls from './VideoControls.svelte';

	/**
	 * A video in a rounded frame: its first frame (or where the reader stopped) with a big play button and its length
	 * until it is started, then the app's own controls, which fade when the pointer rests and come back on movement. A
	 * click plays or pauses and a double click goes fullscreen; on a phone a tap shows or hides the controls and a double
	 * tap on a half skips 10s. Keys work while the player has focus, or anywhere with `shortcuts` (the dialog). It picks up where the
	 * reader stopped and plays at the speed last chosen. When its URL is renewed while it plays, the old one keeps playing;
	 * the new one is loaded at the same time and state when the video pauses or fails (most often a token that ran out),
	 * up to `MEDIA_RETRY_LIMIT` times in a row.
	 */
	let {
		artifact,
		client,
		autoplay = false,
		compact = false,
		theater = false,
		shortcuts = false,
		ondownload,
		downloading: downloadingOutside = false
	}: {
		artifact: Artifact;
		client: HarnessClient;
		autoplay?: boolean;
		/** In the chat: shorter, so a portrait video does not fill the screen, and fewer controls. */
		compact?: boolean;
		/** Fill the parent, which is a size container (`container-type: size`), keeping the video's shape. */
		theater?: boolean;
		/** Take the player's keys anywhere on the page, not only while it has focus. */
		shortcuts?: boolean;
		/** The download button's action, when the page reports its failures; the player downloads by itself otherwise. */
		ondownload?: () => void;
		downloading?: boolean;
	} = $props();

	const player = new VideoPlayer();
	let src = $state<string | undefined>(undefined);
	// svelte-ignore state_referenced_locally
	let started = $state(autoplay);
	let waiting = $state(false);
	let failed = $state(false);
	let failures = $state(0);
	let metadataDuration = $state<number | undefined>(undefined);
	let ratio = $state<number | undefined>(undefined);
	let downloading = $state(false);
	/** Where to pick up after the URL is swapped. */
	let resume: { time: number; playing: boolean } | undefined;
	/** A seek asked for before the video could take it. */
	let pendingSeek: number | undefined;
	let restored = false;
	/** The remembered place the video was opened at, offered as "Start over" for a while. */
	let resumedFrom = $state<number | undefined>(undefined);
	let resumedNotice = $state(false);
	let noticeOffered = false;

	const source = useArtifactSource(() => ({ client, projectId: artifact.projectId, artifactId: artifact.id }));
	const fresh = $derived(source.current?.url);
	const length = $derived(formatMediaDuration(metadataDuration ?? artifact.durationSeconds));
	const title = $derived(artifactTitle(artifact));
	const memoryKey = $derived(videoKey(artifact.projectId, artifact.id));
	const full = $derived(!compact || player.fullscreen);

	$effect(() => {
		const next = fresh;
		if (next === undefined || next === src) return;
		if (src === undefined || player.video == null) {
			src = next;
			return;
		}
		// The playing one keeps its connection; the new URL waits for a pause or a failure.
		if (!player.video.paused && !failed) return;
		swap(next);
	});

	$effect(() => player.watchFullscreen());
	$effect(() => player.watchPictureInPicture(player.video));

	function swap(next: string): void {
		const video = player.video;
		resume = video == null ? undefined : { time: video.currentTime, playing: !video.paused && !failed };
		failed = false;
		src = next;
	}

	function onloadedmetadata(): void {
		const video = player.video;
		if (video == null) return;
		player.sync();
		player.applyRate();
		if (Number.isFinite(video.duration)) metadataDuration = video.duration;
		if (video.videoWidth > 0 && video.videoHeight > 0) ratio = video.videoWidth / video.videoHeight;
		if (resume !== undefined) {
			const { time, playing } = resume;
			resume = undefined;
			if (time > 0) video.currentTime = time;
			if (playing) player.play();
			return;
		}
		if (pendingSeek !== undefined) {
			video.currentTime = pendingSeek;
			pendingSeek = undefined;
			restored = true;
			return;
		}
		if (!restored) {
			restored = true;
			const saved = resumeTime(loadVideoMemory().positions[memoryKey]?.time, video.duration);
			if (saved !== undefined) {
				video.currentTime = saved;
				resumedFrom = saved;
				return;
			}
		}
		// Paint the first frame: some phones show black for a video that has not been seeked.
		if (!started && video.currentTime === 0) video.currentTime = 0.001;
	}

	async function onerror(): Promise<void> {
		failed = true;
		waiting = false;
		if (failures >= MEDIA_RETRY_LIMIT) return;
		failures += 1;
		const renewed = await source.current?.recover();
		if (renewed === true && source.current?.url !== undefined) swap(source.current.url);
	}

	function onpause(): void {
		player.sync();
		savePosition(player.video, true);
		reveal();
		if (fresh !== undefined && fresh !== src) swap(fresh);
	}

	function play(): void {
		started = true;
		failures = 0;
		player.play();
	}

	/** The poster's button goes away once it plays: the keyboard moves to the player. */
	function start(): void {
		play();
		player.frame?.focus({ preventScroll: true });
	}

	function retry(): void {
		failures = 0;
		void onerror();
	}

	async function download(): Promise<void> {
		downloading = true;
		try {
			await downloadArtifact(client, artifact);
		} catch {
			// The dialog's own button reports failures; this one only stops spinning.
		} finally {
			downloading = false;
		}
	}

	// Remembering the place.

	let savedAt = 0;

	function savePosition(video: HTMLVideoElement | null, force = false): void {
		if (video == null || !started || !Number.isFinite(video.duration)) return;
		const now = Date.now();
		if (!force && now - savedAt < 2000) return;
		savedAt = now;
		saveVideoMemory(rememberPosition(loadVideoMemory(), memoryKey, video.currentTime, video.duration, now));
	}

	$effect(() => {
		const video = player.video;
		return () => savePosition(video, true);
	});

	// Showing and hiding the controls.

	let active = $state(true);
	let holding = $state(false);
	let keyboardInside = $state(false);
	let idleTimer: ReturnType<typeof setTimeout> | undefined;
	/** A tap on a phone hid them, even while paused. */
	let tappedAway = $state(false);
	let overBar = $state(false);
	/**
	 * Up on movement, and while the pointer, a menu or the keyboard is on them. They hide when the pointer rests even while
	 * paused: QA recordings burn their captions in at the bottom, where the bar is, and a reader pauses to read them.
	 */
	const controlsShown = $derived(started && !tappedAway && (active || holding || keyboardInside || overBar || player.ended));

	/** Show the controls, and hide them again after a while. */
	function reveal(pointer = false): void {
		if (keyQuiet && !pointer) return;
		active = true;
		tappedAway = false;
		clearTimeout(idleTimer);
		idleTimer = setTimeout(() => (active = false), CONTROLS_IDLE_MS);
	}

	/**
	 * Set while a keyboard shortcut acts: the play, pause and seek events it causes must not bring the bar up over the
	 * captions. The events come a little after the key, so it clears on a timer.
	 */
	let keyQuiet = false;
	let keyQuietTimer: ReturnType<typeof setTimeout> | undefined;

	function quietForKey(): void {
		keyQuiet = true;
		clearTimeout(keyQuietTimer);
		keyQuietTimer = setTimeout(() => (keyQuiet = false), 400);
		keyboardInside = false;
		tappedAway = false;
		conceal();
	}

	function conceal(): void {
		clearTimeout(idleTimer);
		active = false;
	}

	// Pointers on the video.

	let pointerType = 'mouse';
	let lastTap: Tap | undefined;
	let tapTimer: ReturnType<typeof setTimeout> | undefined;

	// The centred cue: a quick flash for what a key (or a double tap) just did, over the middle of the video and away from
	// the captions at the bottom.

	type Cue = { id: number; icon: Component<{ class?: string }>; text?: string; label: string; side: 'left' | 'right' | 'middle'; seconds?: number };
	let cue = $state.raw<Cue | undefined>(undefined);
	let cueTimer: ReturnType<typeof setTimeout> | undefined;
	let cueCount = 0;

	function showCue(next: Omit<Cue, 'id'>): void {
		cue = { ...next, id: ++cueCount };
		clearTimeout(cueTimer);
		cueTimer = setTimeout(() => (cue = undefined), CUE_MS);
	}

	/** A seek adds to the one still showing on the same side, so three presses read "+15s". */
	function showSeekCue(by: number): void {
		const seconds = accumulateSeek(cue?.seconds, by);
		const text = formatSeekCue(seconds);
		showCue({ icon: by < 0 ? RotateCcwIcon : RotateCwIcon, text, label: `${seconds < 0 ? 'Back' : 'Forward'} ${Math.abs(seconds)} seconds`, side: by < 0 ? 'left' : 'right', seconds });
	}

	function showVolumeCue(): void {
		const video = player.video;
		if (video == null) return;
		const silent = video.muted || video.volume === 0;
		const text = silent ? 'Muted' : formatVolume(video.volume);
		showCue({ icon: silent ? VolumeXIcon : video.volume < 0.5 ? Volume1Icon : Volume2Icon, text, label: silent ? 'Muted' : `Volume ${text}`, side: 'middle' });
	}

	/** The cue for `action`, called after it ran (`wasPaused` and `wasFullscreen` are what they were before). */
	function showActionCue(action: PlayerAction, wasPaused: boolean, wasFullscreen: boolean): void {
		switch (action.kind) {
			case 'toggle':
				return showCue({ icon: wasPaused ? PlayIcon : PauseIcon, label: wasPaused ? 'Playing' : 'Paused', side: 'middle' });
			case 'seek':
				return showSeekCue(action.by);
			case 'volume':
			case 'mute':
				return showVolumeCue();
			case 'rate':
				return showCue({ icon: GaugeIcon, text: formatRate(player.rate), label: `Speed ${formatRate(player.rate)}`, side: 'middle' });
			case 'frame':
				return showCue({ icon: action.by < 0 ? StepBackIcon : StepForwardIcon, text: action.by < 0 ? 'Previous frame' : 'Next frame', label: action.by < 0 ? 'Previous frame' : 'Next frame', side: 'middle' });
			case 'fullscreen':
				return showCue({ icon: wasFullscreen ? MinimizeIcon : MaximizeIcon, text: wasFullscreen ? 'Exit fullscreen' : 'Fullscreen', label: wasFullscreen ? 'Exit fullscreen' : 'Fullscreen', side: 'middle' });
		}
	}

	function onsurfacepointerup(event: PointerEvent): void {
		pointerType = event.pointerType;
		if (event.pointerType !== 'touch') return;
		const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
		const tap: Tap = { at: event.timeStamp, zone: tapZone(event.clientX, rect.left, rect.width) };
		const kind = classifyTap(lastTap, tap);
		lastTap = tap;
		clearTimeout(tapTimer);
		if (kind === 'double') {
			skip(tap.zone);
			return;
		}
		tapTimer = setTimeout(() => {
			if (controlsShown) {
				conceal();
				tappedAway = true;
			} else {
				reveal();
			}
		}, DOUBLE_TAP_MS);
	}

	function skip(zone: TapZone): void {
		const by = zone === 'left' ? -SKIP_SECONDS : SKIP_SECONDS;
		player.seekBy(by);
		showSeekCue(by);
	}

	function onsurfaceclick(): void {
		if (pointerType === 'touch') return;
		player.toggle();
		reveal(true);
	}

	function onsurfacedblclick(): void {
		if (pointerType !== 'touch') player.toggleFullscreen();
	}

	function onframepointermove(event: PointerEvent): void {
		if (event.pointerType === 'mouse' || event.pointerType === 'pen') reveal(true);
	}

	// Keys.

	function shortcut(event: KeyboardEvent): void {
		if (event.defaultPrevented || src === undefined) return;
		const target = event.target as HTMLElement | null;
		if (target?.closest('textarea, select, [contenteditable=""], [contenteditable="true"], [role="menu"]')) return;
		if (target instanceof HTMLInputElement && (target.type !== 'range' || event.key.startsWith('Arrow'))) return;
		if ((event.key === ' ' || event.key === 'Enter') && target?.closest('button, a, summary')) return;
		const action = playerKeyAction(event, player.paused);
		if (action === undefined) return;
		event.preventDefault();
		if (!started) {
			if (action.kind === 'toggle') play();
			return;
		}
		quietForKey();
		const wasPaused = player.paused;
		const wasFullscreen = player.fullscreen;
		player.run(action);
		showActionCue(action, wasPaused, wasFullscreen);
	}

	function onwindowkeydown(event: KeyboardEvent): void {
		if (shortcuts && !player.frame?.contains(event.target as Node)) shortcut(event);
	}

	onDestroy(() => {
		clearTimeout(idleTimer);
		clearTimeout(keyQuietTimer);
		clearTimeout(tapTimer);
		clearTimeout(cueTimer);
	});

	/** Jump to `seconds` and play from there: a time in the note was clicked. */
	export function seek(seconds: number): void {
		resumedNotice = false;
		noticeOffered = true;
		const video = player.video;
		if (video == null || video.readyState < HTMLMediaElement.HAVE_METADATA) {
			pendingSeek = seconds;
			play();
			return;
		}
		player.seekTo(seconds);
		if (!started || video.paused) play();
		reveal();
	}

	/** Pause it, for a slide that stopped being the one showing; the place is remembered as for any pause. */
	export function pause(): void {
		player.video?.pause();
	}

	/** Whether it is playing now. */
	export function isPlaying(): boolean {
		return started && player.video != null && !player.video.paused && !player.video.ended;
	}

	/** Give the player the keyboard, so space plays rather than pressing whatever had focus. */
	export function focus(): void {
		player.frame?.focus({ preventScroll: true });
	}
</script>

<svelte:window onkeydown={shortcuts ? onwindowkeydown : undefined} />

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
	bind:this={player.frame}
	class="video-frame group relative w-full overflow-hidden rounded-2xl bg-black outline-none"
	class:compact
	class:theater
	class:idle={started && !controlsShown}
	style:--ratio={ratio ?? 16 / 9}
	role="region"
	aria-label="Video player: {title}"
	tabindex="-1"
	onkeydown={shortcut}
	onpointermove={onframepointermove}
	onpointerleave={(event) => {
		if (event.pointerType === 'mouse') conceal();
	}}
	data-artifact-video
>
	{#if src !== undefined}
		<video
			bind:this={player.video}
			{src}
			class="absolute inset-0 size-full object-contain"
			playsinline
			preload="metadata"
			autoplay={autoplay || started}
			{onloadedmetadata}
			{onerror}
			{onpause}
			onplay={() => {
				player.sync();
				reveal();
			}}
			onplaying={() => {
				started = true;
				waiting = false;
				failures = 0;
				player.sync();
				if (resumedFrom !== undefined && !noticeOffered) {
					noticeOffered = true;
					resumedNotice = true;
					setTimeout(() => (resumedNotice = false), 6000);
				}
			}}
			onwaiting={() => (waiting = true)}
			oncanplay={() => (waiting = false)}
			ontimeupdate={() => {
				player.sync();
				savePosition(player.video);
			}}
			ondurationchange={() => player.sync()}
			onprogress={() => player.sync()}
			onseeked={() => player.sync()}
			onvolumechange={() => player.sync()}
			onratechange={() => {
				if (player.video != null && player.video.playbackRate !== player.rate && player.video.playbackRate > 0) player.rate = player.video.playbackRate;
			}}
			onended={() => {
				player.sync();
				savePosition(player.video, true);
				reveal();
			}}
		>
			<track kind="captions" />
		</video>
	{/if}

	{#if started}
		<!-- Pointer only: the keys and the controls below do the same for a keyboard. -->
		<div
			class="surface absolute inset-0"
			role="presentation"
			onpointerup={onsurfacepointerup}
			onclick={onsurfaceclick}
			ondblclick={onsurfacedblclick}
		></div>
	{/if}

	{#if !started && !failed}
		<button
			type="button"
			class="poster absolute inset-0 flex flex-col justify-between p-3 text-left text-white"
			onclick={start}
			aria-label="{resumedFrom === undefined ? 'Play' : `Resume at ${formatClock(resumedFrom)}`} {title}"
			disabled={src === undefined}
		>
			<span class="truncate text-sm font-semibold drop-shadow">{compact ? '' : title}</span>
			<span class="play-button absolute top-1/2 left-1/2 grid size-14 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full">
				{#if src === undefined}
					<LoaderCircleIcon class="size-6 animate-spin" />
				{:else}
					<PlayIcon class="size-6 translate-x-0.5 fill-current" />
				{/if}
			</span>
			{#if length}
				<span class="self-end rounded-md bg-black/60 px-1.5 py-0.5 font-mono text-xs tabular-nums">
					{resumedFrom === undefined ? length : `${formatClock(resumedFrom)} / ${length}`}
				</span>
			{/if}
			{#if resumedFrom !== undefined && metadataDuration}
				<span class="resume-line absolute inset-x-0 bottom-0 h-1" style:--progress="{(resumedFrom / metadataDuration) * 100}%"></span>
			{/if}
		</button>
	{/if}

	{#if started && waiting && !failed && !player.paused}
		<span class="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-white/85" role="status" aria-label="Loading">
			<LoaderCircleIcon class="size-9 animate-spin drop-shadow" />
		</span>
	{/if}

	<!-- Heard by screen readers: one region that stays, so each change is read out. -->
	<span class="sr-only" role="status" aria-live="polite">{cue?.label ?? ''}</span>
	{#if cue !== undefined}
		{#key cue.id}
			<span
				class="cue pointer-events-none absolute top-1/2 flex items-center justify-center rounded-full text-white {cue.side === 'left' ? 'left-[18%]' : cue.side === 'right' ? 'right-[18%]' : 'left-1/2'} {cue.text === undefined ? 'size-16' : 'min-w-16 flex-col gap-1 px-5 py-4 text-xs font-semibold'}"
				class:middle={cue.side === 'middle'}
				aria-hidden="true"
				data-key-cue
			>
				<cue.icon class={cue.text === undefined ? 'size-7 fill-current' : 'size-5'} />
				{#if cue.text !== undefined}<span class="whitespace-nowrap tabular-nums">{cue.text}</span>{/if}
			</span>
		{/key}
	{/if}

	{#if resumedNotice && resumedFrom !== undefined && started}
		<div class="notice absolute top-2 left-2 flex items-center gap-2 rounded-lg py-1 pr-1 pl-2.5 text-xs" role="status">
			<span>Resumed at {formatClock(resumedFrom)}</span>
			<button
				type="button"
				class="rounded-md px-2 py-1 font-medium text-(--accent-2) hover:bg-(--accent-2)/12"
				onclick={() => {
					resumedNotice = false;
					player.seekTo(0);
					player.play();
				}}
			>
				Start over
			</button>
		</div>
	{/if}

	{#if failed && failures >= MEDIA_RETRY_LIMIT}
		<div class="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 p-4 text-center text-sm text-white" role="alert">
			<p>The video could not be loaded.</p>
			{#if source.current?.error}<p class="text-xs text-white/70">{source.current.error}</p>{/if}
			<button type="button" class="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-xs font-medium hover:bg-white/25" onclick={retry}>
				<RotateCwIcon class="size-3.5" /> Try again
			</button>
		</div>
	{:else if started}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="bar absolute inset-x-2 bottom-2"
			class:hidden-bar={!controlsShown}
			onmousedown={(event) => {
				// Clicking a control keeps the keyboard on the player, so space still plays and pauses.
				if (!(event.target instanceof HTMLInputElement)) event.preventDefault();
			}}
			onfocusin={(event) => {
				keyboardInside = (event.target as HTMLElement).matches(':focus-visible');
				if (keyboardInside) tappedAway = false;
			}}
			onfocusout={() => (keyboardInside = false)}
			onpointerenter={(event) => (overBar = event.pointerType !== 'touch')}
			onpointerleave={() => (overBar = false)}
		>
			<VideoControls
				{player}
				{full}
				downloading={downloading || downloadingOutside}
				ondownload={full ? (ondownload ?? download) : undefined}
				onhold={(value) => {
					holding = value;
					if (!value) reveal();
				}}
			/>
		</div>
	{/if}
</div>

<style>
	/* At its height limit a portrait video's frame narrows to the video instead of growing black bars. */
	.video-frame {
		--frame-height: min(70dvh, 40rem);
		aspect-ratio: var(--ratio);
		max-height: var(--frame-height);
		max-width: calc(var(--frame-height) * var(--ratio));
		margin-inline: auto;
		box-shadow:
			0 0 0 1px color-mix(in oklab, var(--chat-border) 80%, transparent),
			0 10px 30px -12px rgb(0 0 0 / 0.45);
	}
	.video-frame.compact {
		--frame-height: min(55dvh, 22rem);
	}
	.video-frame.theater {
		width: min(100cqw, 100cqh * var(--ratio));
		max-height: none;
		max-width: none;
		border-radius: 0.75rem;
	}
	.video-frame:fullscreen {
		max-height: none;
		max-width: none;
		border-radius: 0;
	}
	.video-frame.idle {
		cursor: none;
	}
	.video-frame:focus-visible {
		outline: 2px solid var(--accent-2);
		outline-offset: 2px;
	}
	/* The controls drop buttons by the bar's width (`VideoControls`). */
	.bar {
		container: video-bar / inline-size;
		transition:
			opacity 120ms ease,
			translate 120ms ease;
	}
	.bar.hidden-bar {
		opacity: 0;
		translate: 0 0.5rem;
		pointer-events: none;
	}
	.poster {
		background: linear-gradient(to bottom, rgb(0 0 0 / 0.45), transparent 35%, transparent 70%, rgb(0 0 0 / 0.4));
	}
	.resume-line {
		background: linear-gradient(to right, var(--accent-2) var(--progress), rgb(255 255 255 / 0.25) var(--progress));
	}
	.play-button {
		background: rgb(255 255 255 / 0.18);
		backdrop-filter: blur(10px);
		box-shadow: 0 0 0 1px rgb(255 255 255 / 0.35), 0 8px 24px rgb(0 0 0 / 0.35);
		transition: scale 160ms ease, background-color 160ms ease;
	}
	.poster:hover .play-button,
	.poster:focus-visible .play-button {
		scale: 1.06;
		background: rgb(255 255 255 / 0.28);
	}
	.poster:focus-visible {
		outline: 2px solid var(--accent-2);
		outline-offset: -2px;
	}
	/* Quick: in, hold, out (CUE_MS). The cue sits on the vertical middle, so it never reaches the bottom-left captions. */
	.cue {
		background: rgb(0 0 0 / 0.5);
		backdrop-filter: blur(6px);
		box-shadow: 0 0 0 1px rgb(255 255 255 / 0.18);
		translate: 0 -50%;
		animation: cue 550ms ease-out forwards;
	}
	.cue.middle {
		translate: -50% -50%;
	}
	@keyframes cue {
		0% {
			opacity: 0;
			scale: 0.8;
		}
		25% {
			opacity: 1;
			scale: 1;
		}
		60% {
			opacity: 1;
		}
		100% {
			opacity: 0;
			scale: 1.15;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.cue {
			animation-name: cue-fade;
		}
	}
	@keyframes cue-fade {
		0% {
			opacity: 0;
		}
		20%,
		60% {
			opacity: 1;
		}
		100% {
			opacity: 0;
		}
	}
	.notice {
		color: var(--chat-fg);
		background: color-mix(in oklab, var(--chat-surface) 88%, transparent);
		backdrop-filter: blur(10px);
		box-shadow: 0 0 0 1px var(--chat-border);
	}
</style>
