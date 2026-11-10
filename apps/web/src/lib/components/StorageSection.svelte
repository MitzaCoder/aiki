<script lang="ts">
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import { withoutRemoved, type ProjectStorage } from '@aiki/client';
	import type { StorageItem } from '@aiki/protocol';
	import Banner from '#lib/components/Banner.svelte';
	import SettingsGroup from '#lib/components/settings/SettingsGroup.svelte';
	import SettingsRow from '#lib/components/settings/SettingsRow.svelte';
	import SettingsSection from '#lib/components/settings/SettingsSection.svelte';
	import StatusChip from '#lib/components/settings/StatusChip.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import type { BackendConnection } from '#lib/harness.svelte.js';
	import { relativeTime } from '#lib/relative-time.js';
	import { cleanupNotice, cleanupSummary, storageKindLabel, storageSize, storageStateLabel } from '#lib/storage.js';

	/**
	 * Project settings' "Storage": what the project's worker and thread workspaces take on disk, largest first, with
	 * "Clean up finished" and a remove button per finished one. Both ask first; the project checkout is never touched.
	 * Only shown when the backend advertises the `storage` feature.
	 */
	let { backend, projectId }: { backend: BackendConnection; projectId: string } = $props();

	let storage = $state<ProjectStorage | undefined>(undefined);
	let loading = $state(false);
	let error = $state<string | undefined>(undefined);
	let notice = $state<{ tone: 'info' | 'warning'; text: string } | undefined>(undefined);
	let confirmOpen = $state(false);
	/** What the confirmation removes: every finished workspace, or one. */
	let target = $state<{ all: true } | { all: false; item: StorageItem } | undefined>(undefined);
	let cleaning = $state(false);
	let cleanError = $state<string | undefined>(undefined);

	const items = $derived(storage?.items ?? []);
	const summary = $derived(cleanupSummary(items));

	function errorText(cause: unknown): string {
		return cause instanceof Error ? cause.message : String(cause);
	}

	async function load(): Promise<void> {
		if (!backend.ready) return;
		loading = true;
		try {
			storage = await backend.client.readProjectStorage(projectId);
			error = undefined;
		} catch (cause) {
			error = errorText(cause);
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		void projectId;
		if (backend.ready) void load();
	});

	function ask(next: NonNullable<typeof target>): void {
		target = next;
		cleanError = undefined;
		confirmOpen = true;
	}

	async function clean(): Promise<void> {
		const chosen = target;
		if (chosen === undefined) return;
		cleaning = true;
		cleanError = undefined;
		try {
			const result = await backend.client.cleanProjectStorage(projectId, chosen.all ? undefined : [chosen.item.id]);
			if (storage !== undefined) storage = withoutRemoved(storage, result.removed);
			notice = cleanupNotice(result);
			confirmOpen = false;
			target = undefined;
			// Freed space shows on the machine line and lifts the chat's disk warning.
			if (backend.supports('server-status')) void backend.refreshServerStatus();
		} catch (cause) {
			cleanError = errorText(cause);
		} finally {
			cleaning = false;
		}
	}
</script>

<SettingsSection title="Storage" description="What this project's workspaces take on disk." icon="hard-drive">
	{#if error}<Banner tone="error">{error}</Banner>{/if}
	{#if notice}
		<Banner tone={notice.tone}><p data-storage-notice>{notice.text}</p></Banner>
	{/if}

	<SettingsGroup title="Disk use">
		<SettingsRow
			label={storage ? storageSize(storage.totalBytes) : loading ? 'Measuring…' : 'Not measured'}
			hint={storage
				? `${items.length === 1 ? '1 workspace' : `${items.length} workspaces`}, measured ${relativeTime(storage.measuredAt, Date.now())}.`
				: 'Worker and background-thread workspaces.'}
			control="auto"
		>
			{#snippet learn()}
				Worker workspaces and background-thread checkouts live in the backend's data folder and can grow large. Finished
				ones are safe to remove; the project's own checkout is never touched.
			{/snippet}
			<div class="flex flex-wrap items-center gap-2 sm:justify-end" data-storage-section>
				<span class="sr-only" data-storage-total>{storage ? storageSize(storage.totalBytes) : ''}</span>
				<Button variant="ghost" size="icon" class="max-sm:size-11" onclick={() => void load()} disabled={loading} aria-label="Measure again" title="Measure again">
					{#if loading}<Spinner />{:else}<RefreshCwIcon />{/if}
				</Button>
				<Button variant="outline" class="max-sm:h-11" disabled={summary.count === 0 || cleaning} onclick={() => ask({ all: true })}>
					<TrashIcon data-icon="inline-start" />Clean up finished
				</Button>
			</div>
		</SettingsRow>
	</SettingsGroup>

	{#if storage && items.length === 0}
		<SettingsGroup><p class="px-5 py-6 text-center text-sm text-muted-foreground">No worker or thread workspaces on disk.</p></SettingsGroup>
	{:else if items.length > 0}
		<SettingsGroup title="Workspaces, largest first">
			{#each items as item (item.id)}
				<div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 sm:px-5" data-storage-item={item.id}>
					<div class="flex min-w-0 flex-1 basis-48 flex-col gap-0.5">
						<p class="flex min-w-0 items-center gap-2 text-sm">
							<StatusChip tone="muted" dot={false} class="h-5 text-[0.6875rem]">{storageKindLabel(item.kind)}</StatusChip>
							<span class="min-w-0 truncate font-semibold" title={item.label}>{item.label}</span>
						</p>
						<p class="truncate font-mono text-[0.6875rem] text-muted-foreground" title={item.path}>{item.path}</p>
					</div>
					<span class="text-sm tabular-nums">{storageSize(item.bytes)}</span>
					<StatusChip tone={item.removable ? 'muted' : 'info'} class="h-5 text-[0.6875rem]">{storageStateLabel(item)}</StatusChip>
					<Button
						variant="ghost"
						size="icon"
						class="shrink-0 max-sm:size-11"
						disabled={!item.removable || cleaning}
						onclick={() => ask({ all: false, item })}
						aria-label="Remove {item.label}"
						title={item.removable ? 'Remove this workspace' : 'Still running; it cannot be removed'}
					>
						<TrashIcon />
					</Button>
				</div>
			{/each}
		</SettingsGroup>
	{/if}
</SettingsSection>

<Dialog.Root bind:open={confirmOpen}>
	<Dialog.Content class="sm:max-w-sm">
		<Dialog.Header>
			<Dialog.Title>
				{target?.all === false ? 'Remove this workspace?' : 'Clean up finished workspaces?'}
			</Dialog.Title>
			<Dialog.Description>
				{#if target?.all === false}
					{storageKindLabel(target.item.kind)} "{target.item.label}", {storageSize(target.item.bytes)}. Its folder is
					deleted; its transcript and reports stay.
				{:else}
					{summary.text}. Their folders are deleted; transcripts and reports stay.
				{/if}
			</Dialog.Description>
		</Dialog.Header>
		{#if cleanError}
			<div class="px-4 sm:px-6"><Banner tone="error">{cleanError}</Banner></div>
		{/if}
		<Dialog.Footer>
			<Dialog.Close>
				{#snippet child({ props })}
					<Button {...props} variant="outline" size="sm" type="button" disabled={cleaning}>Cancel</Button>
				{/snippet}
			</Dialog.Close>
			<Button variant="destructive" size="sm" type="button" disabled={cleaning} onclick={() => void clean()}>
				{#if cleaning}<Spinner data-icon="inline-start" />{/if}
				{target?.all === false ? 'Remove' : 'Clean up'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
