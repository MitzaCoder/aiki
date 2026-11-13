<script lang="ts">
	import type { BackendConnection } from '#lib/harness.svelte.js';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';

	/**
	 * A backend's self-update: one primary "Update now" while a release waits, quiet text buttons for anything that
	 * only interrupts or backs out (Cancel, Restart anyway, Release notes), and a confirm dialog that states the exact
	 * release pair. Nothing here is large: the sidebar spot and About both have little room.
	 */
	let { backend, compact = false }: { backend: BackendConnection; compact?: boolean } = $props();
	let confirm = $state<'start' | 'force' | null>(null);
	let saving = $state(false);
	let error = $state('');
	let confirmedVersion = $state('');
	let confirmedFromVersion = $state('');
	let confirmedNotesUrl = $state('');
	const update = $derived(backend.status?.selfUpdate);
	const available = $derived(backend.status?.updates?.available);
	const busy = $derived(update && ['preparing', 'waiting', 'restarting', 'checking'].includes(update.phase));
	function ask(action: 'start' | 'force') {
		confirmedVersion = action === 'start' ? available?.version ?? '' : update?.toVersion ?? '';
		confirmedFromVersion = backend.status?.updates?.installedVersion ?? update?.fromVersion ?? '';
		confirmedNotesUrl = (action === 'start' ? available?.notesUrl : update?.notesUrl) ?? '';
		confirm = action;
	}
	async function request(action: 'start' | 'cancel' | 'force', version: string) {
		saving = true; error = ''; confirm = null;
		try {
			const response = await backend.client.request({ type: 'server.update', action, version });
			if (response.type === 'server.update' && backend.status) backend.status = { ...backend.status, selfUpdate: response.selfUpdate };
		} catch (cause) { error = cause instanceof Error ? cause.message : 'Could not request update. Reconnect and try again.'; }
		finally { saving = false; }
	}
</script>

<div class="flex min-w-0 flex-col gap-1.5" data-self-update>
	{#if busy}
		<p role="status" class="text-xs text-(--chat-fg-muted)">{update?.message}</p>
		{#if update?.phase === 'waiting'}
			<div class="flex flex-wrap items-center gap-1">
				<Button variant="ghost" size="xs" disabled={saving} onclick={() => request('cancel', update!.toVersion)} data-update-action="cancel">Cancel</Button>
				{#if update.restartAllowed}
					<Button variant="ghost" size="xs" class="text-amber-700 dark:text-amber-300" disabled={saving} onclick={() => ask('force')} title="Restart now and interrupt the running commands" data-update-action="force">Restart anyway</Button>
				{/if}
			</div>
		{/if}
	{:else}
		{#if update && ['succeeded', 'rolled_back', 'failed', 'cancelled'].includes(update.phase)}<p role="status" class="text-xs text-(--chat-fg-muted)">{update.message}</p>{/if}
		{#if available && update?.enabled}
			<Button size="sm" class="self-start" disabled={saving || backend.connection.status !== 'ready'} onclick={() => ask('start')} data-update-action="start">Update now</Button>
		{:else if !compact && update?.disabledReason}<p class="text-xs text-(--chat-fg-muted)">{update.disabledReason}</p>{/if}
	{/if}
	{#if error}<p role="alert" class="text-xs text-(--chat-danger)">{error}</p>{/if}
</div>

<Dialog.Root open={confirm !== null} onOpenChange={(open) => { if (!open) confirm = null; }}>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>{confirm === 'force' ? 'Interrupt running commands?' : 'Update Aiki?'}</Dialog.Title>
			<Dialog.Description>
				{backend.name}: {confirmedFromVersion} → {confirmedVersion}
			</Dialog.Description>
		</Dialog.Header>
		<p class="text-sm">{confirm === 'force' ? 'Running commands will be interrupted and may not be safe to retry. Restart anyway?' : 'The release will be verified, then Aiki holds new tool calls and waits only for running commands before restarting. Your clients reconnect automatically.'}</p>
		<p class="text-sm">If the new release is not healthy within 30 seconds, Aiki restores the old code. This does not undo data migrations. Back up important data first.</p>
		<Button variant="ghost" size="sm" class="self-start" href={confirmedNotesUrl} target="_blank" rel="noopener noreferrer">
			<ExternalLinkIcon data-icon="inline-start" />
			Release notes
		</Button>
		<Dialog.Footer>
			<Button variant="ghost" size="sm" onclick={() => confirm = null} data-update-confirm="cancel">Cancel</Button>
			<Button size="sm" disabled={saving} onclick={() => request(confirm!, confirmedVersion)} data-update-confirm="accept">{confirm === 'force' ? 'Confirm restart' : 'Confirm update'}</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
