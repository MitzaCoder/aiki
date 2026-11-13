<script lang="ts">
	import TaskActivityLine from './TaskActivityLine.svelte';
	import { automaticTaskActivity } from '#lib/task-activity.js';
	import { waitingSummary } from '#lib/task-waiting.js';
	import CircleHelpIcon from '@lucide/svelte/icons/circle-help';
	import LayersIcon from '@lucide/svelte/icons/layers';
	import LinkIcon from '@lucide/svelte/icons/link';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import UserCogIcon from '@lucide/svelte/icons/user-cog';
	import type { Snippet } from 'svelte';
	import RefChip from '#lib/components/RefChip.svelte';
	import TaskRelationChips from '#lib/components/TaskRelationChips.svelte';
	import { blockersOf } from '#lib/board.js';
	import { cardGist, cardTime, type KanbanCard } from '#lib/kanban.js';
	import { useRefLinks } from '#lib/ref-links.svelte.js';
	import { isWarning, refLabel, taskRefs, taskStatusToneClass, taskStatusWords } from '#lib/tasks.js';
	import { taskOwner } from '#lib/threads.js';
	import type { BoardTask, BoardTaskBrief, ThreadSummary, WorkerSummary } from '@kemiri/protocol';

	/**
	 * One task on the board: what a list row says (status dot, title, gist, refs with their live state, time and ID) and,
	 * when it matters, the worker on it, what it waits for and the background thread that holds it. Its title's link
	 * covers the card, so a click anywhere but a chip or the menu opens the task's sheet. A task that needs the user is
	 * tinted like its list row. `ghost` draws the copy that follows the pointer while it is dragged.
	 */
	let {
		card,
		tasks,
		workers = [],
		threads = [],
		now,
		href,
		onopen,
		archivedLinks = [],
		taskHref,
		onopentask,
		menu,
		ghost = false,
		lifted = false,
		searchHit,
		activityEnabled = false
	}: {
		card: KanbanCard;
		activityEnabled?: boolean;
		/** Every task on the board, to name what this one waits for. */
		tasks: readonly BoardTask[];
		workers?: readonly WorkerSummary[];
		threads?: readonly ThreadSummary[];
		now: number;
		href: string;
		onopen?: () => void;
		/** Archived tasks the board names only by title and status, for a parent chip. */
		archivedLinks?: readonly BoardTaskBrief[];
		/** Where a task opens, for the parent chip. */
		taskHref?: (taskId: string) => string;
		onopentask?: (taskId: string) => void;
		/** The "Move to…" menu, at the card's top right. */
		menu?: Snippet;
		ghost?: boolean;
		/** The card being dragged: its place stays, faded. */
		lifted?: boolean;
		searchHit?: import('#lib/task-search.js').TaskSearchHit;
	} = $props();

	const refLinks = useRefLinks();

	const task = $derived(card.task);
	const needsYou = $derived(card.waiting.length > 0 && card.column !== 'done');
	const warned = $derived(card.waiting.some(isWarning));
	const gist = $derived(cardGist(card, activityEnabled));
	const activity = $derived(automaticTaskActivity(task, activityEnabled));
	const refs = $derived(taskRefs(task));
	const time = $derived(cardTime(card, now));
	const closed = $derived(card.column === 'done');
	const running = $derived(
		workers.filter((worker) => worker.status === 'running' && (worker.taskId === task.id || (worker.taskId === undefined && task.workerIds.includes(worker.id))))
	);
	const waitsFor = $derived(task.status === 'done' || task.status === 'dropped' ? [] : blockersOf(task, tasks).filter((blocker) => !blocker.settled));
	const owner = $derived(taskOwner(task, threads));
	const ownerShown = $derived(owner?.claimed === true && !owner.main);
</script>

<article
	class="task-card {taskStatusToneClass(task.status)} relative flex min-w-0 gap-2 rounded-xl border px-3 py-2.5"
	class:task-card-warning={needsYou && warned}
	class:task-card-question={needsYou && !warned}
	class:task-card-dropped={task.status === 'dropped'}
	class:task-card-ghost={ghost}
	class:task-card-lifted={lifted}
	class:search-context={searchHit?.context === true}
	data-task={task.id}
	aria-hidden={ghost ? 'true' : undefined}
>
	<span class="flex h-5 w-3.5 shrink-0 items-center justify-center" aria-hidden="true">
		{#if needsYou && warned}
			<TriangleAlertIcon class="size-3.5 text-(--chat-warning)" />
		{:else if needsYou}
			<CircleHelpIcon class="size-3.5 text-(--accent-2)" />
		{:else}
			<span class="task-status-dot" class:task-card-pulse={task.status === 'in_progress' && !ghost}></span>
		{/if}
	</span>
	<div class="flex min-w-0 flex-1 flex-col gap-1">
		<a
			{href}
			draggable="false"
			tabindex={ghost ? -1 : undefined}
			onclick={() => onopen?.()}
			class="task-card-link line-clamp-3 pr-6 text-[0.875rem] leading-5 font-medium break-words outline-none {closed
				? 'text-(--chat-fg-muted)'
				: 'text-(--chat-fg)'}"
			aria-label="Open {task.id}: {task.title}">{#each task.title.split('') as letter, at}{#if searchHit?.ranges.some(([start, end]) => at >= start && at < end)}<mark>{letter}</mark>{:else}{letter}{/if}{/each}</a
		>
		{#if task.waiting && !activity}<p class="text-xs text-(--chat-fg-subtle)">{waitingSummary(task)}</p>{/if}
{#if searchHit?.snippet}<p class="truncate text-xs text-(--chat-fg-muted)">{searchHit.snippet}</p>{/if}
{#if !searchHit?.snippet && activity}
			<TaskActivityLine {activity} compact />
{:else if !searchHit?.snippet && gist.length > 0 && task.status !== 'waiting'}
			<p class="line-clamp-2 text-task-sm break-words text-(--chat-fg-muted)">{gist}</p>
		{/if}
		{#if needsYou && card.waiting.length > 1}
			<p class="text-[0.6875rem] leading-4 text-(--chat-fg-subtle)">+{card.waiting.length - 1} more waiting</p>
		{/if}
		{#if !ghost}
			<TaskRelationChips {task} {tasks} {archivedLinks} hrefOf={taskHref} onopen={onopentask} />
		{/if}
		{#if refs.length > 0}
			{@const current = refLinks()}
			<div class="flex min-w-0 flex-wrap items-center gap-1 text-[0.6875rem] leading-4 text-(--chat-fg-subtle)">
				{#each refs.slice(0, 3) as ref (ref)}
					<RefChip {ref} links={current?.links} status={current?.status(ref)} />
				{/each}
				{#if refs.length > 3}
					<span title={refs.slice(3).map((ref) => refLabel(ref, current?.links)).join('\n')}>+{refs.length - 3}</span>
				{/if}
			</div>
		{/if}
		{#if running.length > 0 || waitsFor.length > 0 || ownerShown}
			<ul class="flex min-w-0 flex-col gap-0.5 text-[0.6875rem] leading-4 text-(--chat-fg-muted)">
				{#each running as worker (worker.id)}
					<li class="flex min-w-0 items-center gap-1.5" title={worker.title}>
						<UserCogIcon class="size-3 shrink-0 text-(--task-status-working)" aria-hidden="true" />
						<span class="truncate"><span class="text-(--chat-fg-subtle)">Worker</span> {worker.id}</span>
					</li>
				{/each}
				{#if waitsFor.length > 0}
					<li class="flex min-w-0 items-center gap-1.5" title={waitsFor.map((blocker) => `${blocker.id} · ${blocker.title}`).join('\n')}>
						<LinkIcon class="size-3 shrink-0 text-(--chat-fg-subtle)" aria-hidden="true" />
						<span class="truncate"
							><span class="text-(--chat-fg-subtle)">Waits for</span>
							{waitsFor.map((blocker) => blocker.id).join(', ')}</span
						>
					</li>
				{/if}
				{#if ownerShown && owner !== undefined}
					<li class="flex min-w-0 items-center gap-1.5" title="A background thread holds this task">
						<LayersIcon class="size-3 shrink-0 text-(--chat-fg-subtle)" aria-hidden="true" />
						<span class="truncate">{owner.label}</span>
					</li>
				{/if}
			</ul>
		{/if}
		<div class="flex items-center gap-1.5 text-[0.6875rem] leading-4 text-(--chat-fg-subtle)">
			{#if needsYou || task.status === 'dropped'}
				<span class="inline-flex shrink-0 items-center gap-1 font-medium text-(--task-status)">
					<span class="task-status-dot" aria-hidden="true"></span>{taskStatusWords(task.status)}
				</span>
			{/if}
			<span class="flex-1"></span>
			<span class="whitespace-nowrap tabular-nums" title={time.title}>{time.text}</span>
			<span aria-hidden="true">·</span>
			<span class="font-mono text-[0.625rem] opacity-80">{task.id}</span>
		</div>
	</div>
	{#if menu !== undefined && !ghost}
		<div class="task-card-menu-slot absolute top-1.5 right-1.5">{@render menu()}</div>
	{/if}
</article>

<style>
	.search-context { opacity: 0.5; }
	mark { background: color-mix(in oklab, var(--accent-2) 22%, transparent); color: inherit; }
	.task-card {
		border-color: color-mix(in oklab, var(--chat-border) 85%, transparent);
		background: color-mix(in oklab, var(--chat-bg) 55%, var(--chat-surface));
		box-shadow: 0 1px 2px color-mix(in oklab, var(--chat-shadow, #000) 6%, transparent);
		transition:
			background-color 120ms ease,
			border-color 120ms ease,
			opacity 120ms ease;
	}
	/* The title's link reaches over the card; the chips and the menu sit above it. */
	.task-card-link::after {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: inherit;
	}
	.task-card:has(.task-card-link:focus-visible) {
		box-shadow: 0 0 0 2px var(--accent-2);
	}
	.task-card:hover:not(:has(.ref-chip:hover, .relation-chip:hover, .task-card-menu-slot:hover)) {
		border-color: color-mix(in oklab, var(--chat-border-strong) 90%, transparent);
	}
	.task-card-menu-slot {
		z-index: 1;
	}
	/* Only cards that need the user get a wash: amber for a warning, the accent for a question. */
	.task-card-warning {
		border-color: color-mix(in oklab, var(--chat-warning) 35%, transparent);
		background: color-mix(in oklab, var(--chat-warning) 9%, var(--chat-bg));
	}
	.task-card-question {
		border-color: color-mix(in oklab, var(--accent-2) 30%, transparent);
		background: color-mix(in oklab, var(--accent-2) 8%, var(--chat-bg));
	}
	.task-card-dropped {
		opacity: 0.6;
	}
	.task-card-dropped .task-card-link {
		text-decoration: line-through;
		text-decoration-color: color-mix(in oklab, var(--chat-fg-subtle) 60%, transparent);
	}
	.task-card-lifted {
		opacity: 0.35;
		border-style: dashed;
	}
	.task-card-ghost {
		pointer-events: none;
		border-color: color-mix(in oklab, var(--chat-border-strong) 90%, transparent);
		box-shadow:
			0 12px 28px -8px color-mix(in oklab, #000 28%, transparent),
			0 2px 6px color-mix(in oklab, #000 10%, transparent);
	}
	/* The menu is a hint for a pointer that hovers; a touch screen always shows it. */
	@media (hover: hover) and (pointer: fine) {
		.task-card-menu-slot {
			opacity: 0;
			transition: opacity 120ms ease;
		}
		.task-card:hover .task-card-menu-slot,
		.task-card:focus-within .task-card-menu-slot,
		.task-card-menu-slot:has(:global([aria-expanded='true'])) {
			opacity: 1;
		}
	}
	.task-card-pulse {
		animation: task-card-pulse 2.4s ease-in-out infinite;
	}
	@keyframes task-card-pulse {
		0%,
		100% {
			box-shadow: 0 0 0 0 color-mix(in oklab, var(--task-status) 45%, transparent);
		}
		50% {
			box-shadow: 0 0 0 3.5px color-mix(in oklab, var(--task-status) 0%, transparent);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.task-card-pulse {
			animation: none;
		}
	}
</style>
