<script lang="ts">
	import BrainIcon from '@lucide/svelte/icons/brain';
	import CheckIcon from '@lucide/svelte/icons/check';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import CircleStopIcon from '@lucide/svelte/icons/circle-stop';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import XIcon from '@lucide/svelte/icons/x';
	import { slide } from 'svelte/transition';
	import Markdown from '#lib/components/markdown/Markdown.svelte';
	import { duration } from '#lib/chat/time.js';
	import { toolIcon, toolSummary } from '#lib/chat/tools.js';
	import {
		codingGroupSummary,
		exitCodeOf,
		toolCallState,
		type CodingItem,
		type ToolCallState,
		type ToolPart
	} from '#lib/transcript.js';
	import ToolBody from './ToolBody.svelte';
	import ToolCard from './ToolCard.svelte';

	/**
	 * A run of coding calls (bash, read, write, edit) as one card, with any
	 * thinking that sits between them as slim lines of its own. The header counts
	 * the calls by kind and says what failed or is still running; a line opens
	 * into what its single card shows. A lone call keeps the single card, so
	 * nothing is remounted when the model appends another call beside it.
	 */
	let {
		items,
		cwd,
		activeKey
	}: {
		items: readonly CodingItem[];
		/** The project directory, to shorten paths in the lines. */
		cwd?: string;
		/** The key of the part streaming right now, so its thought line shimmers. */
		activeKey?: string;
	} = $props();

	let open = $state(false);
	/** Which line is open, by its part key; new calls keep the open one open. */
	let openItem = $state<string | undefined>(undefined);

	const summary = $derived(codingGroupSummary(items));
	const firstCall = $derived(items.find((item) => item.kind === 'call'));
	const HeaderIcon = $derived(toolIcon(firstCall?.kind === 'call' ? firstCall.part.name : 'bash'));

	const STATE_LABELS: Record<ToolCallState, string> = {
		running: 'running',
		failed: 'failed',
		exited: 'exited',
		done: 'done',
		stopped: 'stopped'
	};

	function itemLabel(state: ToolCallState, part: ToolPart): string {
		if (state === 'exited') {
			const code = exitCodeOf(part);
			return code === undefined ? STATE_LABELS[state] : `exit ${code}`;
		}
		return STATE_LABELS[state];
	}

	function targetOf(item: Extract<CodingItem, { kind: 'call' }>): string {
		return toolSummary(item.part.name, (item.part.arguments ?? {}) as Record<string, unknown>, cwd);
	}

	function firstLine(text: string): string {
		return text.trim().split('\n').find((line) => line.trim().length > 0)?.trim() ?? '…';
	}

	function durationOf(ms: number | undefined): string | undefined {
		if (ms === undefined) return undefined;
		return ms < 1000 ? '<1s' : duration(ms);
	}

</script>

{#if items.length === 1}
	{@const only = items[0]}
	{#if only?.kind === 'call'}
		<ToolCard part={only.part} {cwd} />
	{/if}
{:else}
	<div
		class="my-2 overflow-hidden rounded-2xl border border-(--chat-border) bg-(--chat-surface)/60"
		data-status={summary.status}
	>
		<button
			type="button"
			class="flex w-full min-w-0 items-center gap-2.5 px-3 py-1.5 text-left transition-colors hover:bg-(--chat-surface-2)/60"
			onclick={() => (open = !open)}
			aria-expanded={open}
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
			<div class="border-t border-(--chat-border) bg-(--chat-bg)/40">
				{#each items as item, index (item.key)}
					<div class="border-(--chat-border)/60" class:border-t={index > 0}>
						{#if item.kind === 'thinking'}
							<button
								type="button"
								class="flex w-full min-w-0 items-center gap-2 py-1.5 pr-2.5 pl-3 text-left transition-colors hover:bg-(--chat-surface-2)/60"
								onclick={() => (openItem = openItem === item.key ? undefined : item.key)}
								aria-expanded={openItem === item.key}
							>
								<BrainIcon
									class="size-3.5 shrink-0 {item.key === activeKey
										? 'text-(--accent-3)'
										: 'text-(--chat-fg-subtle)'}"
								/>
								<span
									class="min-w-0 flex-1 truncate text-xs text-(--chat-fg-subtle)
										{item.key === activeKey ? 'shimmer-text' : ''}"
								>
									{firstLine(item.text)}
								</span>
								<ChevronRightIcon
									class="size-3.5 shrink-0 text-(--chat-fg-subtle) transition-transform {openItem ===
									item.key
										? 'rotate-90'
										: ''}"
								/>
							</button>
							{#if openItem === item.key}
								<div
									class="border-t border-(--chat-border)/60 bg-(--chat-bg)/40 px-3.5 py-2.5 text-(--chat-fg-muted)"
									transition:slide={{ duration: 150 }}
								>
									<Markdown
										source={item.text.trim()}
										streaming={item.key === activeKey}
										class="text-[0.9rem]"
									/>
								</div>
							{/if}
						{:else}
							{@const state = toolCallState(item.part)}
							{@const Icon = toolIcon(item.part.name)}
							<button
								type="button"
								class="flex w-full min-w-0 items-center gap-2 py-1.5 pr-2.5 pl-3 text-left transition-colors hover:bg-(--chat-surface-2)/60"
								onclick={() => (openItem = openItem === item.key ? undefined : item.key)}
								aria-expanded={openItem === item.key}
							>
								<span class="grid size-4 shrink-0 place-items-center" title={itemLabel(state, item.part)}>
									{#if state === 'running'}
										<LoaderCircleIcon class="size-3.5 animate-spin text-(--accent-2)" />
									{:else if state === 'failed'}
										<XIcon class="size-3.5 text-(--chat-danger)" />
									{:else if state === 'exited'}
										<TriangleAlertIcon class="size-3.5 text-(--chat-warning)" />
									{:else if state === 'done'}
										<CheckIcon class="size-3 text-(--chat-success)" />
									{:else}
										<CircleStopIcon class="size-3.5" />
									{/if}
								</span>
								<Icon class="size-3.5 shrink-0 text-(--accent-2)" />
								<code
									class="min-w-0 flex-1 truncate font-mono text-xs {state === 'failed'
										? 'text-(--chat-danger)'
										: state === 'exited'
											? 'text-(--chat-warning)'
											: 'text-(--chat-fg-muted)'}">{targetOf(item) || '…'}</code
								>
								{#if item.part.viaScript !== undefined}
									<span
										class="shrink-0 text-[0.6875rem] text-(--chat-fg-subtle)"
										title="Run through a code mode script; open the call to see it">via script</span
									>
								{/if}
								{#if durationOf(item.part.durationMs)}
									<span class="shrink-0 text-[0.6875rem] tabular-nums text-(--chat-fg-subtle)">
										{durationOf(item.part.durationMs)}
									</span>
								{/if}
								<ChevronRightIcon
									class="size-3.5 shrink-0 text-(--chat-fg-subtle) transition-transform {openItem ===
									item.key
										? 'rotate-90'
										: ''}"
								/>
							</button>
							{#if openItem === item.key}
								<div
									class="border-t border-(--chat-border)/60 bg-(--chat-bg)/40"
									transition:slide={{ duration: 150 }}
								>
									<ToolBody part={item.part} {cwd} />
								</div>
							{/if}
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</div>
{/if}

<style>
	.tool-icon {
		color: var(--accent-2);
		background: color-mix(in oklab, var(--accent-2) 12%, transparent);
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
