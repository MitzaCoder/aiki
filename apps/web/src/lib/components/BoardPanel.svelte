<script lang="ts">
	import CardMarkdown from './markdown/CardMarkdown.svelte';
	import { waitingSummary } from '#lib/task-waiting.js';
	import { overlayScroll } from '#lib/scrollbars.js';
	import ArchiveIcon from '@lucide/svelte/icons/archive';
	import ArrowDownIcon from '@lucide/svelte/icons/arrow-down';
	import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';
	import BanIcon from '@lucide/svelte/icons/ban';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import GripVerticalIcon from '@lucide/svelte/icons/grip-vertical';
	import LayersIcon from '@lucide/svelte/icons/layers';
	import LockIcon from '@lucide/svelte/icons/lock';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import TimerIcon from '@lucide/svelte/icons/timer';
	import { inProgressText } from '@aiki/client';
	import { tick } from 'svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import Banner from '#lib/components/Banner.svelte';
	import BoardQuestionCard from '#lib/components/BoardQuestionCard.svelte';
	import BoardTaskEditor from '#lib/components/BoardTaskEditor.svelte';
	import LooseWorkers from '#lib/components/LooseWorkers.svelte';
	import TaskFilters from '#lib/components/TaskFilters.svelte';
	import TaskRelationChips from '#lib/components/TaskRelationChips.svelte';
	import TaskStatusBadge from '#lib/components/TaskStatusBadge.svelte';
	import WorkerStatusBadge from '#lib/components/chat/WorkerStatusBadge.svelte';
	import ArtifactStrip from '#lib/components/artifacts/ArtifactStrip.svelte';
	import { artifactsByTask } from '#lib/artifacts.js';
	import { artifactScope, useArtifactFeed } from '#lib/artifacts.svelte.js';
	import { relativeTime } from '#lib/relative-time.js';
	import {
		answeredQuestions,
		archivedCount,
		blockersOf,
		draftToInput,
		draftFromTask,
		groupTasks,
		openQuestions,
		reorderedIds,
		taskStatusLabel,
		type TaskGroup
	} from '#lib/board.js';
	import { applyTaskFilter } from '#lib/task-relations.js';
	import { taskFilter } from '#lib/tasks-view.svelte.js';
	import { taskStatusToneClass } from '#lib/tasks.js';
	import type { ProjectBoard } from '#lib/board.svelte.js';
	import { questionAskedBy, taskOwner } from '#lib/threads.js';
	import type { BoardQuestion, BoardTask, BoardTaskStatus, ThreadSummary, WorkerSummary } from '@aiki/protocol';

	/**
	 * The project's board, the body of the sidebar's Board tab: the questions waiting on the user (answered right here),
	 * the tasks by status with their workers nested, and the decisions. A task opens in an editor in place of the list;
	 * tasks move by dragging or with the arrow buttons (Alt+Up and Alt+Down on a focused task).
	 */
	let {
		board,
		workers,
		threads = [],
		hrefOf
	}: {
		board: ProjectBoard | undefined;
		workers: readonly WorkerSummary[];
		/** The project's threads, to name a task's owner and a question's asker. */
		threads?: readonly ThreadSummary[];
		hrefOf: (worker: WorkerSummary) => string;
	} = $props();

	/** The project's newest artifacts, read once for every row, by the task each is evidence for. */
	const artifacts = artifactScope();
	const artifactFeed = useArtifactFeed(() => {
		const scope = artifacts?.();
		return scope?.available === true ? { client: scope.client, projectId: scope.projectId, limit: 500 } : undefined;
	});
	const taskArtifacts = $derived(artifactsByTask(artifactFeed.current?.artifacts ?? []));

	/** The task being edited, 'new' for the add form, or undefined for the list. */
	let editing = $state<string | undefined>(undefined);
	let groupOpen = $state<Partial<Record<BoardTaskStatus, boolean>>>({});
	let answeredOpen = $state(false);
	let decisionsOpen = $state(false);
	let draggingId = $state<string | undefined>(undefined);
	let overId = $state<string | undefined>(undefined);
	let rowProblem = $state<string | undefined>(undefined);
	let root = $state<HTMLDivElement | undefined>(undefined);

	const tasks = $derived(board?.tasks ?? []);
	const questions = $derived(board?.board === undefined ? [] : openQuestions(board.board));
	const answered = $derived(board?.board === undefined ? [] : answeredQuestions(board.board));
	const decisions = $derived(board?.board?.decisions ?? []);
	/** The tasks the two filters let through; the rest of the panel reads every task. */
	const shownTasks = $derived(applyTaskFilter(tasks, taskFilter.current));
	const canNarrow = $derived(tasks.some((task) => task.parent != null));
	const groups = $derived(groupTasks(shownTasks, { includeArchived: board?.showArchived === true }));
	const archived = $derived(board?.showArchived === true ? archivedCount(tasks) : 0);
	const editingTask = $derived(editing === undefined || editing === 'new' ? undefined : board?.task(editing));
	const empty = $derived(board?.loaded === true && tasks.length === 0 && questions.length === 0 && decisions.length === 0);

	function isOpen(group: TaskGroup): boolean {
		return groupOpen[group.status] ?? !group.collapsedByDefault;
	}

	function toggleGroup(group: TaskGroup): void {
		groupOpen[group.status] = !isOpen(group);
	}

	function workerOf(id: string): WorkerSummary | undefined {
		return workers.find((worker) => worker.id === id);
	}

	function taskLabelOf(id: string | null): string | undefined {
		if (id === null) return undefined;
		const task = board?.task(id);
		return task === undefined ? id : `${task.id} · ${task.title}`;
	}

	async function answer(question: BoardQuestion, text: string) {
		return board!.answer(question.id, question.revision, text);
	}

	async function move(task: BoardTask, move: { delta: number } | { toIndex: number }): Promise<void> {
		const ids = reorderedIds(tasks, task.id, move);
		if (ids === undefined || board === undefined) return;
		rowProblem = await board.reorder(ids);
		await tick();
		root?.querySelector<HTMLElement>(`[data-task-open="${CSS.escape(task.id)}"]`)?.focus();
	}

	function onRowKeydown(event: KeyboardEvent, task: BoardTask): void {
		if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
		event.preventDefault();
		void move(task, { delta: event.key === 'ArrowUp' ? -1 : 1 });
	}

	function canMove(task: BoardTask): boolean {
		return !task.archived && task.status !== 'done' && task.status !== 'dropped';
	}

	function onDrop(event: DragEvent, target: BoardTask, group: TaskGroup): void {
		event.preventDefault();
		const id = draggingId;
		draggingId = undefined;
		overId = undefined;
		if (id === undefined || id === target.id) return;
		const task = tasks.find((entry) => entry.id === id);
		if (task === undefined || task.status !== target.status) return;
		void move(task, { toIndex: group.tasks.findIndex((entry) => entry.id === target.id) });
	}

	async function drop(task: BoardTask): Promise<void> {
		if (board === undefined) return;
		const outcome = await board.saveTask(
			{ ...draftToInput(draftFromTask(task)), status: 'dropped' },
			{ taskId: task.id, expectedRevision: task.revision }
		);
		rowProblem =
			outcome.kind === 'saved'
				? undefined
				: outcome.kind === 'conflict'
					? `${task.id} changed meanwhile. Open it to review the newer version.`
					: outcome.message;
	}

	function ago(iso: string): string {
		return relativeTime(iso, Date.now());
	}
</script>

{#snippet sectionTitle(title: string, count?: number)}
	<h3 class="flex items-center gap-1.5 px-1 text-[0.6875rem] font-semibold tracking-wide text-(--chat-fg-subtle) uppercase">
		{title}
		{#if count !== undefined}<span class="font-normal">({count})</span>{/if}
	</h3>
{/snippet}

{#snippet rowSkeleton(titleWidth: string)}
	<div class="rounded-xl border border-(--chat-border) px-2.5 py-2" aria-hidden="true">
		<div class="flex items-center gap-2">
			<div class="skeleton h-3.5 w-7"></div>
			<div class="skeleton h-3.5 {titleWidth}"></div>
		</div>
		<div class="mt-2 flex items-center gap-2">
			<div class="skeleton h-3 w-16"></div>
			<div class="skeleton h-3 w-10"></div>
		</div>
	</div>
{/snippet}

{#snippet taskRow(task: BoardTask, group: TaskGroup)}
	{@const blockers = blockersOf(task, tasks)}
	{@const movable = canMove(task)}
	{@const owner = taskOwner(task, threads)}
	<li
		class="board-task task-status-edge {taskStatusToneClass(task.status)} relative flex min-w-0 flex-col gap-1.5 rounded-xl border border-(--chat-border) px-2.5 py-2 transition-colors"
		class:opacity-50={draggingId === task.id}
		class:border-(--accent-2)={overId === task.id && draggingId !== task.id}
		class:opacity-75={task.status === 'done' || task.status === 'dropped'}
		data-task={task.id}
		draggable={movable}
		ondragstart={(event) => {
			if (!movable) return;
			draggingId = task.id;
			event.dataTransfer?.setData('text/plain', task.id);
			if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
		}}
		ondragover={(event) => {
			if (draggingId === undefined) return;
			const dragged = tasks.find((entry) => entry.id === draggingId);
			if (dragged?.status !== task.status) return;
			event.preventDefault();
			overId = task.id;
		}}
		ondragleave={() => {
			if (overId === task.id) overId = undefined;
		}}
		ondrop={(event) => onDrop(event, task, group)}
		ondragend={() => {
			draggingId = undefined;
			overId = undefined;
		}}
	>
		<div class="flex min-w-0 items-start gap-1.5">
			{#if movable}
				<GripVerticalIcon class="mt-0.5 size-3.5 shrink-0 cursor-grab text-(--chat-fg-subtle)" aria-hidden="true" />
			{/if}
			<button
				type="button"
				class="min-w-0 flex-1 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-(--accent-2)"
				data-task-open={task.id}
				onclick={() => (editing = task.id)}
				onkeydown={(event) => onRowKeydown(event, task)}
				aria-label="Edit {task.id}: {task.title}"
				aria-keyshortcuts={movable ? 'Alt+ArrowUp Alt+ArrowDown' : undefined}
			>
				<span class="block text-task font-semibold break-words">
					<span class="font-mono text-xs font-normal text-(--chat-fg-subtle)">{task.id}</span>
					{task.title}
				</span>
			</button>
			<TaskStatusBadge status={task.status} class="shrink-0" />
		</div>

		<TaskRelationChips
			{task}
			{tasks}
			archivedLinks={board?.archivedLinks}
		/>

		{#if owner?.claimed}
			<span
				class="owner-chip inline-flex max-w-full items-center gap-1 self-start rounded-md px-1.5 py-px text-[0.6875rem] font-medium"
				class:owner-main={owner.main}
				title="Claimed by {owner.label}{owner.main ? '' : ', a background thread'}"
				data-owner={owner.threadId}
			>
				<LayersIcon class="size-3 shrink-0" aria-hidden="true" /><span class="truncate">{owner.label}</span>
			</span>
		{:else if owner && threads.some((entry) => !entry.main) && task.status !== 'done' && task.status !== 'dropped'}
			<span class="self-start text-[0.6875rem] text-(--chat-fg-subtle)" data-owner="">Unclaimed</span>
		{/if}

		{#if task.status === 'in_progress' && inProgressText(task)}
			<p class="flex items-center gap-1 text-xs text-(--chat-fg-subtle)" data-in-progress>
				<TimerIcon class="size-3 shrink-0" aria-hidden="true" />{inProgressText(task)}
			</p>
		{/if}

		{#if task.waiting}<p class="text-xs text-(--chat-fg-subtle)">{waitingSummary(task)}</p>{/if}
{#if task.status === 'blocked' && task.blockedReason}
			<p class="flex items-start gap-1 text-xs break-words text-(--chat-danger)">
				<LockIcon class="mt-0.5 size-3 shrink-0" aria-hidden="true" />{task.blockedReason}
			</p>
		{/if}

		{#if blockers.length > 0}
			<p class="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-(--chat-fg-subtle)">
				Waits for
				{#each blockers as blocker (blocker.id)}
					<span
						class="rounded-md border border-(--chat-border) px-1 font-mono"
						class:line-through={blocker.settled}
						title="{blocker.title || 'Archived'} · {blocker.status === 'unknown' ? 'archived' : taskStatusLabel(blocker.status)}"
					>
						{blocker.id}
					</span>
				{/each}
			</p>
		{/if}

		{#if task.writeScopes.length > 0}
			<p class="flex flex-wrap gap-1">
				{#each task.writeScopes as scope (scope)}
					<code class="max-w-full truncate rounded-md bg-(--chat-surface-2) px-1.5 py-0.5 text-[0.6875rem] text-(--chat-fg-muted)" title={scope}>{scope}</code>
				{/each}
			</p>
		{/if}

		{#if taskArtifacts.has(task.id)}
			<ArtifactStrip items={taskArtifacts.get(task.id)} max={4} />
		{/if}

		{#if task.workerIds.length > 0}
			<ul class="flex flex-col gap-1 border-l-2 border-(--chat-border) pl-2" aria-label="Workers on {task.id}">
				{#each task.workerIds as id (id)}
					{@const worker = workerOf(id)}
					<li class="min-w-0">
						{#if worker !== undefined}
							<a
								href={hrefOf(worker)}
								class="flex min-w-0 items-center gap-1.5 rounded-md py-0.5 text-xs hover:bg-(--chat-surface-2)/70"
								data-worker={worker.id}
							>
								<span class="min-w-0 flex-1 truncate font-medium">{worker.title || worker.id}</span>
								<WorkerStatusBadge status={worker.status} class="shrink-0" />
								<ChevronRightIcon class="size-3 shrink-0 text-(--chat-fg-subtle)" />
							</a>
						{:else}
							<span class="block truncate py-0.5 font-mono text-xs text-(--chat-fg-subtle)" title="This worker was forgotten">{id}</span>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}

		{#if movable}
			<div class="flex items-center justify-end gap-0.5">
				<Button variant="ghost" size="icon-sm" class="size-6" onclick={() => move(task, { delta: -1 })} aria-label="Move {task.id} up" title="Move up">
					<ArrowUpIcon class="size-3.5" />
				</Button>
				<Button variant="ghost" size="icon-sm" class="size-6" onclick={() => move(task, { delta: 1 })} aria-label="Move {task.id} down" title="Move down">
					<ArrowDownIcon class="size-3.5" />
				</Button>
				<Button variant="ghost" size="icon-sm" class="size-6" onclick={() => drop(task)} aria-label="Drop {task.id}" title="Drop this task">
					<BanIcon class="size-3.5" />
				</Button>
			</div>
		{/if}
	</li>
{/snippet}

<div class="flex min-h-0 flex-1 flex-col" bind:this={root}>
	<div class="relative flex min-h-0 flex-1 flex-col">
	<div use:overlayScroll={'parent'} class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3">
		<div class="mx-auto flex w-full max-w-3xl flex-col gap-3">
			{#if board === undefined}
				<div class="flex flex-col gap-1.5" role="status" aria-busy="true" aria-label="Loading the board">
					<div class="skeleton mx-1 h-3 w-20"></div>
					{@render rowSkeleton('w-2/3')}
					{@render rowSkeleton('w-3/4')}
					{@render rowSkeleton('w-1/2')}
					<span class="sr-only">Loading the board…</span>
				</div>
			{:else if editing !== undefined && (editing === 'new' || editingTask !== undefined)}
				<BoardTaskEditor
					task={editingTask}
					{tasks}
					onsave={(input, options) => board.saveTask(input, options)}
					onback={() => (editing = undefined)}
				/>
			{:else}
				{#if editing !== undefined}
					<Banner tone="warning">{editing} is no longer on the board.</Banner>
				{/if}
				{#if board.error}
					<Banner tone="error">{board.error}</Banner>
				{/if}
				{#if rowProblem}
					<Banner tone="error">{rowProblem}</Banner>
				{/if}

				{#if questions.length > 0}
					<section class="flex flex-col gap-1.5" aria-label="Questions for you">
						{@render sectionTitle('Questions for you', questions.length)}
						{#each questions as question (question.id)}
							<BoardQuestionCard
								{question}
								taskLabel={taskLabelOf(question.taskId)}
								askedBy={questionAskedBy(question, threads)}
								onanswer={answer}
							/>
						{/each}
					</section>
				{/if}

				<section class="flex flex-col gap-1.5" aria-label="Tasks">
					<div class="flex items-center gap-1 px-1">
						<div class="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
							{@render sectionTitle('Tasks')}
							<TaskFilters {canNarrow} />
						</div>
						<Button variant="ghost" size="sm" class="h-7 px-2 text-xs" onclick={() => (editing = 'new')}>
							<PlusIcon />Add task
						</Button>
					</div>

					{#if !board.loaded}
						<div class="flex flex-col gap-1.5" role="status" aria-busy="true" aria-label="Loading the board">
							<div class="skeleton mx-1 h-3 w-20"></div>
							{@render rowSkeleton('w-2/3')}
							{@render rowSkeleton('w-3/4')}
							<span class="sr-only">Loading the board…</span>
						</div>
					{:else if groups.length === 0}
						<p class="px-1 py-2 text-sm text-(--chat-fg-subtle)">
							{#if empty}
								Nothing on the board yet. The coordinator adds tasks as it plans, or add one yourself.
							{:else}
								No tasks yet.
							{/if}
						</p>
					{/if}

					{#each groups as group (group.status)}
						<div class="flex flex-col gap-1.5" data-group={group.status}>
							<button
								type="button"
								class="flex w-full items-center gap-1.5 rounded-lg px-1 py-1 text-xs font-semibold text-(--chat-fg-muted) hover:text-(--chat-fg) {taskStatusToneClass(group.status)}"
								aria-expanded={isOpen(group)}
								onclick={() => toggleGroup(group)}
							>
								<ChevronRightIcon class="size-3.5 transition-transform {isOpen(group) ? 'rotate-90' : ''}" />
								<span class="task-status-dot" aria-hidden="true"></span>
								{group.label}
								<span class="font-normal text-(--chat-fg-subtle)">({group.tasks.length})</span>
							</button>
							{#if isOpen(group)}
								<ul class="flex flex-col gap-1.5">
									{#each group.tasks as task (task.id)}
										{@render taskRow(task, group)}
									{/each}
								</ul>
							{/if}
						</div>
					{/each}

					<button
						type="button"
						class="flex items-center gap-1.5 self-start rounded-lg px-1 py-1 text-xs text-(--chat-fg-subtle) hover:text-(--chat-fg)"
						aria-pressed={board.showArchived}
						onclick={() => board.setShowArchived(!board.showArchived)}
					>
						<ArchiveIcon class="size-3.5" />
						{board.showArchived ? `Hide archived${archived > 0 ? ` (${archived})` : ''}` : 'Show archived'}
					</button>
				</section>

				{#if answered.length > 0}
					<section class="flex flex-col gap-1.5" aria-label="Answered questions">
						<button
							type="button"
							class="flex w-full items-center gap-1.5 rounded-lg px-1 py-1 text-xs font-semibold text-(--chat-fg-muted) hover:text-(--chat-fg)"
							aria-expanded={answeredOpen}
							onclick={() => (answeredOpen = !answeredOpen)}
						>
							<ChevronRightIcon class="size-3.5 transition-transform {answeredOpen ? 'rotate-90' : ''}" />
							Answered questions
							<span class="font-normal text-(--chat-fg-subtle)">({answered.length})</span>
						</button>
						{#if answeredOpen}
							<ul class="flex flex-col gap-1.5">
								{#each answered as question (question.id)}
									<li class="rounded-xl border border-(--chat-border)/60 px-2.5 py-2 text-task-sm">
										<span class="font-mono text-(--chat-fg-subtle)">{question.id}</span>
										<CardMarkdown source={question.text} />
										<CardMarkdown source={question.answer ?? ''} />
									</li>
								{/each}
							</ul>
						{/if}
					</section>
				{/if}

				{#if decisions.length > 0}
					<section class="flex flex-col gap-1.5" aria-label="Decisions">
						<button
							type="button"
							class="flex w-full items-center gap-1.5 rounded-lg px-1 py-1 text-xs font-semibold text-(--chat-fg-muted) hover:text-(--chat-fg)"
							aria-expanded={decisionsOpen}
							onclick={() => (decisionsOpen = !decisionsOpen)}
						>
							<ChevronRightIcon class="size-3.5 transition-transform {decisionsOpen ? 'rotate-90' : ''}" />
							Decisions
							<span class="font-normal text-(--chat-fg-subtle)">({decisions.length})</span>
						</button>
						{#if decisionsOpen}
							<ul class="flex flex-col gap-1.5">
								{#each decisions as decision (decision.id)}
									<li class="rounded-xl border border-(--chat-border)/60 px-2.5 py-2 text-task-sm">
										<span class="font-mono text-(--chat-fg-subtle)">{decision.id}</span>
										<CardMarkdown source={decision.text} />
										{#if decision.why}
											<div class="mt-1 text-(--chat-fg-muted)"><CardMarkdown source={decision.why} /></div>
										{/if}
										<p class="mt-0.5 text-[0.6875rem] text-(--chat-fg-subtle)">
											{#if decision.taskId}{decision.taskId} · {/if}{ago(decision.at)}
										</p>
									</li>
								{/each}
							</ul>
						{/if}
					</section>
				{/if}

				{#if board.loaded}
					<LooseWorkers {workers} {tasks} {hrefOf} />
				{/if}
			{/if}
		</div>
	</div>
	</div>
</div>

<style>
	.owner-chip {
		color: var(--primary);
		background: color-mix(in oklab, var(--primary) 12%, transparent);
	}
	.owner-chip.owner-main {
		color: var(--chat-fg-muted);
		background: color-mix(in oklab, var(--chat-surface-2) 90%, transparent);
	}
	.board-task {
		background: color-mix(in oklab, var(--chat-surface) 55%, transparent);
	}
</style>
