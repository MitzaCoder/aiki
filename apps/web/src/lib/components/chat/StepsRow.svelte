<script lang="ts">
	import CheckIcon from '@lucide/svelte/icons/check';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import CircleStopIcon from '@lucide/svelte/icons/circle-stop';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import XIcon from '@lucide/svelte/icons/x';
	import { slide } from 'svelte/transition';
	import type { MemoryScope, WorkerSummary } from '@mihai-harness/protocol';
	import { toolIcon } from '#lib/chat/tools.js';
	import { stepsGroupSummary, type ToolPart } from '#lib/transcript.js';
	import type { ThreadCards } from '#lib/threads.js';
	import CallCard from './CallCard.svelte';

	/**
	 * A run of calls that are not coding calls, folded into one row ("5 steps"):
	 * a board write, a schedule saved, a worker spawned. The row counts them and
	 * says what failed or still runs; a step opens into the card it would have
	 * been on its own. A turn with a single call keeps that card instead, so
	 * nothing is folded away that was never a stack.
	 */
	let {
		calls,
		cwd,
		workers = [],
		workerHref,
		scheduleName,
		workerTitlesBefore,
		onopentopic,
		onopenboard,
		threadCards
	}: {
		calls: readonly ToolPart[];
		/** The project directory, to shorten paths in the cards. */
		cwd?: string;
		workers?: readonly WorkerSummary[];
		workerHref?: (worker: WorkerSummary) => string;
		scheduleName?: (scheduleId: string) => string | undefined;
		workerTitlesBefore?: ReadonlyMap<string, string>;
		onopentopic?: (fileId: string, scope: MemoryScope) => void;
		onopenboard?: () => void;
		threadCards?: ThreadCards;
	} = $props();

	let open = $state(false);
	const summary = $derived(stepsGroupSummary(calls));
	const HeaderIcon = $derived(toolIcon(calls[0]?.name ?? ''));
	const names = $derived(calls.map((call) => call.name).join(', '));
</script>

<div
	class="my-2 overflow-hidden rounded-2xl border border-(--chat-border) bg-(--chat-surface)/60"
	data-status={summary.status}
	data-steps={calls.length}
>
	<button
		type="button"
		class="flex w-full min-w-0 items-center gap-2.5 px-3 py-1.5 text-left transition-colors hover:bg-(--chat-surface-2)/60"
		onclick={() => (open = !open)}
		aria-expanded={open}
		title={names}
	>
		<span class="tool-icon grid size-6 shrink-0 place-items-center rounded-md">
			<HeaderIcon class="size-3.5" />
		</span>
		<span class="flex min-w-0 flex-1 items-baseline gap-2">
			<span class="text-[0.8125rem] font-semibold" class:shimmer-text={summary.status === 'running'}>
				{summary.label}
			</span>
			{#if summary.detail}
				<span
					class="shrink-0 text-xs {summary.status === 'failed'
						? 'text-(--chat-danger)'
						: summary.status === 'exited'
							? 'text-(--chat-warning)'
							: 'text-(--chat-fg-subtle)'}"
				>
					{summary.detail}
				</span>
			{/if}
		</span>
		<span class="flex shrink-0 items-center gap-1.5 text-xs text-(--chat-fg-subtle)" title={summary.status}>
			{#if summary.status === 'running'}
				<LoaderCircleIcon class="size-3.5 animate-spin text-(--accent-2)" />
			{:else if summary.status === 'failed'}
				<XIcon class="size-3.5 text-(--chat-danger)" />
			{:else if summary.status === 'exited'}
				<TriangleAlertIcon class="size-3.5 text-(--chat-warning)" />
			{:else if summary.status === 'done'}
				<CheckIcon class="size-3.5 text-(--chat-success)" />
			{:else}
				<CircleStopIcon class="size-3.5" />
			{/if}
			<ChevronRightIcon class="size-3.5 transition-transform {open ? 'rotate-90' : ''}" />
		</span>
	</button>

	{#if open}
		<div
			class="steps-body flex flex-col gap-1 border-t border-(--chat-border) bg-(--chat-bg)/40 p-1.5"
			transition:slide={{ duration: 180 }}
		>
			{#each calls as call (call.key)}
				<CallCard
					part={call}
					{cwd}
					{workers}
					{workerHref}
					{scheduleName}
					{workerTitlesBefore}
					{onopentopic}
					{onopenboard}
					{threadCards}
				/>
			{/each}
		</div>
	{/if}
</div>

<style>
	.tool-icon {
		color: var(--accent-2);
		background: color-mix(in oklab, var(--accent-2) 12%, transparent);
	}
	/* Every card brings its own margin for standing alone between two sentences; inside the row the gap sets it. */
	.steps-body > :global(*) {
		margin-top: 0;
		margin-bottom: 0;
	}
	[data-status='failed'] {
		border-color: color-mix(in oklab, var(--chat-danger) 30%, var(--chat-border));
	}
	[data-status='failed'] .tool-icon {
		color: var(--chat-danger);
		background: color-mix(in oklab, var(--chat-danger) 12%, transparent);
	}
	[data-status='exited'] {
		border-color: color-mix(in oklab, var(--chat-warning) 30%, var(--chat-border));
	}
	[data-status='exited'] .tool-icon {
		color: var(--chat-warning);
		background: color-mix(in oklab, var(--chat-warning) 12%, transparent);
	}
</style>
