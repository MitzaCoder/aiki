<script lang="ts">
	import { overlayScroll } from '#lib/scrollbars.js';
	import CheckIcon from '@lucide/svelte/icons/check';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import CircleStopIcon from '@lucide/svelte/icons/circle-stop';
	import CodeSquareIcon from '@lucide/svelte/icons/code-square';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import XIcon from '@lucide/svelte/icons/x';
	import { slide } from 'svelte/transition';
	import CodeBlock from '#lib/components/markdown/CodeBlock.svelte';
	import CopyButton from '#lib/components/CopyButton.svelte';
	import { codemodeCallView, type CodemodeCallLine, type CodemodeCallStatus } from '#lib/chat/codemode.js';
	import { duration } from '#lib/chat/time.js';
	import { toolCardStatus, type ToolCardStatus, type ToolPart } from '#lib/transcript.js';

	/**
	 * One code mode call: a one-line summary (the script's first comment or line,
	 * then its nested calls by kind), opening into the script (collapsed on its
	 * own, highlighted), the nested calls as slim lines, and the script's own
	 * output. A nested `bash`/`powershell` call that exited non-zero reads amber,
	 * like a single `bash` card; any other nested failure and the call itself
	 * read red, collapsed, as any other failed tool.
	 */
	let { part }: { part: ToolPart } = $props();

	const view = $derived(codemodeCallView(part));
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
	let scriptOpen = $state(false);
	let openCall = $state<string | undefined>(undefined);

	const LINE_LABELS: Record<CodemodeCallStatus, string> = {
		running: 'running',
		ok: 'done',
		error: 'failed',
		exited: 'exited non-zero',
		cancelled: 'cancelled when the script ended'
	};

	function lineLabel(line: CodemodeCallLine): string {
		return line.status === 'exited' && line.exitCode !== undefined ? `exit ${line.exitCode}` : LINE_LABELS[line.status];
	}

	function durationOf(ms: number | undefined): string | undefined {
		if (ms === undefined) return undefined;
		return ms < 1000 ? '<1s' : duration(ms);
	}
</script>

<div
	class="my-2 overflow-hidden rounded-2xl border border-(--chat-border) bg-(--chat-surface)/60"
	data-status={status}
>
	<button
		type="button"
		class="flex w-full min-w-0 items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-(--chat-surface-2)/60"
		onclick={() => (open = !open)}
		aria-expanded={open}
	>
		<span class="tool-icon grid size-7 shrink-0 place-items-center rounded-lg">
			<CodeSquareIcon class="size-3.5" />
		</span>
		<span class="min-w-0 flex-1 truncate text-[0.8125rem] font-semibold" title={view.summary}>
			{view.summary}
		</span>
		<span class="flex shrink-0 items-center gap-1.5 text-xs text-(--chat-fg-subtle)" title={LABELS[status]}>
			{#if status === 'preparing' || status === 'running'}
				<LoaderCircleIcon class="size-3.5 animate-spin text-(--accent-2)" />
			{:else if status === 'done'}
				<CheckIcon class="size-3.5 text-(--chat-success)" />
			{:else if status === 'error'}
				<XIcon class="size-3.5 text-(--chat-danger)" />
			{:else}
				<CircleStopIcon class="size-3.5" />
			{/if}
			<span class="hidden sm:inline">{LABELS[status]}</span>
			<ChevronRightIcon class="size-3.5 transition-transform {open ? 'rotate-90' : ''}" />
		</span>
	</button>

	{#if open}
		<div class="border-t border-(--chat-border) bg-(--chat-bg)/40" transition:slide={{ duration: 180 }}>
			<button
				type="button"
				class="section-label w-full hover:text-(--chat-fg)"
				onclick={() => (scriptOpen = !scriptOpen)}
				aria-expanded={scriptOpen}
			>
				<span class="flex items-center gap-1">
					<ChevronRightIcon class="size-3 transition-transform {scriptOpen ? 'rotate-90' : ''}" />
					Script
				</span>
				<CopyButton text={view.code} />
			</button>
			{#if scriptOpen}
				<div transition:slide={{ duration: 150 }}>
					<CodeBlock code={view.code} lang="javascript" bare />
				</div>
			{/if}

			{#if view.calls.length > 0}
				<div class="section-label">
					<span>{view.live ? 'Calls (running)' : `Calls · ${view.calls.length}`}</span>
				</div>
				<div class="divide-y divide-(--chat-border)/60">
					{#each view.calls as line (line.id)}
						<button
							type="button"
							class="flex w-full min-w-0 items-center gap-2 px-3.5 py-1.5 text-left transition-colors hover:bg-(--chat-surface-2)/60"
							onclick={() => (openCall = openCall === line.id ? undefined : line.id)}
							aria-expanded={openCall === line.id}
						>
							<span class="grid size-4 shrink-0 place-items-center" title={lineLabel(line)}>
								{#if line.status === 'running'}
									<LoaderCircleIcon class="size-3.5 animate-spin text-(--accent-2)" />
								{:else if line.status === 'error'}
									<XIcon class="size-3.5 text-(--chat-danger)" />
								{:else if line.status === 'exited'}
									<TriangleAlertIcon class="size-3.5 text-(--chat-warning)" />
								{:else if line.status === 'ok'}
									<CheckIcon class="size-3 text-(--chat-success)" />
								{:else}
									<CircleStopIcon class="size-3.5 text-(--chat-fg-subtle)" />
								{/if}
							</span>
							<code
								class="min-w-0 flex-1 truncate font-mono text-xs {line.status === 'error'
									? 'text-(--chat-danger)'
									: line.status === 'exited'
										? 'text-(--chat-warning)'
										: 'text-(--chat-fg-muted)'}"
							>
								{line.name}
							</code>
							{#if durationOf(line.durationMs)}
								<span class="shrink-0 text-[0.6875rem] tabular-nums text-(--chat-fg-subtle)">
									{durationOf(line.durationMs)}
								</span>
							{/if}
							<ChevronRightIcon
								class="size-3.5 shrink-0 text-(--chat-fg-subtle) transition-transform {openCall === line.id
									? 'rotate-90'
									: ''}"
							/>
						</button>
						{#if openCall === line.id}
							<div
								class="border-t border-(--chat-border)/60 bg-(--chat-bg)/40 px-3.5 py-2"
								transition:slide={{ duration: 150 }}
							>
								{#if line.argsPreview}
									<pre class="call-detail">{line.argsPreview}</pre>
								{/if}
								{#if line.error}
									<p class="mt-1 text-xs {line.status === 'exited' ? 'text-(--chat-warning)' : 'text-(--chat-danger)'}">
										{line.error}
									</p>
								{/if}
							</div>
						{/if}
					{/each}
				</div>
			{/if}

			{#if view.output.length > 0}
				<div class="section-label">
					<span>Output</span>
					<CopyButton text={view.output} />
				</div>
				<div class="relative">
				<div use:overlayScroll={'parent'} class="max-h-96 overflow-auto" class:error={status === 'error'}>
					<pre class="output">{view.output}</pre>
				</div>
				</div>
			{:else if status === 'running' || status === 'preparing'}
				<p class="shimmer-text px-3.5 py-2.5 text-xs">Running…</p>
			{/if}
		</div>
	{/if}
</div>

<style>
	.tool-icon {
		color: var(--accent-2);
		background: color-mix(in oklab, var(--accent-2) 12%, transparent);
	}
	[data-status='error'] {
		border-color: color-mix(in oklab, var(--chat-danger) 30%, var(--chat-border));
	}
	[data-status='error'] .tool-icon {
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
	.output,
	.call-detail {
		margin: 0;
		padding: 0.5rem 0.875rem 0.875rem;
		font-family: var(--font-mono);
		font-size: 0.78rem;
		line-height: 1.6;
		white-space: pre-wrap;
		word-break: break-word;
		color: var(--chat-fg-muted);
	}
	.call-detail {
		padding: 0;
	}
	.error .output {
		color: var(--chat-danger);
	}
</style>
