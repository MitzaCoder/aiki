<script lang="ts">
	import BotIcon from '@lucide/svelte/icons/bot';
	import CalendarClockIcon from '@lucide/svelte/icons/calendar-clock';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { workerScheduleLabel } from '#lib/schedules.js';
	import type { WorkerSummary } from '@mihai-harness/protocol';
	import type { ToolPart } from '#lib/transcript.js';
	import { workerPlace, workerSendLine, workerToolAction } from '#lib/workers.js';
	import WorkerStatusBadge from './WorkerStatusBadge.svelte';

	/**
	 * A `worker_*` call in the coordinator's transcript: one compact card for the
	 * worker it acted on, linking to that worker's read-only transcript, instead of
	 * a generic tool card with the full argument JSON.
	 */
	let {
		part,
		worker,
		href,
		scheduleName,
		previousTitle
	}: {
		part: ToolPart;
		worker: WorkerSummary;
		/** The worker's transcript; the card is a plain block when the caller has no place to link to. */
		href?: string;
		/** The title of the schedule that started this worker, when the caller has the project's schedules. */
		scheduleName?: (scheduleId: string) => string | undefined;
		/** The worker's title before this call, for a `worker_send` that retitled it; see `workerTitlesBeforeSend`. */
		previousTitle?: string;
	} = $props();

	const sentLine = $derived(workerSendLine(part, previousTitle));

	const scheduleId = $derived(worker.scheduleId ?? undefined);
	const scheduleTag = $derived(
		scheduleId === undefined ? undefined : workerScheduleLabel(scheduleId, scheduleName?.(scheduleId)),
	);
</script>

{#snippet body()}
	<span class="worker-tool-icon grid size-7 shrink-0 place-items-center rounded-lg">
		<BotIcon class="size-3.5" />
	</span>
	<span class="flex min-w-0 flex-1 flex-col gap-0.5">
		<span class="flex min-w-0 items-baseline gap-2">
			<span class="truncate text-[0.8125rem] font-semibold">{worker.title || worker.id}</span>
			<span class="shrink-0 font-mono text-[0.6875rem] text-(--chat-fg-subtle)">{worker.id}</span>
		</span>
		{#if sentLine}
			<span class="text-xs break-words text-(--chat-fg-muted)" data-worker-send>{sentLine}</span>
		{/if}
		<span class="truncate text-xs text-(--chat-fg-subtle)">
			{[sentLine ? undefined : workerToolAction(part.name), workerPlace(worker), worker.model.modelId]
				.filter((piece) => piece !== undefined)
				.join(' · ')}
		</span>
		{#if scheduleTag}
			<Badge
				variant="secondary"
				class="mt-0.5 h-4 max-w-full px-1.5 text-[0.625rem] text-ellipsis"
				title="Started by the scheduled task {scheduleTag}"
			>
				<CalendarClockIcon />{scheduleTag}
			</Badge>
		{/if}
	</span>
	<WorkerStatusBadge status={worker.status} class="shrink-0" />
	{#if href}
		<ChevronRightIcon class="size-3.5 shrink-0 text-(--chat-fg-subtle)" />
	{/if}
{/snippet}

{#if href}
	<a
		{href}
		class="my-2 flex min-w-0 items-center gap-2.5 rounded-2xl border border-(--chat-border) bg-(--chat-surface)/60 px-3 py-2 transition-colors hover:bg-(--chat-surface-2)/60"
		data-worker={worker.id}
	>
		{@render body()}
	</a>
{:else}
	<div
		class="my-2 flex min-w-0 items-center gap-2.5 rounded-2xl border border-(--chat-border) bg-(--chat-surface)/60 px-3 py-2"
		data-worker={worker.id}
	>
		{@render body()}
	</div>
{/if}

<style>
	.worker-tool-icon {
		color: var(--accent-2);
		background: color-mix(in oklab, var(--accent-2) 12%, transparent);
	}
</style>
