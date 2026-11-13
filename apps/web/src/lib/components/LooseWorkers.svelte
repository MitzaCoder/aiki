<script lang="ts">
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import WorkerStatusBadge from '#lib/components/chat/WorkerStatusBadge.svelte';
	import { splitLooseWorkers, workersWithoutTask } from '#lib/workers.js';
	import type { WorkerSummary } from '@kemiri/protocol';

	/**
	 * The workers no task lists: the coordinator started them without a task, so a task's Workers section cannot reach
	 * them and this is the one place they open from. It sits at the bottom of every task view, below the tasks. The
	 * running and idle ones are listed; the finished ones (failed, stopped, forgotten) fold under "Finished (N)", which
	 * starts closed. Draws nothing when there are none.
	 */
	let {
		workers,
		tasks,
		hrefOf
	}: {
		workers: readonly WorkerSummary[];
		tasks: readonly { workerIds: readonly string[] }[];
		hrefOf: (worker: WorkerSummary) => string;
	} = $props();

	const loose = $derived(workersWithoutTask(workers, tasks));
	const split = $derived(splitLooseWorkers(loose));
	let finishedOpen = $state(false);
</script>

{#snippet workerRow(worker: WorkerSummary)}
	<li class="min-w-0">
		<a
			href={hrefOf(worker)}
			class="flex min-w-0 items-center gap-1.5 rounded-xl border border-(--chat-border) px-2.5 py-1.5 text-xs hover:bg-(--chat-surface-2)/70"
			data-worker={worker.id}
		>
			<span class="min-w-0 flex-1 truncate font-medium">{worker.title || worker.id}</span>
			<WorkerStatusBadge status={worker.status} class="shrink-0" />
			<ChevronRightIcon class="size-3 shrink-0 text-(--chat-fg-subtle)" />
		</a>
	</li>
{/snippet}

{#if loose.length > 0}
	<section class="flex shrink-0 flex-col gap-1.5" aria-label="Workers without a task">
		<h3 class="flex items-center gap-1.5 px-1 text-[0.8125rem] font-semibold text-(--chat-fg-muted)">
			Workers without a task
			<span class="rounded-full bg-(--chat-surface-2) px-1.5 text-[0.6875rem] leading-4 font-medium text-(--chat-fg-subtle) tabular-nums">{loose.length}</span>
		</h3>
		{#if split.active.length > 0}
			<ul class="flex flex-col gap-1" data-loose-active>
				{#each split.active as worker (worker.id)}{@render workerRow(worker)}{/each}
			</ul>
		{/if}
		{#if split.finished.length > 0}
			<button
				type="button"
				class="flex items-center gap-1 self-start rounded-lg px-1 py-0.5 text-xs font-semibold text-(--chat-fg-muted) hover:text-(--chat-fg)"
				aria-expanded={finishedOpen}
				onclick={() => (finishedOpen = !finishedOpen)}
				data-loose-finished-toggle
			>
				<ChevronRightIcon class="size-3.5 transition-transform {finishedOpen ? 'rotate-90' : ''}" />
				Finished ({split.finished.length})
			</button>
			{#if finishedOpen}
				<ul class="flex flex-col gap-1" data-loose-finished>
					{#each split.finished as worker (worker.id)}{@render workerRow(worker)}{/each}
				</ul>
			{/if}
		{/if}
	</section>
{/if}
