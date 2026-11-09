<script lang="ts">
	import XIcon from '@lucide/svelte/icons/x';
	import ListFilterIcon from '@lucide/svelte/icons/list-filter';
	import { taskFilter } from '#lib/tasks-view.svelte.js';

	/**
	 * The two filters on the task list, the board and the legacy panel: "Top-level" hides subtasks, and a "Linked to T8"
	 * chip (set from a task's sheet) keeps that task and everything linked to it. The toggle shows only when there is a
	 * subtask to hide (`canNarrow`) or it is on, so a board without links looks as it did.
	 */
	let { canNarrow, class: className = '' }: { canNarrow: boolean; class?: string } = $props();
</script>

{#if canNarrow || taskFilter.topLevelOnly}
	<button
		type="button"
		class="inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors {taskFilter.topLevelOnly
			? 'border-(--chat-border-strong) bg-(--chat-surface-2) text-(--chat-fg)'
			: 'border-(--chat-border) text-(--chat-fg-muted) hover:bg-(--chat-surface-2)/60'} {className}"
		aria-pressed={taskFilter.topLevelOnly}
		title={taskFilter.topLevelOnly ? 'Show subtasks too' : 'Hide subtasks: show only top-level tasks'}
		onclick={() => taskFilter.setTopLevelOnly(!taskFilter.topLevelOnly)}
		data-filter-top-level
	>
		<ListFilterIcon class="size-3.5" aria-hidden="true" />Top-level only
	</button>
{/if}
{#if taskFilter.focus !== null}
	<span
		class="inline-flex h-7 items-center gap-1 rounded-full border border-(--accent-2)/40 bg-(--accent-2)/10 pr-1 pl-2.5 text-xs font-medium text-(--accent-2) {className}"
		data-filter-focus={taskFilter.focus}
	>
		Linked to <span class="font-mono">{taskFilter.focus}</span>
		<button
			type="button"
			class="grid size-5 place-items-center rounded-full hover:bg-(--accent-2)/20"
			aria-label="Show every task again"
			title="Show every task again"
			onclick={() => taskFilter.clearFocus()}
		>
			<XIcon class="size-3" aria-hidden="true" />
		</button>
	</span>
{/if}
