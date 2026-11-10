<script lang="ts">
	import { overlayScroll } from '#lib/scrollbars.js';
	import ArchiveIcon from '@lucide/svelte/icons/archive';
	import ArchiveRestoreIcon from '@lucide/svelte/icons/archive-restore';
	import CalendarClockIcon from '@lucide/svelte/icons/calendar-clock';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import CircleStopIcon from '@lucide/svelte/icons/circle-stop';
	import Banner from '#lib/components/Banner.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import ThreadFacts from '#lib/components/chat/ThreadFacts.svelte';
	import ThreadStatusBadge from '#lib/components/chat/ThreadStatusBadge.svelte';
	import { exactTime, relativeTime } from '#lib/relative-time.js';
	import { isThreadActive } from '@aiki/client';
	import { sortThreads, threadActivityLine, threadStartedByText } from '#lib/threads.js';
	import type { ProjectThreads } from '#lib/threads.svelte.js';
	import type { ThreadSummary } from '@aiki/protocol';

	/**
	 * Main's background threads: what each does now, its workers and tasks, who started it and when, with open, stop
	 * (behind a confirmation) and archive. The body of the sidebar's Background tab; archived threads sit behind a
	 * toggle. Nothing here starts a thread: the user asks main.
	 */
	let {
		threads,
		hrefOf,
		scheduleName,
		now
	}: {
		threads: ProjectThreads | undefined;
		hrefOf: (threadId: string) => string;
		scheduleName?: (scheduleId: string) => string | undefined;
		/** Ticks, so the relative times move on. */
		now: number;
	} = $props();

	const ordered = $derived(sortThreads(threads?.background ?? []));
	const live = $derived(ordered.filter((thread) => !thread.archived));
	const archived = $derived(ordered.filter((thread) => thread.archived));

	let stopping = $state<ThreadSummary | undefined>(undefined);
	let stopOpen = $state(false);
	let stopBusy = $state(false);
	let busyId = $state<string | undefined>(undefined);

	function askStop(thread: ThreadSummary): void {
		stopping = thread;
		stopOpen = true;
	}

	async function confirmStop(): Promise<void> {
		if (stopping === undefined || threads === undefined) return;
		stopBusy = true;
		const ok = await threads.stopThread(stopping.id);
		stopBusy = false;
		if (ok) stopOpen = false;
	}

	async function archive(thread: ThreadSummary, archive: boolean): Promise<void> {
		if (threads === undefined) return;
		busyId = thread.id;
		await threads.archive(thread.id, archive);
		busyId = undefined;
	}

	function timeOf(thread: ThreadSummary): { text: string; title: string } {
		const at = thread.finishedAt ?? thread.updatedAt;
		const verb = thread.finishedAt !== null ? 'Ended' : thread.status === 'running' ? 'Active' : 'Updated';
		return { text: `${verb} ${relativeTime(at, now)}`, title: `Started ${exactTime(thread.createdAt)} · ${verb.toLowerCase()} ${exactTime(at)}` };
	}
</script>

{#snippet row(thread: ThreadSummary)}
	{@const time = timeOf(thread)}
	{@const error = threads?.actionError?.threadId === thread.id ? threads.actionError.message : undefined}
	<div
		class="thread-row flex min-w-0 flex-col rounded-xl border border-(--chat-border) transition-colors"
		class:opacity-75={thread.archived}
		data-thread={thread.id}
	>
		<a href={hrefOf(thread.id)} class="flex min-w-0 flex-col gap-1 rounded-t-xl px-3 pt-2 pb-1.5 hover:bg-(--chat-surface-2)/60">
			<span class="flex min-w-0 items-center gap-2">
				<span class="min-w-0 flex-1 truncate text-[0.8125rem] font-semibold">{thread.title || thread.id}</span>
				<ThreadStatusBadge status={thread.status} class="shrink-0" />
				<ChevronRightIcon class="size-3.5 shrink-0 text-(--chat-fg-subtle)" />
			</span>
			<span
				class="line-clamp-2 text-xs break-words {thread.status === 'failed' ? 'text-(--chat-danger)' : 'text-(--chat-fg-muted)'}"
			>
				{threadActivityLine(thread)}
			</span>
			<ThreadFacts {thread} />
			<span class="flex min-w-0 flex-wrap items-center gap-x-1.5 text-[0.6875rem] text-(--chat-fg-subtle)">
				{#if thread.startedBy === 'schedule'}<CalendarClockIcon class="size-3" aria-hidden="true" />{/if}
				<span class="truncate">{threadStartedByText(thread, scheduleName)}</span>
				<span aria-hidden="true">·</span>
				<span title={time.title}>{time.text}</span>
			</span>
		</a>
		<div class="flex items-center gap-1 border-t border-(--chat-border)/60 px-1.5 py-1">
			{#if isThreadActive(thread)}
				<Button variant="ghost" size="sm" class="h-6 px-2 text-xs" onclick={() => askStop(thread)}>
					<CircleStopIcon data-icon="inline-start" />Stop
				</Button>
			{/if}
			{#if thread.archived}
				<Button variant="ghost" size="sm" class="h-6 px-2 text-xs" disabled={busyId === thread.id} onclick={() => void archive(thread, false)}>
					<ArchiveRestoreIcon data-icon="inline-start" />Restore
				</Button>
			{:else if !isThreadActive(thread)}
				<Button variant="ghost" size="sm" class="h-6 px-2 text-xs" disabled={busyId === thread.id} onclick={() => void archive(thread, true)}>
					<ArchiveIcon data-icon="inline-start" />Archive
				</Button>
			{/if}
			<a href={hrefOf(thread.id)} class="ml-auto px-2 text-xs font-medium text-(--chat-fg-muted) hover:underline">Open</a>
		</div>
		{#if error}
			<p class="px-3 pb-1.5 text-xs break-words text-(--chat-danger)">{error}</p>
		{/if}
	</div>
{/snippet}

<div class="flex min-h-0 flex-1 flex-col">
	<div class="shrink-0 border-b border-(--chat-border)/70 px-4 py-2.5 text-xs text-(--chat-fg-subtle)">
		<p class="mx-auto w-full max-w-3xl">
			Big jobs main handed off. They report back to main, which relays them; ask main to start, steer or stop one.
		</p>
	</div>

	<div class="relative flex min-h-0 flex-1 flex-col">
	<div use:overlayScroll={'parent'} class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2">
		<div class="mx-auto flex w-full max-w-3xl flex-col gap-1.5">
			{#if threads?.error}
				<p class="px-1 py-2 text-xs break-words text-(--chat-danger)">{threads.error}</p>
			{/if}

			{#if live.length === 0}
				<p class="px-1 py-4 text-sm text-(--chat-fg-subtle)">
					{#if threads?.loaded}
						Nothing runs in the background. Main starts a thread when a job is big enough, or a schedule does.
					{:else}
						Loading background threads…
					{/if}
				</p>
			{/if}

			{#each live as thread (thread.id)}
				{@render row(thread)}
			{/each}

			{#if threads?.loaded}
				<button
					type="button"
					class="mt-1 flex items-center gap-1.5 self-start rounded-lg px-1 py-1 text-xs text-(--chat-fg-subtle) hover:text-(--chat-fg)"
					aria-pressed={threads.showArchived}
					onclick={() => threads?.setShowArchived(!threads.showArchived)}
				>
					<ArchiveIcon class="size-3.5" />
					{threads.showArchived ? `Hide archived${archived.length > 0 ? ` (${archived.length})` : ''}` : 'Show archived'}
				</button>
			{/if}

			{#if threads?.showArchived}
				{#if archived.length === 0}
					<p class="px-1 text-xs text-(--chat-fg-subtle)">No archived threads.</p>
				{/if}
				{#each archived as thread (thread.id)}
					{@render row(thread)}
				{/each}
			{/if}
		</div>
	</div>
	</div>
</div>

<Dialog.Root bind:open={stopOpen}>
	<Dialog.Content class="sm:max-w-sm">
		<Dialog.Header>
			<Dialog.Title>Stop {stopping?.title || 'this thread'}?</Dialog.Title>
			<Dialog.Description>
				Its running turn and its workers are aborted, and it does no more work. Main keeps what it reported so far.
			</Dialog.Description>
		</Dialog.Header>
		{#if stopping !== undefined && threads?.actionError?.threadId === stopping.id}
			<div class="px-4 sm:px-6"><Banner tone="error">{threads.actionError.message}</Banner></div>
		{/if}
		<Dialog.Footer>
			<Dialog.Close>
				{#snippet child({ props })}
					<Button {...props} variant="outline" size="sm" type="button" disabled={stopBusy}>Keep it running</Button>
				{/snippet}
			</Dialog.Close>
			<Button variant="destructive" size="sm" type="button" disabled={stopBusy} onclick={() => void confirmStop()}>
				{#if stopBusy}<Spinner data-icon="inline-start" />{/if}
				Stop
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<style>
	.thread-row {
		background: color-mix(in oklab, var(--chat-surface) 55%, transparent);
	}
</style>
