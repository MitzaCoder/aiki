<script lang="ts">
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import LayersIcon from '@lucide/svelte/icons/layers';
	import MessageSquareIcon from '@lucide/svelte/icons/message-square';
	import Markdown from '#lib/components/markdown/Markdown.svelte';
	import { threadName, type ThreadCards } from '#lib/threads.js';
	import type { TranscriptItem } from '#lib/transcript.js';
	import TaskLine from './TaskLine.svelte';
	import TaskRef from './TaskRef.svelte';
	import ThreadFacts from './ThreadFacts.svelte';

	/**
	 * What a background thread posted into this conversation: its finish (the summary as Markdown, its artifacts and a
	 * link to the thread), its failure in red, or a message from it as a small notice. The server admits these as user
	 * inputs; they are never drawn as something the user typed.
	 */
	let {
		item,
		cards
	}: {
		item: Extract<TranscriptItem, { kind: 'thread' }>;
		cards?: ThreadCards;
	} = $props();

	const notice = $derived(item.notice);
	const threadId = $derived(item.threadId ?? undefined);
	const thread = $derived(threadId === undefined ? undefined : cards?.threads.find((entry) => entry.id === threadId));
	const name = $derived(threadId === undefined ? 'A background thread' : threadName(threadId, cards?.threads ?? []));
	const taskId = $derived(thread?.taskId ?? undefined);
	const href = $derived(threadId === undefined || threadId === 'main' ? undefined : cards?.href(threadId));
</script>

{#if notice.kind === 'finished' || notice.kind === 'failed'}
	{@const ok = notice.kind === 'finished'}
	<TaskLine
		icon={ok ? CircleCheckIcon : CircleAlertIcon}
		tone={ok ? 'done' : 'failed'}
		timestamp={item.timestamp}
		data-thread-card={threadId}
		data-thread-notice={notice.kind}
	>
		{#snippet children()}
			<span class="{taskId === undefined ? 'min-w-0 truncate' : 'shrink-0'} {ok ? 'text-(--chat-fg-muted)' : 'font-medium text-(--chat-danger)'}">
				{#if taskId === undefined}
					<span class="font-medium text-(--chat-fg)">{name}</span> {ok ? 'finished' : 'failed'}
				{:else}
					{ok ? 'Thread finished' : 'Thread failed'}
				{/if}
			</span>
			{#if taskId !== undefined}
				<TaskRef {taskId} fallbackTitle={thread?.title} />
			{/if}
		{/snippet}
		{#snippet details()}
			<div class="px-3.5 py-2.5">
				{#if taskId !== undefined}
					<p class="pb-1 text-xs text-(--chat-fg-subtle)">{name}</p>
				{/if}
				{#if notice.kind === 'finished'}
					{#if notice.summary.length > 0}
						<Markdown source={notice.summary} />
					{:else}
						<p class="py-1 text-sm text-(--chat-fg-subtle) italic">It finished without a summary.</p>
					{/if}
					{#if threadId !== undefined && cards?.artifacts}
						{@render cards.artifacts(threadId, item.timestamp)}
					{/if}
				{:else}
					<p class="py-1 text-sm break-words whitespace-pre-wrap text-(--chat-danger)">
						{notice.reason.length > 0 ? notice.reason : 'It failed without a reason.'}
					</p>
					{#if thread}
						<ThreadFacts {thread} />
					{/if}
				{/if}
				{#if href}
					<a {href} class="mt-1 inline-flex items-center gap-1 text-xs font-medium text-(--chat-fg-muted) hover:underline">
						Open thread
						<ArrowRightIcon class="size-3" />
					</a>
				{/if}
			</div>
		{/snippet}
	</TaskLine>
{:else}
	<div
		class="thread-card animate-rise flex min-w-0 items-start gap-2 self-start rounded-xl border border-dashed border-(--chat-border) bg-(--chat-surface)/40 px-3 py-1.5 text-xs"
		data-thread-card={threadId}
		data-thread-notice={notice.kind}
	>
		{#if notice.kind === 'message'}
			<MessageSquareIcon class="mt-0.5 size-3.5 shrink-0 text-(--chat-fg-subtle)" />
		{:else}
			<LayersIcon class="mt-0.5 size-3.5 shrink-0 text-(--chat-fg-subtle)" />
		{/if}
		<span class="min-w-0 flex-1 break-words text-(--chat-fg-muted)">
			{#if notice.kind === 'message'}
				<span class="font-medium text-(--chat-fg)">From {name}:</span>
				{notice.message}
			{:else}
				{notice.text}
			{/if}
		</span>
		{#if href}
			<a {href} class="shrink-0 font-medium text-(--chat-fg-subtle) hover:underline">Open</a>
		{/if}
	</div>
{/if}
