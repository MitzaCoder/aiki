<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '#lib/utils.js';

	/**
	 * A titled surface that holds rows, divided by hairlines. It lifts off the page with a ring and a soft shadow;
	 * `danger` tints the edge for things that cannot be undone. `actions` sits on the title's right.
	 */
	let {
		title,
		description,
		tone = 'default',
		actions,
		class: className,
		children
	}: {
		title?: string;
		description?: string;
		tone?: 'default' | 'danger';
		actions?: Snippet;
		class?: string;
		children: Snippet;
	} = $props();
</script>

<section class="flex flex-col gap-2" data-settings-group>
	{#if title || actions}
		<div class="flex min-h-6 items-end gap-3 px-1">
			<div class="flex min-w-0 flex-1 flex-col">
				{#if title}
					<h3 class="text-[0.6875rem] font-semibold tracking-wide text-(--chat-fg-subtle) uppercase">{title}</h3>
				{/if}
				{#if description}
					<p class="text-[0.8125rem] leading-5 text-muted-foreground">{description}</p>
				{/if}
			</div>
			{@render actions?.()}
		</div>
	{/if}
	<div
		class={cn(
			'divide-y divide-(--chat-border) overflow-hidden rounded-2xl bg-card text-card-foreground ring-1 ring-foreground/10',
			'shadow-[0_1px_2px_0_rgb(0_0_0/0.04),0_8px_24px_-14px_rgb(0_0_0/0.22)]',
			tone === 'danger' && 'ring-destructive/30',
			className
		)}
	>
		{@render children()}
	</div>
</section>
