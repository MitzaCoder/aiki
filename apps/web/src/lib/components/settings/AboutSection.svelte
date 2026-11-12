<script lang="ts">
	import { harness, type BackendConnection } from '#lib/harness.svelte.js';
	import { backendVersion } from '#lib/aiki-version.js';
	import SettingsSection from './SettingsSection.svelte';
	import SettingsGroup from './SettingsGroup.svelte';
	let error = $state('');
	let saving = $state(false);
	async function dismiss(backend: BackendConnection, dismissVersion: string) {
		saving = true;
		error = '';
		try {
			const response = await backend.client.request({ type: 'server.updates.set', dismissVersion });
			if (response.type === 'server.updates.set' && backend.status) backend.status = { ...backend.status, updates: response.updates };
		} catch { error = 'Could not dismiss. Try again when connected.'; }
		finally { saving = false; }
	}
	async function setEnabled(backend: BackendConnection, enabled: boolean) {
		saving = true;
		error = '';
		try {
			const response = await backend.client.request({ type: 'server.updates.set', enabled });
			if (response.type === 'server.updates.set' && backend.status) backend.status = { ...backend.status, updates: response.updates };
		} catch { error = 'Could not save update checks. Try again when connected.'; }
		finally { saving = false; }
	}
</script>

<SettingsSection title="About" description="Aiki and updates for each backend, across all projects." icon="settings">
	{#each harness.backends as backend (backend.id)}
		{@const updates = backend.supports('release-updates') ? backend.status?.updates : undefined}
		<SettingsGroup title={backend.name}>
			<div class="flex flex-col gap-3 px-4 py-4 text-sm sm:px-5" data-release-update-about>
				<p>Aiki {backendVersion(backend.connection.server?.version, backend.status) ?? '—'}</p>
				{#if updates?.schemaVersion === 1}
					<p>{updates.installedVersion ? `Installed ${updates.installedVersion} · ${updates.channel} channel` : 'Source checkout · checks off by default'}</p>
					<label class="flex min-h-11 items-center gap-3">
						<input type="checkbox" checked={updates.enabled} disabled={saving} onchange={(event) => setEnabled(backend, event.currentTarget.checked)} />
						Check for Aiki updates
					</label>
					<p class="text-(--chat-fg-muted)">Checks public GitHub releases about once a day. Does not install or restart anything.</p>
					{#if updates.enabled && updates.available}
						<p>Aiki <strong>{updates.available.version}</strong> is available. <a class="underline" href={updates.available.notesUrl} target="_blank" rel="noopener noreferrer">Release notes</a></p>
						<p>Stop Aiki, then <code>aiki update</code>, then start it.</p>
						{#if updates.dismissedVersion !== updates.available.version}
							<button type="button" class="min-h-11 self-start underline" disabled={saving} onclick={() => dismiss(backend, updates.available!.version)}>Dismiss update notice</button>
						{:else}<p class="text-(--chat-fg-muted)">Update notice dismissed.</p>{/if}
					{:else if updates.enabled}<p>No newer release found yet.</p>{/if}
				{:else}<p>Update checks are not available on this backend.</p>{/if}
			</div>
		</SettingsGroup>
	{/each}
	{#if error}<p role="status">{error}</p>{/if}
</SettingsSection>
