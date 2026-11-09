<script lang="ts">
	import * as Alert from '#lib/components/ui/alert/index.js';
	import { cn } from '#lib/utils.js';
	import type { Snippet } from 'svelte';

	/** A page-level message: plain information, a warning, or an error. */
	let {
		tone = 'info',
		class: className,
		children
	}: {
		tone?: 'info' | 'warning' | 'error';
		class?: string;
		children: Snippet;
	} = $props();
</script>

<Alert.Root
	variant={tone === 'error' ? 'destructive' : 'default'}
	class={cn(
		'px-3 py-2 text-sm',
		tone === 'warning' &&
			'border-amber-500/40 bg-amber-50 text-amber-900 dark:border-amber-400/30 dark:bg-amber-950/40 dark:text-amber-200',
		className
	)}
>
	<!-- One child, so a banner's inline links stay in the sentence: the alert is a grid. -->
	<div class="min-w-0">{@render children()}</div>
</Alert.Root>
