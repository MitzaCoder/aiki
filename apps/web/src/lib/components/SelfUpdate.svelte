<script lang="ts">
	import type { BackendConnection } from '#lib/harness.svelte.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
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

<div class="flex min-w-0 flex-col gap-2" data-self-update>
	{#if busy}
		<p role="status" class="text-sm">{update?.message}</p>
		{#if update?.phase === 'waiting'}
			<div class="flex flex-wrap gap-2">
				<button class="min-h-11 rounded-lg border border-(--chat-border) px-3 text-sm" disabled={saving} onclick={() => request('cancel', update!.toVersion)}>Cancel</button>
				{#if update.restartAllowed}<button class="min-h-11 rounded-lg border border-(--chat-border) px-3 text-sm" disabled={saving} onclick={() => ask('force')}>Restart anyway</button>{/if}
			</div>
		{/if}
	{:else}
		{#if update && ['succeeded', 'rolled_back', 'failed', 'cancelled'].includes(update.phase)}<p role="status" class="text-sm">{update.message}</p>{/if}
		{#if available && update?.enabled}
			<button class="min-h-11 self-start rounded-lg bg-(--primary) px-3 text-sm font-medium text-(--primary-foreground)" disabled={saving || backend.connection.status !== 'ready'} onclick={() => ask('start')}>Update now</button>
		{:else if !compact && update?.disabledReason}<p class="text-sm text-(--chat-fg-muted)">{update.disabledReason}</p>{/if}
	{/if}
	{#if error}<p role="alert" class="text-sm">{error}</p>{/if}
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
		<a class="min-h-11 content-center text-sm underline" href={confirmedNotesUrl} target="_blank" rel="noopener noreferrer">Release notes</a>
		<Dialog.Footer>
			<button class="min-h-11 rounded-lg border border-(--chat-border) px-4" onclick={() => confirm = null}>Cancel</button>
			<button class="min-h-11 rounded-lg bg-(--primary) px-4 text-(--primary-foreground)" disabled={saving} onclick={() => request(confirm!, confirmedVersion)}>{confirm === 'force' ? 'Confirm restart' : 'Confirm update'}</button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
