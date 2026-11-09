<script lang="ts">
	import type { BoardTask } from '@mihai-harness/protocol';
	import { waitingSummary } from '#lib/task-waiting.js';
	import { taskSummaryCells } from '#lib/task-summary.js';
	import TaskStatusBadge from '#lib/components/TaskStatusBadge.svelte';
	let { task, openQuestions, runningWorkers }: { task: BoardTask; openQuestions: number; runningWorkers: number } = $props();
	const cells = $derived(taskSummaryCells(task, openQuestions, runningWorkers));
</script>

<dl class="task-summary" aria-label="Task summary" data-task-summary>
	{#each cells as cell (cell.kind)}
		<div data-summary-cell={cell.kind}>
			<dt>{cell.label}</dt>
			<dd>
				{#if cell.kind === 'status'}<TaskStatusBadge status={task.status} />{:else}{cell.value}{/if}
			</dd>
		</div>
	{/each}
{#if task.status === 'waiting' && task.waiting}<div class="col-span-full" data-waiting-summary><dt>Waiting</dt><dd>{waitingSummary(task)}</dd></div>{/if}
</dl>

<style>
	.task-summary {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 9rem), 1fr));
		gap: 0.8rem 1.5rem;
		padding: 0.9rem 0 1.15rem;
		margin-bottom: 1.25rem;
		border-bottom: 1px solid var(--chat-border);
	}
	.task-summary > div {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.4rem;
	}
	dt {
		color: var(--chat-fg-subtle);
		font-size: 0.65rem;
		letter-spacing: 0.05em;
		text-transform: uppercase;
	}
	dd {
		font-size: 1rem;
		font-weight: 650;
		line-height: 1.4;
	}
</style>
