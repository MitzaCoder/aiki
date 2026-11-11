<script lang="ts">
	import { overlayScroll } from '#lib/scrollbars.js';
	import ArchiveIcon from '@lucide/svelte/icons/archive';
	import BanIcon from '@lucide/svelte/icons/ban';
	import CheckIcon from '@lucide/svelte/icons/check';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import XIcon from '@lucide/svelte/icons/x';
	import { onDestroy, onMount, untrack, type Snippet } from 'svelte';
	import { flip } from 'svelte/animate';
	import { MediaQuery, SvelteMap } from 'svelte/reactivity';
	import { fade } from 'svelte/transition';
	import { Button } from '#lib/components/ui/button/index.js';
	import Banner from '#lib/components/Banner.svelte';
	import BoardQuestionCard from '#lib/components/BoardQuestionCard.svelte';
	import BoardTaskEditor from '#lib/components/BoardTaskEditor.svelte';
	import TaskCard from '#lib/components/TaskCard.svelte';
	import TaskFilters from '#lib/components/TaskFilters.svelte';
	import TaskSearchBox from './TaskSearchBox.svelte';
	import { useTaskSearch } from '#lib/task-search.svelte.js';
	import TaskMoveDialog from '#lib/components/TaskMoveDialog.svelte';
	import TaskMoveMenu from '#lib/components/TaskMoveMenu.svelte';
	import type { ProjectBoard } from '#lib/board.svelte.js';
	import {
		DONE_SHOWN,
		dropTarget,
		kanbanColumns,
		moveInput,
		moveNotice,
		moveQuestion,
		needsYouCount,
		reasonMessage,
		todoOrderWith,
		type KanbanCard,
		type KanbanColumnId,
		type MoveQuestion,
		type MoveTarget
	} from '#lib/kanban.js';
	import LooseWorkers from '#lib/components/LooseWorkers.svelte';
	import { applyTaskFilter } from '#lib/task-relations.js';
	import { taskFilter } from '#lib/tasks-view.svelte.js';
	import { looseWaiting, type TaskStatusTone } from '#lib/tasks.js';
	import { questionAskedBy } from '#lib/threads.js';
	import type { BoardQuestion, BoardTask, BoardTaskStatus, ThreadSummary, WorkerSummary } from '@aiki/protocol';

	/**
	 * The project's tasks as a board: one column per status, To do in the user's priority order and the rest sorted by
	 * themselves. The user moves a card by dragging it (mouse or pen) or with its "Move to…" menu (keyboard, touch);
	 * every move is a save the server passes on to the coordinator as a `[board]` note. Moving a task back from review
	 * asks why, and the agents get the answer with the move. When an agent moves a task, its card glides to its new
	 * column. On a narrow screen one column shows at a time, with the column names as tabs and a swipe between them.
	 */
	let {
		board,
		workers = [],
		threads = [],
		workerHref,
		taskHref,
		onopentask,
		canNote,
		onsendreason,
		viewSwitch
	}: {
		board: ProjectBoard | undefined;
		workers?: readonly WorkerSummary[];
		threads?: readonly ThreadSummary[];
		/** Where a worker opens; the workers no task lists show above the columns. */
		workerHref?: (worker: WorkerSummary) => string;
		taskHref: (taskId: string) => string;
		onopentask?: (taskId: string) => void;
		/** Whether a save carries the user's reason to the coordinator (`board-moves`); without it the reason goes as a message. */
		canNote: boolean;
		/** Sends a message about a task to main: the reason for a move on a backend without `board-moves`. */
		onsendreason?: (taskId: string, text: string) => Promise<void>;
		/** The List | Board switch, at the start of the toolbar. */
		viewSwitch?: Snippet;
	} = $props();

	const reducedMotion = new MediaQuery('(prefers-reduced-motion: reduce)');

	let now = $state(Date.now());
	let onlyNeedsYou = $state(false);
	let doneExpanded = $state(false);
	let adding = $state(false);
	/** Moves sent and not answered yet: the card shows in its new column at once. */
	const pending = new SvelteMap<string, BoardTaskStatus>();
	let notice = $state<{ text: string; tone: 'info' | 'error'; undo?: () => void } | undefined>(undefined);
	let noticeTimer: ReturnType<typeof setTimeout> | undefined;
	/** A move that waits for the user's reason. */
	let asking = $state<{ task: BoardTask; question: Exclude<MoveQuestion, 'none'> } | undefined>(undefined);
	let askedMove: { task: BoardTask; target: MoveTarget; beforeId: string | null | undefined } | undefined;

	let root = $state<HTMLDivElement | null>(null);
	let scroller = $state<HTMLDivElement | null>(null);
	let boardWidth = $state(0);
	/** On a narrow screen, the column on show. */
	let activeIndex = $state(0);

	const oneColumn = $derived(boardWidth > 0 && boardWidth < 640);

	const tasks = $derived.by((): BoardTask[] => {
		const all = board?.tasks ?? [];
		if (pending.size === 0) return all;
		return all.map((task) => {
			const status = pending.get(task.id);
			return status === undefined ? task : { ...task, status };
		});
	});
	const questions = $derived(board?.board?.questions ?? []);
	/** The tasks the two filters let through; the "needs you" count and the To do order read every task. */
	const filtered = $derived(applyTaskFilter(tasks, taskFilter.current));
	const search = useTaskSearch(() => tasks, () => board);
	const searchHits = $derived(search.search(new Set(filtered.map(task => task.id))));
	const searchHitById = $derived(new Map(searchHits.map(hit => [hit.id, hit])));
	const shownTasks = $derived(search.query.trim() ? filtered.filter(task => searchHitById.has(task.id)) : filtered);
	const canNarrow = $derived(tasks.some((task) => task.parent != null));
	const columns = $derived(
		kanbanColumns(
			{ tasks: shownTasks, questions },
			{ includeArchived: board?.showArchived === true, doneShown: doneExpanded ? Number.POSITIVE_INFINITY : DONE_SHOWN, onlyNeedsYou }
		)
	);
	const needsYou = $derived(needsYouCount({ tasks: shownTasks, questions }));
	const loose = $derived(board?.board === undefined ? [] : looseWaiting({ tasks, questions }));
	const archivedShown = $derived(board?.showArchived === true ? tasks.filter((task) => task.archived).length : 0);
	/** To do in priority order, whatever the filter shows: what a reorder sends. */
	const todoIds = $derived(
		tasks
			.filter((task) => task.status === 'todo' && !task.archived)
			.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id, undefined, { numeric: true }))
			.map((task) => task.id)
	);

	const COLUMN_TONES: Record<KanbanColumnId, TaskStatusTone> = {
		todo: 'todo',
		working: 'working',
		blocked: 'blocked',
		review: 'review',
		waiting: 'waiting',
		done: 'done'
	};

	onMount(() => {
		const timer = setInterval(() => (now = Date.now()), 30_000);
		return () => clearInterval(timer);
	});

	onDestroy(() => {
		if (noticeTimer !== undefined) clearTimeout(noticeTimer);
		endDrag();
	});

	$effect(() => {
		if (root == null) return;
		const element = root;
		boardWidth = element.clientWidth;
		const observer = new ResizeObserver(() => (boardWidth = element.clientWidth));
		observer.observe(element);
		return () => observer.disconnect();
	});

	// --- live moves glide ----------------------------------------------------------------------------------------

	/** Cards the user just dropped: they are already where the pointer left them, so they do not glide. */
	const settledByHand = new Set<string>();
	/** Where every card was before the last change: its column, its box and its element. */
	let before = new Map<string, { column: string; rect: DOMRect; element: HTMLElement }>();

	function cardsOnShow(): Map<string, { column: string; rect: DOMRect; element: HTMLElement }> {
		const found = new Map<string, { column: string; rect: DOMRect; element: HTMLElement }>();
		for (const element of root?.querySelectorAll<HTMLElement>('[data-card]') ?? []) {
			const column = element.closest<HTMLElement>('[data-column]')?.dataset.column;
			const id = element.dataset.card;
			if (column !== undefined && id !== undefined) found.set(id, { column, rect: element.getBoundingClientRect(), element });
		}
		return found;
	}

	$effect.pre(() => {
		void columns;
		if (root != null) before = cardsOnShow();
	});

	/**
	 * A card that changed column glides there: a copy of the old card flies over the board from its old place to its new
	 * one (a column's own scroll box would clip it), while the card waits hidden in its new column.
	 */
	$effect(() => {
		void columns;
		if (root == null || untrack(() => reducedMotion.current || drag?.active === true)) return;
		const was = before;
		const view = root.getBoundingClientRect();
		for (const [id, now] of cardsOnShow()) {
			const old = was.get(id);
			if (old === undefined || old.column === now.column || settledByHand.has(id)) continue;
			const target = now.element.getBoundingClientRect();
			const visible = target.bottom > view.top && target.top < view.bottom && target.right > view.left && target.left < view.right;
			if (!visible || old.rect.width === 0) continue;
			const copy = old.element.cloneNode(true) as HTMLElement;
			copy.classList.add('kanban-glide');
			Object.assign(copy.style, {
				left: `${old.rect.left}px`,
				top: `${old.rect.top}px`,
				width: `${old.rect.width}px`,
				height: `${old.rect.height}px`
			});
			document.body.appendChild(copy);
			now.element.style.visibility = 'hidden';
			const distance = Math.hypot(target.left - old.rect.left, target.top - old.rect.top);
			const animation = copy.animate(
				[
					{ transform: 'translate(0, 0)' },
					{
						transform: `translate(${target.left - old.rect.left}px, ${target.top - old.rect.top}px)`,
						width: `${target.width}px`,
						height: `${target.height}px`
					}
				],
				{ duration: Math.min(560, 220 + Math.sqrt(distance) * 10), easing: 'cubic-bezier(0.22, 0.8, 0.24, 1)', fill: 'forwards' }
			);
			const land = (): void => {
				copy.remove();
				now.element.style.visibility = '';
			};
			animation.onfinish = land;
			animation.oncancel = land;
		}
	});

	const flipDuration = $derived(reducedMotion.current ? 0 : 220);

	// --- notices ---------------------------------------------------------------------------------------------------

	function say(text: string, tone: 'info' | 'error' = 'info', undo?: () => void): void {
		notice = { text, tone, undo };
		if (noticeTimer !== undefined) clearTimeout(noticeTimer);
		noticeTimer = setTimeout(() => (notice = undefined), tone === 'error' ? 9000 : 6000);
	}

	// --- moves -----------------------------------------------------------------------------------------------------

	/**
	 * Move a card. `beforeId` places it in To do: before that card, or last with null; undefined leaves the order alone.
	 * A move that needs the user's words asks first.
	 */
	function requestMove(task: BoardTask, target: MoveTarget, beforeId?: string | null): void {
		if (target === task.status) {
			if (target === 'todo' && beforeId !== undefined) void reorder(task.id, beforeId);
			return;
		}
		const question = moveQuestion(task.status, target);
		if (question !== 'none') {
			askedMove = { task, target, beforeId };
			asking = { task, question };
			return;
		}
		void commitMove(task, target, { beforeId });
	}

	function answerAsked(text: string): void {
		const move = askedMove;
		askedMove = undefined;
		if (move === undefined) return;
		const question = moveQuestion(move.task.status, move.target);
		void commitMove(move.task, move.target, {
			beforeId: move.beforeId,
			reason: question === 'reason' ? text : undefined,
			blockedReason: question === 'blocked-reason' ? text : undefined
		});
	}

	async function commitMove(
		task: BoardTask,
		target: MoveTarget,
		options: { beforeId?: string | null; reason?: string; blockedReason?: string }
	): Promise<void> {
		if (board === undefined) return;
		const reason = options.reason?.trim();
		pending.set(task.id, target);
		const outcome = await board.saveTask(moveInput(task, target, options.blockedReason), {
			taskId: task.id,
			expectedRevision: task.revision,
			...(reason !== undefined && canNote ? { note: reason } : {})
		});
		pending.delete(task.id);
		if (outcome.kind === 'conflict') {
			say(`${task.id} changed while you moved it. It shows where it is now; try again if you still want it moved.`, 'error');
			return;
		}
		if (outcome.kind === 'failed') {
			say(`Could not move ${task.id}: ${outcome.message}`, 'error');
			return;
		}
		if (reason !== undefined && !canNote) {
			try {
				await onsendreason?.(task.id, reasonMessage(reason));
			} catch (error) {
				say(`${task.id} moved, but your reason did not reach the coordinator: ${error instanceof Error ? error.message : String(error)}`, 'error');
				return;
			}
		}
		if (target === 'todo' && options.beforeId !== undefined) await reorder(task.id, options.beforeId);
		// A reason already went to the agents; taking the move back would leave them with half a story.
		const undo = reason === undefined ? () => void undoMove(outcome.task, task) : undefined;
		say(moveNotice(task, target), 'info', undo);
	}

	async function undoMove(moved: BoardTask, before: BoardTask): Promise<void> {
		if (board === undefined) return;
		notice = undefined;
		pending.set(moved.id, before.status);
		const outcome = await board.saveTask(
			{ ...moveInput(moved, 'todo'), status: before.status, blockedReason: before.blockedReason, ...(before.waiting === undefined ? {} : { waitingFor: before.waiting.note, ...(before.waiting.until === undefined ? {} : { waitUntil: before.waiting.until }) }) },
			{ taskId: moved.id, expectedRevision: moved.revision }
		);
		pending.delete(moved.id);
		if (outcome.kind === 'conflict') say(`${moved.id} changed since; it was left where it is.`, 'error');
		else if (outcome.kind === 'failed') say(`Could not undo: ${outcome.message}`, 'error');
	}

	/** Put a To do card before `beforeId` (last with null): the priority the coordinator works by. */
	async function reorder(taskId: string, beforeId: string | null): Promise<void> {
		if (board === undefined || beforeId === taskId) return;
		const rest = todoIds.filter((id) => id !== taskId);
		const index = beforeId === null ? rest.length : Math.max(0, rest.indexOf(beforeId));
		const order = todoOrderWith(todoIds, taskId, index);
		if (order.join() === todoIds.join()) return;
		const problem = await board.reorder(order);
		if (problem !== undefined) say(`Could not reorder: ${problem}`, 'error');
	}

	/** The menu's priority moves, by place in the shown To do list. */
	function reorderTo(card: KanbanCard, index: number): void {
		const shown = columns.find((column) => column.id === 'todo')?.cards.map((entry) => entry.task.id) ?? [];
		const rest = shown.filter((id) => id !== card.task.id);
		void reorder(card.task.id, rest[index] ?? null);
	}

	// --- dragging --------------------------------------------------------------------------------------------------

	type DropSpot = { column: KanbanColumnId; target: MoveTarget | undefined; beforeId?: string | null; lineTop?: number };
	type DragState = {
		card: KanbanCard;
		pointerId: number;
		startX: number;
		startY: number;
		grabX: number;
		grabY: number;
		width: number;
		x: number;
		y: number;
		active: boolean;
		over: DropSpot | undefined;
	};

	let drag = $state<DragState | undefined>(undefined);
	let swallowClick = false;
	let scrollFrame: number | undefined;

	function startDrag(event: PointerEvent, card: KanbanCard): void {
		// A mouse or a pen drags; on a touch screen the menu moves a card, and a swipe changes the column.
		if (oneColumn || event.button !== 0 || event.pointerType === 'touch' || board === undefined) return;
		if ((event.target as Element | null)?.closest('.ref-chip, .relation-chip, [data-card-menu], .task-card-menu-slot')) return;
		const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
		drag = {
			card,
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			grabX: event.clientX - rect.left,
			grabY: event.clientY - rect.top,
			width: rect.width,
			x: event.clientX,
			y: event.clientY,
			active: false,
			over: undefined
		};
		window.addEventListener('pointermove', moveDrag);
		window.addEventListener('pointerup', dropDrag);
		window.addEventListener('pointercancel', cancelDrag);
		window.addEventListener('keydown', escapeDrag, true);
	}

	function moveDrag(event: PointerEvent): void {
		if (drag === undefined || event.pointerId !== drag.pointerId) return;
		if (!drag.active) {
			if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 5) return;
			drag.active = true;
			document.documentElement.classList.add('kanban-dragging');
			window.getSelection()?.removeAllRanges();
			if (scrollFrame === undefined) scrollFrame = requestAnimationFrame(autoScroll);
		}
		event.preventDefault();
		drag.x = event.clientX;
		drag.y = event.clientY;
		drag.over = spotAt(event.clientX, event.clientY);
	}

	function dropDrag(event: PointerEvent): void {
		if (drag === undefined || event.pointerId !== drag.pointerId) return;
		const { active, over, card } = drag;
		endDrag();
		if (!active) return;
		swallowClick = true;
		setTimeout(() => (swallowClick = false), 0);
		if (over?.target === undefined) return;
		if (over.target !== card.task.status) {
			settledByHand.add(card.task.id);
			setTimeout(() => settledByHand.delete(card.task.id), 400);
		}
		requestMove(card.task, over.target, over.column === 'todo' ? (over.beforeId ?? null) : undefined);
	}

	function cancelDrag(): void {
		endDrag();
	}

	function escapeDrag(event: KeyboardEvent): void {
		if (event.key !== 'Escape' || drag === undefined) return;
		event.preventDefault();
		event.stopPropagation();
		endDrag();
	}

	function endDrag(): void {
		drag = undefined;
		if (typeof window === 'undefined') return;
		document.documentElement.classList.remove('kanban-dragging');
		window.removeEventListener('pointermove', moveDrag);
		window.removeEventListener('pointerup', dropDrag);
		window.removeEventListener('pointercancel', cancelDrag);
		window.removeEventListener('keydown', escapeDrag, true);
		if (scrollFrame !== undefined) cancelAnimationFrame(scrollFrame);
		scrollFrame = undefined;
	}

	/** A click that ends a drag is not a click on the card. */
	function onClickCapture(event: MouseEvent): void {
		if (!swallowClick) return;
		swallowClick = false;
		event.preventDefault();
		event.stopPropagation();
	}

	/** The column under the pointer (the nearest one in a gap) and, in To do, where the card would go. */
	function spotAt(x: number, y: number): DropSpot | undefined {
		if (root == null || drag === undefined) return undefined;
		const sections = [...root.querySelectorAll<HTMLElement>('[data-column]')];
		let best: { element: HTMLElement; distance: number } | undefined;
		for (const element of sections) {
			const rect = element.getBoundingClientRect();
			const distance = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0;
			if (best === undefined || distance < best.distance) best = { element, distance };
		}
		if (best === undefined || best.distance > 48) return undefined;
		const column = best.element.dataset.column as KanbanColumnId;
		if (column === 'done') {
			const droppedZone = best.element.querySelector<HTMLElement>('[data-drop-zone="dropped"]')?.getBoundingClientRect();
			const dropped = droppedZone !== undefined && y >= droppedZone.top;
			return { column, target: dropTarget(column, dropped) };
		}
		if (column !== 'todo') return { column, target: dropTarget(column) };
		const list = best.element.querySelector<HTMLElement>('[data-column-list]');
		if (list === undefined || list === null) return { column, target: 'todo', beforeId: null };
		const listRect = list.getBoundingClientRect();
		const items = [...list.querySelectorAll<HTMLElement>(':scope > [data-card]')].filter((item) => item.dataset.card !== drag?.card.task.id);
		for (const item of items) {
			const rect = item.getBoundingClientRect();
			if (y < rect.top + rect.height / 2) {
				return { column, target: 'todo', beforeId: item.dataset.card ?? null, lineTop: rect.top - listRect.top + list.scrollTop - 5 };
			}
		}
		const last = items[items.length - 1]?.getBoundingClientRect();
		return { column, target: 'todo', beforeId: null, lineTop: last === undefined ? 0 : last.bottom - listRect.top + list.scrollTop + 4 };
	}

	/** Near an edge, scroll the board sideways and the column under the pointer up or down. */
	function autoScroll(): void {
		scrollFrame = undefined;
		if (drag === undefined || !drag.active || root == null) return;
		const { x, y } = drag;
		const edge = 56;
		const step = (distance: number): number => Math.ceil(((edge - distance) / edge) * 14);
		let moved = false;
		if (scroller != null) {
			const rect = scroller.getBoundingClientRect();
			if (x < rect.left + edge && scroller.scrollLeft > 0) {
				scroller.scrollLeft -= step(Math.max(0, x - rect.left));
				moved = true;
			} else if (x > rect.right - edge && scroller.scrollLeft < scroller.scrollWidth - scroller.clientWidth) {
				scroller.scrollLeft += step(Math.max(0, rect.right - x));
				moved = true;
			}
		}
		const column = drag.over === undefined ? undefined : root.querySelector<HTMLElement>(`[data-column="${drag.over.column}"] [data-column-list]`);
		if (column !== undefined && column !== null) {
			const rect = column.getBoundingClientRect();
			if (y < rect.top + edge && y > rect.top - edge && column.scrollTop > 0) {
				column.scrollTop -= step(Math.max(0, y - rect.top));
				moved = true;
			} else if (y > rect.bottom - edge && y < rect.bottom + edge && column.scrollTop < column.scrollHeight - column.clientHeight) {
				column.scrollTop += step(Math.max(0, rect.bottom - y));
				moved = true;
			}
		}
		if (moved) drag.over = spotAt(x, y);
		scrollFrame = requestAnimationFrame(autoScroll);
	}

	/** The ghost lives on the body: a sheet's transform would pin a fixed element to the sheet instead of the window. */
	function onBody(node: HTMLElement): { destroy(): void } {
		document.body.appendChild(node);
		return { destroy: () => node.remove() };
	}

	// --- one column at a time --------------------------------------------------------------------------------------

	/** The selected tab stays in view in its own scrolling row. */
	$effect(() => {
		if (!oneColumn) return;
		const id = columns[activeIndex]?.id;
		untrack(() => root?.querySelector<HTMLElement>(`[data-column-tab="${id}"]`))?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
	});

	function showColumn(index: number): void {
		activeIndex = index;
		const width = scroller?.clientWidth ?? 0;
		scroller?.scrollTo({ left: index * width, behavior: reducedMotion.current ? 'auto' : 'smooth' });
	}

	function onScroll(): void {
		if (!oneColumn || scroller == null || scroller.clientWidth === 0) return;
		activeIndex = Math.max(0, Math.min(columns.length - 1, Math.round(scroller.scrollLeft / scroller.clientWidth)));
	}

	function onTabsKeydown(event: KeyboardEvent): void {
		if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
		event.preventDefault();
		const next = (activeIndex + (event.key === 'ArrowRight' ? 1 : -1) + columns.length) % columns.length;
		showColumn(next);
		root?.querySelector<HTMLElement>(`[data-column-tab="${columns[next]?.id}"]`)?.focus();
	}

	function taskLabelOf(question: BoardQuestion): string | undefined {
		if (question.taskId === null) return undefined;
		const title = board?.task(question.taskId)?.title;
		return title === undefined ? question.taskId : `${question.taskId} · ${title}`;
	}
</script>

{#snippet countPill(count: number, accent = false)}
	<span
		class="rounded-full px-1.5 text-[0.6875rem] leading-4 font-medium tabular-nums {accent
			? 'bg-(--accent-2)/15 text-(--accent-2)'
			: 'bg-(--chat-surface-2) text-(--chat-fg-subtle)'}">{count}</span
	>
{/snippet}

{#snippet cardMenu(card: KanbanCard, index: number, count: number)}
	<TaskMoveMenu
		task={card.task}
		position={card.column === 'todo' ? { index, count } : undefined}
		onmove={(target) => requestMove(card.task, target)}
		onreorder={(to) => reorderTo(card, to)}
	/>
{/snippet}

{#snippet columnSkeleton()}
	{#each [0, 1, 2] as index (index)}
		<div class="flex flex-col gap-2 rounded-xl border border-(--chat-border)/70 px-3 py-3" aria-hidden="true">
			<div class="skeleton h-3.5 {index === 1 ? 'w-2/3' : 'w-4/5'}"></div>
			<div class="skeleton h-3 w-11/12"></div>
			<div class="skeleton ml-auto h-2.5 w-12"></div>
		</div>
	{/each}
{/snippet}

<div bind:this={root} class="task-board flex min-h-0 flex-1 flex-col" onclickcapture={onClickCapture} data-task-board>
	{#if board !== undefined && adding}
		<div class="relative flex min-h-0 flex-1 flex-col">
		<div use:overlayScroll={'parent'} class="min-h-0 flex-1 overflow-y-auto px-3 py-3">
			<div class="mx-auto w-full max-w-2xl">
				<BoardTaskEditor
					task={undefined}
					tasks={board.tasks}
					onsave={(input, options) => board.saveTask(input, options)}
					onback={() => (adding = false)}
				/>
			</div>
		</div>
		</div>
	{:else}
		<div class="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1.5 px-3 pt-3 pb-2">
			{#if viewSwitch}{@render viewSwitch()}{/if}
			{#if needsYou > 0 || onlyNeedsYou}
				<button
					type="button"
					class="inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold transition-colors {onlyNeedsYou
						? 'border-(--accent-2) bg-(--accent-2)/15 text-(--accent-2)'
						: 'border-(--accent-2)/35 text-(--accent-2) hover:bg-(--accent-2)/10'}"
					aria-pressed={onlyNeedsYou}
					title={onlyNeedsYou ? 'Show every task' : 'Show only what needs you'}
					onclick={() => (onlyNeedsYou = !onlyNeedsYou)}
					data-needs-you-count
				>
					Needs you
					<span class="grid min-w-4 place-items-center rounded-full bg-(--accent-2) px-1 text-[0.625rem] leading-4 text-white tabular-nums"
						>{needsYou}</span
					>
				</button>
			{/if}
			<TaskFilters {canNarrow} />
			<TaskSearchBox query={search.query} onchange={search.setQuery} />
			{#if search.query.trim() && !searchHits.length}<p role="status">No tasks match your search.</p>{/if}
			<span class="flex-1"></span>
			{#if board !== undefined}
				<Button
					variant="ghost"
					size="sm"
					class="h-7 px-2 text-xs text-(--chat-fg-muted)"
					aria-pressed={board.showArchived}
					onclick={() => board.setShowArchived(!board.showArchived)}
				>
					<ArchiveIcon />{board.showArchived ? `Hide archived${archivedShown > 0 ? ` (${archivedShown})` : ''}` : 'Show archived'}
				</Button>
				<Button variant="ghost" size="sm" class="h-7 px-2 text-xs" onclick={() => (adding = true)}>
					<PlusIcon />Add task
				</Button>
			{/if}
		</div>

		{#if board?.error}
			<div class="px-3 pb-2"><Banner tone="error">{board.error}</Banner></div>
		{/if}

		{#if loose.length > 0}
			<section class="flex shrink-0 flex-col gap-1.5 px-3 pb-2" aria-label="Waiting for you, not about a task">
				<h3 class="flex items-center gap-1.5 px-1 text-[0.8125rem] font-semibold text-(--accent-2)">
					Waiting for you{@render countPill(loose.length, true)}
				</h3>
				<div class="grid gap-1.5 md:grid-cols-2 xl:grid-cols-3">
					{#each loose as question (question.id)}
						<BoardQuestionCard
							{question}
							compact
							taskLabel={taskLabelOf(question)}
							taskHref={question.taskId === null ? undefined : taskHref(question.taskId)}
							askedBy={questionAskedBy(question, threads)}
							onanswer={(entry, text) => board!.answer(entry.id, entry.revision, text)}
						/>
					{/each}
				</div>
			</section>
		{/if}

		{#if oneColumn}
			<div
				class="flex shrink-0 gap-1 overflow-x-auto px-3 pb-2 [scrollbar-width:none]"
				role="tablist"
				aria-label="Columns"
				tabindex={-1}
				onkeydown={onTabsKeydown}
			>
				{#each columns as column, index (column.id)}
					<button
						type="button"
						role="tab"
						aria-selected={activeIndex === index}
						aria-controls="kanban-column-{column.id}"
						tabindex={activeIndex === index ? 0 : -1}
						data-column-tab={column.id}
						class="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold transition-colors task-status-{COLUMN_TONES[
							column.id
						]} {activeIndex === index ? 'bg-(--chat-surface-2) text-(--chat-fg)' : 'text-(--chat-fg-subtle)'}"
						onclick={() => showColumn(index)}
					>
						<span class="task-status-dot" aria-hidden="true"></span>{column.label}
						<span class="tabular-nums opacity-70">{column.cards.length + column.hidden}</span>
					</button>
				{/each}
			</div>
		{/if}

		<div class="relative flex min-h-0 flex-1 flex-col">
		<div
			bind:this={scroller}
			use:overlayScroll={'parent'}
			class="kanban-columns flex min-h-0 flex-1 gap-3 overflow-x-auto overflow-y-hidden px-3 pb-3"
			class:kanban-one-column={oneColumn}
			onscroll={onScroll}
		>
			{#each columns as column, columnIndex (column.id)}
				{@const over = drag?.active === true && drag.over?.column === column.id}
				{@const refusing = drag?.active === true && (column.id === 'review' || column.id === 'waiting')}
				{@const total = column.cards.length + column.hidden}
				<section
					id="kanban-column-{column.id}"
					class="kanban-column task-status-{COLUMN_TONES[column.id]} relative flex min-h-0 flex-col rounded-2xl"
					class:kanban-column-over={over && !refusing && drag?.over?.target !== drag?.card.task.status}
					class:kanban-column-refusing={refusing}
					data-column={column.id}
					aria-label="{column.label}, {total} {total === 1 ? 'task' : 'tasks'}"
					role={oneColumn ? 'tabpanel' : undefined}
					inert={oneColumn && activeIndex !== columnIndex}
				>
					{#if !oneColumn}
						<header class="flex shrink-0 items-center gap-1.5 px-3 pt-2.5 pb-1.5">
							<span class="task-status-dot" aria-hidden="true"></span>
							<h3 class="text-[0.8125rem] font-semibold text-(--chat-fg)">{column.label}</h3>
							{@render countPill(total)}
						</header>
					{/if}
					<div class="relative flex min-h-0 flex-1 flex-col">
					<ul
						class="kanban-list relative flex min-h-0 flex-1 flex-col gap-2 overflow-x-hidden overflow-y-auto overscroll-y-contain px-2 pt-1 pb-2"
						use:overlayScroll={'parent'}
						data-column-list
					>
						{#each column.cards as card, index (card.task.id)}
							<li
								class="kanban-card-slot"
								data-card={card.task.id}
								onpointerdown={(event) => startDrag(event, card)}
								ondragstart={(event) => event.preventDefault()}
								animate:flip={{ duration: flipDuration }}
							>
								<TaskCard
									{card}
									searchHit={search.query.trim() ? searchHitById.get(card.task.id) : undefined}
									tasks={board?.tasks ?? []}
									archivedLinks={board?.archivedLinks}
									{taskHref}
									{onopentask}
									{workers}
									{threads}
									{now}
									href={taskHref(card.task.id)}
									onopen={() => onopentask?.(card.task.id)}
									lifted={drag?.active === true && drag.card.task.id === card.task.id}
								>
									{#snippet menu()}{@render cardMenu(card, index, column.cards.length)}{/snippet}
								</TaskCard>
							</li>
						{/each}
						{#if board === undefined || !board.loaded}
							{@render columnSkeleton()}
						{:else if column.cards.length === 0 && !(over && column.id !== 'done')}
							<li class="px-2 py-3 text-xs text-(--chat-fg-subtle)" aria-hidden={refusing ? 'true' : undefined}>
								{onlyNeedsYou ? 'Nothing here needs you.' : column.empty}
							</li>
						{/if}
						{#if over && column.id === 'todo' && drag?.over?.lineTop !== undefined}
							<li class="kanban-drop-line" style:top="{drag.over.lineTop}px" aria-hidden="true"></li>
						{/if}
					</ul>
					</div>
					{#if column.id === 'done' && column.hidden > 0}
						<button
							type="button"
							class="mx-2 mb-2 shrink-0 rounded-lg px-2 py-1 text-xs text-(--chat-fg-subtle) hover:bg-(--chat-surface-2) hover:text-(--chat-fg)"
							onclick={() => (doneExpanded = true)}
						>
							Show {column.hidden} more
						</button>
					{/if}
					{#if refusing}
						<div class="kanban-refuse" aria-hidden="true">Agents put tasks here when they are ready for you.</div>
					{/if}
					{#if drag?.active === true && column.id === 'done'}
						<!-- While a card is dragged, Done splits in two: close it as done, or drop it. -->
						<div class="kanban-zones" aria-hidden="true">
							<div
								class="kanban-zone task-status-done"
								class:kanban-zone-over={over && drag.over?.target === 'done'}
								data-drop-zone="done"
							>
								<CheckIcon class="size-4" />Done
							</div>
							<div
								class="kanban-zone task-status-dropped"
								class:kanban-zone-over={over && drag.over?.target === 'dropped'}
								data-drop-zone="dropped"
							>
								<BanIcon class="size-4" />Dropped
							</div>
						</div>
					{/if}
				</section>
			{/each}
		</div>
		</div>

		{#if board?.loaded && workerHref}
			<!-- Below every column; a long list scrolls in its own box instead of taking the board's height. -->
			<div class="max-h-[35%] shrink-0 overflow-y-auto border-t border-(--chat-border)/60 px-3 pt-2 pb-3" data-loose-workers>
				<LooseWorkers {workers} {tasks} hrefOf={workerHref} />
			</div>
		{/if}
	{/if}

	{#if notice !== undefined}
		<div
			class="kanban-notice pointer-events-auto absolute bottom-4 left-1/2 z-20 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-2 rounded-full border py-1.5 pr-1.5 pl-3.5 text-xs"
			class:kanban-notice-error={notice.tone === 'error'}
			role={notice.tone === 'error' ? 'alert' : 'status'}
			transition:fade={{ duration: reducedMotion.current ? 0 : 140 }}
		>
			<span class="min-w-0">{notice.text}</span>
			{#if notice.undo}
				<button
					type="button"
					class="shrink-0 rounded-full px-2 py-0.5 font-semibold text-(--accent-2) hover:bg-(--accent-2)/12"
					onclick={() => notice?.undo?.()}>Undo</button
				>
			{/if}
			<button
				type="button"
				class="grid size-6 shrink-0 place-items-center rounded-full text-(--chat-fg-subtle) hover:bg-(--chat-surface-2) hover:text-(--chat-fg)"
				aria-label="Dismiss"
				onclick={() => (notice = undefined)}><XIcon class="size-3.5" /></button
			>
		</div>
	{/if}
</div>

{#if drag?.active}
	<div
		use:onBody
		class="kanban-ghost"
		style:left="{drag.x - drag.grabX}px"
		style:top="{drag.y - drag.grabY}px"
		style:width="{drag.width}px"
		aria-hidden="true"
	>
		<TaskCard card={drag.card} tasks={board?.tasks ?? []} {workers} {threads} {now} href={taskHref(drag.card.task.id)} ghost />
	</div>
{/if}

<TaskMoveDialog bind:request={asking} onconfirm={answerAsked} />

<style>
	.task-board {
		position: relative;
	}
	.kanban-column {
		flex: 1 1 0;
		min-width: 14rem;
		max-width: 24rem;
		background: color-mix(in oklab, var(--chat-surface) 45%, transparent);
		border: 1px solid color-mix(in oklab, var(--chat-border) 55%, transparent);
		transition:
			background-color 140ms ease,
			border-color 140ms ease,
			opacity 140ms ease;
	}
	/* On a narrow screen a column is the whole width, and a swipe snaps to the next. */
	.kanban-one-column {
		scroll-snap-type: x mandatory;
		gap: 0.75rem;
	}
	.kanban-one-column .kanban-column {
		flex: 0 0 100%;
		max-width: none;
		min-width: 0;
		scroll-snap-align: center;
		scroll-snap-stop: always;
	}
	.kanban-column-over {
		border-color: color-mix(in oklab, var(--task-status) 55%, transparent);
		background: color-mix(in oklab, var(--task-status) 7%, var(--chat-bg));
	}
	.kanban-column-refusing > :not(.kanban-refuse) {
		opacity: 0.45;
	}
	.kanban-refuse {
		position: absolute;
		z-index: 2;
		inset: 2.5rem 0.5rem 0.5rem;
		display: grid;
		place-items: center;
		padding: 1rem;
		border: 1.5px dashed color-mix(in oklab, var(--chat-border-strong) 80%, transparent);
		border-radius: 0.875rem;
		text-align: center;
		font-size: 0.75rem;
		color: var(--chat-fg-muted);
		background: color-mix(in oklab, var(--chat-bg) 70%, transparent);
		pointer-events: none;
	}
	.kanban-zones {
		position: absolute;
		z-index: 2;
		inset: 2.5rem 0.5rem 0.5rem;
		display: grid;
		grid-template-rows: 1fr 1fr;
		gap: 0.5rem;
		pointer-events: none;
	}
	.kanban-zone {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		border: 1.5px dashed color-mix(in oklab, var(--task-status) 55%, transparent);
		border-radius: 0.875rem;
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--task-status);
		background: color-mix(in oklab, var(--chat-bg) 88%, var(--task-status));
		transition:
			background-color 120ms ease,
			border-color 120ms ease;
	}
	.task-status-dropped.kanban-zone {
		color: var(--chat-fg-muted);
		--task-status: var(--chat-fg-subtle);
	}
	.kanban-zone-over {
		border-style: solid;
		border-color: var(--task-status);
		background: color-mix(in oklab, var(--chat-bg) 72%, var(--task-status));
	}
	.kanban-drop-line {
		position: absolute;
		left: 0.5rem;
		right: 0.5rem;
		height: 2px;
		border-radius: 1px;
		background: var(--accent-2);
		pointer-events: none;
	}
	.kanban-drop-line::before {
		content: '';
		position: absolute;
		left: -3px;
		top: -2px;
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--accent-2);
	}
	/* The board's cards are moved, not selected; the sheet has the text. */
	@media (pointer: fine) {
		.kanban-card-slot {
			user-select: none;
			cursor: grab;
		}
	}
	:global(html.kanban-dragging),
	:global(html.kanban-dragging *) {
		cursor: grabbing !important;
	}
	/* A copy of a card on its way to another column, over everything; see the glide effect. */
	:global(.kanban-glide) {
		position: fixed;
		z-index: 90;
		margin: 0;
		list-style: none;
		pointer-events: none;
		box-shadow: 0 14px 30px -12px color-mix(in oklab, #000 30%, transparent);
		border-radius: 0.75rem;
	}
	.kanban-ghost {
		position: fixed;
		z-index: 100;
		pointer-events: none;
		transform: rotate(1.5deg) scale(1.02);
	}
	.kanban-notice {
		border-color: color-mix(in oklab, var(--chat-border-strong) 70%, transparent);
		background: color-mix(in oklab, var(--chat-bg) 92%, var(--chat-surface));
		color: var(--chat-fg);
		box-shadow: 0 8px 24px -10px color-mix(in oklab, #000 35%, transparent);
	}
	.kanban-notice-error {
		border-color: color-mix(in oklab, var(--chat-danger) 45%, transparent);
		color: var(--chat-danger);
	}
	@media (prefers-reduced-motion: reduce) {
		.kanban-ghost {
			transform: none;
		}
	}
</style>
