<script lang="ts">
	import GitBranchIcon from '@lucide/svelte/icons/git-branch';
	import LockIcon from '@lucide/svelte/icons/lock';
	import LinkIcon from '@lucide/svelte/icons/link';
	import { linkTarget, openFeedbackCount } from '#lib/task-relations.js';
	import type { TaskRow } from '#lib/tasks.js';

	type BoardTask = TaskRow['task'];
	let { task, tasks, archivedLinks = [], nested, taskHref, onopen }: {
		task: BoardTask;
		tasks: readonly BoardTask[];
		archivedLinks?: readonly Pick<BoardTask, 'id' | 'title' | 'status' | 'archived'>[];
		nested: boolean;
		taskHref: (id: string) => string;
		onopen?: (id: string) => void;
	} = $props();
	const parent = $derived(task.parent == null ? undefined : linkTarget(task.parent, tasks, archivedLinks));
	const progress = $derived(task.subtaskCount);
	const feedback = $derived(openFeedbackCount(task));
	const hints = $derived([
		...(task.foundWhile ? [{ id: task.foundWhile, label: 'Found while working on', icon: GitBranchIcon }] : []),
		...task.blockedBy.map((id) => ({ id, label: 'Blocked by', icon: LockIcon })),
		...(task.related ?? []).map((id) => ({ id, label: 'Related to', icon: LinkIcon }))
	]);
</script>

{#if (parent && !nested) || (progress && progress.total > 0) || hints.length > 0 || feedback > 0}
	<span class="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.6875rem] leading-4 text-(--chat-fg-subtle)">
		{#if parent && !nested}
			{@const label = `Subtask of ${parent.id}${parent.title ? `: ${parent.title}` : ''}${parent.archived ? ' (archived)' : ''}`}
			<a href={taskHref(parent.id)} onclick={() => onopen?.(parent.id)} title={label} aria-label={label} class="family-link" class:opacity-60={parent.closed} data-parent-chip={parent.id}>↳ {parent.id}</a>
		{/if}
		{#if progress && progress.total > 0}
			<span class="inline-flex items-center gap-1" title="{progress.done} of {progress.total} subtasks done" data-subtask-chip>
				<svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
					<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.2" />
					<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.5" pathLength="1" stroke-dasharray="{progress.done / progress.total} 1" transform="rotate(-90 8 8)" />
				</svg>
				{progress.done}/{progress.total} subtasks
			</span>
		{/if}
		{#each hints as hint (`${hint.label}-${hint.id}`)}
			{@const target = linkTarget(hint.id, tasks, archivedLinks)}
			{@const label = `${hint.label} ${hint.id}${target.title ? `: ${target.title}` : ''}${target.archived ? ' (archived)' : ''}`}
			<a href={taskHref(hint.id)} onclick={() => onopen?.(hint.id)} title={label} aria-label={label} class="family-link inline-flex items-center" class:opacity-60={target.closed}>
				<hint.icon class="size-3" aria-hidden="true" />
			</a>
		{/each}
		{#if feedback > 0}<span data-feedback-badge={feedback}>{feedback} feedback</span>{/if}
	</span>
{/if}

<style>
	.family-link { position: relative; z-index: 1; border-radius: 3px; }
	.family-link:hover { color: var(--chat-fg); }
	.family-link:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 3px; }
	/* Keep tiny relation glyphs quiet, but give touch a forgiving target. */
	@media (pointer: coarse) {
		.family-link::before { content: ''; position: absolute; inset: -7px -3px; }
	}
</style>
