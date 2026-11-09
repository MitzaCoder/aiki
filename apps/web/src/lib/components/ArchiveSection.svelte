<script lang="ts">
	import ArchiveIcon from '@lucide/svelte/icons/archive';
	import ArchiveRestoreIcon from '@lucide/svelte/icons/archive-restore';
	import Banner from '#lib/components/Banner.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import SettingsGroup from '#lib/components/settings/SettingsGroup.svelte';
	import SettingsRow from '#lib/components/settings/SettingsRow.svelte';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import { projectHref } from '#lib/backends.js';
	import type { BackendConnection } from '#lib/harness.svelte.js';
	import { isArchived } from '#lib/projects.js';

	/**
	 * Project settings' "Archive project": hide the project from the project lists and pause its schedules and event
	 * triggers, keeping everything else. A confirmation says exactly that; the backend refuses while workers or
	 * background threads run and its message (which names them) is shown in the dialog. Only shown on a backend with the
	 * `project-archive` feature. An archived project shows the same card with Unarchive.
	 */
	let { backend, projectId }: { backend: BackendConnection; projectId: string } = $props();

	const project = $derived(backend.projects.find((entry) => entry.id === projectId));
	const archived = $derived(project !== undefined && isArchived(project));

	let confirming = $state(false);
	let busy = $state(false);
	let error = $state<string | undefined>(undefined);

	function ask(): void {
		error = undefined;
		confirming = true;
	}

	async function set(value: boolean): Promise<void> {
		busy = true;
		error = undefined;
		try {
			await backend.configureProject(projectId, { archived: value });
			confirming = false;
		} catch (failure) {
			error = failure instanceof Error ? failure.message : String(failure);
		} finally {
			busy = false;
		}
	}
</script>

<SettingsGroup title="Archive">
	<SettingsRow
		label={archived ? 'This project is archived' : 'Archive this project'}
		hint={archived ? 'Hidden from the project list; schedules and triggers are paused.' : 'Hide it and pause its schedules. Nothing is deleted.'}
		control="auto"
	>
		{#snippet learn()}
			{#if archived}
				It is not in the project list and its scheduled tasks and event triggers are paused. Unarchive it to put it
				back as it was.
			{:else}
				The project leaves the project list and its schedules and event triggers stop firing and stay as they are.
				Conversations, board, memory and artifacts stay, and you can unarchive it from Settings → Archived projects.
			{/if}
		{/snippet}
		{#if archived}
			<Button variant="outline" class="max-sm:h-11" disabled={busy} onclick={() => void set(false)}>
				{#if busy}<Spinner data-icon="inline-start" />{:else}<ArchiveRestoreIcon data-icon="inline-start" />{/if}
				Unarchive
			</Button>
		{:else}
			<Button variant="outline" class="max-sm:h-11" onclick={ask}>
				<ArchiveIcon data-icon="inline-start" /> Archive
			</Button>
		{/if}
		{#snippet below()}
			{#if archived && error}<Banner tone="error">{error}</Banner>{/if}
		{/snippet}
	</SettingsRow>
</SettingsGroup>

<Dialog.Root bind:open={confirming}>
	<Dialog.Content class="sm:max-w-sm">
		<Dialog.Header>
			<Dialog.Title>Archive {project?.name ?? 'this project'}?</Dialog.Title>
			<Dialog.Description>
				It leaves the project list, and its scheduled tasks and event triggers stop firing and stay as they are. Nothing
				is deleted. You can unarchive it from the Archived list. Its address still opens it.
			</Dialog.Description>
		</Dialog.Header>
		{#if error}
			<div class="px-4 sm:px-6"><Banner tone="error">{error}</Banner></div>
		{/if}
		<Dialog.Footer>
			<Dialog.Close>
				{#snippet child({ props })}
					<Button {...props} variant="outline" size="sm" type="button" disabled={busy}>Cancel</Button>
				{/snippet}
			</Dialog.Close>
			<Button size="sm" type="button" disabled={busy} onclick={() => void set(true)}>
				{#if busy}<Spinner data-icon="inline-start" />{/if}
				Archive
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
