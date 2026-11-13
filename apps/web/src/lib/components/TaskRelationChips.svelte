<script lang="ts">
	import ListTreeIcon from '@lucide/svelte/icons/list-tree';
	import MessageSquareIcon from '@lucide/svelte/icons/message-square';
	import {
		linkTarget,
		openFeedbackCount,
		openFeedbackTitle,
		subtaskCountText,
		subtaskProgressText
	} from '#lib/task-relations.js';
	import type { BoardTask, BoardTaskBrief } from '@kemiri/protocol';

	/**
	 * What a task's row or card says about its links and feedback, in small chips: "↳ T8" on a subtask (it opens the
	 * parent), "2/5 subtasks" on a parent, and a badge with the number of feedback entries still open. Nothing for a task
	 * without any, and nothing at all from a backend that sends none.
	 */
	let {
		task,
		tasks,
		archivedLinks = [],
		hrefOf,
		onopen,
		class: className = ''
	}: {
		task: BoardTask;
		tasks: readonly BoardTask[];
		archivedLinks?: readonly BoardTaskBrief[];
		/** Where a task opens; without it the parent chip is plain text. */
		hrefOf?: (taskId: string) => string;
		onopen?: (taskId: string) => void;
		class?: string;
	} = $props();

	const parent = $derived(task.parent == null ? undefined : linkTarget(task.parent, tasks, archivedLinks));
	const progress = $derived(subtaskProgressText(task));
	const subtaskCount = $derived(subtaskCountText(task));
	const feedback = $derived(openFeedbackCount(task));
</script>

{#if parent !== undefined || subtaskCount !== undefined || feedback > 0}
	<span class="flex min-w-0 flex-wrap items-center gap-1 text-[0.6875rem] leading-4 {className}" data-relations>
		{#if parent !== undefined}
			{@const title = `Subtask of ${parent.id}${parent.title === '' ? '' : ` · ${parent.title}`}${parent.archived ? ' (archived)' : ''}`}
			{#if hrefOf === undefined}
				<span
					class="relation-chip inline-flex max-w-[11rem] items-center gap-1 rounded-md border border-(--chat-border) px-1.5 text-(--chat-fg-muted)"
					class:relation-chip-closed={parent.closed}
					{title}
					data-parent-chip={parent.id}
				>
					<span aria-hidden="true">↳</span><span class="font-mono">{parent.id}</span>
					<span class="sr-only">{title}</span>
				</span>
			{:else}
				<a
					href={hrefOf(parent.id)}
					onclick={() => onopen?.(parent.id)}
					draggable="false"
					class="relation-chip inline-flex max-w-[11rem] items-center gap-1 rounded-md border border-(--chat-border) px-1.5 text-(--chat-fg-muted) hover:bg-(--chat-surface-2) hover:text-(--chat-fg)"
					class:relation-chip-closed={parent.closed}
					{title}
					data-parent-chip={parent.id}
				>
					<span aria-hidden="true">↳</span><span class="font-mono">{parent.id}</span>
					<span class="sr-only">{title}</span>
				</a>
			{/if}
		{/if}
		{#if subtaskCount !== undefined}
			<span
				class="relation-chip inline-flex items-center gap-1 rounded-md border border-(--chat-border) px-1.5 text-(--chat-fg-muted)"
				title={progress === undefined ? subtaskCount : `${subtaskCount}, ${progress}`}
				data-subtask-chip
			>
				<ListTreeIcon class="size-3" aria-hidden="true" />
				<span class="tabular-nums">{task.subtaskCount === undefined || task.subtaskCount.total === 0 ? subtaskCount : `${task.subtaskCount.done}/${task.subtaskCount.total}`}</span>
				<span class="sr-only">{subtaskCount}{progress === undefined ? '' : `, ${progress}`}</span>
			</span>
		{/if}
		{#if feedback > 0}
			<span
				class="relation-chip inline-flex items-center gap-1 rounded-full bg-(--accent-2)/15 px-1.5 font-medium text-(--accent-2)"
				title={openFeedbackTitle(feedback)}
				data-feedback-badge={feedback}
			>
				<MessageSquareIcon class="size-3" aria-hidden="true" /><span class="tabular-nums">{feedback}</span>
				<span class="sr-only">{openFeedbackTitle(feedback)}</span>
			</span>
		{/if}
	</span>
{/if}

<style>
	/* Above the row's stretched link, like the ref chips, so a chip answers a hover and a click of its own. */
	.relation-chip {
		position: relative;
		z-index: 1;
	}
	.relation-chip-closed {
		opacity: 0.6;
	}
</style>
