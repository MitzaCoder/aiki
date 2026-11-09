<script lang="ts">
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { workerStatusClass, workerStatusLabel } from '#lib/workers.js';
	import type { WorkerStatus } from '@mihai-harness/protocol';

	/** A worker's status as a badge: a spinner while it runs, coloured in the theme's tokens. */
	let {
		status,
		class: className = ''
	}: {
		status: WorkerStatus;
		class?: string;
	} = $props();
</script>

<Badge variant="outline" class="{workerStatusClass(status)} {className}">
	{#if status === 'running'}
		<LoaderCircleIcon class="animate-spin" aria-hidden="true" />
	{/if}
	{workerStatusLabel(status)}
</Badge>
