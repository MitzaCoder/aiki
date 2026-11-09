<script lang="ts">
	import type { WindowPace } from '@mihai-harness/client';
	import type { UsageWindow } from '@mihai-harness/protocol';
	import { PACE_TONE_COLOR, clockTime, usageChart, type PaceTone } from '#lib/subscription-usage.js';

	/**
	 * The window's samples as an area over its whole span, with the even pace (0 at the start to 100% at the reset) as a
	 * dashed diagonal and the average rate from now as a dashed projection. Above the diagonal is ahead of pace.
	 */
	let { window, pace, now, tone }: { window: UsageWindow; pace: WindowPace; now: number; tone: PaceTone } = $props();

	const W = 300;
	const H = 72;
	const uid = $props.id();
	const chart = $derived(usageChart(window, pace, now, W, H));
	const color = $derived(PACE_TONE_COLOR[tone]);
	const last = $derived(chart.points.at(-1));
	const startLabel = $derived(pace.startsAt === null ? null : clockTime(pace.startsAt, now));
	const legend = $derived(
		['Solid: used so far', chart.evenPace ? 'dashed: even pace' : null, chart.projection ? 'dotted: at this rate' : null]
			.filter((part) => part !== null)
			.join(', ')
	);
	const endLabel = $derived(pace.resetsAt === null ? 'now' : clockTime(pace.resetsAt, now));
</script>

<figure class="flex flex-col gap-0.5" style:--tone={color} title={legend}>
	<div class="relative h-12 w-full @[28rem]:h-16">
		<svg viewBox="0 0 {W} {H}" preserveAspectRatio="none" class="absolute inset-0 size-full overflow-visible" aria-hidden="true">
			<defs>
				<linearGradient id="{uid}-fill" x1="0" y1="0" x2="0" y2="1">
					<stop offset="0" stop-color="var(--tone)" stop-opacity="0.32" />
					<stop offset="1" stop-color="var(--tone)" stop-opacity="0" />
				</linearGradient>
				<linearGradient id="{uid}-line" x1="0" y1="0" x2="1" y2="0">
					{#if tone === 'calm'}
						<stop offset="0" stop-color="var(--accent-1)" />
						<stop offset="0.6" stop-color="var(--accent-2)" />
						<stop offset="1" stop-color="var(--accent-3)" />
					{:else}
						<stop offset="0" stop-color="color-mix(in oklab, var(--tone) 50%, var(--accent-2))" />
						<stop offset="1" stop-color="var(--tone)" />
					{/if}
				</linearGradient>
			</defs>
			<line x1="0" y1={chart.limitY} x2={W} y2={chart.limitY} stroke="var(--chat-border-strong)" stroke-width="1" vector-effect="non-scaling-stroke" />
			<line x1="0" y1={H} x2={W} y2={H} stroke="var(--chat-border)" stroke-width="1" vector-effect="non-scaling-stroke" />
			{#if chart.evenPace}
				<line
					x1={chart.evenPace.from.x}
					y1={chart.evenPace.from.y}
					x2={chart.evenPace.to.x}
					y2={chart.evenPace.to.y}
					stroke="var(--chat-fg-subtle)"
					stroke-width="1.25"
					stroke-dasharray="4 4"
					vector-effect="non-scaling-stroke"
					opacity="0.8"
				/>
			{/if}
			{#if chart.area}
				<path class="area" d={chart.area} fill="url(#{uid}-fill)" />
				<path
					class="line"
					d={chart.line}
					fill="none"
					stroke="url(#{uid}-line)"
					stroke-width="2"
					stroke-linejoin="round"
					stroke-linecap="round"
					vector-effect="non-scaling-stroke"
				/>
			{/if}
			{#if chart.projection}
				<line
					class="projection"
					x1={chart.projection.from.x}
					y1={chart.projection.from.y}
					x2={chart.projection.to.x}
					y2={chart.projection.to.y}
					stroke="var(--tone)"
					stroke-width="1.75"
					stroke-dasharray="2 4"
					stroke-linecap="round"
					vector-effect="non-scaling-stroke"
				/>
			{/if}
			{#if chart.nowX !== null}
				<line x1={chart.nowX} y1="0" x2={chart.nowX} y2={H} stroke="var(--chat-fg-subtle)" stroke-width="1" stroke-dasharray="1 3" vector-effect="non-scaling-stroke" opacity="0.6" />
			{/if}
		</svg>
		{#if last && chart.nowX !== null}
			<span
				class="dot absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
				style:left="{(last.x / W) * 100}%"
				style:top="{(last.y / H) * 100}%"
			></span>
		{/if}
		{#if chart.projection && chart.projection.to.y <= chart.limitY + 0.5 && pace.exhaustsAt !== null}
			<span
				class="absolute size-2 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px] bg-(--tone)"
				style:left="{(chart.projection.to.x / W) * 100}%"
				style:top="{(chart.projection.to.y / H) * 100}%"
				title="Limit reached at this rate"
			></span>
		{/if}
		{#if !chart.area}
			<span class="absolute inset-0 grid place-items-center text-[0.6875rem] text-(--chat-fg-subtle)">
				No history yet
			</span>
		{/if}
	</div>
	<figcaption class="flex items-center justify-between gap-x-2 text-[0.625rem] text-(--chat-fg-subtle) tabular-nums">
		<span>{startLabel ?? ''}</span>
		<span class="flex items-center gap-2 @max-[18rem]:hidden @[28rem]:hidden">
			<span class="flex items-center gap-1" title="Used so far"><i class="legend-line"></i>used</span>
			{#if chart.evenPace}<span class="flex items-center gap-1" title="Even pace: 0 at the start to 100% at the reset"><i class="legend-even"></i>even</span>{/if}
			{#if chart.projection}<span class="flex items-center gap-1" title="At this rate: the average pace so far, continued"><i class="legend-proj"></i>rate</span>{/if}
		</span>
		<span>{endLabel}</span>
	</figcaption>
</figure>

<style>
	.dot {
		background: var(--tone);
		box-shadow:
			0 0 0 3px color-mix(in oklab, var(--tone) 22%, transparent),
			0 0 12px color-mix(in oklab, var(--tone) 70%, transparent);
	}
	@media (prefers-reduced-motion: no-preference) {
		.line {
			animation: draw 1.2s cubic-bezier(0.2, 0.8, 0.2, 1) both;
		}
		.area,
		.projection,
		.dot {
			animation: fade 0.9s ease-out 0.5s both;
		}
	}
	@keyframes draw {
		from {
			clip-path: inset(0 100% 0 0);
		}
		to {
			clip-path: inset(0 0 0 0);
		}
	}
	@keyframes fade {
		from {
			opacity: 0;
		}
	}
	i {
		display: inline-block;
		width: 0.75rem;
		height: 0;
		border-top: 2px solid var(--tone);
	}
	.legend-even {
		border-top: 1.5px dashed var(--chat-fg-subtle);
	}
	.legend-proj {
		border-top: 2px dotted var(--tone);
	}
</style>
