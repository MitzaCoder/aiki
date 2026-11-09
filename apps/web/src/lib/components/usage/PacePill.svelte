<script lang="ts">
	import { PACE_TONE_COLOR, type PaceTone } from '#lib/subscription-usage.js';

	/** The pace's short title in its tone: a soft pill with a glowing dot. */
	let { tone, title }: { tone: PaceTone; title: string } = $props();
</script>

<span
	class="pill inline-flex w-fit items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium"
	style:--tone={PACE_TONE_COLOR[tone]}
>
	<span class="size-1.5 rounded-full bg-(--tone) shadow-[0_0_8px_var(--tone)]"></span>
	{title}
</span>

<style>
	.pill {
		color: color-mix(in oklab, var(--tone) 82%, var(--chat-fg));
		background: color-mix(in oklab, var(--tone) 13%, transparent);
		box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--tone) 26%, transparent);
	}
</style>
