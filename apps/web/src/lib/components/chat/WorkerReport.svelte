<script lang="ts">
	import BotIcon from '@lucide/svelte/icons/bot';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import Markdown from '#lib/components/markdown/Markdown.svelte';
	import { reportMarkdown } from '#lib/workers.js';
	import type { TranscriptItem } from '#lib/transcript.js';
	import TaskLine from './TaskLine.svelte';
	import TaskRef from './TaskRef.svelte';

	/**
	 * A report a worker posted back to the coordinator, as one line naming the task it is about; the whole report opens
	 * under it. The server admits it as a user message; recognising its prefix keeps it from reading as something the
	 * user typed.
	 */
	let {
		item,
		href,
		taskId,
		workerTitle
	}: {
		item: Extract<TranscriptItem, { kind: 'report' }>;
		/** The worker's read-only transcript, when the caller can build the link. */
		href?: string;
		/** The board task the worker was spawned for. */
		taskId?: string;
		workerTitle?: string;
	} = $props();
</script>

<TaskLine icon={item.ok ? BotIcon : CircleAlertIcon} tone={item.ok ? 'report' : 'failed'} timestamp={item.timestamp} data-worker={item.workerId}>
	{#snippet children()}
		<span class="shrink-0 {item.ok ? 'text-(--chat-fg-muted)' : 'font-medium text-(--chat-danger)'}">
			{#if taskId === undefined}
				Worker <span class="font-mono">{item.workerId}</span> {item.ok ? 'reported' : 'failed'}
			{:else}
				{item.ok ? 'Worker reported' : 'Worker failed'}
			{/if}
		</span>
		{#if taskId !== undefined}
			<TaskRef {taskId} fallbackTitle={workerTitle} />
		{/if}
	{/snippet}
	{#snippet details()}
		<div class="px-3.5 py-2.5">
			{#if taskId !== undefined}
				<p class="pb-1 text-xs text-(--chat-fg-subtle)">Worker <span class="font-mono">{item.workerId}</span></p>
			{/if}
			{#if item.ok}
				{#if item.body.length > 0}
					<Markdown source={reportMarkdown(item.body)} />
				{:else}
					<p class="py-1 text-sm text-(--chat-fg-subtle) italic">It answered with no text.</p>
				{/if}
			{:else}
				<p class="py-1 text-sm break-words text-(--chat-danger)">{item.failure ?? 'It failed without a reason.'}</p>
			{/if}
			{#if href}
				<a {href} class="mt-1 inline-flex items-center gap-1 text-xs font-medium text-(--chat-fg-muted) hover:underline">
					Open the worker's transcript
					<ArrowRightIcon class="size-3" />
				</a>
			{/if}
		</div>
	{/snippet}
</TaskLine>
