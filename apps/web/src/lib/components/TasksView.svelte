<script lang="ts">
	import ListIcon from '@lucide/svelte/icons/list';
	import KanbanIcon from '@lucide/svelte/icons/square-kanban';
	import NetworkIcon from '@lucide/svelte/icons/network';
	import TaskGraph from '#lib/components/TaskGraph.svelte';
	import TaskBoard from '#lib/components/TaskBoard.svelte';
	import TasksPanel from '#lib/components/TasksPanel.svelte';
	import type { ProjectBoard } from '#lib/board.svelte.js';
	import type { TasksViewMode } from '#lib/kanban.js';
	import { tasksView } from '#lib/tasks-view.svelte.js';
	import type { ThreadSummary, WorkerSummary } from '@kemiri/protocol';

	/**
	 * The full-width Tasks view: list, board or graph, with a switch this device remembers. The sidebar
	 * at its usual width always shows the list; this view is the sidebar expanded, or its sheet on a narrow screen.
	 */
	let {
		board,
		workers = [],
		graphWorkers = workers,
		scope,
		threads = [],
		workerHref,
		taskHref,
		canNote,
		onsendreason
	}: {
		board: ProjectBoard | undefined;
		workers?: readonly WorkerSummary[];
		graphWorkers?: readonly WorkerSummary[];
		scope: string;
		threads?: readonly ThreadSummary[];
		workerHref?: (worker: WorkerSummary) => string;
		taskHref: (taskId: string) => string;
		canNote: boolean;
		onsendreason?: (taskId: string, text: string) => Promise<void>;
	} = $props();

	const MODES: { mode: TasksViewMode; label: string; icon: typeof ListIcon }[] = [
		{ mode: 'list', label: 'List', icon: ListIcon },
		{ mode: 'board', label: 'Board', icon: KanbanIcon },
		{ mode: 'graph', label: 'Graph', icon: NetworkIcon }
	];
</script>

{#snippet viewSwitch()}
	<div class="inline-flex h-7 items-center gap-0.5 rounded-lg bg-(--chat-surface-2)/70 p-0.5" role="group" aria-label="Show the tasks as">
		{#each MODES as entry (entry.mode)}
			{@const selected = tasksView.mode === entry.mode}
			<button
				type="button"
				class="inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-xs font-semibold transition-colors {selected
					? 'bg-(--chat-bg) text-(--chat-fg) shadow-sm'
					: 'text-(--chat-fg-subtle) hover:text-(--chat-fg)'}"
				aria-pressed={selected}
				data-tasks-view={entry.mode}
				onclick={() => tasksView.set(entry.mode)}
			>
				<entry.icon class="size-3.5" />{entry.label}
			</button>
		{/each}
	</div>
{/snippet}

{#if tasksView.mode === 'board'}
	<TaskBoard {board} {workers} {threads} {workerHref} {taskHref} {canNote} {onsendreason} {viewSwitch} />
{:else if tasksView.mode === 'graph'}
	{#key scope}<TaskGraph {board} {scope} workers={graphWorkers} {threads} {taskHref} {viewSwitch} />{/key}
{:else}
	<TasksPanel {board} {threads} {workers} {workerHref} {taskHref} toolbarStart={viewSwitch} />
{/if}
