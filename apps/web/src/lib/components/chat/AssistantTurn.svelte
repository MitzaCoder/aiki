<script lang="ts">
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import CircleStopIcon from '@lucide/svelte/icons/circle-stop';
	import CoinsIcon from '@lucide/svelte/icons/coins';
	import CopyButton from '#lib/components/CopyButton.svelte';
	import Markdown from '#lib/components/markdown/Markdown.svelte';
	import AgentMascot from '#lib/components/AgentMascot.svelte';
	import type { AgentMotion } from '#lib/agent-activity.js';
	import { clockTime, compactNumber, duration, fullTime } from '#lib/chat/time.js';
	import { cacheMissDetail, cacheMissLine, turnUsageTitle } from '#lib/chat/cache.js';
	import { groupTurnParts, turnText, type TurnPart, type TurnUsage } from '#lib/transcript.js';
	import { linkTaskMentions } from '#lib/task-chat.js';
	import { useTaskLinks } from '#lib/task-links.svelte.js';
	import type { CacheMiss, MemoryScope, WorkerSummary } from '@kemiri/protocol';
	import type { ThreadCards } from '#lib/threads.js';
	import CallCard from './CallCard.svelte';
	import CodingCalls from './CodingCalls.svelte';
	import StepsRow from './StepsRow.svelte';
	import ThinkingBlock from './ThinkingBlock.svelte';

	/**
	 * Everything the coordinator did between two user messages, under one orb:
	 * thinking, its answer, tool calls, and how it ended.
	 */
	let {
		parts,
		streaming = false,
		motion,
		cwd,
		workers = [],
		workerHref,
		scheduleName,
		workerTitlesBefore,
		onopentopic,
		onopenboard,
		threadCards,
		timestamp,
		ended,
		model,
		usage,
		cacheMisses = []
	}: {
		parts: readonly TurnPart[];
		streaming?: boolean;
		motion?: AgentMotion;
		/** The project directory, to shorten paths in tool cards. */
		cwd?: string;
		/** The project's workers, so a `worker_*` call shows the worker it acted on. */
		workers?: readonly WorkerSummary[];
		workerHref?: (worker: WorkerSummary) => string;
		/** The title of the schedule behind a worker, for workers a schedule started. */
		scheduleName?: (scheduleId: string) => string | undefined;
		/** Each retitling `worker_send`'s previous worker title, by call ID. */
		workerTitlesBefore?: ReadonlyMap<string, string>;
		/** A memory topic a card names opens in the Memory tab. */
		onopentopic?: (fileId: string, scope: MemoryScope) => void;
		/** Open the Board tab, from a `board` call's card. */
		onopenboard?: () => void;
		/** The project's threads, so a `thread_*` call shows the thread it started or acted on, live. */
		threadCards?: ThreadCards;
		timestamp?: number;
		ended?: number;
		model?: string;
		usage?: TurnUsage;
		/** Requests of this turn that re-billed much of the cached prompt; each gets a line under the reply. */
		cacheMisses?: readonly CacheMiss[];
	} = $props();

	const links = useTaskLinks();
	const text = $derived(turnText(parts));
	const lastKey = $derived(parts.at(-1)?.key);
	const rows = $derived(groupTurnParts(parts));
	function mentions(markdown: string, arriving: boolean): string {
		const current = links();
		return current === undefined ? markdown : linkTaskMentions(markdown, { title: current.title, streaming: arriving });
	}
	const elapsed = $derived(timestamp !== undefined && ended !== undefined ? ended - timestamp : undefined);
	/** The reply's time always shows; its duration, model, tokens and cost wait for a hover, a focus or a tap on the time. */
	let metaOpen = $state(false);
	const hasMeta = $derived(
		(elapsed !== undefined && elapsed > 1000) || model !== undefined || (usage !== undefined && usage.output > 0)
	);

	function toggleMeta(event: MouseEvent): void {
		metaOpen = !metaOpen;
		// A pointer click leaves the time focused, and focus alone keeps the rest of the line open; drop it so a second
		// tap closes it again. A keyboard's Enter keeps the focus where it is.
		if (!metaOpen && event.detail > 0) (event.currentTarget as HTMLElement | null)?.blur();
	}
</script>

{#if motion !== 'waiting' || parts.length > 0}
<div class="flex gap-3 sm:gap-4">
	<div class="hidden pt-0.5 sm:block" role="img" aria-label={motion === 'waiting' ? 'Waiting for your answer…' : 'Assistant'}>
		<AgentMascot state={motion ?? (streaming ? 'working' : 'idle')} />
	</div>
	<div class="min-w-0 flex-1">
		{#each rows as row (row.key)}
			<!-- Each row rises as it lands, so a turn that grows while the model works assembles itself instead of jumping. -->
			<div class="animate-rise motion-reduce:animate-none">
				{#if row.kind === 'thinking'}
					<ThinkingBlock steps={row.steps} active={row.steps.at(-1)?.streaming === true} />
				{:else if row.kind === 'coding'}
					<CodingCalls
						items={row.items}
						{cwd}
						activeKey={row.items.find((item) => item.kind === 'thinking' && item.streaming === true)?.key}
					/>
				{:else if row.kind === 'steps'}
					<StepsRow
						calls={row.calls}
						{cwd}
						{workers}
						{workerHref}
						{scheduleName}
						{workerTitlesBefore}
						{onopentopic}
						{onopenboard}
						{threadCards}
					/>
				{:else if row.part.type === 'text'}
					<Markdown source={mentions(row.part.text, streaming && row.part.key === lastKey)} streaming={streaming && row.part.key === lastKey} class="my-2" />
				{:else if row.part.type === 'tool'}
					<CallCard
						part={row.part}
						{cwd}
						{workers}
						{workerHref}
						{scheduleName}
						{workerTitlesBefore}
						{onopentopic}
						{onopenboard}
						{threadCards}
					/>
				{:else if row.part.type === 'error'}
					<div
						class="my-2 flex items-start gap-2 rounded-2xl border border-(--chat-danger)/30 bg-(--chat-danger)/8 px-3.5 py-2.5 text-sm text-(--chat-danger)"
					>
						<CircleAlertIcon class="mt-0.5 size-4 shrink-0" />
						<span class="min-w-0 break-words">{row.part.message}</span>
					</div>
				{:else}
					<p class="my-2 flex items-center gap-1.5 text-sm text-(--chat-fg-subtle)">
						<CircleStopIcon class="size-3.5" />
						Stopped.
					</p>
				{/if}
			</div>
		{/each}

		{#if streaming && parts.length === 0}
			{#if motion !== 'waiting'}
				<p class="my-2 text-sm font-medium shimmer-text">Working…</p>
			{/if}
		{/if}

		{#each cacheMisses as miss, index (index)}
			<p class="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-(--chat-fg-subtle)" title={cacheMissDetail(miss)}>
				<CoinsIcon class="size-3.5 shrink-0 text-(--chat-warning)" aria-hidden="true" />
				<span class="min-w-0 truncate">{cacheMissLine(miss)}</span>
			</p>
		{/each}

		{#if !streaming}
			<div
				class="group/meta mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-(--chat-fg-subtle) opacity-80 transition-opacity hover:opacity-100"
				data-meta
			>
				{#if text}
					<span class="-ml-1.5 inline-flex items-center">
						<CopyButton {text} label="Copy reply" />
					</span>
				{/if}
				{#if ended !== undefined}
					<button
						type="button"
						class="tabular-nums transition-colors hover:text-(--chat-fg) focus-visible:text-(--chat-fg)"
						onclick={toggleMeta}
						aria-expanded={hasMeta ? metaOpen : undefined}
						aria-label={hasMeta ? (metaOpen ? 'Hide what this reply took' : 'Show what this reply took') : undefined}
						title={hasMeta ? `${fullTime(ended)} · tap for the rest` : fullTime(ended)}
					>
						<time datetime={new Date(ended).toISOString()}>{clockTime(ended)}</time>
					</button>
				{/if}
				<span
					class="flex-wrap items-center gap-x-3 gap-y-1 {metaOpen
						? 'inline-flex'
						: 'hidden'} group-hover/meta:inline-flex group-focus-within/meta:inline-flex"
				>
					{#if elapsed !== undefined && elapsed > 1000}
						<span title="Response time">{duration(elapsed)}</span>
					{/if}
					{#if model}
						<span>{model}</span>
					{/if}
					{#if usage !== undefined && usage.output > 0}
						<span title={turnUsageTitle(usage)}
							>↑{compactNumber(usage.input)} ↓{compactNumber(usage.output)}{#if usage.cacheRead > 0}<span
									class="ml-2">{compactNumber(usage.cacheRead)} cached</span
								>{/if}</span
						>
					{/if}
					{#if usage !== undefined && usage.cost > 0}
						<span>${usage.cost < 0.01 ? usage.cost.toFixed(4) : usage.cost.toFixed(2)}</span>
					{/if}
				</span>
			</div>
		{/if}
	</div>
</div>
{/if}
