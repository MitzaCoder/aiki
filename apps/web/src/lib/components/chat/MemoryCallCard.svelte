<script lang="ts">
	import BookOpenIcon from '@lucide/svelte/icons/book-open';
	import CheckIcon from '@lucide/svelte/icons/check';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import CircleStopIcon from '@lucide/svelte/icons/circle-stop';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import XIcon from '@lucide/svelte/icons/x';
	import { slide } from 'svelte/transition';
	import Markdown from '#lib/components/markdown/Markdown.svelte';
	import {
		memoryCallView,
		memoryScopeBadge,
		type MemoryHit,
		type MemoryMatch
	} from '#lib/chat/memory-tools.js';
	import { toolCardStatus, type ToolCardStatus, type ToolPart } from '#lib/transcript.js';
	import type { MemoryScope } from '@kemiri/protocol';

	/**
	 * One memory tool call, in words: a search's hits, a read's sections, a
	 * write's text and close matches, an archive's reason. A topic name opens
	 * that file in the Memory tab; an error stays collapsed and red like any
	 * other tool.
	 */
	let {
		part,
		onopentopic
	}: {
		part: ToolPart;
		onopentopic?: (fileId: string, scope: MemoryScope) => void;
	} = $props();

	type TopicRow = MemoryHit | MemoryMatch;

	const view = $derived(memoryCallView(part));
	const status: ToolCardStatus = $derived(toolCardStatus(part));
	// Memory tools never exit a shell, so "exited" never actually shows; the label exists only so this map stays total.
	const LABELS: Record<ToolCardStatus, string> = {
		preparing: 'preparing',
		running: 'running',
		done: 'done',
		error: 'failed',
		exited: 'failed',
		interrupted: 'stopped'
	};
	let open = $state(false);

	function openTopic(fileId: string, scope: MemoryScope): void {
		if (fileId.length > 0) onopentopic?.(fileId, scope);
	}
</script>

{#snippet topicRows(rows: readonly TopicRow[])}
	<div class="divide-y divide-(--chat-border)/60">
		{#each rows as row, index (row.scope + ':' + row.fileId + ':' + (row.heading ?? '') + ':' + index)}
			<button
				type="button"
				class="block w-full px-3.5 py-2 text-left transition-colors hover:bg-(--chat-surface-2)/50"
				onclick={() => openTopic(row.fileId, row.scope)}
				title="Open {row.fileId} in the Memory tab"
			>
				<span class="flex min-w-0 items-center gap-2">
					<span class="min-w-0 flex-1 truncate text-[0.8125rem] font-semibold">{row.title || row.fileId}</span>
					<span
						class="shrink-0 rounded-full border border-(--chat-border) px-1.5 py-0.5 text-[0.625rem] font-semibold text-(--chat-fg-muted)"
					>
						{memoryScopeBadge(row.scope)}
					</span>
				</span>
				<span class="block truncate text-[0.625rem] text-(--chat-fg-subtle)">
					{row.heading ?? 'Introduction'}
				</span>
				<p class="line-clamp-3 text-xs break-words text-(--chat-fg-muted)">
					{#each row.parts as snippet, partIndex (partIndex)}{#if snippet.match}<mark
								class="rounded-sm bg-(--chat-warning)/30 px-0.5 font-medium text-(--chat-fg)">{snippet.text}</mark
							>{:else}{snippet.text}{/if}{/each}
				</p>
			</button>
		{/each}
	</div>
{/snippet}

<div
	class="my-2 overflow-hidden rounded-2xl border border-(--chat-border) bg-(--chat-surface)/60"
	data-status={status}
>
	<button
		type="button"
		class="flex w-full min-w-0 items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-(--chat-surface-2)/60"
		onclick={() => (open = !open)}
		aria-expanded={open}
	>
		<span class="tool-icon grid size-7 shrink-0 place-items-center rounded-lg">
			<BookOpenIcon class="size-3.5" />
		</span>
		<span class="flex min-w-0 flex-1 items-center gap-2">
			<span class="text-[0.8125rem] font-semibold" title={view.summary}>{view.summary}</span>
			<span
				class="shrink-0 rounded-full border border-(--chat-border) px-1.5 py-0.5 text-[0.625rem] font-semibold text-(--chat-fg-muted)"
			>
				{memoryScopeBadge(view.scope)}
			</span>
		</span>
		<span class="flex shrink-0 items-center gap-1.5 text-xs text-(--chat-fg-subtle)" title={LABELS[status]}>
			{#if status === 'preparing' || status === 'running'}
				<LoaderCircleIcon class="size-3.5 animate-spin text-(--accent-2)" />
			{:else if status === 'done'}
				<CheckIcon class="size-3.5 text-(--chat-success)" />
			{:else if status === 'error'}
				<XIcon class="size-3.5 text-(--chat-danger)" />
			{:else}
				<CircleStopIcon class="size-3.5" />
			{/if}
			<span class="hidden sm:inline">{LABELS[status]}</span>
			<ChevronRightIcon class="size-3.5 transition-transform {open ? 'rotate-90' : ''}" />
		</span>
	</button>

	{#if open}
		<div class="border-t border-(--chat-border) bg-(--chat-bg)/40" transition:slide={{ duration: 180 }}>
			{#if view.isError}
				<pre class="error-output">{view.output || 'The memory tool failed.'}</pre>
			{:else if view.kind === 'search'}
				{#if view.hits.length === 0}
					<p class="px-3.5 py-2.5 text-xs text-(--chat-fg-subtle) italic">No memories matched.</p>
				{:else}
					{@render topicRows(view.hits)}
				{/if}
			{:else if view.kind === 'read'}
				<div class="flex flex-wrap items-center gap-x-2 gap-y-1 px-3.5 pt-2 pb-1">
					<button
						type="button"
						class="inline-flex min-w-0 items-center gap-1 text-[0.8125rem] font-semibold hover:text-(--accent-2)"
						onclick={() => openTopic(view.fileId, view.scope === 'both' ? 'project' : view.scope)}
						title="Open {view.fileId} in the Memory tab"
					>
						<BookOpenIcon class="size-3.5 shrink-0" />
						<span class="truncate">{view.title ?? view.fileId}</span>
					</button>
				</div>
				{#if view.summaryText}
					<p class="px-3.5 text-xs text-(--chat-fg-subtle)">{view.summaryText}</p>
				{/if}
				{#if view.tags.length > 0 || (view.status !== undefined && view.status !== 'active')}
					<div class="flex flex-wrap items-center gap-1.5 px-3.5 pt-0.5 text-[0.6875rem] text-(--chat-fg-subtle)">
						{#if view.tags.length > 0}
							<span>Tags: {view.tags.join(', ')}</span>
						{/if}
						{#if view.status !== undefined && view.status !== 'active'}
							<span class="rounded-full border border-(--chat-border) px-1.5 py-0.5 capitalize">
								{view.status}
							</span>
						{/if}
					</div>
				{/if}
				{#if view.intro}
					<div class="px-3.5 pt-2 pb-1 text-(--chat-fg-muted)">
						<Markdown source={view.intro} />
					</div>
				{/if}
				{#each view.sections as section, index (section.heading)}
					<div class="mx-3.5 border-(--chat-border)/60 py-2" class:border-t={index > 0 || view.intro.length > 0}>
						<p class="text-[0.8125rem] font-semibold">{section.heading}</p>
						<div class="text-(--chat-fg-muted)">
							<Markdown source={section.text} streaming={false} />
						</div>
					</div>
				{/each}
				{#if view.links.length > 0}
					<div class="flex flex-wrap gap-1.5 border-t border-(--chat-border)/60 px-3.5 py-2">
						{#each view.links as link (link.scope + ':' + link.fileId)}
							<button
								type="button"
								class="rounded-full border border-(--chat-border) px-2 py-0.5 text-[0.6875rem] text-(--chat-fg-muted) transition-colors hover:text-(--chat-fg)"
								onclick={() => openTopic(link.fileId, link.scope)}
								title="Open {link.fileId} in the Memory tab"
							>
								{link.title || link.fileId}
							</button>
						{/each}
					</div>
				{/if}
			{:else if view.kind === 'write'}
				<div class="flex flex-wrap items-center gap-x-2 gap-y-1 px-3.5 pt-2 pb-1">
					<button
						type="button"
						class="inline-flex min-w-0 items-center gap-1 text-[0.8125rem] font-semibold hover:text-(--accent-2)"
						onclick={() => openTopic(view.fileId, view.scope === 'both' ? 'project' : view.scope)}
						title="Open {view.fileId} in the Memory tab"
					>
						<BookOpenIcon class="size-3.5 shrink-0" />
						<span class="truncate">{view.fileId}</span>
					</button>
					<span class="text-xs text-(--chat-fg-subtle)">
						{view.outcome === 'created'
							? 'created'
							: view.outcome === 'unchanged'
								? 'unchanged'
								: view.outcome === 'suggested'
									? 'not created'
									: 'updated'}
					</span>
				</div>
				<div class="px-3.5 pb-1">
					<p class="text-[0.6875rem] font-semibold tracking-wide text-(--chat-fg-subtle) uppercase">
						{view.heading === undefined ? 'Introduction' : 'Section · ' + view.heading}
					</p>
					<div class="text-(--chat-fg-muted)">
						<Markdown source={view.text} />
					</div>
				</div>
				{#if view.closeMatches.length > 0}
					<div class="border-t border-(--chat-border)/60">
						<div class="section-label"><span>Close matches</span></div>
						{@render topicRows(view.closeMatches)}
					</div>
				{/if}
			{:else}
				<div class="px-3.5 py-2.5 text-sm text-(--chat-fg-muted)">
					{#if view.reason}
						{view.reason}
					{:else}
						<span class="text-(--chat-fg-subtle) italic">No reason was given.</span>
					{/if}
				</div>
				<div class="border-t border-(--chat-border)/60 px-3.5 py-2">
					<button
						type="button"
						class="inline-flex items-center gap-1 text-xs text-(--chat-fg-muted) hover:text-(--chat-fg)"
						onclick={() => openTopic(view.fileId, view.scope === 'both' ? 'project' : view.scope)}
						title="Open {view.fileId} in the Memory tab"
					>
						<BookOpenIcon class="size-3.5" /> {view.fileId}
					</button>
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.tool-icon {
		color: var(--accent-2);
		background: color-mix(in oklab, var(--accent-2) 12%, transparent);
	}
	[data-status='error'] {
		border-color: color-mix(in oklab, var(--chat-danger) 30%, var(--chat-border));
	}
	[data-status='error'] .tool-icon {
		color: var(--chat-danger);
		background: color-mix(in oklab, var(--chat-danger) 12%, transparent);
	}
	.error-output {
		margin: 0;
		padding: 0.5rem 0.875rem 0.875rem;
		font-family: var(--font-mono);
		font-size: 0.78rem;
		line-height: 1.6;
		white-space: pre-wrap;
		word-break: break-word;
		color: var(--chat-danger);
	}
</style>
