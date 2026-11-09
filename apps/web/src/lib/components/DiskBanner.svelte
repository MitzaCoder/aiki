<script lang="ts">
	import type { ServerStatus } from '@mihai-harness/protocol';
	import Banner from '#lib/components/Banner.svelte';
	import { diskWarning } from '#lib/server-status.js';

	/** A small warning above the composer while the backend says a disk is low; the harness warns and never blocks. */
	let { status, settingsHref }: { status: ServerStatus | null | undefined; settingsHref?: string } = $props();

	const warning = $derived(diskWarning(status));
</script>

{#if warning}
	<Banner tone="warning" class="py-1.5 text-xs">
		<p data-disk-warning>
			{warning}
			{#if settingsHref}<a class="underline" href={settingsHref}>Clean up finished workspaces</a>{/if}
		</p>
	</Banner>
{/if}
