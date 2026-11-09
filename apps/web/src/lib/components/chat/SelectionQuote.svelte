<script lang="ts">
	import QuoteIcon from '@lucide/svelte/icons/quote';
	import { MediaQuery } from 'svelte/reactivity';
	import { quoteFromSelection, selectionInWholeWords, type SelectionEdge } from '#lib/chat/quotes.js';

	/**
	 * A small "Quote" button at the end of text selected inside `scope`, which hands the selection's plain text to
	 * `onquote`. A mouse sees it once the drag ends, just above the end; on a touch screen it sits below the end, clear of
	 * the selection handle and the system's menu above. It goes when the selection does, on scroll and on Escape.
	 * Selections in text fields are not quotes. It is placed in its nearest positioned ancestor, which should not scroll.
	 */
	let { scope, onquote }: { scope: HTMLElement | null | undefined; onquote: (quote: string) => void } = $props();

	const GAP = 6;
	const MARGIN = 8;
	/** How far below the end the button sits on a touch screen, past the selection handle. */
	const TOUCH_DROP = 30;

	const coarse = new MediaQuery('pointer: coarse');
	let anchor = $state<HTMLSpanElement | null>(null);
	let width = $state(80);
	let height = $state(32);
	let shown = $state<{ quote: string; left: number; top: number } | undefined>(undefined);
	/** The quote under a press on the button, kept in case the press itself clears the selection. */
	let pressed: string | undefined;
	let dragging = false;
	let frame = 0;

	function edge(node: Node, offset: number): SelectionEdge | undefined {
		return node instanceof Text ? { text: node.data, offset } : undefined;
	}

	function selectionInScope(): { quote: string; end: DOMRect } | undefined {
		const selection = document.getSelection();
		if (scope == null || selection === null || selection.isCollapsed || selection.rangeCount === 0) return undefined;
		const range = selection.getRangeAt(0);
		if (!scope.contains(range.startContainer) || !scope.contains(range.endContainer)) return undefined;
		const common = range.commonAncestorContainer;
		const element = common instanceof Element ? common : common.parentElement;
		if (element?.closest('textarea, input, form, [contenteditable="true"]') != null) return undefined;
		const quote = quoteFromSelection(
			selectionInWholeWords(
				selection.toString(),
				edge(range.startContainer, range.startOffset),
				edge(range.endContainer, range.endOffset)
			)
		);
		if (quote.length === 0) return undefined;
		const caret = range.cloneRange();
		caret.collapse(false);
		let end = caret.getBoundingClientRect();
		if (end.height === 0) {
			const boxes = [...range.getClientRects()].filter((box) => box.width > 0 && box.height > 0);
			end = boxes.at(-1) ?? range.getBoundingClientRect();
		}
		return { quote, end };
	}

	function update(): void {
		frame = 0;
		if (pressed !== undefined) return;
		const found = dragging ? undefined : selectionInScope();
		const host = anchor?.offsetParent;
		if (found === undefined || anchor == null || host == null) {
			shown = undefined;
			return;
		}
		const origin = anchor.getBoundingClientRect();
		const bounds = host.getBoundingClientRect();
		const { end } = found;
		let top = coarse.current ? end.bottom + TOUCH_DROP : end.top - height - GAP;
		if (!coarse.current && top < bounds.top + MARGIN) top = end.bottom + GAP;
		top = Math.min(Math.max(top, bounds.top + MARGIN), bounds.bottom - height - MARGIN);
		const left = Math.min(Math.max(end.right - width / 2, bounds.left + MARGIN), bounds.right - width - MARGIN);
		shown = { quote: found.quote, left: left - origin.left, top: top - origin.top };
	}

	function schedule(): void {
		if (frame === 0) frame = requestAnimationFrame(update);
	}

	function hide(): void {
		if (pressed === undefined) shown = undefined;
	}

	function quote(): void {
		const text = pressed ?? shown?.quote;
		pressed = undefined;
		shown = undefined;
		document.getSelection()?.removeAllRanges();
		if (text !== undefined) onquote(text);
	}

	$effect(() => () => cancelAnimationFrame(frame));
</script>

<svelte:document onselectionchange={schedule} />
<svelte:window
	onpointerdown={(event) => {
		if (event.pointerType === 'mouse' && event.button === 0 && pressed === undefined) dragging = true;
	}}
	onpointerup={() => {
		dragging = false;
		schedule();
	}}
	onpointercancel={() => {
		dragging = false;
		pressed = undefined;
		schedule();
	}}
	onkeydown={(event) => {
		if (event.key === 'Escape') hide();
	}}
	onscrollcapture={hide}
	onresize={hide}
/>

<span bind:this={anchor} class="pointer-events-none absolute top-0 left-0 size-0" aria-hidden="true"></span>
{#if shown}
	<button
		type="button"
		bind:offsetWidth={width}
		bind:offsetHeight={height}
		class="absolute z-30 inline-flex animate-rise items-center gap-1.5 rounded-full border border-(--chat-border) px-3 text-xs font-medium text-(--chat-fg) shadow-(--chat-shadow) glass transition-colors hover:bg-(--chat-surface-2) active:scale-95 {coarse.current
			? 'h-9'
			: 'h-8'}"
		style:left="{shown.left}px"
		style:top="{shown.top}px"
		onpointerdown={(event) => {
			event.preventDefault();
			pressed = shown?.quote;
		}}
		onclick={quote}
		title="Quote this in your message"
		data-selection-quote
	>
		<QuoteIcon class="size-3.5 text-(--accent-2)" />
		Quote
	</button>
{/if}
