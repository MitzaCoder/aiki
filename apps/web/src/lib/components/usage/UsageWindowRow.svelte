<script lang="ts">
	import TimerIcon from '@lucide/svelte/icons/timer';
	import { windowPace } from '@mihai-harness/client';
	import type { UsageWindow } from '@mihai-harness/protocol';
	import PacePill from './PacePill.svelte';
	import UsageChart from './UsageChart.svelte';
	import UsageGauge from './UsageGauge.svelte';
	import { clockTime, paceView, resetLabel, windowLengthLabel } from '#lib/subscription-usage.js';

	/**
	 * One rate-limit window: its gauge, its pace in words, the countdown to its reset, and its chart. The chart sits
	 * beside the words when the block is wide enough, else below them.
	 */
	let { window, now }: { window: UsageWindow; now: number } = $props();

	const pace = $derived(windowPace(window, now));
	const view = $derived(paceView(pace, now));
	const length = $derived(windowLengthLabel(window.windowMinutes));
	const resetTitle = $derived(
		pace.resetsAt === null
			? 'The provider gives no reset time'
			: new Date(pace.resetsAt).toLocaleString(undefined, { weekday: 'long', hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' })
	);
</script>

<section class="@container rounded-xl border border-(--chat-border)/80 bg-(--chat-bg)/45 p-2.5 sm:px-3" aria-label={window.label}>
	<div class="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5 @[28rem]:grid-cols-[auto_minmax(0,1.3fr)_minmax(0,1fr)] @[28rem]:gap-x-4 @[44rem]:grid-cols-[auto_minmax(0,1fr)_minmax(0,1.5fr)]">
		<UsageGauge usedPercent={window.usedPercent} elapsedShare={pace.elapsedShare} tone={view.tone} size={84} />
		<div class="flex min-w-0 flex-col gap-1">
			<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
				<h3 class="text-sm font-semibold tracking-tight">{window.label}</h3>
				{#if length}<span class="text-[0.6875rem] text-(--chat-fg-subtle)" title="{length} window">{length}</span>{/if}
				<PacePill tone={view.tone} title={view.title} />
			</div>
			<p class="line-clamp-2 cursor-help text-xs @[28rem]:line-clamp-3 @[44rem]:line-clamp-2 leading-snug text-(--chat-fg-muted)" title={view.detail}>{view.detail}</p>
			<p class="flex items-center gap-1.5 text-xs text-(--chat-fg-muted)">
				<TimerIcon class="size-3.5 shrink-0 text-(--chat-fg-subtle)" />
				<time
					class="cursor-help tabular-nums underline decoration-(--chat-border-strong) decoration-dotted underline-offset-4"
					datetime={window.resetsAt ?? undefined}
					title={resetTitle}
				>
					{resetLabel(pace, now)}{#if pace.resetsAt !== null && pace.resetsAt > now}<span class="text-(--chat-fg-subtle) @min-[28rem]:@max-[44rem]:hidden"
							>&nbsp;· {clockTime(pace.resetsAt, now)}</span
						>{/if}
				</time>
			</p>
		</div>
		<div class="col-span-2 @[28rem]:col-span-1">
			<UsageChart {window} {pace} {now} tone={view.tone} />
		</div>
	</div>
</section>
