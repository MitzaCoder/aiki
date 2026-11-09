<script lang="ts">
	/** A quote at the top of a user message: a couple of lines behind the chat's gradient rule, with "Show more" when it is longer. */
	let { quote }: { quote: string } = $props();

	let element = $state<HTMLQuoteElement | undefined>(undefined);
	let expanded = $state(false);
	let clamped = $state(false);

	$effect(() => {
		const quoted = element;
		if (quoted === undefined) return;
		const observer = new ResizeObserver(() => {
			if (!expanded) clamped = quoted.scrollHeight > quoted.clientHeight + 1;
		});
		observer.observe(quoted);
		return () => observer.disconnect();
	});
</script>

<div class="flex min-w-0 flex-col items-start gap-0.5" data-message-quote>
	<blockquote
		bind:this={element}
		class="quote min-w-0 pl-2.5 text-sm leading-relaxed whitespace-pre-wrap text-(--chat-fg-muted) {expanded ? '' : 'line-clamp-2'}"
	>{quote}</blockquote>
	{#if clamped || expanded}
		<button
			type="button"
			class="pl-2.5 text-xs text-(--chat-fg-subtle) transition-colors hover:text-(--chat-fg)"
			onclick={() => (expanded = !expanded)}
			aria-expanded={expanded}
		>
			{expanded ? 'Show less' : 'Show more'}
		</button>
	{/if}
</div>

<style>
	.quote {
		border-left: 2px solid transparent;
		border-image: var(--chat-grad) 1;
		overflow-wrap: anywhere;
	}
</style>
