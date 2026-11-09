<script lang="ts">
	import ArrowDownIcon from '@lucide/svelte/icons/arrow-down';
	import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';
	import ArrowUpToLineIcon from '@lucide/svelte/icons/arrow-up-to-line';
	import MoveIcon from '@lucide/svelte/icons/move';
	import * as Popover from '#lib/components/ui/popover/index.js';
	import { moveChoices, type MoveTarget } from '#lib/kanban.js';
	import { taskStatusToneClass } from '#lib/tasks.js';
	import type { BoardTask } from '@mihai-harness/protocol';

	/**
	 * A card's "Move to…" menu: every status the user may move the task to (never Ready for review, which the agents
	 * fill), and in To do its place in the priority order. It is the way to move a card by keyboard and on a touch
	 * screen, where dragging is awkward.
	 */
	let {
		task,
		position,
		onmove,
		onreorder,
		class: className = ''
	}: {
		task: Pick<BoardTask, 'id' | 'title' | 'status'>;
		/** In To do: where the card is and how many there are, for the priority moves. */
		position?: { index: number; count: number };
		onmove: (target: MoveTarget) => void;
		onreorder?: (index: number) => void;
		class?: string;
	} = $props();

	let open = $state(false);
	const choices = $derived(moveChoices(task.status));

	function pick(action: () => void): void {
		open = false;
		action();
	}

	const itemClass =
		'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[0.8125rem] outline-none hover:bg-(--chat-surface-2) focus-visible:bg-(--chat-surface-2) disabled:opacity-40 disabled:hover:bg-transparent';
</script>

<Popover.Root bind:open>
	<Popover.Trigger
		class="task-card-menu inline-flex size-7 items-center justify-center rounded-md text-(--chat-fg-subtle) outline-none hover:bg-(--chat-surface-2) hover:text-(--chat-fg) focus-visible:ring-2 focus-visible:ring-(--accent-2) aria-expanded:bg-(--chat-surface-2) aria-expanded:text-(--chat-fg) {className}"
		aria-label="Move {task.id}: {task.title}"
		title="Move to…"
		data-card-menu
	>
		<MoveIcon class="size-3.5" />
	</Popover.Trigger>
	<Popover.Content side="bottom" align="end" class="w-60 gap-0.5 p-1">
		<p class="px-2 pt-1 pb-1.5 text-[0.6875rem] font-semibold text-(--chat-fg-subtle)">Move {task.id} to…</p>
		{#each choices as choice (choice.target)}
			<button type="button" class={itemClass} onclick={() => pick(() => onmove(choice.target))} data-move-to={choice.target}>
				<span class="task-status-dot shrink-0 {taskStatusToneClass(choice.target)}" aria-hidden="true"></span>
				<span class="min-w-0 flex-1 font-medium text-(--chat-fg)">{choice.label}</span>
				<span class="shrink-0 text-[0.6875rem] text-(--chat-fg-subtle)">{choice.hint}</span>
			</button>
		{/each}
		{#if position !== undefined && onreorder !== undefined && position.count > 1}
			<div class="my-1 h-px bg-(--chat-border)" role="separator"></div>
			<p class="px-2 pt-0.5 pb-1 text-[0.6875rem] font-semibold text-(--chat-fg-subtle)">Priority</p>
			<button type="button" class={itemClass} disabled={position.index === 0} onclick={() => pick(() => onreorder(0))}>
				<ArrowUpToLineIcon class="size-3.5 shrink-0 text-(--chat-fg-subtle)" />To the top
			</button>
			<button type="button" class={itemClass} disabled={position.index === 0} onclick={() => pick(() => onreorder(position.index - 1))}>
				<ArrowUpIcon class="size-3.5 shrink-0 text-(--chat-fg-subtle)" />Up one
			</button>
			<button
				type="button"
				class={itemClass}
				disabled={position.index >= position.count - 1}
				onclick={() => pick(() => onreorder(position.index + 1))}
			>
				<ArrowDownIcon class="size-3.5 shrink-0 text-(--chat-fg-subtle)" />Down one
			</button>
		{/if}
		<p class="px-2 pt-1.5 pb-1 text-[0.6875rem] leading-4 text-(--chat-fg-subtle)">
			The coordinator hears about every move. Only the agents put a task up for review.
		</p>
	</Popover.Content>
</Popover.Root>
