<script lang="ts">
	import CheckIcon from '@lucide/svelte/icons/check';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import CircleStopIcon from '@lucide/svelte/icons/circle-stop';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import XIcon from '@lucide/svelte/icons/x';
	import { slide } from 'svelte/transition';
	import { exitCodeOf, isCodingTool, toolCardStatus, type ToolCardStatus, type ToolPart } from '#lib/transcript.js';
	import { toolHeadline, toolIcon, toolSummary } from '#lib/chat/tools.js';
	import ToolBody from './ToolBody.svelte';

	/**
	 * One tool call: a quiet header with what it did, what it acted on and how it
	 * ended, opening into the command, the diff, the file or the output. A tool
	 * that is not a coding tool reads in words ("Saved a schedule") rather than by
	 * its wire name, which stays in the header's tooltip.
	 */
	let {
		part,
		cwd
	}: {
		part: ToolPart;
		/** The project directory, to shorten paths in the summary. */
		cwd?: string;
	} = $props();

	const status: ToolCardStatus = $derived(toolCardStatus(part));

	const LABELS: Record<ToolCardStatus, string> = {
		preparing: 'preparing',
		running: 'running',
		done: 'done',
		error: 'failed',
		exited: 'exited',
		interrupted: 'stopped'
	};

	const label = $derived(
		status === 'exited' && exitCodeOf(part) !== undefined ? `exit ${exitCodeOf(part)}` : LABELS[status]
	);

	let open = $state(false);

	const args = $derived((part.arguments ?? {}) as Record<string, unknown>);
	const Icon = $derived(toolIcon(part.name));
	const summary = $derived(toolSummary(part.name, args, cwd));
	const headline = $derived(toolHeadline(part.name));
</script>

<div
	class="my-2 overflow-hidden rounded-2xl border border-(--chat-border) bg-(--chat-surface)/60"
	data-status={status}
>
	<button
		type="button"
		class="flex w-full min-w-0 items-center gap-2.5 px-3 text-left transition-colors hover:bg-(--chat-surface-2)/60 {isCodingTool(
			part.name
		)
			? 'py-1.5'
			: 'py-2'}"
		onclick={() => (open = !open)}
		aria-expanded={open}
	>
		<span class="tool-icon grid size-7 shrink-0 place-items-center rounded-lg">
			<Icon class="size-3.5" />
		</span>
		<span class="flex min-w-0 flex-1 items-baseline gap-2">
			<span class="shrink-0 text-[0.8125rem] font-semibold" title={headline === undefined ? undefined : part.name}>
				{headline ?? (part.name || '…')}
			</span>
			<span class="truncate text-xs text-(--chat-fg-muted)" class:font-mono={headline === undefined}>{summary}</span>
			{#if part.viaScript !== undefined}
				<span class="shrink-0 text-[0.6875rem] text-(--chat-fg-subtle)" title="Run through a code mode script">via script</span>
			{/if}
		</span>
		<span class="flex shrink-0 items-center gap-1.5 text-xs text-(--chat-fg-subtle)" title={label}>
			{#if status === 'preparing' || status === 'running'}
				<LoaderCircleIcon class="size-3.5 animate-spin text-(--accent-2)" />
			{:else if status === 'done'}
				<CheckIcon class="size-3.5 text-(--chat-success)" />
			{:else if status === 'error'}
				<XIcon class="size-3.5 text-(--chat-danger)" />
			{:else if status === 'exited'}
				<TriangleAlertIcon class="size-3.5 text-(--chat-warning)" />
			{:else}
				<CircleStopIcon class="size-3.5" />
			{/if}
			<span class="hidden sm:inline">{label}</span>
			<ChevronRightIcon class="size-3.5 transition-transform {open ? 'rotate-90' : ''}" />
		</span>
	</button>

	{#if open}
		<div class="border-t border-(--chat-border) bg-(--chat-bg)/40" transition:slide={{ duration: 180 }}>
			<ToolBody {part} {cwd} />
		</div>
	{/if}
</div>

<style>
	.tool-icon {
		color: var(--accent-2);
		background: color-mix(in oklab, var(--accent-2) 12%, transparent);
	}
	[data-status='error'] .tool-icon {
		color: var(--chat-danger);
		background: color-mix(in oklab, var(--chat-danger) 12%, transparent);
	}
	[data-status='error'] {
		border-color: color-mix(in oklab, var(--chat-danger) 30%, var(--chat-border));
	}
	[data-status='exited'] .tool-icon {
		color: var(--chat-warning);
		background: color-mix(in oklab, var(--chat-warning) 12%, transparent);
	}
	[data-status='exited'] {
		border-color: color-mix(in oklab, var(--chat-warning) 30%, var(--chat-border));
	}
</style>
