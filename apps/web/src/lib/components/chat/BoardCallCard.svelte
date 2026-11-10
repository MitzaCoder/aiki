<script lang="ts">
	import CardMarkdown from '../markdown/CardMarkdown.svelte';
	import CheckIcon from '@lucide/svelte/icons/check';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import CircleStopIcon from '@lucide/svelte/icons/circle-stop';
	import ClipboardListIcon from '@lucide/svelte/icons/clipboard-list';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import XIcon from '@lucide/svelte/icons/x';
	import { slide } from 'svelte/transition';
	import type { BoardCallView } from '#lib/board.js';
	import TaskText from './TaskText.svelte';
	import { toolCardStatus, type ToolCardStatus, type ToolPart } from '#lib/transcript.js';

	/**
	 * One call of the coordinator's `board` tool as a single line ("Added T4 · Fix parser recovery"). It opens into the
	 * longer text when there is some, and an error stays collapsed and red, like every tool card.
	 */
	let {
		part,
		view,
		onopenboard
	}: {
		part: ToolPart;
		view: BoardCallView;
		/** Jump to the Board tab. */
		onopenboard?: () => void;
	} = $props();

	const status: ToolCardStatus = $derived(toolCardStatus(part));
	const LABELS: Record<ToolCardStatus, string> = {
		preparing: 'preparing',
		running: 'running',
		done: 'done',
		error: 'failed',
		exited: 'failed',
		interrupted: 'stopped'
	};
	let open = $state(false);
	const failed = $derived(status === 'error' || status === 'exited');
	const expandable = $derived(failed || view.detail !== undefined || onopenboard !== undefined);
</script>

<div class="my-1 overflow-hidden rounded-lg border border-(--chat-border) bg-(--chat-surface)/60" data-status={status} data-board-call>
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div
		class="flex min-h-9 w-full min-w-0 items-center gap-2 px-3 text-left sm:min-h-7 {expandable ? 'cursor-pointer transition-colors hover:bg-(--chat-surface-2)/60' : ''}"
		onclick={(event) => {
			if (expandable && (event.target as Element).closest('a') === null) open = !open;
		}}
	>
		<span class="tool-icon grid size-6 shrink-0 place-items-center rounded-md">
			<ClipboardListIcon class="size-3.5" />
		</span>
		<span class="block min-w-0 flex-1 truncate text-[0.8125rem] font-semibold" title={view.summary}>
			<TaskText text={view.summary} />
		</span>
		<span class="flex shrink-0 items-center gap-1.5 text-xs text-(--chat-fg-subtle)" title={LABELS[status]}>
			{#if status === 'preparing' || status === 'running'}
				<LoaderCircleIcon class="size-3.5 animate-spin text-(--accent-2)" />
			{:else if status === 'done'}
				<CheckIcon class="size-3.5 text-(--chat-success)" />
			{:else if failed}
				<XIcon class="size-3.5 text-(--chat-danger)" />
			{:else}
				<CircleStopIcon class="size-3.5" />
			{/if}
			{#if expandable}
				<button
					type="button"
					class="-mr-1.5 grid size-8 place-items-center rounded-lg hover:text-(--chat-fg) sm:size-7"
					onclick={() => (open = !open)}
					aria-expanded={open}
					aria-label={open ? 'Hide the details' : 'Show the details'}
				>
					<ChevronRightIcon class="size-3.5 transition-transform {open ? 'rotate-90' : ''}" />
				</button>
			{/if}
		</span>
	</div>

	{#if open}
		<div class="border-t border-(--chat-border) bg-(--chat-bg)/40" transition:slide={{ duration: 180 }}>
			{#if failed}
				<pre class="error-output">{part.output || 'The board tool failed.'}</pre>
			{:else}
				{#if view.detail}
					<div class="px-3.5 py-2.5 text-(--chat-fg-muted)"><CardMarkdown source={view.detail} /></div>
				{/if}
				{#if onopenboard}
					<button
						type="button"
						class="px-3.5 pb-2.5 text-xs font-medium text-(--accent-2) hover:underline"
						onclick={onopenboard}
					>
						Open the Board
					</button>
				{/if}
			{/if}
		</div>
	{/if}
</div>

<style>
	.tool-icon {
		color: var(--accent-2);
		background: color-mix(in oklab, var(--accent-2) 12%, transparent);
	}
	[data-status='error'],
	[data-status='exited'] {
		border-color: color-mix(in oklab, var(--chat-danger) 30%, var(--chat-border));
	}
	[data-status='error'] .tool-icon,
	[data-status='exited'] .tool-icon {
		color: var(--chat-danger);
		background: color-mix(in oklab, var(--chat-danger) 12%, transparent);
	}
	.error-output {
		margin: 0;
		padding: 0.5rem 0.875rem 0.875rem;
		font-family: var(--font-mono);
		font-size: 0.78rem;
		line-height: 1.6;
		white-space: pre-wrap;
		word-break: break-word;
		color: var(--chat-danger);
	}
</style>
