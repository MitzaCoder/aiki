<script lang="ts">
	import { usesNativeScrollbars } from '#lib/scrollbars.js';

	/**
	 * A vertical overlay scrollbar for one scroller, drawn with the OverlayScrollbars markup and theme (so it looks like
	 * every other scrollbar) but driven by hand: the library re-measures its whole viewport on each update, which on a
	 * long chat that streams is a long task every few seconds. This reads only the scroller's scroll metrics, on scroll
	 * and resize. It shows while the reader scrolls (not while the scroller follows new output) and hides when idle.
	 * Place it beside the scroller in a positioned parent; on touch devices the scroller keeps its native scrollbar.
	 */
	let { scroller }: { scroller: HTMLElement | null | undefined } = $props();

	let scrollbar = $state<HTMLDivElement | null>(null);
	let track = $state<HTMLDivElement | null>(null);
	let handle = $state<HTMLDivElement | null>(null);

	/** How long after the reader's own input a scroll still counts as theirs. */
	const INPUT_WINDOW_MS = 1000;
	const HIDE_AFTER_MS = 700;

	$effect(() => {
		if (scroller == null || scrollbar == null || track == null || handle == null) return;
		if (usesNativeScrollbars()) return;
		return attach(scroller, scrollbar, track, handle);
	});

	/** Drives `bar` from `element`'s scrolling; returns what undoes it. */
	function attach(
		element: HTMLElement,
		bar: HTMLDivElement,
		barTrack: HTMLDivElement,
		barHandle: HTMLDivElement
	): () => void {
		element.style.scrollbarWidth = 'none';

		let lastInput = -Infinity;
		let hovered = false;
		let dragging = false;
		let hideTimer: ReturnType<typeof setTimeout> | undefined;

		function measure(): void {
			const range = element.scrollHeight - element.clientHeight;
			bar.classList.toggle('os-scrollbar-unusable', range <= 0);
			bar.style.setProperty('--os-viewport-percent', String(element.clientHeight / Math.max(element.scrollHeight, 1)));
			bar.style.setProperty('--os-scroll-percent', String(range > 0 ? element.scrollTop / range : 0));
		}
		function hideUnlessHeld(): void {
			if (!hovered && !dragging) bar.classList.add('os-scrollbar-auto-hide-hidden');
		}
		function show(): void {
			bar.classList.remove('os-scrollbar-auto-hide-hidden');
			clearTimeout(hideTimer);
			hideTimer = setTimeout(hideUnlessHeld, HIDE_AFTER_MS);
		}
		function noteInput(): void {
			lastInput = performance.now();
		}
		function onScroll(): void {
			measure();
			if (dragging || performance.now() - lastInput < INPUT_WINDOW_MS) show();
		}
		function onEnter(): void {
			hovered = true;
			bar.classList.add('os-scrollbar-interaction');
		}
		function onLeave(): void {
			hovered = false;
			bar.classList.remove('os-scrollbar-interaction');
			show();
		}
		function onHandleDown(event: PointerEvent): void {
			if (event.button !== 0) return;
			event.preventDefault();
			event.stopPropagation();
			barHandle.setPointerCapture(event.pointerId);
			dragging = true;
			const startY = event.clientY;
			const startTop = element.scrollTop;
			const scrollPerPixel =
				(element.scrollHeight - element.clientHeight) / Math.max(barTrack.clientHeight - barHandle.offsetHeight, 1);
			const onMove = (move: PointerEvent): void => {
				element.scrollTop = startTop + (move.clientY - startY) * scrollPerPixel;
			};
			const onUp = (): void => {
				dragging = false;
				barHandle.removeEventListener('pointermove', onMove);
				barHandle.removeEventListener('pointerup', onUp);
				barHandle.removeEventListener('pointercancel', onUp);
				show();
			};
			barHandle.addEventListener('pointermove', onMove);
			barHandle.addEventListener('pointerup', onUp);
			barHandle.addEventListener('pointercancel', onUp);
		}
		// A click on the track pages towards it, as on macOS.
		function onTrackDown(event: PointerEvent): void {
			if (event.button !== 0 || event.target !== barTrack) return;
			event.preventDefault();
			noteInput();
			const handleBox = barHandle.getBoundingClientRect();
			const direction = event.clientY < handleBox.top ? -1 : 1;
			element.scrollBy({ top: direction * element.clientHeight * 0.9 });
		}

		const resizes = new ResizeObserver(measure);
		resizes.observe(element);
		for (const child of element.children) resizes.observe(child);
		element.addEventListener('scroll', onScroll, { passive: true });
		for (const type of ['wheel', 'keydown', 'touchmove'] as const)
			element.addEventListener(type, noteInput, { passive: true });
		barTrack.addEventListener('pointerenter', onEnter);
		barTrack.addEventListener('pointerleave', onLeave);
		barTrack.addEventListener('pointerdown', onTrackDown);
		barHandle.addEventListener('pointerdown', onHandleDown);
		measure();
		return () => {
			resizes.disconnect();
			clearTimeout(hideTimer);
			element.removeEventListener('scroll', onScroll);
			for (const type of ['wheel', 'keydown', 'touchmove'] as const) element.removeEventListener(type, noteInput);
			barTrack.removeEventListener('pointerenter', onEnter);
			barTrack.removeEventListener('pointerleave', onLeave);
			barTrack.removeEventListener('pointerdown', onTrackDown);
			barHandle.removeEventListener('pointerdown', onHandleDown);
			element.style.scrollbarWidth = '';
		};
	}
</script>

<div
	bind:this={scrollbar}
	class="os-scrollbar os-scrollbar-vertical os-scrollbar-cornerless os-scrollbar-visible os-scrollbar-auto-hide os-scrollbar-auto-hide-hidden os-scrollbar-handle-interactive os-scrollbar-track-interactive os-theme-harness"
	aria-hidden="true"
>
	<div bind:this={track} class="os-scrollbar-track">
		<div bind:this={handle} class="os-scrollbar-handle"></div>
	</div>
</div>
