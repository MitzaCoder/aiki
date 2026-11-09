<script lang="ts">
	import { onMount } from 'svelte';
	import {
		ZOOM_FIT,
		ZOOM_MIN,
		clampZoom,
		fittedSize,
		isDismissSwipe,
		toggleZoom,
		wheelFactor,
		zoomAround,
		type Zoom
	} from '#lib/artifacts.js';

	/**
	 * An image fitted into its parent, zoomed with the wheel, a pinch, a double click or tap or `step`, and panned by
	 * dragging; the maths is `lib/artifacts.ts`. At fit, a swipe down (touch) or a click beside the image calls `ondismiss`
	 * (the swipe leaves the image where the finger let go, so the parent can fly it away from there), and `pull` follows the
	 * finger meanwhile. With `swipeAcross`, horizontal drags at fit are left to the browser (the carousel the pane sits in
	 * scrolls); zoomed in, the pane pans instead. Used by the image lightbox and the media viewer.
	 */
	let {
		src,
		alt,
		active = true,
		swipeAcross = false,
		zoom = $bindable(ZOOM_FIT),
		pull = $bindable(0),
		gesturing = $bindable(false),
		frame = $bindable<HTMLDivElement | undefined>(undefined),
		image = $bindable<HTMLImageElement | undefined>(undefined),
		onready,
		onerror,
		ondismiss
	}: {
		src: string;
		alt: string;
		/** Whether keys (+, −, 0) and the zoom apply: false for a slide that is not showing. */
		active?: boolean;
		swipeAcross?: boolean;
		zoom?: Zoom;
		/** How far a swipe down at fit has pulled the image, in pixels. */
		pull?: number;
		gesturing?: boolean;
		/** The element the pane fills; a flight animates it. */
		frame?: HTMLDivElement | undefined;
		image?: HTMLImageElement | undefined;
		/** The image loaded and was measured. */
		onready?: () => void;
		/** The image failed to load. */
		onerror?: () => void;
		ondismiss?: (pull: number) => void;
	} = $props();

	let natural = $state({ width: 0, height: 0 });
	let box = $state({ width: 0, height: 0 });

	const fitted = $derived(fittedSize(natural, box));

	const pointers = new Map<number, { x: number; y: number }>();
	let start: { zoom: Zoom; x: number; y: number; distance: number; moved: boolean } | undefined;
	let lastTap = { at: 0, x: 0, y: 0 };
	/** Touch double taps are read from the taps; browsers also send a `dblclick` for them, which must not toggle again. */
	let lastPointerType = 'mouse';

	onMount(() => {
		const observer = new ResizeObserver(() => measure());
		if (frame) observer.observe(frame);
		return () => observer.disconnect();
	});

	$effect(() => {
		if (!active) {
			zoom = ZOOM_FIT;
			pull = 0;
		}
	});

	function measure(): void {
		if (!frame) return;
		box = { width: frame.clientWidth, height: frame.clientHeight };
		zoom = clampZoom(zoom, fittedSize(natural, box), box);
	}

	function pointOf(event: { clientX: number; clientY: number }): { x: number; y: number } {
		const rect = frame!.getBoundingClientRect();
		return { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 };
	}

	function centreAndDistance(): { x: number; y: number; distance: number } {
		const [a, b] = [...pointers.values()];
		if (a === undefined) return { x: 0, y: 0, distance: 0 };
		if (b === undefined) return { ...a, distance: 0 };
		return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, distance: Math.hypot(a.x - b.x, a.y - b.y) };
	}

	function begin(): void {
		const centre = centreAndDistance();
		start = { zoom, x: centre.x, y: centre.y, distance: centre.distance, moved: start?.moved ?? false };
	}

	function onpointerdown(event: PointerEvent): void {
		lastPointerType = event.pointerType;
		if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
		frame?.setPointerCapture(event.pointerId);
		pointers.set(event.pointerId, pointOf(event));
		gesturing = true;
		if (pointers.size === 1 && start !== undefined) start.moved = false;
		begin();
	}

	function onpointermove(event: PointerEvent): void {
		if (!pointers.has(event.pointerId) || start === undefined) return;
		pointers.set(event.pointerId, pointOf(event));
		const centre = centreAndDistance();
		const dx = centre.x - start.x;
		const dy = centre.y - start.y;
		if (Math.hypot(dx, dy) > 6) start.moved = true;
		if (pointers.size >= 2 && start.distance > 0) {
			const pinched = zoomAround(start.zoom, start.zoom.scale * (centre.distance / start.distance), start, fitted, box);
			zoom = clampZoom({ ...pinched, x: pinched.x + dx, y: pinched.y + dy }, fitted, box);
		} else if (start.zoom.scale > ZOOM_MIN + 0.01) {
			zoom = clampZoom({ ...start.zoom, x: start.zoom.x + dx, y: start.zoom.y + dy }, fitted, box);
		} else if (event.pointerType !== 'mouse') {
			// Mostly sideways is the carousel's; only a downward pull moves the image.
			pull = Math.abs(dy) > Math.abs(dx) ? Math.max(0, dy) : 0;
		}
	}

	function onpointerup(event: PointerEvent): void {
		if (!pointers.has(event.pointerId) || start === undefined) return;
		const point = pointOf(event);
		const moved = start.moved;
		const swipe = pointers.size === 1 && isDismissSwipe(zoom, point.x - start.x, point.y - start.y);
		pointers.delete(event.pointerId);
		if (pointers.size > 0) {
			pull = 0;
			begin();
			return;
		}
		gesturing = false;
		start = undefined;
		if (swipe && event.pointerType !== 'mouse') {
			ondismiss?.(pull);
			return;
		}
		pull = 0;
		if (moved) return;
		// A tap: two close together zoom; one beside the image at fit dismisses.
		const now = performance.now();
		if (event.pointerType !== 'mouse' && now - lastTap.at < 300 && Math.hypot(point.x - lastTap.x, point.y - lastTap.y) < 30) {
			zoom = toggleZoom(zoom, point, fitted, box);
			lastTap = { at: 0, x: 0, y: 0 };
			return;
		}
		lastTap = { at: now, ...point };
		const outside = Math.abs(point.x) > fitted.width / 2 || Math.abs(point.y) > fitted.height / 2;
		if (outside && zoom.scale <= ZOOM_MIN + 0.01) ondismiss?.(0);
	}

	function ondblclick(event: MouseEvent): void {
		if (lastPointerType !== 'mouse') return;
		zoom = toggleZoom(zoom, pointOf(event), fitted, box);
	}

	function onwheel(event: WheelEvent): void {
		event.preventDefault();
		zoom = zoomAround(zoom, zoom.scale * wheelFactor(event.deltaY, event.deltaMode), pointOf(event), fitted, box);
	}

	/** Zoom by a factor around the centre: the zoom buttons. */
	export function step(factor: number): void {
		zoom = zoomAround(zoom, zoom.scale * factor, { x: 0, y: 0 }, fitted, box);
	}

	export function reset(): void {
		zoom = ZOOM_FIT;
	}

	function onwindowkeydown(event: KeyboardEvent): void {
		if (!active || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
		if ((event.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable="true"]')) return;
		if (event.key === '+' || event.key === '=') step(1.5);
		else if (event.key === '-') step(1 / 1.5);
		else if (event.key === '0') reset();
	}
</script>

<svelte:window onkeydown={onwindowkeydown} />

<div
	bind:this={frame}
	class="pane absolute inset-0 overflow-hidden select-none"
	class:cursor-grab={zoom.scale > ZOOM_MIN && !gesturing}
	class:cursor-grabbing={zoom.scale > ZOOM_MIN && gesturing}
	style:touch-action={zoom.scale > ZOOM_MIN + 0.01 || !swipeAcross ? 'none' : 'pan-x'}
	role="presentation"
	data-zoom-pane
	{onpointerdown}
	{onpointermove}
	{onpointerup}
	onpointercancel={onpointerup}
	{ondblclick}
	{onwheel}
>
	<img
		bind:this={image}
		{src}
		{alt}
		draggable="false"
		data-zoom-image
		class="image absolute top-1/2 left-1/2 max-w-none"
		class:animate={!gesturing}
		style:width="{fitted.width}px"
		style:height="{fitted.height}px"
		style:transform="translate(-50%, -50%) translate({zoom.x}px, {zoom.y + pull}px) scale({zoom.scale})"
		{onerror}
		onload={(event) => {
			const loaded = event.currentTarget as HTMLImageElement;
			natural = { width: loaded.naturalWidth, height: loaded.naturalHeight };
			measure();
			onready?.();
		}}
	/>
</div>

<style>
	.image {
		transform-origin: center;
		will-change: transform;
		border-radius: 4px;
		box-shadow: 0 20px 60px rgb(0 0 0 / 0.5);
	}
	.image.animate {
		transition: transform 180ms cubic-bezier(0.2, 0.7, 0.2, 1);
	}
</style>
