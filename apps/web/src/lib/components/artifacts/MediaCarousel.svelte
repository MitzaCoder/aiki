<script lang="ts">
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import { onMount, untrack, type Snippet } from 'svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import { MEDIA_MOTION, nearestSlide, scrollPosition, slideLook, stepIndex } from '#lib/media-gallery.js';

	/**
	 * A row of slides, one at a time, the neighbours peeking: the generic part of the media carousel, used inline in a task
	 * and full screen in the viewer (`variant`). It is a native scroll-snap row, so a touch swipe has the platform's
	 * momentum and snapping; arrows, ←/→, Home and End (while it has focus) move by one. `index` follows the slide nearest the
	 * middle as it scrolls and moves the row when changed from outside. Slides look dimmer and a little smaller beside the
	 * middle, following the scroll; with reduced motion they only differ by a fixed dimming. What a slide shows is the
	 * `slide` snippet's.
	 */
	let {
		count,
		keys,
		labels,
		label,
		index = $bindable(0),
		variant = 'inline',
		root = $bindable<HTMLElement | undefined>(undefined),
		instant = false,
		slide,
		onsettle
	}: {
		count: number;
		/** One stable key per slide. */
		keys: readonly string[];
		/** Each slide's accessible name, e.g. "Screenshot 3 of 8: Checkout". */
		labels: readonly string[];
		/** The carousel's own accessible name. */
		label: string;
		index?: number;
		variant?: 'inline' | 'viewer';
		root?: HTMLElement | undefined;
		/** Moves from outside jump instead of scrolling: the row is covered (the viewer is open). */
		instant?: boolean;
		slide: Snippet<[index: number, active: boolean]>;
		/** The row stopped moving at the slide `index`. */
		onsettle?: (index: number) => void;
	} = $props();

	let track = $state<HTMLDivElement>();
	const reduced = new MediaQuery('(prefers-reduced-motion: reduce)');
	/** A move the code asked for is under way: the scroll must not feed back into `index`. */
	let programmatic = false;
	/** Until when a finger, wheel or pointer is taken to be moving the row: only then does its scroll position set `index`. */
	let userUntil = 0;
	/** Where a move the code asked for ends; reaching it settles at once. */
	let target: number | undefined;
	let frame = 0;
	/** The frame callback of our own scroll animation, while one runs. */
	let moveFrame = 0;
	let settleTimer: ReturnType<typeof setTimeout> | undefined;
	const touched = new Set<number>();

	function slides(): HTMLElement[] {
		return !track ? [] : [...track.children].filter((child): child is HTMLElement => child instanceof HTMLElement && child.dataset.slide !== undefined);
	}

	/** The distance from one slide's middle to the next's; the whole width when there is only one. */
	function pitch(): number {
		const [first, second] = slides();
		if (first === undefined) return 0;
		return second === undefined ? first.offsetWidth : second.offsetLeft - first.offsetLeft;
	}

	function applyLook(position: number): void {
		if (variant === 'viewer' || reduced.current) return;
		const items = slides();
		const low = Math.max(0, Math.floor(position) - 1);
		const high = Math.min(count - 1, Math.ceil(position) + 1);
		for (const at of touched) {
			if (at >= low && at <= high) continue;
			const element = items[at];
			if (element !== undefined) {
				element.style.removeProperty('transform');
				element.style.removeProperty('opacity');
			}
			touched.delete(at);
		}
		for (let at = low; at <= high; at += 1) {
			const element = items[at];
			if (element === undefined) continue;
			const look = slideLook(at - position);
			element.style.transform = `scale(${look.scale})`;
			element.style.opacity = String(look.opacity);
			touched.add(at);
		}
	}

	function update(): void {
		if (!track) return;
		const step = pitch();
		applyLook(step > 0 ? track.scrollLeft / step : 0);
		// Scrolling nobody asked for (the browser re-snapping, an ancestor re-parenting the row) must not change the slide.
		if (programmatic) return;
		if (performance.now() > userUntil) {
			// Nobody asked for this move: put the row back on the slide it shows.
			const want = index * step;
			if (step > 0 && Math.abs(track.scrollLeft - want) > 2) track.scrollTo({ left: want, behavior: 'auto' });
			return;
		}
		userUntil = performance.now() + 400;
		const next = nearestSlide(track.scrollLeft, step, count);
		if (next !== index) index = next;
	}

	/** Ends our own scroll animation and gives the row its scroll snapping back (which then lands on the nearest slide). */
	function stopMove(): void {
		if (moveFrame !== 0) cancelAnimationFrame(moveFrame);
		moveFrame = 0;
		track?.style.removeProperty('scroll-snap-type');
	}

	/** Scrolls the row to `left` in `slideMs` with a strong ease-out; native smooth scrolling is slow and cannot be tuned. */
	function moveTo(left: number): void {
		if (!track) return;
		stopMove();
		const row = track;
		const from = row.scrollLeft;
		const started = performance.now();
		// Snapping would pull the row back to a slide on every frame of the move.
		row.style.scrollSnapType = 'none';
		const step = (now: number): void => {
			const elapsed = now - started;
			row.scrollLeft = scrollPosition(from, left, elapsed, MEDIA_MOTION.slideMs);
			const size = pitch();
			applyLook(size > 0 ? row.scrollLeft / size : 0);
			if (elapsed < MEDIA_MOTION.slideMs) {
				moveFrame = requestAnimationFrame(step);
				return;
			}
			moveFrame = 0;
			row.scrollLeft = left;
			row.style.removeProperty('scroll-snap-type');
			clearTimeout(settleTimer);
			settleTimer = setTimeout(settle, 30);
		};
		moveFrame = requestAnimationFrame(step);
	}

	function settle(): void {
		stopMove();
		// A move that never got going (a hidden tab, no frames) is finished at once, so the view agrees with `index`.
		if (programmatic && target !== undefined && track && Math.abs(track.scrollLeft - target) > 2) {
			track.scrollTo({ left: target, behavior: 'auto' });
		}
		programmatic = false;
		target = undefined;
		update();
		onsettle?.(index);
	}

	function onscroll(): void {
		if (frame === 0) {
			frame = requestAnimationFrame(() => {
				frame = 0;
				update();
			});
		}
		clearTimeout(settleTimer);
		// A move the code asked for settles on arrival, or when the row has been still for a good while.
		if (programmatic && target !== undefined && track && Math.abs(track.scrollLeft - target) < 1.5) settleTimer = setTimeout(settle, 30);
		else settleTimer = setTimeout(settle, programmatic ? MEDIA_MOTION.slideMs + 300 : 110);
	}

	/** A finger, wheel or key press on the row takes the move over from code. */
	function takeOver(): void {
		stopMove();
		programmatic = false;
		target = undefined;
		userUntil = performance.now() + 1200;
	}

	/** Move to a slide: a short animation, unless the reader asked for reduced motion or `instant`. */
	export function goTo(slideAt: number, options: { instant?: boolean } = {}): void {
		if (!track || count === 0) return;
		const at = Math.min(count - 1, Math.max(0, slideAt));
		const jump = options.instant === true || reduced.current;
		programmatic = true;
		index = at;
		target = at * pitch();
		clearTimeout(settleTimer);
		if (jump) {
			stopMove();
			track.scrollTo({ left: target, behavior: 'auto' });
			settleTimer = setTimeout(settle, 60);
			return;
		}
		moveTo(target);
		// A hidden tab runs no frames: settle jumps to the target then.
		settleTimer = setTimeout(settle, MEDIA_MOTION.slideMs + 300);
	}

	/** A slide's element, for a flight that starts or ends on it. */
	export function slideElement(at: number): HTMLElement | undefined {
		return slides()[at];
	}

	// A change of `index` from outside moves the row; the row's own scrolling already agrees with it.
	$effect(() => {
		const wanted = index;
		untrack(() => {
			if (!track || count === 0) return;
			const step = pitch();
			if (nearestSlide(track.scrollLeft, step, count) === wanted) return;
			goTo(wanted, { instant });
		});
	});

	// A new set of slides (a filter changed) starts again at the same index, and slides get their look.
	$effect(() => {
		void keys;
		void count;
		untrack(() => {
			touched.clear();
			if (!track) return;
			const at = Math.min(Math.max(0, index), Math.max(0, count - 1));
			if (at !== index) index = at;
			track.scrollLeft = at * pitch();
			applyLook(at);
		});
	});

	$effect(() => {
		void reduced.current;
		untrack(() => {
			for (const at of touched) {
				const element = slides()[at];
				element?.style.removeProperty('transform');
				element?.style.removeProperty('opacity');
			}
			touched.clear();
			if (track && pitch() > 0) applyLook(track.scrollLeft / pitch());
		});
	});

	onMount(() => {
		if (!track) return;
		track.scrollLeft = index * pitch();
		applyLook(index);
		// A new width changes the pitch: stay on the same slide.
		const observer = new ResizeObserver(() => {
			if (!track || programmatic) return;
			track.scrollLeft = index * pitch();
			applyLook(index);
		});
		observer.observe(track);
		return () => {
			observer.disconnect();
			stopMove();
			clearTimeout(settleTimer);
			if (frame !== 0) cancelAnimationFrame(frame);
		};
	});

	function onkeydown(event: KeyboardEvent): void {
		if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
		const target = event.target as HTMLElement;
		if (target !== root && target.closest('[data-carousel-nav]') === null) return;
		const next = stepIndex(index, count, event.key);
		if (next === undefined) return;
		event.preventDefault();
		if (next !== index) goTo(next);
	}

	function onslideclick(event: MouseEvent, at: number): void {
		if (at === index) return;
		// A tap on a neighbour brings it to the middle instead of acting on what it shows.
		event.preventDefault();
		event.stopPropagation();
		goTo(at);
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
	bind:this={root}
	class="carousel group/carousel relative"
	class:viewer={variant === 'viewer'}
	role="region"
	aria-roledescription="carousel"
	aria-label={label}
	tabindex={variant === 'viewer' ? -1 : 0}
	onkeydown={variant === 'viewer' ? undefined : onkeydown}
	data-media-carousel
>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div bind:this={track} class="track" {onscroll} onpointerdown={takeOver} onwheel={takeOver} data-carousel-track>
		{#each keys as key, at (key)}
			<div
				class="slide"
				role="group"
				aria-roledescription="slide"
				aria-label={labels[at]}
				data-slide={at}
				data-active={at === index}
				onclickcapture={(event) => onslideclick(event, at)}
				onfocusin={() => at !== index && goTo(at)}
			>
				{@render slide(at, at === index)}
			</div>
		{/each}
	</div>

	{#if count > 1}
		<button
			type="button"
			class="nav prev"
			data-carousel-nav
			aria-label="Previous"
			title="Previous (←)"
			disabled={index <= 0}
			onclick={() => goTo(index - 1)}
		>
			<ChevronLeftIcon class="size-5" />
		</button>
		<button
			type="button"
			class="nav next"
			data-carousel-nav
			aria-label="Next"
			title="Next (→)"
			disabled={index >= count - 1}
			onclick={() => goTo(index + 1)}
		>
			<ChevronRightIcon class="size-5" />
		</button>
	{/if}
	<span class="sr-only" aria-live="polite" aria-atomic="true">{labels[index] ?? ''}</span>
</div>

<style>
	.carousel {
		container-type: inline-size;
		--slide-w: 84cqw;
		--slide-h: min(max(18rem, 48cqw), 60dvh);
		--slide-gap: 0.75rem;
		border-radius: 1rem;
		outline: none;
	}
	.carousel.viewer {
		--slide-w: 100cqw;
		--slide-h: 100%;
		--slide-gap: 0rem;
		height: 100%;
		border-radius: 0;
	}
	.carousel:not(.viewer):focus-visible {
		outline: 2px solid var(--accent-2);
		outline-offset: 2px;
	}
	.track {
		display: flex;
		gap: var(--slide-gap);
		overflow-x: auto;
		overflow-y: hidden;
		padding-inline: calc((100cqw - var(--slide-w)) / 2);
		scroll-snap-type: x mandatory;
		overscroll-behavior-x: contain;
		scrollbar-width: none;
		height: 100%;
	}
	.track::-webkit-scrollbar {
		display: none;
	}
	.slide {
		position: relative;
		flex: none;
		width: var(--slide-w);
		height: var(--slide-h);
		scroll-snap-align: center;
		scroll-snap-stop: always;
		/* What the look function leaves alone: the slides further away. */
		transform: scale(0.93);
		opacity: 0.55;
		transform-origin: center;
		will-change: transform, opacity;
	}
	.viewer .slide {
		transform: none;
		opacity: 1;
		will-change: auto;
	}
	@media (prefers-reduced-motion: reduce) {
		.slide {
			transform: none;
			opacity: 0.6;
		}
		.slide[data-active='true'] {
			opacity: 1;
		}
		.viewer .slide {
			opacity: 1;
		}
		.track {
			scroll-behavior: auto;
		}
	}
	.nav {
		position: absolute;
		top: 50%;
		translate: 0 -50%;
		z-index: 2;
		display: grid;
		place-items: center;
		width: 2.5rem;
		height: 2.5rem;
		border-radius: 9999px;
		color: white;
		background: rgb(0 0 0 / 0.5);
		backdrop-filter: blur(6px);
		box-shadow: 0 0 0 1px rgb(255 255 255 / 0.2);
		opacity: 0;
		transition:
			opacity 160ms ease,
			background-color 120ms ease;
	}
	.nav.prev {
		left: 0.5rem;
	}
	.nav.next {
		right: 0.5rem;
	}
	.carousel:hover .nav:not(:disabled),
	.carousel:focus-within .nav:not(:disabled) {
		opacity: 1;
	}
	.nav:hover:not(:disabled) {
		background: rgb(0 0 0 / 0.7);
	}
	.nav:focus-visible {
		opacity: 1;
		outline: 2px solid var(--accent-2);
		outline-offset: 2px;
	}
	.nav:disabled {
		opacity: 0;
		pointer-events: none;
	}
	/* A touch screen swipes; the arrows would only cover the picture. */
	@media (hover: none) and (pointer: coarse) {
		.nav {
			display: none;
		}
	}
</style>
