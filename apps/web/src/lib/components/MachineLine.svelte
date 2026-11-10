<script lang="ts">
	import HardDriveIcon from '@lucide/svelte/icons/hard-drive';
	import { serverDisks } from '@aiki/client';
	import type { ServerStatus } from '@aiki/protocol';
	import { diskLevelClass, diskView, diskWarning } from '#lib/server-status.js';
	import { cn } from '#lib/utils.js';

	/**
	 * A backend's machine in one line: free and total space per filesystem it reports, amber when tight and red when the
	 * server calls it low, with a short warning under it then. Nothing for an older server without disks.
	 */
	let { status, class: className }: { status: ServerStatus | null | undefined; class?: string } = $props();

	const disks = $derived(serverDisks(status).map(diskView));
	const warning = $derived(diskWarning(status));
</script>

{#if disks.length > 0}
	<div class={cn('flex min-w-0 flex-col gap-0.5', className)} data-machine>
		<p class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
			<span class="inline-flex items-center gap-1 font-medium text-foreground">
				<HardDriveIcon class="size-3.5" aria-hidden="true" />Machine
			</span>
			{#each disks as disk, index (disk.label + index)}
				{#if index > 0}<span aria-hidden="true">·</span>{/if}
				<span class={cn('tabular-nums', diskLevelClass(disk.level))} title={disk.title} data-disk={disk.level}>
					<span class="font-medium">{disk.label}</span>
					{disk.text}
				</span>
			{/each}
		</p>
		{#if warning}
			<p class="text-xs text-(--chat-danger)" role="status">
				{warning} Clean up finished workspaces in each project's settings.
			</p>
		{/if}
	</div>
{/if}
