<script lang="ts">
	import ArchiveIcon from '@lucide/svelte/icons/archive';
	import Banner from '#lib/components/Banner.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import type { BackendConnection } from '#lib/harness.svelte.js';

	/**
	 * Shown above the composer of a project the user archived: it still opens and works, but it is out of the lists and
	 * its schedules and event triggers are paused. Unarchive puts it back as it was.
	 */
	let { backend, projectId }: { backend: BackendConnection; projectId: string } = $props();

	let busy = $state(false);
	let error = $state<string | undefined>(undefined);

	async function unarchive(): Promise<void> {
		busy = true;
		error = undefined;
		try {
			await backend.configureProject(projectId, { archived: false });
		} catch (failure) {
			error = failure instanceof Error ? failure.message : String(failure);
		} finally {
			busy = false;
		}
	}
</script>

<Banner tone="warning">
	<div class="flex flex-wrap items-center gap-x-3 gap-y-2" data-archived-banner>
		<span class="flex min-w-0 flex-1 basis-48 items-center gap-2">
			<ArchiveIcon class="size-4 shrink-0" aria-hidden="true" />
			<span>
				<strong class="font-semibold">This project is archived.</strong>
				<span class="text-[0.8125rem]">Its schedules and triggers are paused and it is not in the project list.</span>
			</span>
		</span>
		<Button variant="outline" size="sm" type="button" class="shrink-0 bg-transparent" disabled={busy} onclick={() => void unarchive()}>
			{#if busy}<Spinner data-icon="inline-start" />{/if}
			Unarchive
		</Button>
	</div>
	{#if error}
		<p class="mt-1.5 text-[0.8125rem] break-words text-destructive" role="alert">{error}</p>
	{/if}
</Banner>
