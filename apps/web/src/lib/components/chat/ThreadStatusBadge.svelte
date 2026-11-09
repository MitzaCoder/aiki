<script lang="ts">
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { threadStatusClass, threadStatusLabel } from '#lib/threads.js';
	import type { ThreadStatus } from '@mihai-harness/protocol';

	/** A background thread's status as a badge: a spinner while it works, red only when it failed. */
	let {
		status,
		class: className = ''
	}: {
		status: ThreadStatus;
		class?: string;
	} = $props();
</script>

<Badge variant="outline" class="{threadStatusClass(status)} {className}">
	{#if status === 'running'}
		<LoaderCircleIcon class="animate-spin" aria-hidden="true" />
	{/if}
	{threadStatusLabel(status)}
</Badge>
