<script lang="ts">
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import LayersIcon from '@lucide/svelte/icons/layers';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import type { ThreadSummary } from '@aiki/protocol';
	import type { ToolPart } from '#lib/transcript.js';
	import { threadCallSummary } from '#lib/threads.js';

	/**
	 * A `thread_*` call without a card of its own (a list, a peek, a tool this app does not know) as one line in the
	 * thread cards' style. A failure stays collapsed and red; its message opens on a tap.
	 */
	let {
		part,
		threads = []
	}: {
		part: ToolPart;
		threads?: readonly ThreadSummary[];
	} = $props();

	const summary = $derived(threadCallSummary(part, threads));
	let open = $state(false);
</script>

<div
	class="thread-card my-2 min-w-0 overflow-hidden rounded-2xl border {summary.failed
		? 'border-(--chat-danger)/30 bg-(--chat-danger)/8'
		: 'border-(--chat-border) bg-(--chat-surface)/60'}"
	data-thread-call={part.name}
	data-thread-call-line
>
	{#snippet row(expandable: boolean)}
		<span class="thread-icon grid size-6 shrink-0 place-items-center rounded-lg">
			{#if summary.pending}
				<LoaderCircleIcon class="size-3.5 animate-spin" />
			{:else}
				<LayersIcon class="size-3.5" />
			{/if}
		</span>
		<span
			class="min-w-0 flex-1 truncate text-[0.8125rem] {summary.failed
				? 'font-medium text-(--chat-danger)'
				: 'text-(--chat-fg-muted)'}"
		>
			{summary.text}
		</span>
		{#if expandable}
			<ChevronRightIcon class="size-3.5 shrink-0 text-(--chat-danger) transition-transform {open ? 'rotate-90' : ''}" />
		{/if}
	{/snippet}
	{#if summary.failed && part.output}
		<button
			type="button"
			class="flex w-full min-w-0 items-center gap-2.5 px-3 py-2 text-left"
			onclick={() => (open = !open)}
			aria-expanded={open}
		>
			{@render row(true)}
		</button>
	{:else}
		<div class="flex w-full min-w-0 items-center gap-2.5 px-3 py-2">
			{@render row(false)}
		</div>
	{/if}
	{#if open && summary.failed && part.output}
		<p class="border-t border-(--chat-danger)/20 px-3 py-2 text-xs leading-relaxed break-words whitespace-pre-wrap text-(--chat-danger)">
			{part.output}
		</p>
	{/if}
</div>

<style>
	.thread-icon {
		color: var(--primary);
		background: color-mix(in oklab, var(--primary) 12%, transparent);
	}
</style>
