<script lang="ts">
	import { markdownText } from '@aiki/protocol';
	import CircleDotIcon from '@lucide/svelte/icons/circle-dot';
	import CircleHelpIcon from '@lucide/svelte/icons/circle-help';
	import FlagIcon from '@lucide/svelte/icons/flag';
	import LinkIcon from '@lucide/svelte/icons/link';
	import MessageSquareIcon from '@lucide/svelte/icons/message-square';
	import ScaleIcon from '@lucide/svelte/icons/scale';
	import UserCogIcon from '@lucide/svelte/icons/user-cog';
	import { exactTime, relativeTime } from '#lib/relative-time.js';
	import { TIMELINE_KINDS, timelineCounts, visibleTimeline } from '#lib/task-relations.js';
	import type { BoardTimelineEntry, BoardTimelineKind, BoardWriter } from '@aiki/protocol';

	/**
	 * Everything that happened to a task, oldest first: feedback and what became of it, status moves, workers, questions,
	 * decisions, milestones and link changes. Filter chips turn a kind off; only the kinds the task has show a chip. The
	 * sheet reads the entries (`board.task.timeline`) and passes them in.
	 */
	let {
		entries,
		error,
		writerName,
		workerHref,
		taskHref
	}: {
		/** Undefined while the first read is on its way. */
		entries: readonly BoardTimelineEntry[] | undefined;
		error?: string | undefined;
		writerName: (writer: BoardWriter) => string;
		/** Where a worker opens; undefined for one the project forgot. */
		workerHref?: (workerId: string) => string | undefined;
		taskHref: (taskId: string) => string;
	} = $props();

	let hidden = $state<ReadonlySet<BoardTimelineKind>>(new Set());

	const counts = $derived(timelineCounts(entries ?? []));
	const shown = $derived(visibleTimeline(entries ?? [], hidden));
	const kinds = $derived(TIMELINE_KINDS.filter((entry) => (counts.get(entry.kind) ?? 0) > 0));

	function toggle(kind: BoardTimelineKind): void {
		const next = new Set(hidden);
		if (next.has(kind)) next.delete(kind);
		else next.add(kind);
		hidden = next;
	}

	function iconOf(kind: BoardTimelineKind) {
		switch (kind) {
			case 'feedback':
				return MessageSquareIcon;
			case 'status':
				return CircleDotIcon;
			case 'worker':
				return UserCogIcon;
			case 'question':
				return CircleHelpIcon;
			case 'decision':
				return ScaleIcon;
			case 'milestone':
				return FlagIcon;
			case 'link':
				return LinkIcon;
		}
	}
</script>

<div class="flex flex-col gap-3" data-task-timeline>
	{#if error}
		<p class="text-xs text-(--chat-danger)" role="alert">{error}</p>
	{:else if entries === undefined}
		<div class="flex flex-col gap-2" role="status" aria-busy="true" aria-label="Loading the timeline">
			<div class="skeleton h-3.5 w-2/3"></div>
			<div class="skeleton h-3.5 w-full"></div>
			<div class="skeleton h-3.5 w-4/5"></div>
			<span class="sr-only">Loading the timeline…</span>
		</div>
	{:else if entries.length === 0}
		<p class="text-xs text-(--chat-fg-subtle)">Nothing has happened yet.</p>
	{:else}
		<div class="flex flex-wrap items-center gap-1.5" role="group" aria-label="Show these kinds">
			{#each kinds as entry (entry.kind)}
				{@const on = !hidden.has(entry.kind)}
				<button
					type="button"
					class="inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs transition-colors {on
						? 'border-(--chat-border-strong) bg-(--chat-surface-2) font-medium text-(--chat-fg)'
						: 'border-(--chat-border)/70 text-(--chat-fg-subtle) line-through hover:text-(--chat-fg)'}"
					aria-pressed={on}
					data-timeline-filter={entry.kind}
					onclick={() => toggle(entry.kind)}
				>
					{entry.label}<span class="tabular-nums opacity-70">{counts.get(entry.kind)}</span>
				</button>
			{/each}
		</div>
		{#if shown.length === 0}
			<p class="text-xs text-(--chat-fg-subtle)">Every kind is hidden.</p>
		{:else}
			<ol class="timeline relative flex flex-col" data-timeline-list>
				{#each shown as entry, index (index)}
					{@const Icon = iconOf(entry.kind)}
					<li class="timeline-entry relative flex gap-2.5 pb-3 last:pb-0" data-timeline-kind={entry.kind} data-state={entry.state}>
						<span class="timeline-icon relative z-1 mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-(--chat-border) bg-(--chat-bg) text-(--chat-fg-muted)">
							<Icon class="size-3" aria-hidden="true" />
						</span>
						<div class="min-w-0 flex-1">
							<p class="text-task leading-5 break-words">
								{#if entry.kind === 'link' && entry.ref !== undefined}
									<a href={taskHref(entry.ref)} class="font-medium underline decoration-(--chat-border-strong) underline-offset-2 hover:decoration-current">{entry.label}</a>
								{:else if entry.kind === 'worker' && entry.ref !== undefined && workerHref?.(entry.ref) !== undefined}
									<a href={workerHref(entry.ref)} class="font-medium underline decoration-(--chat-border-strong) underline-offset-2 hover:decoration-current">{entry.label}</a>
								{:else}
									<span class="font-medium">{entry.label}</span>
								{/if}
							</p>
							{#if entry.detail}
								<p class="line-clamp-4 text-task-sm break-words whitespace-pre-wrap text-(--chat-fg-muted)">{markdownText(entry.detail)}</p>
							{/if}
							<p class="text-[0.6875rem] text-(--chat-fg-subtle)">
								<span title={exactTime(entry.at)}>{relativeTime(entry.at, Date.now())}</span>
								{#if entry.by}· {writerName(entry.by)}{/if}
							</p>
						</div>
					</li>
				{/each}
			</ol>
		{/if}
	{/if}
</div>

<style>
	/* A thin line runs through the icons, from the first entry to the last. */
	.timeline-entry:not(:last-child)::before {
		content: '';
		position: absolute;
		top: 1.5rem;
		bottom: -0.125rem;
		left: calc(0.625rem - 0.5px);
		width: 1px;
		background: color-mix(in oklab, var(--chat-border) 90%, transparent);
	}
</style>
