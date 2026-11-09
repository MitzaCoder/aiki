<script lang="ts">
	import QuoteIcon from '@lucide/svelte/icons/quote';
	import XIcon from '@lucide/svelte/icons/x';
	import { quotePreview } from '#lib/chat/quotes.js';

	/**
	 * A quote waiting in the composer as a small pill: its first line, cut short. Hovering shows the whole quote, a tap
	 * on the line opens it (`ontoggle`, shown by the composer), and × removes it.
	 */
	let {
		quote,
		open = false,
		ontoggle,
		onremove
	}: { quote: string; open?: boolean; ontoggle: () => void; onremove: () => void } = $props();
</script>

<span
	class="inline-flex max-w-full min-w-0 items-center rounded-full border border-(--chat-border) bg-(--chat-surface-2)/60 pr-0.5 text-xs {open
		? 'border-(--accent-2)/50'
		: ''}"
	data-quote-chip
>
	<button
		type="button"
		class="flex min-w-0 items-center gap-1.5 py-0.5 pl-2 text-left"
		onclick={ontoggle}
		aria-expanded={open}
		title={quote}
	>
		<QuoteIcon class="size-3 shrink-0 text-(--accent-2)" />
		<span class="max-w-[16rem] min-w-0 truncate text-(--chat-fg-muted)">{quotePreview(quote)}</span>
	</button>
	<button
		type="button"
		class="-my-1 grid size-7 shrink-0 place-items-center rounded-full text-(--chat-fg-subtle) transition-colors hover:bg-(--chat-surface-2) hover:text-(--chat-fg)"
		onclick={onremove}
		aria-label="Remove the quote"
		title="Remove the quote"
	>
		<XIcon class="size-3.5" />
	</button>
</span>
