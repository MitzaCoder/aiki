<script lang="ts">
	import TaskSection from '#lib/components/TaskSection.svelte';
	import ListFilterIcon from '@lucide/svelte/icons/list-filter';
	import TaskStatusBadge from '#lib/components/TaskStatusBadge.svelte';
	import { linkGroups, subtaskFraction, subtaskProgressText } from '#lib/task-relations.js';
	import type { BoardTask, BoardTaskBrief } from '@aiki/protocol';

	/**
	 * A task's links, grouped by kind and shown from this task's side: what it is a subtask of, its subtasks (with how far
	 * they are), the task it was found while working on and what it led to, what it waits for and blocks, and related
	 * tasks. Each link opens that task. A link to a task that is done, dropped or archived stays, dimmed. "Show with
	 * linked" filters the task list to this task and everything linked to it.
	 */
	let {
		task,
		tasks,
		archivedLinks = [],
		hrefOf,
		onshowlinked
	}: {
		task: BoardTask;
		/** Every task the board lists, to name a link's target. */
		tasks: readonly BoardTask[];
		/** Archived tasks the board names only by title and status. */
		archivedLinks?: readonly BoardTaskBrief[];
		hrefOf: (taskId: string) => string;
		onshowlinked?: () => void;
	} = $props();

	const groups = $derived(linkGroups(task, tasks, archivedLinks));
	const progressText = $derived(subtaskProgressText(task));
	const fraction = $derived(subtaskFraction(task));
</script>

{#if groups.length > 0}
	<TaskSection
		title="Related"
		kind="related"
		count={groups.reduce((total, group) => total + group.items.length, 0)}
		class="flex flex-col gap-2.5"
		data-related
	>
		{#snippet meta()}
			{#if onshowlinked}
				<button
					type="button"
					class="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.6875rem] text-(--chat-fg-subtle) hover:bg-(--chat-surface-2) hover:text-(--chat-fg)"
					onclick={onshowlinked}
					data-show-linked
					title="Show this task and everything linked to it in the task list"
				>
					<ListFilterIcon class="size-3" aria-hidden="true" />Show with linked
				</button>
			{/if}
		{/snippet}
		{#each groups as group (group.kind)}
			<div class="flex flex-col gap-1" data-link-group={group.kind}>
				<p class="flex items-baseline gap-2 px-0.5 text-xs font-semibold text-(--chat-fg-muted)">
					{group.label}
					{#if group.kind === 'subtasks' && progressText}
						<span class="font-normal text-(--chat-fg-subtle) tabular-nums" data-subtask-progress>{progressText}</span>
					{/if}
				</p>
				{#if group.kind === 'subtasks' && fraction !== undefined}
					<div
						class="h-1.5 overflow-hidden rounded-full bg-(--chat-surface-2)"
						role="progressbar"
						aria-label="Subtasks done"
						aria-valuemin="0"
						aria-valuemax={task.subtaskCount?.total}
						aria-valuenow={task.subtaskCount?.done}
					>
						<div class="h-full rounded-full bg-(--task-status-done)" style="width: {Math.round(fraction * 100)}%"></div>
					</div>
				{/if}
				<ul class="flex flex-col gap-1">
					{#each group.items as item (item.id)}
						<li class="min-w-0">
							<a
								href={hrefOf(item.id)}
								class="relation-row flex min-w-0 items-center gap-2 rounded-lg border border-(--chat-border)/70 px-3 py-1.5 text-[0.8125rem] hover:bg-(--chat-surface-2)/70"
								class:relation-closed={item.closed}
								data-link={item.id}
								data-link-closed={item.closed ? 'true' : undefined}
								title={item.archived ? `${item.id} is archived` : undefined}
							>
								<span class="shrink-0 font-mono text-xs text-(--chat-fg-subtle)">{item.id}</span>
								<span class="min-w-0 flex-1 truncate font-medium" class:line-through={item.status === 'dropped'}
									>{item.title === '' ? 'Not on the board' : item.title}</span
								>
								{#if item.archived}<span class="shrink-0 text-[0.6875rem] text-(--chat-fg-subtle)">archived</span>{/if}
								{#if item.status !== 'unknown'}<TaskStatusBadge status={item.status} class="shrink-0" />{/if}
							</a>
						</li>
					{/each}
				</ul>
			</div>
		{/each}
	</TaskSection>
{/if}

<style>
	/* Done, dropped and archived targets stay, quieter than the live ones. */
	.relation-closed {
		opacity: 0.62;
	}
	.relation-closed:hover,
	.relation-closed:focus-visible {
		opacity: 1;
	}
</style>
