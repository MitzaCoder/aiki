<script lang="ts">
	import { overlayScroll } from '#lib/scrollbars.js';
	import ClipboardListIcon from '@lucide/svelte/icons/clipboard-list';
	import { parseHandoff, threadName, type ThreadCards } from '#lib/threads.js';
	import type { TranscriptItem } from '#lib/transcript.js';
	import TaskLine from './TaskLine.svelte';
	import TaskRef from './TaskRef.svelte';
	import TaskText from './TaskText.svelte';

	/**
	 * A note the harness posted about the board (a change of yours, a worker's effect on a task): admitted as a user
	 * input, but not something the user typed, so it is one quiet line that names the task and opens into the whole note.
	 * A task another thread handed over reads as such, naming that thread.
	 */
	let {
		item,
		cards
	}: {
		item: Extract<TranscriptItem, { kind: 'board' }>;
		cards?: ThreadCards;
	} = $props();

	const handoff = $derived(parseHandoff(item.body));
	const fromHref = $derived(handoff === undefined || handoff.from === 'main' ? undefined : cards?.href(handoff.from));
	const multiline = $derived(item.body.trim() !== item.summary.trim());
</script>

<TaskLine icon={ClipboardListIcon} timestamp={item.timestamp} data-board-notice details={multiline || fromHref ? details : undefined}>
	{#snippet children()}
		{#if handoff}
			<TaskRef taskId={handoff.taskId} fallbackTitle={handoff.title} />
			<span class="min-w-0 truncate text-(--chat-fg-muted)">handed over by {threadName(handoff.from, cards?.threads ?? [])}</span>
		{:else}
			<span class="block min-w-0 flex-1 truncate text-(--chat-fg-muted)"><TaskText text={item.summary} titles /></span>
		{/if}
	{/snippet}
</TaskLine>

{#snippet details()}
	{#if fromHref}
		<a href={fromHref} class="block px-3.5 pt-2 text-xs font-medium text-(--chat-fg-muted) hover:underline">
			Open {threadName(handoff?.from, cards?.threads ?? [])}
		</a>
	{/if}
	<div class="relative">
	<pre
		use:overlayScroll={'parent'}
		class="max-h-80 overflow-auto px-3.5 py-2.5 font-mono text-[0.75rem] leading-relaxed break-words whitespace-pre-wrap text-(--chat-fg-muted)">{item.body}</pre>
	</div>
{/snippet}
