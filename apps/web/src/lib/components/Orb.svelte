<script lang="ts">
	/** The mark: a softly spinning gradient orb that speeds up while working. */
	let { size = 28, active = false }: { size?: number; active?: boolean } = $props();
</script>

<span
	class="orb relative inline-block shrink-0 rounded-full"
	class:active
	style:width="{size}px"
	style:height="{size}px"
	aria-hidden="true"
>
	<span class="absolute inset-0 animate-orb rounded-full blur-[1px]"></span>
	<span class="glint absolute rounded-full"></span>
</span>

<style>
	.orb > span:first-child {
		background: conic-gradient(
			from 0deg,
			var(--accent-1),
			var(--accent-2),
			var(--accent-3),
			var(--accent-4),
			var(--accent-1)
		);
		animation-duration: 9s;
	}
	.orb.active > span:first-child {
		animation-duration: 1.6s;
		box-shadow: 0 0 18px -2px color-mix(in oklab, var(--accent-3) 70%, transparent);
	}
	.glint {
		inset: 18%;
		background: radial-gradient(circle at 35% 30%, rgb(255 255 255 / 0.85), transparent 60%);
		mix-blend-mode: soft-light;
	}
</style>
