<script lang="ts">
	import { overlayScroll } from '#lib/scrollbars.js';
	import ActivityIcon from '@lucide/svelte/icons/activity';
	import { checkInTaskIds } from '#lib/task-chat.js';
	import { checkInThreads, threadName, type ThreadCards } from '#lib/threads.js';
	import type { TranscriptItem } from '#lib/transcript.js';
	import TaskLine from './TaskLine.svelte';
	import TaskRef from './TaskRef.svelte';

	/**
	 * The harness' periodic check-in on running workers. Like a report, it is admitted as a user input, but it is not
	 * something the user wrote: it is one quiet line naming the tasks it covers, and the whole digest opens under it.
	 * Main's also covers its background threads, linked when open.
	 */
	let {
		item,
		cards
	}: {
		item: Extract<TranscriptItem, { kind: 'checkin' }>;
		cards?: ThreadCards;
	} = $props();

	const threads = $derived(checkInThreads(item.body));
	const taskIds = $derived(checkInTaskIds(item.body));
</script>

<TaskLine icon={ActivityIcon} timestamp={item.timestamp}>
	{#snippet children()}
		<span class="shrink-0 text-(--chat-fg-muted)">{taskIds.length > 0 ? 'Check-in' : threads.length > 0 ? 'Check-in on running work' : 'Check-in on running workers'}</span>
		{#each taskIds as taskId (taskId)}
			<TaskRef {taskId} showTitle={taskIds.length === 1} />
		{/each}
	{/snippet}
	{#snippet details()}
		{#if threads.length > 0}
			<div class="flex flex-wrap gap-1.5 px-3.5 pt-2" data-checkin-threads>
				{#each threads as thread (thread.id)}
					<a
						href={cards?.href(thread.id)}
						class="rounded-full border border-(--chat-border) px-2 py-0.5 text-xs text-(--chat-fg-muted) hover:bg-(--chat-surface-2)"
					>
						{threadName(thread.id, cards?.threads ?? []) === thread.id ? thread.title : threadName(thread.id, cards?.threads ?? [])}
					</a>
				{/each}
			</div>
		{/if}
		<div class="relative">
		<pre
			use:overlayScroll={'parent'}
			class="max-h-80 overflow-auto px-3.5 py-2.5 font-mono text-[0.75rem] leading-relaxed break-words whitespace-pre-wrap text-(--chat-fg-muted)">{item.body}</pre>
		</div>
	{/snippet}
</TaskLine>
