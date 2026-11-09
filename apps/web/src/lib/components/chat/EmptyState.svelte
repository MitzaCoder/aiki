<script lang="ts">
	import Orb from '#lib/components/Orb.svelte';

	/** The transcript is empty: the mark, and what to do next. */
	let { title, subtitle }: { title: string; subtitle: string } = $props();
</script>

<div class="flex flex-1 flex-col items-center justify-center py-10 text-center">
	<div class="relative mb-6">
		<div class="aura absolute -inset-10 -z-10 rounded-full blur-3xl"></div>
		<Orb size={64} />
	</div>
	<h2 class="text-3xl font-semibold tracking-tight sm:text-4xl">
		<span class="text-gradient">{title}</span>
	</h2>
	<p class="mt-2 max-w-sm text-(--chat-fg-muted)">{subtitle}</p>
</div>

<style>
	.aura {
		background: conic-gradient(
			from 90deg,
			color-mix(in oklab, var(--accent-1) 35%, transparent),
			color-mix(in oklab, var(--accent-3) 30%, transparent),
			color-mix(in oklab, var(--accent-4) 25%, transparent),
			color-mix(in oklab, var(--accent-1) 35%, transparent)
		);
	}
</style>
