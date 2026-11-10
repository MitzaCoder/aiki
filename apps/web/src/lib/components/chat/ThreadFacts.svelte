<script lang="ts">
	import BotIcon from '@lucide/svelte/icons/bot';
	import CircleHelpIcon from '@lucide/svelte/icons/circle-help';
	import ClipboardListIcon from '@lucide/svelte/icons/clipboard-list';
	import { openQuestionsText, ownedTasksText, runningWorkersText } from '#lib/threads.js';
	import type { ThreadSummary } from '@aiki/protocol';

	/** A thread's live counts as small chips: workers running, the tasks it owns, questions waiting on the user. */
	let { thread }: { thread: Pick<ThreadSummary, 'runningWorkers' | 'ownedTasks' | 'openQuestions'> } = $props();

	const workers = $derived(runningWorkersText(thread.runningWorkers));
	const tasks = $derived(ownedTasksText(thread.ownedTasks));
	const questions = $derived(openQuestionsText(thread.openQuestions));
</script>

{#if workers || tasks || questions}
	<span class="flex min-w-0 flex-wrap items-center gap-1.5 text-[0.6875rem] text-(--chat-fg-subtle)">
		{#if questions}
			<span class="fact needs-you inline-flex items-center gap-1 rounded-md px-1.5 py-px font-medium">
				<CircleHelpIcon class="size-3" aria-hidden="true" />{questions}
			</span>
		{/if}
		{#if workers}
			<span class="fact inline-flex items-center gap-1 rounded-md px-1.5 py-px">
				<BotIcon class="size-3" aria-hidden="true" />{workers}
			</span>
		{/if}
		{#if tasks}
			<span class="fact inline-flex min-w-0 items-center gap-1 rounded-md px-1.5 py-px" title={thread.ownedTasks.join(', ')}>
				<ClipboardListIcon class="size-3 shrink-0" aria-hidden="true" /><span class="truncate">{tasks}</span>
			</span>
		{/if}
	</span>
{/if}

<style>
	.fact {
		background: color-mix(in oklab, var(--chat-surface-2) 80%, transparent);
	}
	.needs-you {
		color: var(--accent-2);
		background: color-mix(in oklab, var(--accent-2) 12%, transparent);
	}
</style>
