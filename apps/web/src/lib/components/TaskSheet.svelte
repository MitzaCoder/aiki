<script lang="ts">
	import CardMarkdown from './markdown/CardMarkdown.svelte';
	import ReportSectionFreshness from './ReportSectionFreshness.svelte';
	import ReportStaleAction from './ReportStaleAction.svelte';
	import { reportFreshnessEnabled, emptyFinishedResults } from '#lib/report-freshness.js';
	import { taskSheetViewport } from '#lib/task-sheet-viewport.js';
	import { overlayScroll } from '#lib/scrollbars.js';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import LayersIcon from '@lucide/svelte/icons/layers';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import XIcon from '@lucide/svelte/icons/x';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import '#lib/task-sheet.css';
	import { TASK_SHEET_REPORT_SECTIONS } from '#lib/task-sections.js';
	import { taskSheetMeta, taskWorkerCount } from '#lib/task-sheet-meta.js';
	import { openFeedbackCount } from '#lib/task-relations.js';
	import TaskReply from '#lib/components/TaskReply.svelte';
	import TaskSectionNav from '#lib/components/TaskSectionNav.svelte';
	import TaskSection from '#lib/components/TaskSection.svelte';
	import { formatMinutes } from '@aiki/client';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import TaskFiles from '#lib/components/artifacts/TaskFiles.svelte';
	import TaskStatusMenu from '#lib/components/TaskStatusMenu.svelte';
	import TaskWaitingForm from '#lib/components/TaskWaitingForm.svelte';
	import WorkerStatusBadge from '#lib/components/chat/WorkerStatusBadge.svelte';
	import BoardQuestionCard from '#lib/components/BoardQuestionCard.svelte';
	import BoardTaskEditor from '#lib/components/BoardTaskEditor.svelte';
	import Markdown from '#lib/components/markdown/Markdown.svelte';
	import TaskFeedback from '#lib/components/TaskFeedback.svelte';
	import TaskHistory from '#lib/components/TaskHistory.svelte';
	import TaskRelations from '#lib/components/TaskRelations.svelte';
	import ArrowDownWideNarrowIcon from '@lucide/svelte/icons/arrow-down-wide-narrow';
	import ArrowUpWideNarrowIcon from '@lucide/svelte/icons/arrow-up-wide-narrow';
	import { timelineOrder } from '#lib/timeline-order.svelte.js';
	import TaskTimeline from '#lib/components/TaskTimeline.svelte';
	import TaskRefs from '#lib/components/TaskRefs.svelte';
	import { useRefLinks } from '#lib/ref-links.svelte.js';
	import { splitRefMentions } from '#lib/refs.js';
	import { useArtifactFeed } from '#lib/artifacts.svelte.js';
	import { blockersOf, decisionsFor, draftFromTask, draftToInput } from '#lib/board.js';
	import type { ProjectBoard } from '#lib/board.svelte.js';
	import type { BackendConnection } from '#lib/harness.svelte.js';
	import { exactTime, relativeTime } from '#lib/relative-time.js';
	import { REPORT_SECTIONS, shortWriterLabel, taskFromUrl, taskRefs, waitingOn, withTask } from '#lib/tasks.js';
	import { questionAskedBy, taskOwner, threadName } from '#lib/threads.js';
	import SelectionQuote from '#lib/components/chat/SelectionQuote.svelte';
	import type {
		Artifact,
		BoardFeedback,
		BoardTask,
		BoardTaskStatus,
		BoardTimelineEntry,
		BoardWriter,
		ThreadSummary,
		WorkerSummary
	} from '@aiki/protocol';

	/**
	 * A task as a sheet over the project chat, opened by `?task=T12` on main's page or a thread's: a wide panel on a
	 * desktop, the whole screen on a phone. Questions lead a single column of section cards with sticky section navigation.
	 * Report, feedback and files follow, then references, folded history and brief. The user closes the task from here (Done, Drop, Reopen) and talks about it in the reply box, which
	 * sends to main's conversation with the task's ID. Text selected in the task can be quoted into the chat's message
	 * (`onquote`): the sheet closes so the message can be written.
	 */
	let {
		backend,
		projectId,
		board,
		workers,
		threads = [],
		workerHref,
		onquote,
		onshowlinked
	}: {
		backend: BackendConnection;
		projectId: string;
		board: ProjectBoard | undefined;
		workers: readonly WorkerSummary[];
		threads?: readonly ThreadSummary[];
		workerHref: (worker: WorkerSummary) => string;
		onquote?: (quote: string) => void;
		/** Shows the task list filtered to a task and everything linked to it; the sheet closes first. */
		onshowlinked?: (taskId: string) => void;
	} = $props();

	const refLinks = useRefLinks();

	let body = $state<HTMLDivElement | null>(null);
	let sheet = $state<HTMLElement | null>(null);
	$effect(() => {
		if (!sheet) return;
		return taskSheetViewport(sheet).destroy;
	});
	/** A quote taken from the sheet, handed over once the sheet has closed so the composer keeps the focus. */
	let pendingQuote: string | undefined;

	function quote(text: string): void {
		pendingQuote = text;
		close();
	}

	const requestedId = $derived(taskFromUrl(page.url));
	// The sheet keeps showing the task while it fades out.
	let shownId = $state<string | undefined>(undefined);
	$effect(() => {
		if (requestedId !== null) shownId = requestedId;
	});
	const taskId = $derived(requestedId ?? shownId);

	const liveTask = $derived(taskId === undefined ? undefined : board?.task(taskId));
	let archivedTask = $state<BoardTask | undefined>(undefined);
	let archivedChecked = $state<string | undefined>(undefined);
	const task = $derived(liveTask ?? (archivedTask?.id === taskId ? archivedTask : undefined));
	const lookedUp = $derived(taskId !== undefined && archivedChecked === taskId);

	// A task the live board does not list may be archived; read once to see.
	$effect(() => {
		const id = taskId;
		if (id === undefined || board === undefined || !board.loaded || liveTask !== undefined || archivedChecked === id) return;
		archivedChecked = id;
		void board
			.findArchived(id)
			.then((found) => {
				if (found !== undefined && taskId === id) archivedTask = found;
			})
			.catch(() => undefined);
	});

	let editing = $state(false);
	let confirmDrop = $state(false);
	let waitingForm = $state(false);
	let problem = $state<string | undefined>(undefined);
	let closing = $state(false);
	let briefOpen = $state(false);
	let historyOpen = $state(false);
	let timelineOpen = $state(false);

	// The timeline and the feedback come from one read, repeated when anything the board carries about the task moves.
	let timelineEntries = $state<BoardTimelineEntry[] | undefined>(undefined);
	let timelineError = $state<string | undefined>(undefined);
	let feedbackEntries = $state<BoardFeedback[]>([]);
	let feedbackBusy = $state(false);
	let feedbackProblem = $state<string | undefined>(undefined);

	$effect(() => {
		void taskId;
		editing = false;
		confirmDrop = false;
		waitingForm = false;
		problem = undefined;
		briefOpen = false;
		historyOpen = false;
		timelineOpen = false;
		timelineEntries = undefined;
		timelineError = undefined;
		feedbackEntries = [];
		feedbackProblem = undefined;
	});

	const tasks = $derived(board?.tasks ?? []);
	const questions = $derived(board?.board === undefined || task === undefined ? [] : waitingOn(board.board.questions, task.id));
	const decisions = $derived(board?.board === undefined || task === undefined ? [] : decisionsFor(board.board.decisions, task.id));
	const blockers = $derived(task === undefined ? [] : blockersOf(task, tasks).filter((blocker) => !blocker.settled));
	const owner = $derived(task === undefined ? undefined : taskOwner(task, threads));
	const taskWorkers = $derived(
		task === undefined ? [] : task.workerIds.map((id) => ({ id, worker: workers.find((entry) => entry.id === id) }))
	);
	const report = $derived(task?.report);
	const hasReport = $derived(report !== undefined && REPORT_SECTIONS.some(({ key }) => report[key].trim().length > 0));

	const supportsLinks = $derived(backend.supports('task-links'));
	const supportsFreshness = $derived(task !== undefined && reportFreshnessEnabled(backend.supports('task-freshness'), task));

	$effect(() => {
		const current = task;
		if (current === undefined || board === undefined || !supportsLinks) return;
		const id = current.id;
		void [current.timelineRevision, current.snapshots, current.feedback, current.status, current.report.revision, current.revision];
		void [questions.length, decisions.length];
		let cancelled = false;
		board
			.timeline(id)
			.then((read) => {
				if (cancelled) return;
				timelineEntries = read.entries;
				feedbackEntries = read.feedback;
				timelineError = undefined;
			})
			.catch((cause: unknown) => {
				if (!cancelled) timelineError = cause instanceof Error ? cause.message : String(cause);
			});
		return () => {
			cancelled = true;
		};
	});

	async function setFeedback(entry: BoardFeedback, state: 'dismissed' | 'open'): Promise<void> {
		if (board === undefined || task === undefined || feedbackBusy) return;
		feedbackBusy = true;
		feedbackProblem = undefined;
		try {
			const saved = await board.setFeedback(task.id, entry.id, state);
			feedbackEntries = feedbackEntries.map((candidate) => (candidate.id === saved.id ? saved : candidate));
		} catch (error) {
			feedbackProblem = error instanceof Error ? error.message : String(error);
		} finally {
			feedbackBusy = false;
		}
	}

	function showLinked(): void {
		if (task === undefined) return;
		const id = task.id;
		close();
		onshowlinked?.(id);
	}

	const artifactFeed = useArtifactFeed(() =>
		taskId !== undefined && backend.supports('artifacts')
			? { client: backend.client, projectId, filter: { taskId }, limit: 100 }
			: undefined
	);
	const artifacts = $derived(artifactFeed.current?.artifacts ?? []);

	async function updateArtifactTags(artifact: Artifact, tags: string[]): Promise<void> {
		const row = await backend.client.updateArtifactTags(projectId, artifact.id, tags);
		artifactFeed.current?.upsert(row);
	}

	function ago(iso: string): string {
		return relativeTime(iso, Date.now());
	}

	function writerName(writer: BoardWriter): string {
		return shortWriterLabel(writer, threads);
	}

	function close(): void {
		void goto(withTask(page.url, null), { replace: true, reset: false });
	}

	async function setStatus(target: BoardTaskStatus, waitingFor?: string, waitUntil?: string): Promise<void> {
		if (board === undefined || task === undefined || closing) return;
		closing = true;
		problem = undefined;
		confirmDrop = false;
		const outcome = await board.saveTask(
			{ ...draftToInput(draftFromTask(task)), status: target, ...(waitingFor === undefined ? {} : { waitingFor }), ...(waitUntil === undefined ? {} : { waitUntil }) },
			{ taskId: task.id, expectedRevision: task.revision }
		);
		closing = false;
		if (outcome.kind === 'saved') {
			waitingForm = false;
			if (archivedTask?.id === task.id) archivedTask = outcome.task;
		} else if (outcome.kind === 'conflict') problem = `${task.id} changed while you were looking. Check it and try again.`;
		else problem = outcome.message;
	}
</script>

<Dialog.Root
	open={requestedId !== null}
	onOpenChange={(open) => {
		if (!open) close();
	}}
>
	<Dialog.Content
		bind:ref={sheet}
		showCloseButton={false}
		data-task-sheet
		onCloseAutoFocus={(event) => {
			if (pendingQuote === undefined) return;
			event.preventDefault();
			onquote?.(pendingQuote);
			pendingQuote = undefined;
		}}
		class="top-0 left-0 flex h-dvh w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none p-0 sm:right-0 sm:left-auto sm:w-[min(74rem,calc(100vw-3rem))] sm:max-w-none sm:rounded-l-2xl"
	>
		<Dialog.Description class="sr-only">A task: its report, questions, workers and history.</Dialog.Description>
		{#if task === undefined}
			<header class="flex shrink-0 items-center gap-2 border-b border-(--chat-border) px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3">
				<Dialog.Title class="min-w-0 flex-1 truncate text-base font-semibold">{taskId ?? 'Task'}</Dialog.Title>
				<Button variant="ghost" size="icon-sm" onclick={close} aria-label="Close the task" title="Close"><XIcon /></Button>
			</header>
			{#if board === undefined || !board.loaded || !lookedUp}
				<div class="flex flex-col gap-2 px-4 py-6" role="status" aria-busy="true" aria-label="Loading {taskId ?? 'the task'}">
					<div class="skeleton h-5 w-32"></div>
					<div class="skeleton h-3 w-24"></div>
					<div class="skeleton mt-3 h-3.5 w-4/5"></div>
					<div class="skeleton h-3.5 w-full"></div>
					<div class="skeleton h-3.5 w-11/12"></div>
					<div class="skeleton mt-3 h-3 w-2/3"></div>
					<span class="sr-only">Loading {taskId ?? 'the task'}…</span>
				</div>
			{:else}
				<div class="px-4 py-6 text-sm text-(--chat-fg-subtle)">{taskId} is not on the board any more.</div>
			{/if}
		{:else}
			<header
				class="task-header flex max-h-[35%] shrink-0 flex-col overflow-y-auto overscroll-contain gap-2 border-b border-(--chat-border) px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3"
			>
				<div class="flex items-center gap-2">
					<span class="font-mono text-xs text-(--chat-fg-subtle)">{task.id}</span>
					<TaskStatusMenu status={task.status} disabled={closing} supportsWaiting={backend.supports('task-waiting')} onpick={(status) => {
						confirmDrop = status === 'dropped';
						waitingForm = status === 'waiting';
						if (!confirmDrop && !waitingForm) void setStatus(status);
					}} />
					<span class="flex-1"></span>
					{#if !editing}
						<Button variant="ghost" size="icon-sm" onclick={() => (editing = true)} aria-label="Edit {task.id}" title="Edit the task">
							<PencilIcon />
						</Button>
					{/if}
					<Button variant="ghost" size="icon-sm" onclick={close} aria-label="Close the task" title="Close">
						<XIcon />
					</Button>
				</div>
				<Dialog.Title class="text-lg leading-snug font-semibold break-words"
					>{#each splitRefMentions(task.title, refLinks()?.links) as piece, index (index)}{#if piece.href}<a
								href={piece.href}
								target="_blank"
								rel="noopener noreferrer"
								class="underline decoration-(--chat-border-strong) underline-offset-2 hover:decoration-current">{piece.text}</a
							>{:else}{piece.text}{/if}{/each}</Dialog.Title
				>
				{#key task.id}
					{#if taskRefs(task).length > 0}<TaskRefs refs={taskRefs(task)} />{/if}
				{/key}
				<p class="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-(--chat-fg-subtle)">
					{#if task.inProgressMinutes !== undefined && (task.inProgressMinutes > 0 || task.status === 'in_progress')}
						<span data-in-progress>{formatMinutes(task.inProgressMinutes)} in progress</span>
						<span aria-hidden="true">·</span>
					{/if}
					<span title={exactTime(task.updatedAt)}>Updated {ago(task.updatedAt)}</span>
					{#if owner?.claimed && !owner.main}
						<span aria-hidden="true">·</span>
						<span class="inline-flex items-center gap-1"><LayersIcon class="size-3" aria-hidden="true" />{owner.label}</span>
					{/if}
					{#each taskSheetMeta(task) as context (context)}
						<span aria-hidden="true">·</span><span class="min-w-0 break-words" data-task-context>{context}</span>
					{/each}
					{#if task.archived}
						<span aria-hidden="true">·</span><span>Archived</span>
					{/if}
				</p>

				{#if waitingForm}
					<TaskWaitingForm waiting={task.waiting} busy={closing} onsave={(note, until)=>setStatus('waiting',note,until)} oncancel={()=>waitingForm=false}/>
				{:else if confirmDrop}
					<div class="flex flex-wrap items-center gap-2"><span class="text-xs">Drop {task.id}? It will not be done.</span><Button variant="destructive" size="sm" disabled={closing} onclick={()=>setStatus('dropped')}>Drop it</Button><Button variant="ghost" size="sm" onclick={()=>confirmDrop=false}>Keep</Button></div>
				{/if}
				{#if problem}
					<p class="text-xs text-(--chat-danger)" role="alert">{problem}</p>
				{/if}
			</header>

			<div class="task-body-frame relative flex min-h-0 flex-1 flex-col">
				<div
					bind:this={body}
					use:overlayScroll={'parent'}
					class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4"
					data-task-body
				>
					{#key task.id}
						<div class="task-body-layout">
							{#if !editing}<TaskSectionNav root={body} />{/if}
							<div class="task-sections flex min-w-0 flex-col gap-5">
							{#if editing}
								<BoardTaskEditor
									{task}
									{tasks}
									onsave={(input, options) => board!.saveTask(input, options)}
									onback={() => (editing = false)}
								/>
							{:else}
								{#snippet questionsSection()}
									{#if questions.length > 0}
										<TaskSection
											title="Questions"
											kind="questions"
											count={questions.length + ' open'}
											class="flex flex-col gap-2"
											data-needs-you
										>
											{#each questions as question (question.id)}
												<BoardQuestionCard
													{question}
													askedBy={questionAskedBy(question, threads)}
													onanswer={(entry, text) => board!.answer(entry.id, entry.revision, text)}
												/>
											{/each}
										</TaskSection>
									{/if}
								{/snippet}
								{#snippet blockedSection()}
									{#if task.status === 'blocked' && (task.blockedReason || blockers.length > 0)}
										<section
											class="flex flex-col gap-1.5 rounded-xl border border-(--chat-danger)/30 px-3 py-2.5 text-task"
											aria-label="Blocked"
										>
											{#if task.blockedReason}<p class="break-words text-(--chat-danger)">{task.blockedReason}</p>{/if}
											{#if blockers.length > 0}
												<p class="flex flex-wrap items-center gap-1.5 text-xs text-(--chat-fg-muted)">
													Waits for
													{#each blockers as blocker (blocker.id)}
														<a
															href={withTask(page.url, blocker.id)}
															class="rounded-md border border-(--chat-border) px-1.5 py-0.5 hover:bg-(--chat-surface-2)"
															title={blocker.title}
														>
															<span class="font-mono">{blocker.id}</span>{blocker.title ? ` · ${blocker.title}` : ''}
														</a>
													{/each}
												</p>
											{/if}
										</section>
									{/if}
								{/snippet}
								{#snippet reportSection()}
									<TaskSection
										title="Report"
										kind="report"
										count={hasReport ? 'Current update' : undefined}
										class="flex flex-col gap-3"
										data-report
									>
										{#snippet meta()}<span class="inline-flex items-center gap-2 text-[0.6875rem] text-(--chat-fg-subtle)">
												{#if task.report.updatedAt !== null}
													<span title={exactTime(task.report.updatedAt)}>{ago(task.report.updatedAt)}</span>
													{#if task.report.updatedBy}· {writerName(task.report.updatedBy)}{/if}
												{/if}
												{#if supportsFreshness}<ReportStaleAction {backend} {projectId} taskId={task.id} />{/if}
											</span>{/snippet}
										{#if supportsFreshness && report?.freshness}
											{#each TASK_SHEET_REPORT_SECTIONS as section (section.key)}
												{#if report[section.key].trim().length > 0 || (section.key === 'results' && emptyFinishedResults(task))}
													<div data-report-section={section.key}>
														<p class="mb-0.5 text-xs font-semibold text-(--chat-fg-muted)">{section.label}</p>
														{#if section.key === 'results' && emptyFinishedResults(task)}
															<div class="text-task text-(--chat-fg-muted)">No results yet · work finished</div>
														{:else}<Markdown source={report[section.key]} class="report-md" />{/if}
														{#if section.key !== 'now'}<ReportSectionFreshness section={report.freshness[section.key]} emptyResults={section.key === 'results' && emptyFinishedResults(task)} />{/if}
													</div>
												{/if}
											{/each}
											{#if !hasReport && !emptyFinishedResults(task)}<p class="text-task text-(--chat-fg-subtle)">Nothing written yet. The agents fill this in as they work.</p>{/if}
										{:else if hasReport && report}
											{#each TASK_SHEET_REPORT_SECTIONS as section (section.key)}
												{#if report[section.key].trim().length > 0}
													<div data-report-section={section.key}>
														<p class="mb-0.5 text-xs font-semibold text-(--chat-fg-muted)">{section.label}</p>
														<Markdown source={report[section.key]} class="report-md" />
													</div>
												{/if}
											{/each}
										{:else}
											<p class="text-task text-(--chat-fg-subtle)">Nothing written yet. The agents fill this in as they work.</p>
										{/if}
									</TaskSection>
								{/snippet}
								{#snippet feedbackSection()}
									{#if supportsLinks}
										<TaskFeedback
											entries={feedbackEntries}
											openCount={task.feedback === undefined ? undefined : openFeedbackCount(task)}
											busy={feedbackBusy}
											problem={feedbackProblem}
											onset={setFeedback}
											threadName={(id) => threadName(id, threads)}
										/>
									{/if}
								{/snippet}
								{#snippet relatedSection()}
									<TaskRelations
										{task}
										{tasks}
										archivedLinks={board?.archivedLinks}
										hrefOf={(id) => withTask(page.url, id)}
										onshowlinked={onshowlinked === undefined ? undefined : showLinked}
									/>
								{/snippet}
								{#snippet decisionsSection()}
									{#if decisions.length > 0}
										<TaskSection title="Decisions" kind="decisions" count={decisions.length} class="flex flex-col gap-1.5">
											<ul class="flex flex-col gap-1.5">
												{#each decisions as decision (decision.id)}
													<li class="rounded-xl border border-(--chat-border)/70 px-3 py-2 text-task">
														<span class="font-mono text-xs text-(--chat-fg-subtle)">{decision.id}</span>
														<CardMarkdown source={decision.text} />
														{#if decision.why}<div class="mt-1 text-(--chat-fg-muted)"><CardMarkdown source={decision.why} /></div>{/if}
														<p class="mt-0.5 text-[0.6875rem] text-(--chat-fg-subtle)">{ago(decision.at)}</p>
													</li>
												{/each}
											</ul>
										</TaskSection>
									{/if}
								{/snippet}
								{#snippet workersSection()}
									{#if taskWorkers.length > 0}
										<TaskSection title="Workers" kind="workers" count={taskWorkerCount(taskWorkers.length, taskWorkers.filter((entry) => entry.worker?.status === 'running').length)} class="flex flex-col gap-1.5">
											<ul class="flex flex-col gap-1">
												{#each taskWorkers as entry (entry.id)}
													<li class="min-w-0">
														{#if entry.worker !== undefined}
															<a
																href={workerHref(entry.worker)}
																class="flex min-w-0 items-center gap-2 rounded-lg border border-(--chat-border)/70 px-3 py-1.5 text-[0.8125rem] hover:bg-(--chat-surface-2)/70"
																data-worker={entry.worker.id}
															>
																<span class="min-w-0 flex-1 truncate font-medium">{entry.worker.title || entry.worker.id}</span>
																<WorkerStatusBadge status={entry.worker.status} class="shrink-0" />
																<ChevronRightIcon class="size-3.5 shrink-0 text-(--chat-fg-subtle)" />
															</a>
														{:else}
															<span
																class="block truncate px-3 py-1.5 font-mono text-xs text-(--chat-fg-subtle)"
																title="This worker was forgotten"
															>
																{entry.id}
															</span>
														{/if}
													</li>
												{/each}
											</ul>
										</TaskSection>
									{/if}
								{/snippet}
								{#snippet filesSection()}
									{#if artifacts.length > 0}
										<TaskSection title="Files" kind="files" count={artifacts.length} class="flex flex-col gap-2">
											<TaskFiles
												{artifacts}
												client={backend.client}
												{projectId}
												onupdatetags={backend.supports('artifact-tags') ? updateArtifactTags : undefined}
											/>
										</TaskSection>
									{/if}
								{/snippet}
								{#snippet briefSection()}
									{#if task.description.trim().length > 0 || (task.acceptance ?? '').trim().length > 0}
										<TaskSection
											title="Brief"
											kind="brief"
											count={'Reference'}
											expanded={briefOpen}
											ontoggle={() => (briefOpen = !briefOpen)}
											class="flex flex-col gap-1.5"
										>
											{#if briefOpen}
												<div class="flex flex-col gap-2">
													{#if task.description.trim().length > 0}
														<Markdown source={task.description} class="report-md" />
													{/if}
													{#if task.acceptance}
														<div>
															<p class="mb-0.5 text-xs font-semibold text-(--chat-fg-muted)">Done when</p>
															<Markdown source={task.acceptance} class="report-md" />
														</div>
													{/if}
												</div>
											{/if}
										</TaskSection>
									{/if}
								{/snippet}
								{#snippet timelineSection()}
									{#if supportsLinks && timelineEntries !== undefined && timelineEntries.length > 0}
										<TaskSection
											title="Timeline"
											kind="timeline"
											count={timelineEntries.length}
											expanded={timelineOpen}
											ontoggle={() => (timelineOpen = !timelineOpen)}
											class="flex flex-col gap-2"
											data-timeline
										>
											{#snippet meta()}
												<button type="button" class="inline-flex size-11 items-center justify-center rounded-lg hover:bg-(--chat-surface-2)" aria-label={timelineOrder.order === 'newest' ? 'Newest first; show oldest first' : 'Oldest first; show newest first'} title={timelineOrder.order === 'newest' ? 'Newest first' : 'Oldest first'} onclick={() => timelineOrder.toggle()} data-timeline-order>
													{#if timelineOrder.order === 'newest'}<ArrowDownWideNarrowIcon class="size-4" />{:else}<ArrowUpWideNarrowIcon class="size-4" />{/if}
												</button>
											{/snippet}
											{#if timelineOpen}
												<TaskTimeline
													entries={timelineEntries}
													error={timelineError}
													{writerName}
													workerHref={(id) => {
														const worker = workers.find((entry) => entry.id === id);
														return worker === undefined ? undefined : workerHref(worker);
													}}
													taskHref={(id) => withTask(page.url, id)}
												/>
											{/if}
										</TaskSection>
									{/if}
								{/snippet}
								{#snippet historySection()}
									{#if task.snapshots > 0}
										<TaskSection
											title="History"
											kind="history"
											count={task.snapshots}
											expanded={historyOpen}
											ontoggle={() => (historyOpen = !historyOpen)}
											class="flex flex-col gap-2"
										>
											{#if historyOpen && board !== undefined}
												<TaskHistory {board} {task} {writerName} />
											{/if}
										</TaskSection>
									{/if}
								{/snippet}
								{@render questionsSection()}
								{@render blockedSection()}
								{@render reportSection()}
								{@render timelineSection()}
								{@render feedbackSection()}
								{@render filesSection()}
								{@render relatedSection()}
								{@render workersSection()}
								{@render decisionsSection()}
								{@render historySection()}
								{@render briefSection()}
							{/if}
						</div>
						</div>
					{/key}
				</div>
			</div>

			{#if !editing}
				<footer class="max-h-[45%] shrink-0 overflow-y-auto border-t border-(--chat-border)" data-task-reply>
					<div class="mx-auto w-full max-w-3xl">
						{#key `${backend.id}/${projectId}/${task.id}`}
							<TaskReply {backend} {projectId} taskId={task.id} />
						{/key}
					</div>
				</footer>
			{/if}
		{/if}
		{#if onquote}
			<SelectionQuote scope={body} onquote={quote} />
		{/if}
	</Dialog.Content>
</Dialog.Root>

<style>
	/* Let a long update confirmation wrap within the header, never across its title. */
	:global([data-report] .section-heading h3) {
		min-width: max-content;
	}
	/* Leave room for send controls even with a long draft and an IME-reduced visual viewport. */
	:global([data-task-composer] textarea) {
		max-height: max(2.5rem, calc(var(--task-viewport-height, 100dvh) * 0.2));
	}
	:global(.report-md.md) {
		font-size: var(--text-task);
		line-height: 1.6;
	}
</style>
