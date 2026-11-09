<script lang="ts">
	import BrainIcon from '@lucide/svelte/icons/brain';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import { slide } from 'svelte/transition';
	import Markdown from '#lib/components/markdown/Markdown.svelte';
	import { thinkingHeaderText, type ThinkingStep } from '#lib/transcript.js';

	/**
	 * The model's reasoning: one quiet line while it thinks (shimmering, with the
	 * last lines as a preview) that opens into the full text. Consecutive thinking
	 * parts arrive as steps of one block, divided so each reads on its own.
	 */
	let { steps, active = false }: { steps: readonly ThinkingStep[]; active?: boolean } = $props();

	let open = $state(false);
	const filled = $derived(steps.filter((step) => step.text.trim().length > 0));
	const last = $derived(filled.at(-1));
	/** Collapsed and still thinking: the tail of the last step, as it arrives. */
	const preview = $derived(
		(last?.text ?? '')
			.trim()
			.split('\n')
			.filter((line) => line.trim().length > 0)
			.slice(-2)
			.join(' ')
	);
</script>

<div class="my-1.5 min-w-0">
	<button
		type="button"
		class="group flex max-w-full items-center gap-1.5 rounded-full py-1 pr-2 text-left text-[0.8125rem] text-(--chat-fg-subtle) transition-colors hover:text-(--chat-fg)"
		onclick={() => (open = !open)}
		aria-expanded={open}
		disabled={filled.length === 0}
	>
		<BrainIcon class="size-3.5 shrink-0 {active ? 'text-(--accent-3)' : ''}" />
		{#if active}
			<span class="shimmer-text font-medium">{thinkingHeaderText(filled.length, true)}</span>
		{:else}
			<span class="font-medium">{thinkingHeaderText(filled.length, false)}</span>
		{/if}
		{#if filled.length > 0}
			<ChevronRightIcon class="size-3.5 shrink-0 transition-transform {open ? 'rotate-90' : ''}" />
		{/if}
	</button>

	{#if open && filled.length > 0}
		<div
			class="mt-1 ml-1.5 border-l-2 border-(--chat-border) pl-4 text-(--chat-fg-muted)"
			transition:slide={{ duration: 180 }}
		>
			{#each filled as step, index (step.key)}
				<div
					class={index > 0 ? 'mt-2.5 border-t border-(--chat-border)/60 pt-2.5' : ''}
					data-thinking-step={index + 1}
				>
					<Markdown
						source={step.text.trim()}
						streaming={active && index === filled.length - 1}
						class="text-[0.9rem]"
					/>
				</div>
			{/each}
		</div>
	{:else if active && preview}
		<p class="mt-0.5 ml-5 line-clamp-2 text-[0.8125rem] leading-relaxed text-(--chat-fg-subtle)/80 italic">
			{preview}
		</p>
	{/if}
</div>
