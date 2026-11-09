<script lang="ts">
	import { providerMark } from '#lib/subscription-usage.js';

	/** A provider's mark: a soft tile tinted with a theme accent and a simple glyph, never the provider's logo. */
	let { providerId, label, size = 40 }: { providerId: string; label: string; size?: number } = $props();

	const mark = $derived(providerMark(providerId, label));
</script>

<span
	class="mark relative grid shrink-0 place-items-center rounded-xl"
	style:width="{size}px"
	style:height="{size}px"
	style:--mark={mark.accent}
	aria-hidden="true"
>
	{#if mark.glyph === 'claude'}
		<svg viewBox="0 0 24 24" class="size-[58%]" fill="currentColor">
			{#each [0, 30, 60, 90, 120, 150] as deg (deg)}
				<rect x="11" y="2.5" width="2" height="19" rx="1" transform="rotate({deg} 12 12)" />
			{/each}
		</svg>
	{:else if mark.glyph === 'openai'}
		<svg viewBox="0 0 24 24" class="size-[60%]" fill="none" stroke="currentColor" stroke-width="1.8">
			{#each [0, 60, 120, 180, 240, 300] as deg (deg)}
				<ellipse cx="12" cy="7.6" rx="2.9" ry="4.6" transform="rotate({deg} 12 12)" />
			{/each}
		</svg>
	{:else}
		<span class="text-[0.95em] font-semibold">{mark.initial}</span>
	{/if}
</span>

<style>
	.mark {
		color: var(--mark);
		background:
			radial-gradient(circle at 30% 25%, color-mix(in oklab, var(--mark) 26%, transparent), transparent 70%),
			color-mix(in oklab, var(--mark) 12%, var(--chat-surface));
		box-shadow:
			inset 0 0 0 1px color-mix(in oklab, var(--mark) 28%, transparent),
			0 6px 18px -8px color-mix(in oklab, var(--mark) 60%, transparent);
	}
</style>
