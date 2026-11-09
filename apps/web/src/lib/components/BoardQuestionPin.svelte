<script lang="ts">
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import CircleHelpIcon from '@lucide/svelte/icons/circle-help';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import { MediaQuery } from 'svelte/reactivity';
	import BoardQuestionCard from '#lib/components/BoardQuestionCard.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { openQuestions } from '#lib/board.js';
	import { isWarning, itemsWaitingLabel } from '#lib/tasks.js';
	import type { ProjectBoard } from '#lib/board.svelte.js';
	import { inThread, questionAskedBy, questionPin } from '#lib/threads.js';
	import type { BoardQuestion, ThreadSummary } from '@mihai-harness/protocol';

	/**
	 * The questions waiting on the user, pinned above the composer so they are answered where the conversation is. The
	 * board is shared by every thread, so on main a question a background thread asked shows here too, labelled with
	 * that thread; the answer goes to the thread that asked. One question is open to answer and the others wait as
	 * one-line rows that switch to it, so the pin stays small; a background thread's page pins only its own questions.
	 *
	 * On a phone the pin starts as one line — how many are waiting and which task — and opens on a tap: an open
	 * question card and its rows would take most of the screen above the composer. A waiting warning keeps the
	 * warning's colour and icon there, so it still stands out closed.
	 */
	let {
		board,
		threads = [],
		threadId,
		tasksView = false,
		taskHref,
		onopenboard
	}: {
		board: ProjectBoard;
		/** The project's threads, to name the one that asked. */
		threads?: readonly ThreadSummary[];
		/** Pin only this background thread's questions; undefined on main, which pins every thread's. */
		threadId?: string;
		/** The Board tab is the Tasks view: the footer says so, and a question's task label opens that task. */
		tasksView?: boolean;
		taskHref?: (taskId: string) => string;
		onopenboard: () => void;
	} = $props();

	/** From `md` up the pin is what it always was; below it stays one line until the user opens it. */
	const wide = new MediaQuery('(min-width: 48rem)');
	let expanded = $state(false);
	const collapsed = $derived(!wide.current && !expanded);

	let chosen = $state<string | undefined>(undefined);
	const waiting = $derived(
		board.board === undefined
			? []
			: openQuestions(board.board).filter((question) => threadId === undefined || inThread(question, threadId))
	);
	const pin = $derived(questionPin(waiting, chosen));
	/** A warning anywhere in the waiting list colours the closed line, not only when it is the one on top. */
	const warned = $derived(waiting.some((question) => isWarning(question)));
	/** The task the open question belongs to: "T15", so the closed line says which work it unblocks. */
	const summaryTask = $derived(pin.current?.taskId === null || pin.current?.taskId === undefined ? undefined : pin.current.taskId);

	function taskLabelOf(question: BoardQuestion): string | undefined {
		const id = question.taskId;
		if (id === null || id === undefined) return undefined;
		const task = board.task(id);
		return task === undefined ? id : `${task.id} · ${task.title}`;
	}
</script>

{#if pin.current}
	<div class="flex min-w-0 flex-col gap-1" data-board-pin data-collapsed={collapsed}>
		{#if !wide.current}
			<button
				type="button"
				class="flex min-w-0 items-center gap-2 rounded-xl border px-3 py-1.5 text-left text-xs transition-colors {warned
					? 'pin-row-warning border-(--chat-warning)/35 hover:border-(--chat-warning)/60'
					: 'pin-row border-(--accent-2)/25 hover:border-(--accent-2)/50'}"
				onclick={() => (expanded = !expanded)}
				aria-expanded={expanded}
				aria-label={expanded ? 'Hide the questions waiting' : 'Show the questions waiting'}
				data-board-pin-summary
			>
				{#if warned}
					<TriangleAlertIcon class="size-3.5 shrink-0 text-(--chat-warning)" aria-hidden="true" />
				{:else}
					<CircleHelpIcon class="size-3.5 shrink-0 text-(--accent-2)" aria-hidden="true" />
				{/if}
				<span class="min-w-0 flex-1 truncate {warned ? 'text-(--chat-warning)' : 'text-(--chat-fg)'}">
					{itemsWaitingLabel(waiting)}{summaryTask ? ` · ${summaryTask}` : ''}
				</span>
				<ChevronDownIcon
					class="size-3.5 shrink-0 text-(--chat-fg-subtle) transition-transform {expanded ? 'rotate-180' : ''}"
					aria-hidden="true"
				/>
			</button>
		{/if}
		{#if !collapsed}
			{#key pin.current.id}
				<BoardQuestionCard
					question={pin.current}
					taskLabel={taskLabelOf(pin.current)}
					askedBy={questionAskedBy(pin.current, threads)}
					taskHref={pin.current.taskId !== null && taskHref !== undefined ? taskHref(pin.current.taskId) : undefined}
					compact
					onanswer={(entry, text) => board.answer(entry.id, entry.revision, text)}
				/>
			{/key}
			{#each pin.others as question (question.id)}
				{@const asker = questionAskedBy(question, threads)}
				<button
					type="button"
					class="pin-row flex min-w-0 items-center gap-2 rounded-xl border px-3 py-1.5 text-left text-xs transition-colors {isWarning(question)
						? 'pin-row-warning border-(--chat-warning)/35 hover:border-(--chat-warning)/60'
						: 'border-(--accent-2)/25 hover:border-(--accent-2)/50'}"
					onclick={() => (chosen = question.id)}
					data-question-row={question.id}
					title={`${isWarning(question) ? 'Acknowledge' : 'Answer'} ${question.id}`}
				>
					{#if isWarning(question)}
						<TriangleAlertIcon class="size-3.5 shrink-0 text-(--chat-warning)" aria-hidden="true" />
					{:else}
						<CircleHelpIcon class="size-3.5 shrink-0 text-(--accent-2)" aria-hidden="true" />
					{/if}
					<span class="shrink-0 font-medium text-(--chat-fg-muted)">{asker ?? 'Main'}</span>
					<span class="min-w-0 flex-1 truncate text-(--chat-fg)">{question.text}</span>
					<ChevronRightIcon class="size-3.5 shrink-0 text-(--chat-fg-subtle)" aria-hidden="true" />
				</button>
			{/each}
			<div class="flex items-center justify-between gap-2 px-1 text-xs text-(--chat-fg-subtle)">
				<span>{itemsWaitingLabel(waiting)}{pin.more > 0 ? ` · ${pin.more} more in ${tasksView ? 'Tasks' : 'the Board'}` : ''}</span>
				<Button variant="ghost" size="sm" class="h-6 px-2 text-xs" onclick={onopenboard}>{tasksView ? 'Open Tasks' : 'Open the Board'}</Button>
			</div>
		{/if}
	</div>
{/if}

<style>
	.pin-row {
		background: color-mix(in oklab, var(--accent-2) 6%, transparent);
	}
	.pin-row-warning {
		background: color-mix(in oklab, var(--chat-warning) 8%, transparent);
	}
</style>
