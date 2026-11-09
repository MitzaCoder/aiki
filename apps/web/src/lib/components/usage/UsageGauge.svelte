<script lang="ts">
	import { cubicOut } from 'svelte/easing';
	import { Tween, prefersReducedMotion } from 'svelte/motion';
	import CountUp from './CountUp.svelte';
	import { GAUGE_START_DEG, GAUGE_SWEEP_DEG, PACE_TONE_COLOR, arcPath, gaugeAngle, polar, type PaceTone } from '#lib/subscription-usage.js';

	/**
	 * A 270° gauge: the thick outer arc is the used share, the thin inner arc the share of the window that has passed, and
	 * a notch on the outer track marks where the even pace would be. Read together: an outer arc past the notch is ahead.
	 */
	let {
		usedPercent,
		elapsedShare,
		tone,
		size = 132,
		label = 'used'
	}: {
		usedPercent: number | null;
		elapsedShare: number | null;
		tone: PaceTone;
		size?: number;
		label?: string;
	} = $props();

	const uid = $props.id();
	const C = 60;
	const OUTER = 50;
	const INNER = 38;
	const track = arcPath(C, C, OUTER, GAUGE_START_DEG, GAUGE_START_DEG + GAUGE_SWEEP_DEG);
	const innerTrack = arcPath(C, C, INNER, GAUGE_START_DEG, GAUGE_START_DEG + GAUGE_SWEEP_DEG);

	const used = new Tween(0, { duration: 1100, easing: cubicOut });
	const time = new Tween(0, { duration: 1300, easing: cubicOut });
	$effect(() => {
		const duration = prefersReducedMotion.current ? 0 : undefined;
		void used.set(Math.min(1, Math.max(0, (usedPercent ?? 0) / 100)), duration === undefined ? {} : { duration });
		void time.set(elapsedShare ?? 0, duration === undefined ? {} : { duration });
	});

	const color = $derived(PACE_TONE_COLOR[tone]);
	const timeDot = $derived(polar(C, C, INNER, gaugeAngle(time.current)));
	const notchIn = $derived(polar(C, C, OUTER - 7.5, gaugeAngle(elapsedShare ?? 0)));
	const notchOut = $derived(polar(C, C, OUTER + 7.5, gaugeAngle(elapsedShare ?? 0)));
</script>

<div class="relative shrink-0" style:width="{size}px" style:height="{size}px" style:--tone={color}>
	<svg viewBox="0 0 120 120" class="size-full overflow-visible" role="img" aria-label={usedPercent === null ? 'Usage unknown' : `${Math.round(usedPercent)}% used${elapsedShare === null ? '' : `, ${Math.round(elapsedShare * 100)}% of the window passed`}`}>
		<defs>
			<linearGradient id="{uid}-g" x1="0" y1="1" x2="1" y2="0">
				{#if tone === 'calm'}
					<stop offset="0" stop-color="var(--accent-1)" />
					<stop offset="0.55" stop-color="var(--accent-2)" />
					<stop offset="1" stop-color="var(--accent-3)" />
				{:else}
					<stop offset="0" stop-color="color-mix(in oklab, var(--tone) 55%, var(--accent-2))" />
					<stop offset="1" stop-color="var(--tone)" />
				{/if}
			</linearGradient>
		</defs>
		<path d={track} pathLength="100" fill="none" stroke="var(--chat-surface-2)" stroke-width="9" stroke-linecap="round" />
		{#if usedPercent !== null && used.current > 0.001}
			<path
				class="glow"
				d={track}
				pathLength="100"
				fill="none"
				stroke="url(#{uid}-g)"
				stroke-width="9"
				stroke-linecap="round"
				stroke-dasharray="{used.current * 100} 100"
			/>
		{/if}
		<path d={innerTrack} fill="none" stroke="var(--chat-border)" stroke-width="2.5" stroke-linecap="round" pathLength="100" />
		{#if elapsedShare !== null}
			<path
				d={innerTrack}
				pathLength="100"
				fill="none"
				stroke="var(--chat-fg-muted)"
				stroke-width="2.5"
				stroke-linecap="round"
				stroke-dasharray="{time.current * 100} 100"
				opacity="0.75"
			/>
			<circle cx={timeDot.x} cy={timeDot.y} r="3.2" fill="var(--chat-bg)" stroke="var(--chat-fg-muted)" stroke-width="1.8" />
			<line x1={notchIn.x} y1={notchIn.y} x2={notchOut.x} y2={notchOut.y} stroke="var(--chat-fg)" stroke-width="1.6" stroke-linecap="round" opacity="0.55" />
		{/if}
	</svg>
	<div class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
		<span class="text-[1.65em] leading-none font-semibold tracking-tight tabular-nums" style:font-size="{size * 0.2}px">
			{#if usedPercent === null}
				—
			{:else}
				<CountUp value={usedPercent} /><span class="text-[0.55em] font-medium text-(--chat-fg-muted)">%</span>
			{/if}
		</span>
		<span class="mt-1 text-[0.6875rem] text-(--chat-fg-subtle)">{label}</span>
	</div>
	{#if elapsedShare !== null}
		<span
			class="pointer-events-none absolute inset-x-0 bottom-0 text-center text-[0.625rem] leading-none text-(--chat-fg-subtle) tabular-nums"
			title="How much of the window has passed"
		>
			<CountUp value={elapsedShare * 100} />% of time
		</span>
	{/if}
</div>

<style>
	.glow {
		filter: drop-shadow(0 0 5px color-mix(in oklab, var(--tone) 45%, transparent));
	}
</style>
