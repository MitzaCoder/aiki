<script lang="ts">
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import type { Snippet } from 'svelte';

	/**
	 * The longer explanation behind a one-line hint: a disclosure under the hint, never a tooltip, so it works on touch
	 * and with a keyboard. Closed by default.
	 */
	let { label = 'Learn more', children }: { label?: string; children: Snippet } = $props();

	let open = $state(false);
	const id = $props.id();
</script>

<div class="flex flex-col items-start gap-1.5">
	<button
		type="button"
		class="-ml-1 inline-flex min-h-6 items-center gap-0.5 rounded px-1 text-xs font-medium text-(--accent-2) hover:underline max-sm:-my-2 max-sm:min-h-11"
		aria-expanded={open}
		aria-controls={id}
		onclick={() => (open = !open)}
	>
		<ChevronRightIcon class="size-3.5 transition-transform motion-reduce:transition-none {open ? 'rotate-90' : ''}" aria-hidden="true" />
		{label}
	</button>
	{#if open}
		<div {id} class="max-w-prose rounded-lg bg-(--chat-surface-2)/60 px-3 py-2 text-xs leading-5 text-muted-foreground">
			{@render children()}
		</div>
	{/if}
</div>
