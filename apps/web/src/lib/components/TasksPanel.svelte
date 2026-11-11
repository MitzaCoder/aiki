<script lang="ts">
	import CardMarkdown from './markdown/CardMarkdown.svelte';
	import TaskSearchBox from './TaskSearchBox.svelte';
	import { useTaskSearch } from '#lib/task-search.svelte.js';
	import { page } from '$app/state';
	import TaskFamilyMeta from './TaskFamilyMeta.svelte';
	import { familyExpansionKey, loadFamilyExpansion, needsFamilyAttention, saveFamilyExpansion, taskFamilies, type TaskFamily } from '#lib/task-families.js';
	import { waitingSummary } from '#lib/task-waiting.js';
	import { overlayScroll } from '#lib/scrollbars.js';
	import ArchiveIcon from '@lucide/svelte/icons/archive';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import CircleHelpIcon from '@lucide/svelte/icons/circle-help';
	import { formatMinutes } from '@aiki/client';
	import { Button } from '#lib/components/ui/button/index.js';
	import Banner from '#lib/components/Banner.svelte';
	import BoardQuestionCard from '#lib/components/BoardQuestionCard.svelte';
	import BoardTaskEditor from '#lib/components/BoardTaskEditor.svelte';
	import LooseWorkers from '#lib/components/LooseWorkers.svelte';
	import RefChip from '#lib/components/RefChip.svelte';
	import TaskFilters from '#lib/components/TaskFilters.svelte';
	import { applyTaskFilter } from '#lib/task-relations.js';
	import { taskFilter } from '#lib/tasks-view.svelte.js';
	import { useRefLinks } from '#lib/ref-links.svelte.js';
	import { compactRelativeTime, relativeTime } from '#lib/relative-time.js';
	import { answeredQuestions } from '#lib/board.js';
	import type { ProjectBoard } from '#lib/board.svelte.js';
	import {
		isWarning,
		looseWaiting,
		refLabel,
		rowGist,
		taskRefs,
		taskSections,
		taskStatusToneClass,
		taskStatusWords,
		type TaskRow,
		type TaskSection,
		type TaskSectionId
	} from '#lib/tasks.js';
	import { questionAskedBy } from '#lib/threads.js';
	import type { BoardQuestion, ThreadSummary, WorkerSummary } from '@aiki/protocol';
	import { untrack, type Snippet } from 'svelte';

	/**
	 * The project's tasks, the body of the sidebar's Tasks tab: every task grouped by what it needs from the user (needs
	 * you, ready for review, blocked, working, to do, recently closed). A row opens the task's sheet (`taskHref`); the
	 * questions and warnings that name no task are answered right here. Decisions and answered questions fold at the
	 * bottom.
	 */
	let {
		board,
		threads = [],
		workers = [],
		workerHref,
		taskHref,
		onopentask,
		toolbarStart
	}: {
		board: ProjectBoard | undefined;
		threads?: readonly ThreadSummary[];
		/** The project's workers, and where one opens: the ones no task lists show under the tasks. */
		workers?: readonly WorkerSummary[];
		workerHref?: (worker: WorkerSummary) => string;
		/** Where a task's sheet opens: the page's URL with `?task=<id>`. */
		taskHref: (taskId: string) => string;
		/** Called when a row is chosen, so the caller can step aside for the sheet. */
		onopentask?: (taskId: string) => void;
		/** Shown at the start of the toolbar: the full-width view's List | Board switch. */
		toolbarStart?: Snippet;
	} = $props();

	const refLinks = useRefLinks();

	// Quiet work starts folded. Remember explicit choices per parent, backend and project.
	const expansionKey = $derived(familyExpansionKey(page.params.backend ?? '', page.params.id ?? ''));
	let savedExpansion = $state<{ key: string; choices: Record<string, boolean> } | null>(null);
	const expansion = $derived(savedExpansion?.key === expansionKey ? savedExpansion.choices : {});

	function familyStorage(): Storage | undefined {
		try { return typeof localStorage === 'undefined' ? undefined : localStorage; } catch { return undefined; }
	}

	$effect(() => {
		const key = expansionKey;
		untrack(() => { savedExpansion = { key, choices: loadFamilyExpansion(key, familyStorage()) }; });
	});

	function toggleFamily(id: string): void {
		const choices = { ...expansion, [id]: expansion[id] !== true };
		savedExpansion = { key: expansionKey, choices };
		saveFamilyExpansion(expansionKey, choices, familyStorage());
	}

	let adding = $state(false);
	let sectionOpen = $state<Partial<Record<TaskSectionId, boolean>>>({});
	let answeredOpen = $state(false);
	let decisionsOpen = $state(false);

	const tasks = $derived(board?.tasks ?? []);
	/** The tasks the two filters let through; every other count reads the whole board. */
	const shownTasks = $derived(applyTaskFilter(tasks, taskFilter.current));
	const search = useTaskSearch(() => tasks, () => board);
	const searching = $derived(search.query.trim().length > 0);
	const searchHits = $derived(search.search(new Set(shownTasks.filter(task => (board?.showArchived || !task.archived) && (sectionOpen.closed === true || !['done', 'dropped'].includes(task.status))).map(task => task.id))));
	const searchHitById = $derived(new Map(searchHits.map(hit => [hit.id, hit])));
	const searchFamilies = $derived.by(() => {
		const rows = new Map(sections.flatMap(section => section.rows.map(row => [row.task.id, row] as const)));
		return searchHits.flatMap(hit => { const row = rows.get(hit.id); return row ? [{ row, children: [], canToggle: false, expanded: true, foldedCount: 0 } satisfies TaskFamily] : []; });
	});
	const canNarrow = $derived(tasks.some((task) => task.parent != null));
	const sections = $derived(
		board?.board === undefined
			? []
			: taskSections({ tasks: shownTasks, questions: board.board.questions }, { includeArchived: board.showArchived })
	);
	const familySections = $derived(sections.map((section) => ({ section, families: taskFamilies(section, expansion) })));
	const loose = $derived(board?.board === undefined ? [] : looseWaiting({ tasks, questions: board.board.questions }));
	const answered = $derived(board?.board === undefined ? [] : answeredQuestions(board.board));
	const decisions = $derived(board?.board?.decisions ?? []);
	const empty = $derived(board?.loaded === true && tasks.length === 0 && loose.length === 0);
	const archivedShown = $derived(board?.showArchived === true ? tasks.filter((task) => task.archived).length : 0);
	const openCount = $derived(shownTasks.filter((task) => !task.archived && task.status !== 'done' && task.status !== 'dropped').length);

	function isOpen(section: TaskSection): boolean {
		return sectionOpen[section.id] ?? (section.rows.some(needsFamilyAttention) || !section.collapsedByDefault);
	}

	function toggle(section: TaskSection): void {
		sectionOpen[section.id] = !isOpen(section);
	}

	function ago(iso: string): string {
		return relativeTime(iso, Date.now());
	}

	function taskLabelOf(question: BoardQuestion): string | undefined {
		if (question.taskId === null) return undefined;
		const title = board?.task(question.taskId)?.title;
		return title === undefined ? question.taskId : `${question.taskId} · ${title}`;
	}

	/** The row's time, short enough for its narrow column: time in progress while working, else how long ago it moved. */
	function timeOf(row: TaskRow): string {
		const { task, section } = row;
		if (section === 'working' && task.inProgressMinutes !== undefined) return formatMinutes(task.inProgressMinutes);
		return compactRelativeTime(section === 'closed' ? (task.settledAt ?? task.updatedAt) : task.updatedAt, Date.now());
	}

	function timeTitleOf(row: TaskRow): string {
		const { task, section } = row;
		if (section === 'working' && task.inProgressMinutes !== undefined) return `${formatMinutes(task.inProgressMinutes)} in progress`;
		if (section === 'closed') return `${task.status === 'dropped' ? 'Dropped' : 'Done'} ${ago(task.settledAt ?? task.updatedAt)}`;
		return `Updated ${ago(task.updatedAt)}`;
	}
</script>

{#snippet countPill(count: number, accent = false)}
	<span
		class="rounded-full px-1.5 text-[0.6875rem] leading-4 font-medium tabular-nums {accent
			? 'bg-(--accent-2)/15 text-(--accent-2)'
			: 'bg-(--chat-surface-2) text-(--chat-fg-subtle)'}">{count}</span
	>
{/snippet}

{#snippet sectionTitle(title: string, count?: number, accent = false)}
	<h3 class="flex items-center gap-1.5 px-1 text-[0.8125rem] font-semibold {accent ? 'text-(--accent-2)' : 'text-(--chat-fg-muted)'}">
		{title}
		{#if count !== undefined}{@render countPill(count, accent)}{/if}
	</h3>
{/snippet}

{#snippet refChips(refs: readonly string[])}
	{@const current = refLinks()}
	{#each refs.slice(0, 2) as ref (ref)}
		<RefChip {ref} links={current?.links} status={current?.status(ref)} />
	{/each}
	{#if refs.length > 2}
		<span class="text-(--chat-fg-subtle)" title={refs.slice(2).map((ref) => refLabel(ref, current?.links)).join('\n')}>+{refs.length - 2}</span>
	{/if}
{/snippet}

{#snippet taskRow(family: TaskFamily, depth = 0)}
	{@const row = family.row}
	{@const warned = row.waiting.some(isWarning)}
	{@const gist = rowGist(row)}
	{@const refs = taskRefs(row.task)}
	{@const needsYou = row.section === 'needs_you'}
	<li class="task-row-item">
		<!-- The title's link covers the whole row; the ref chips sit above it, so neither link is inside the other. -->
		<div
			class="task-row {taskStatusToneClass(row.task.status)} group relative flex min-w-0 items-start gap-2.5 py-2.5 pr-2 pl-3"
			class:task-row-warning={needsYou && warned}
			class:task-row-question={needsYou && !warned}
			class:search-context={searching && searchHitById.get(row.task.id)?.context}
			data-task={row.task.id}
		>
			<span class="flex h-5 w-3.5 shrink-0 items-center justify-center" aria-hidden="true">
				{#if needsYou && warned}
					<TriangleAlertIcon class="size-3.5 text-(--chat-warning)" />
				{:else if needsYou}
					<CircleHelpIcon class="size-3.5 text-(--accent-2)" />
				{:else}
					<span class="task-status-dot" class:task-row-pulse={row.task.status === 'in_progress'}></span>
				{/if}
			</span>
			<span class="flex min-w-0 flex-1 flex-col gap-0.5">
				<a
					href={taskHref(row.task.id)}
					onclick={() => onopentask?.(row.task.id)}
					class="task-row-link line-clamp-2 text-[0.875rem] leading-5 font-medium break-words outline-none {row.section === 'closed'
						? 'text-(--chat-fg-muted)'
						: 'text-(--chat-fg)'}"
					aria-label="Open {row.task.id}: {row.task.title}">{#each row.task.title.split('') as letter, at}{#if searching && searchHitById.get(row.task.id)?.ranges.some(([start, end]) => at >= start && at < end)}<mark>{letter}</mark>{:else}{letter}{/if}{/each}</a
				>
				{#if searching && searchHitById.get(row.task.id)?.snippet}<p class="truncate text-xs text-(--chat-fg-muted)">{searchHitById.get(row.task.id)?.snippet}</p>{/if}
				<TaskFamilyMeta task={row.task} {tasks} archivedLinks={board?.archivedLinks} nested={depth > 0} {taskHref} onopen={onopentask}
					summary={searching && searchHitById.get(row.task.id)?.snippet ? '' : row.task.status === 'waiting' ? waitingSummary(row.task) : gist}
					canToggle={family.canToggle} expanded={family.expanded} foldedCount={family.foldedCount} ontoggle={() => toggleFamily(row.task.id)} />
				{#if needsYou || refs.length > 0}
					<span class="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[0.6875rem] leading-4 text-(--chat-fg-subtle)">
						{#if needsYou}
							<span class="inline-flex shrink-0 items-center gap-1 font-medium text-(--task-status)">
								<span class="task-status-dot" aria-hidden="true"></span>{taskStatusWords(row.task.status)}
							</span>
							{#if row.waiting.length > 1}
								<span class="shrink-0">+{row.waiting.length - 1} more</span>
							{/if}
						{/if}
						{@render refChips(refs)}
					</span>
				{/if}
			</span>
			<span class="flex shrink-0 flex-col items-end gap-0.5 pt-0.5 text-right text-[0.6875rem] leading-4 text-(--chat-fg-subtle)">
				<span class="whitespace-nowrap tabular-nums" title={timeTitleOf(row)}>{timeOf(row)}</span>
				<span class="font-mono text-[0.625rem] opacity-80">{row.task.id}</span>
			</span>
			<ChevronRightIcon class="task-row-chevron mt-0.5 size-3.5 shrink-0 text-(--chat-fg-subtle)" aria-hidden="true" />
		</div>
		{#if family.children.length > 0}
			<ul class="family-children" class:family-depth-limit={depth >= 3} aria-label="Subtasks of {row.task.id}">
				{#each family.children as child (child.row.task.id)}
					{@render taskRow(child, depth + 1)}
				{/each}
			</ul>
		{/if}
	</li>
{/snippet}

{#snippet rowSkeleton(titleWidth: string, gistWidth: string)}
	<div class="task-row-item flex items-start gap-2.5 py-2.5 pr-2 pl-3" aria-hidden="true">
		<span class="flex h-5 w-3.5 shrink-0 items-center justify-center"><span class="skeleton size-2 rounded-full"></span></span>
		<div class="flex min-w-0 flex-1 flex-col gap-2 pt-1">
			<div class="skeleton h-3.5 {titleWidth}"></div>
			<div class="skeleton h-3 {gistWidth}"></div>
		</div>
		<div class="flex shrink-0 flex-col items-end gap-1.5 pt-1">
			<div class="skeleton h-2.5 w-9"></div>
			<div class="skeleton h-2.5 w-5"></div>
		</div>
	</div>
{/snippet}

{#snippet listSkeleton()}
	<div class="task-group">
		{@render rowSkeleton('w-3/4', 'w-11/12')}
		{@render rowSkeleton('w-2/3', 'w-4/5')}
		{@render rowSkeleton('w-4/5', 'w-3/4')}
	</div>
{/snippet}

<div class="flex min-h-0 flex-1 flex-col">
	<div class="relative flex min-h-0 flex-1 flex-col">
	<div use:overlayScroll={'parent'} class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3">
		<div class="mx-auto flex w-full max-w-3xl flex-col gap-4">
			{#if board === undefined}
				<div class="flex flex-col gap-1.5" role="status" aria-busy="true" aria-label="Loading the tasks">
					<div class="skeleton mx-1 h-3.5 w-24"></div>
					{@render listSkeleton()}
					<span class="sr-only">Loading the tasks…</span>
				</div>
			{:else if adding}
				<BoardTaskEditor
					task={undefined}
					{tasks}
					onsave={(input, options) => board.saveTask(input, options)}
					onback={() => (adding = false)}
				/>
			{:else}
				{#if board.error}
					<Banner tone="error">{board.error}</Banner>
				{/if}

				<div class="flex items-center gap-1 px-1">
					{#if toolbarStart}<div class="mr-1.5 shrink-0">{@render toolbarStart()}</div>{/if}
					<div class="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-(--chat-fg-subtle)">
						{#if !board.loaded}
							<span class="skeleton inline-block h-3 w-14 align-middle" aria-hidden="true"></span>
							<span class="sr-only">Loading the tasks…</span>
						{:else if empty}
							Nothing here yet.
						{:else}
							{openCount} open
						{/if}
						<TaskFilters {canNarrow} />
					</div>
					<Button variant="ghost" size="sm" class="h-7 px-2 text-xs" onclick={() => (adding = true)}>
						<PlusIcon />Add task
					</Button>
				</div>

				<TaskSearchBox query={search.query} onchange={search.setQuery} />
				{#if searching}
					<label class="px-1 text-xs text-(--chat-fg-muted)"><input type="checkbox" checked={sectionOpen.closed === true} onchange={event => sectionOpen.closed = event.currentTarget.checked} /> Show closed</label>
					<section aria-label="Search results" aria-live="polite">
						<p class="mb-2 px-1 text-xs text-(--chat-fg-subtle)">{searchHits.filter(hit => !hit.context).length} matching tasks</p>
						{#if searchFamilies.length}<ul class="task-group">{#each searchFamilies as family (family.row.task.id)}{@render taskRow(family)}{/each}</ul>{:else}<p class="px-1 text-sm text-(--chat-fg-muted)">No tasks match your search.</p>{/if}
					</section>
				{/if}

				{#if !board.loaded}
					<div class="flex flex-col gap-1.5" aria-hidden="true">
						<div class="skeleton mx-1 h-3.5 w-24"></div>
						{@render listSkeleton()}
					</div>
				{:else if empty}
					<p class="px-1 text-sm text-(--chat-fg-subtle)">
						The coordinator adds a task for each thing you bring up. You can also add one yourself.
					</p>
				{/if}

				{#if board.loaded && !empty && sections.length === 0 && loose.length === 0}
					<p class="px-1 text-sm text-(--chat-fg-subtle)" data-filter-empty>No task matches the filter.</p>
				{/if}

				{#if loose.length > 0}
					<section class="flex flex-col gap-1.5" aria-label="Waiting for you, not about a task">
						{@render sectionTitle('Waiting for you', loose.length, true)}
						{#each loose as question (question.id)}
							<BoardQuestionCard
								{question}
								taskLabel={taskLabelOf(question)}
								taskHref={question.taskId === null ? undefined : taskHref(question.taskId)}
								askedBy={questionAskedBy(question, threads)}
								onanswer={(entry, text) => board.answer(entry.id, entry.revision, text)}
							/>
						{/each}
					</section>
				{/if}

				{#each searching ? [] : familySections as entry (entry.section.id)}
					{@const section = entry.section}
					<section class="flex flex-col gap-1.5" data-section={section.id} aria-label={section.label}>
						{#if section.collapsedByDefault}
							<button
								type="button"
								class="flex w-full items-center gap-1.5 rounded-lg px-1 py-0.5 text-[0.8125rem] font-semibold text-(--chat-fg-muted) hover:text-(--chat-fg)"
								aria-expanded={isOpen(section)}
								onclick={() => toggle(section)}
							>
								{section.label}
								{@render countPill(section.rows.length)}
								<ChevronRightIcon class="size-3.5 text-(--chat-fg-subtle) transition-transform {isOpen(section) ? 'rotate-90' : ''}" />
							</button>
						{:else}
							{@render sectionTitle(section.label, section.rows.length, section.id === 'needs_you')}
						{/if}
						{#if isOpen(section)}
							<ul class="task-group">
								{#each entry.families as family (family.row.task.id)}
									{@render taskRow(family)}
								{/each}
							</ul>
						{/if}
					</section>
				{/each}

				<button
					type="button"
					class="flex items-center gap-1.5 self-start rounded-lg px-1 py-1 text-xs text-(--chat-fg-subtle) hover:text-(--chat-fg)"
					aria-pressed={board.showArchived}
					onclick={() => board.setShowArchived(!board.showArchived)}
				>
					<ArchiveIcon class="size-3.5" />
					{board.showArchived ? `Hide archived${archivedShown > 0 ? ` (${archivedShown})` : ''}` : 'Show archived'}
				</button>

				{#if answered.length > 0}
					<section class="flex flex-col gap-1.5" aria-label="Answered questions">
						<button
							type="button"
							class="flex w-full items-center gap-1.5 rounded-lg px-1 py-1 text-xs font-semibold text-(--chat-fg-muted) hover:text-(--chat-fg)"
							aria-expanded={answeredOpen}
							onclick={() => (answeredOpen = !answeredOpen)}
						>
							<ChevronRightIcon class="size-3.5 transition-transform {answeredOpen ? 'rotate-90' : ''}" />
							Answered
							{@render countPill(answered.length)}
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
							{@render countPill(decisions.length)}
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

				{#if board.loaded && workerHref}
					<LooseWorkers {workers} {tasks} hrefOf={workerHref} />
				{/if}
			{/if}
		</div>
	</div>
	</div>
</div>

<style>
	.search-context { opacity: 0.5; }
	mark { background: color-mix(in oklab, var(--accent-2) 22%, transparent); color: inherit; border-radius: 2px; }
	.family-children { margin-left: 14px; border-left: 1px solid var(--chat-border); }
	.family-depth-limit { margin-left: 0; }
	/* A section's rows as one inset-grouped card, split by hairlines that start where the text does. */
	.task-group {
		display: flex;
		flex-direction: column;
		overflow: hidden;
		border: 1px solid color-mix(in oklab, var(--chat-border) 80%, transparent);
		border-radius: 0.875rem;
		background: color-mix(in oklab, var(--chat-surface) 55%, transparent);
	}
	.task-row-item {
		position: relative;
	}
	.task-row-item + .task-row-item::before {
		content: '';
		position: absolute;
		top: 0;
		right: 0;
		left: 2.25rem;
		height: 1px;
		background: color-mix(in oklab, var(--chat-border) 85%, transparent);
	}
	.task-row {
		transition: background-color 120ms ease;
	}
	/* The title's link reaches over the whole row, so the row opens wherever it is tapped but on a chip. */
	.task-row-link::after {
		content: '';
		position: absolute;
		inset: 0;
	}
	.task-row:has(.task-row-link:focus-visible) {
		box-shadow: inset 0 0 0 2px var(--accent-2);
	}
	.task-row:hover:not(:has(.ref-chip:hover, .relation-chip:hover)) {
		background: color-mix(in oklab, var(--chat-surface-2) 70%, transparent);
	}
	/* Only rows that need the user get a wash: amber for a warning, the accent for a question. */
	.task-row-warning {
		background: color-mix(in oklab, var(--chat-warning) 9%, transparent);
	}
	.task-row-warning:hover {
		background: color-mix(in oklab, var(--chat-warning) 14%, transparent);
	}
	.task-row-question {
		background: color-mix(in oklab, var(--accent-2) 8%, transparent);
	}
	.task-row-question:hover {
		background: color-mix(in oklab, var(--accent-2) 13%, transparent);
	}
	/* The chevron is a hint for a pointer that hovers; a touch screen never shows it. */
	:global(.task-row-chevron) {
		display: none;
	}
	@media (hover: hover) and (pointer: fine) {
		:global(.task-row-chevron) {
			display: block;
			opacity: 0;
			transition: opacity 120ms ease;
		}
		.task-row:hover :global(.task-row-chevron),
		.task-row:has(.task-row-link:focus-visible) :global(.task-row-chevron) {
			opacity: 1;
		}
	}
	/* A working task's dot breathes, softly. */
	.task-row-pulse {
		animation: task-row-pulse 2.4s ease-in-out infinite;
	}
	@keyframes task-row-pulse {
		0%,
		100% {
			box-shadow: 0 0 0 0 color-mix(in oklab, var(--task-status) 45%, transparent);
		}
		50% {
			box-shadow: 0 0 0 3.5px color-mix(in oklab, var(--task-status) 0%, transparent);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.task-row, :global(.task-row-chevron) { transition: none; }
		.task-row-pulse {
			animation: none;
		}
	}
</style>
