<script lang="ts">
	import TaskActivityLine from './TaskActivityLine.svelte';
	import type { BoardTaskActivity } from '@aiki/protocol';
	import GitBranchIcon from '@lucide/svelte/icons/git-branch';
	import LockIcon from '@lucide/svelte/icons/lock';
	import LinkIcon from '@lucide/svelte/icons/link';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import * as Popover from '#lib/components/ui/popover/index.js';
	import { linkGroups, linkTarget, openFeedbackCount, type LinkTarget } from '#lib/task-relations.js';
	import type { TaskRow } from '#lib/tasks.js';

	type BoardTask = TaskRow['task'];
	let { task, tasks, archivedLinks = [], nested, taskHref, onopen, summary = '', activity, canToggle = false, expanded = false, foldedCount = 0, ontoggle }: {
		task: BoardTask;
		tasks: readonly BoardTask[];
		archivedLinks?: readonly Pick<BoardTask, 'id' | 'title' | 'status' | 'archived'>[];
		nested: boolean;
		taskHref: (id: string) => string;
		onopen?: (id: string) => void;
		summary?: string;
		activity?: BoardTaskActivity;
		canToggle?: boolean;
		expanded?: boolean;
		foldedCount?: number;
		ontoggle?: () => void;
	} = $props();
	const parent = $derived(task.parent == null ? undefined : linkTarget(task.parent, tasks, archivedLinks));
	const progress = $derived(task.subtaskCount);
	const feedback = $derived(openFeedbackCount(task));
	const hints = $derived(linkGroups(task, tasks, archivedLinks).filter(group => ['foundWhile', 'blockedBy', 'related'].includes(group.kind)));
	let openGroup = $state<string | null>(null);
	function relationLabel(label: string, target: LinkTarget): string {
		return `${label} ${target.id}${target.title ? `: ${target.title}` : ''}${target.archived ? ' (archived)' : ''}`;
	}
</script>

{#snippet relationIcon(kind: string)}
	{#if kind === 'foundWhile'}<GitBranchIcon class="size-3" aria-hidden="true" />
	{:else if kind === 'blockedBy'}<LockIcon class="size-3" aria-hidden="true" />
	{:else}<LinkIcon class="size-3" aria-hidden="true" />{/if}
{/snippet}

{#snippet progressCount()}
	{#if progress && progress.total > 0}
		<svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
			<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.2" />
			<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.5" pathLength="1" stroke-dasharray="{progress.done / progress.total} 1" transform="rotate(-90 8 8)" />
		</svg>
		{progress.done}/{progress.total}
	{:else}Subtasks{/if}
{/snippet}

{#if activity || summary || (parent && !nested) || (progress && progress.total > 0) || canToggle || hints.length > 0 || feedback > 0}
	<span class="family-meta flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.6875rem] leading-4 text-(--chat-fg-subtle)">
		{#if activity}<TaskActivityLine {activity} compact />{:else if summary}<span class="max-w-full text-(--chat-fg-muted)" class:truncate={task.status !== 'waiting'} class:text-task-sm={task.status !== 'waiting'} class:text-xs={task.status === 'waiting'}>{summary}</span>{/if}
		{#if parent && !nested}
			{@const label = relationLabel('Subtask of', parent)}
			<a href={taskHref(parent.id)} onclick={() => onopen?.(parent.id)} title={label} aria-label={label} class="family-link" class:opacity-60={parent.closed} data-parent-chip={parent.id}>↳ {parent.id}</a>
		{/if}
		{#each hints as group (group.kind)}
			{@const label = group.items.map(target => relationLabel(group.label, target)).join('; ')}
			{#if group.items.length === 1}
				{@const target = group.items[0]!}
				<a href={taskHref(target.id)} onclick={() => onopen?.(target.id)} title={label} aria-label={label} class="family-link inline-flex items-center" class:opacity-60={target.closed}>
					{@render relationIcon(group.kind)}
				</a>
			{:else}
				<Popover.Root open={openGroup === group.kind} onOpenChange={(open) => openGroup = open ? group.kind : null}>
					<Popover.Trigger class="family-link inline-flex items-center gap-1" title={label} aria-label={label}>
						{@render relationIcon(group.kind)}{group.items.length}
					</Popover.Trigger>
					<Popover.Content class="w-80 p-1" side="bottom" align="start">
						<p class="px-2 py-1 text-xs font-medium">{group.label}</p>
						{#each group.items as target (target.id)}
							<a href={taskHref(target.id)} onclick={() => { openGroup = null; onopen?.(target.id); }} class="block rounded px-2 py-2 text-sm hover:bg-(--chat-surface-2) focus-visible:outline-2 focus-visible:outline-(--accent-2)" class:opacity-60={target.closed}>
								{relationLabel(group.label, target)}
							</a>
						{/each}
					</Popover.Content>
				</Popover.Root>
			{/if}
		{/each}
		{#if (progress && progress.total > 0) || canToggle}
			{@const label = progress && progress.total > 0 ? `${progress.done} of ${progress.total} subtasks done` : `Subtasks of ${task.id}`}
			{#if canToggle}
				<button type="button" class="family-link family-progress" aria-label="{expanded ? 'Collapse' : 'Expand'} subtasks of {task.id}, {label}" aria-expanded={expanded} title="{label} · {expanded ? 'Collapse subtasks' : `Expand subtasks (${foldedCount} folded)`}" onclick={ontoggle} data-subtask-chip>
					{@render progressCount()}<ChevronRightIcon class="size-3 {expanded ? 'rotate-90' : ''}" aria-hidden="true" />
				</button>
			{:else}
				<span class="family-progress" title={label} aria-label={label} data-subtask-chip>{@render progressCount()}</span>
			{/if}
		{/if}
		{#if feedback > 0}<span data-feedback-badge={feedback}>{feedback} feedback</span>{/if}
	</span>
{/if}

<style>
	.family-meta :global(.family-link) { position: relative; z-index: 1; border-radius: 3px; }
	.family-meta :global(.family-link:hover) { color: var(--chat-fg); }
	.family-meta :global(.family-link:focus-visible) { outline: 2px solid var(--accent-2); outline-offset: 3px; }
	.family-progress { display: inline-flex; align-items: center; gap: 4px; padding: 1px 4px; border-radius: 4px; background: color-mix(in oklab, var(--chat-fg-subtle) 8%, transparent); white-space: nowrap; }
	/* Hit areas grow out of the inline box, never adding a disclosure column or a padded metadata row. */
	button.family-progress::before { content: ''; position: absolute; inset: -12px -4px; }
	@media (pointer: coarse) {
		.family-meta :global(.family-link)::before { content: ''; position: absolute; inset: -12px -4px; }
	}
</style>
