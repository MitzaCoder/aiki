<script lang="ts">
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import LayersIcon from '@lucide/svelte/icons/layers';
	import type { ThreadSummary } from '@mihai-harness/protocol';
	import type { ToolPart } from '#lib/transcript.js';
	import {
		threadActivityLine,
		threadCallDetail,
		threadCallTitle,
		threadStartedByText,
		threadToolAction
	} from '#lib/threads.js';
	import ThreadFacts from './ThreadFacts.svelte';
	import ThreadStatusBadge from './ThreadStatusBadge.svelte';

	/**
	 * A `thread_*` call in main's transcript: one compact card for the background thread it started or acted on, live
	 * from `threads.state` (status, what it does now, its workers, tasks and questions), linking to the thread. The
	 * call's own words (the brief, the message sent) open under it.
	 */
	let {
		part,
		threadId,
		thread,
		href,
		scheduleName
	}: {
		part: ToolPart;
		threadId: string | undefined;
		/** The thread as the list has it now; undefined while it loads or once it was archived. */
		thread: ThreadSummary | undefined;
		href?: string;
		scheduleName?: (scheduleId: string) => string | undefined;
	} = $props();

	const title = $derived(thread?.title || threadCallTitle(part) || threadId || 'Background thread');
	const detail = $derived(threadCallDetail(part));
	const action = $derived(threadToolAction(part.name));
	const pending = $derived(part.status !== 'done');
	const failed = $derived(part.isError === true);
	let open = $state(false);
</script>

<div
	class="thread-card my-2 min-w-0 overflow-hidden rounded-2xl border border-(--chat-border) bg-(--chat-surface)/60"
	data-thread-card={threadId}
	data-thread-call={part.name}
>
	<div class="flex min-w-0 items-start gap-2.5 px-3 py-2">
		<span class="thread-icon mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg">
			<LayersIcon class="size-3.5" />
		</span>
		<span class="flex min-w-0 flex-1 flex-col gap-0.5">
			<span class="flex min-w-0 items-baseline gap-2">
				<span class="truncate text-[0.8125rem] font-semibold">{title}</span>
				<span class="shrink-0 text-[0.6875rem] text-(--chat-fg-subtle)">
					{pending ? `${action}…` : failed ? `${action} · failed` : action}
				</span>
			</span>
			{#if failed}
				<span class="line-clamp-2 text-xs break-words text-(--chat-danger)">{part.output ?? 'The call failed.'}</span>
			{:else if thread}
				<span class="line-clamp-2 text-xs break-words text-(--chat-fg-muted)" data-thread-current>
					{threadActivityLine(thread)}
				</span>
				<ThreadFacts {thread} />
				{#if thread.startedBy === 'schedule'}
					<span class="text-[0.6875rem] text-(--chat-fg-subtle)">{threadStartedByText(thread, scheduleName)}</span>
				{/if}
			{:else if !pending}
				<span class="text-xs text-(--chat-fg-subtle)">Works in the background; main relays what it does.</span>
			{/if}
		</span>
		{#if thread}
			<ThreadStatusBadge status={thread.status} class="mt-0.5 shrink-0" />
		{/if}
	</div>
	{#if detail || href}
		<div class="flex min-w-0 items-center gap-2 border-t border-(--chat-border)/60 px-3 py-1">
			{#if detail}
				<button
					type="button"
					class="inline-flex min-w-0 flex-1 items-center gap-1 text-left text-xs text-(--chat-fg-subtle) hover:text-(--chat-fg)"
					onclick={() => (open = !open)}
					aria-expanded={open}
				>
					<ChevronRightIcon class="size-3 shrink-0 transition-transform {open ? 'rotate-90' : ''}" />
					<span class="truncate">{part.name === 'thread_send' ? 'Message' : part.name === 'thread_start' ? 'Brief' : 'Summary'}{open ? '' : ` · ${detail}`}</span>
				</button>
			{:else}
				<span class="flex-1"></span>
			{/if}
			{#if href}
				<a {href} class="inline-flex shrink-0 items-center gap-0.5 text-xs font-medium text-(--chat-fg-muted) hover:underline">
					Open thread<ChevronRightIcon class="size-3" />
				</a>
			{/if}
		</div>
		{#if open && detail}
			<p class="border-t border-(--chat-border)/60 px-3 py-2 text-xs leading-relaxed break-words whitespace-pre-wrap text-(--chat-fg-muted)">
				{detail}
			</p>
		{/if}
	{/if}
</div>

<style>
	.thread-icon {
		color: var(--primary);
		background: color-mix(in oklab, var(--primary) 12%, transparent);
	}
</style>
