<script lang="ts">
	import TaskSection from '#lib/components/TaskSection.svelte';
	import Markdown from '#lib/components/markdown/Markdown.svelte';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import XIcon from '@lucide/svelte/icons/x';
	import ImageIcon from '@lucide/svelte/icons/image';
	import { Button } from '#lib/components/ui/button/index.js';
	import { exactTime, relativeTime } from '#lib/relative-time.js';
	import { feedbackStateWords, sortedFeedback } from '#lib/task-relations.js';
	import type { BoardFeedback } from '@mihai-harness/protocol';

	/**
	 * What the user said about a task, one entry per message: open ones first, each with its state and, once addressed,
	 * the note that says what addressed it. The user can dismiss an entry ("not needed") or reopen one that was addressed
	 * or dismissed; the coordinator moves entries to being handled and addressed. The text uses the same Markdown as the user's chat bubble.
	 */
	let {
		entries,
		openCount,
		busy = false,
		problem,
		onset,
		threadName
	}: {
		entries: readonly BoardFeedback[];
		/** Stored totals stay available before the timeline read completes. */
		openCount?: number;
		busy?: boolean;
		problem?: string | undefined;
		onset: (entry: BoardFeedback, state: 'dismissed' | 'open') => void;
		/** Names the chat an entry came through, for one that is not main's. */
		threadName?: (threadId: string) => string;
	} = $props();

	const sorted = $derived(sortedFeedback(entries));
	const waiting = $derived(openCount ?? sorted.filter((entry) => entry.state === 'open' || entry.state === 'handling').length);
</script>

{#if sorted.length > 0 || waiting > 0}
	<TaskSection title="Feedback" kind="feedback" count={`${waiting} open`} class="flex flex-col gap-1.5" data-feedback>
		{#if sorted.length === 0}<p class="text-task text-(--chat-fg-subtle)" role="status">Loading feedback…</p>{/if}
		<ul class="flex flex-col gap-1.5">
			{#each sorted as entry (entry.id)}
				{@const settled = entry.state === 'addressed' || entry.state === 'dismissed'}
				<li
					class="feedback-entry feedback-{entry.state} rounded-xl border border-(--chat-border)/70 px-3 py-2 text-task"
					data-feedback-entry={entry.id}
					data-state={entry.state}
				>
					<div class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
						<span class="font-mono text-(--chat-fg-subtle)">{entry.id}</span>
						<span class="feedback-state inline-flex items-center gap-1.5 font-medium" data-feedback-state={entry.state}>
							<span class="feedback-dot" aria-hidden="true"></span>{feedbackStateWords(entry.state)}
						</span>
						<span class="text-(--chat-fg-subtle)" title={exactTime(entry.at)}>{relativeTime(entry.at, Date.now())}</span>
						{#if entry.threadId !== 'main'}
							<span class="text-(--chat-fg-subtle)">in {threadName?.(entry.threadId) ?? entry.threadId}</span>
						{/if}
						<span class="flex-1"></span>
						{#if settled}
							<Button
								variant="ghost"
								size="sm"
								class="h-6 px-1.5 text-xs text-(--chat-fg-muted)"
								disabled={busy}
								onclick={() => onset(entry, 'open')}
							>
								<RotateCcwIcon class="size-3" />Reopen
							</Button>
						{:else}
							<Button
								variant="ghost"
								size="sm"
								class="h-6 px-1.5 text-xs text-(--chat-fg-muted)"
								disabled={busy}
								onclick={() => onset(entry, 'dismissed')}
								title="Not needed"
							>
								<XIcon class="size-3" />Dismiss
							</Button>
						{/if}
					</div>
					<div class="mt-1 min-w-0" class:text-(--chat-fg-muted)={settled}><Markdown source={entry.text} userMessage /></div>
					{#if entry.images !== undefined}
						<p class="mt-0.5 flex items-center gap-1 text-xs text-(--chat-fg-subtle)">
							<ImageIcon class="size-3" aria-hidden="true" />{entry.images} image{entry.images === 1 ? '' : 's'}
						</p>
					{/if}
					{#if entry.note}
						<p class="mt-1 border-l-2 border-(--chat-border) pl-2 text-task-sm break-words text-(--chat-fg-muted)" data-feedback-note>
							{entry.note}
						</p>
					{/if}
				</li>
			{/each}
		</ul>
		{#if problem}
			<p class="text-xs text-(--chat-danger)" role="alert">{problem}</p>
		{/if}
	</TaskSection>
{/if}

<style>
	.feedback-dot {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 9999px;
		background: var(--chat-fg-subtle);
	}
	.feedback-open {
		border-color: color-mix(in oklab, var(--accent-2) 35%, transparent);
		background: color-mix(in oklab, var(--accent-2) 6%, transparent);
	}
	.feedback-open .feedback-state {
		color: var(--accent-2);
	}
	.feedback-open .feedback-dot {
		background: var(--accent-2);
	}
	.feedback-handling .feedback-state {
		color: var(--task-status-working);
	}
	.feedback-handling .feedback-dot {
		background: var(--task-status-working);
	}
	.feedback-addressed .feedback-state {
		color: var(--task-status-done);
	}
	.feedback-addressed .feedback-dot {
		background: var(--task-status-done);
	}
	.feedback-dismissed {
		opacity: 0.7;
	}
	.feedback-dismissed .feedback-state {
		color: var(--chat-fg-subtle);
	}
</style>
