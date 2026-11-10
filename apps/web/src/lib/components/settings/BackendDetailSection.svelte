<script lang="ts">
	import DevicesSection from './DevicesSection.svelte';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import { goto } from '$app/navigation';
	import Banner from '#lib/components/Banner.svelte';
	import ConnectionBadge from '#lib/components/ConnectionBadge.svelte';
	import DeployBanner from '#lib/components/DeployBanner.svelte';
	import MachineLine from '#lib/components/MachineLine.svelte';
	import MemoryMaintenanceGroup from '#lib/components/settings/MemoryMaintenanceGroup.svelte';
	import ReleaseLine from '#lib/components/ReleaseLine.svelte';
	import SettingsGroup from '#lib/components/settings/SettingsGroup.svelte';
	import SettingsRow from '#lib/components/settings/SettingsRow.svelte';
	import SettingsSection from '#lib/components/settings/SettingsSection.svelte';
	import StatusChip from '#lib/components/settings/StatusChip.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import AutoInput from '#lib/components/settings/AutoInput.svelte';
	import CopyButton from '#lib/components/CopyButton.svelte';
	import { harness, type BackendConnection } from '#lib/harness.svelte.js';
	import { backendSettingsHref, generalSettingsHref } from '#lib/settings.js';

	/**
	 * General → Backends → one backend: its connection and release, its name (saved when you leave the field), where its
	 * accounts and API keys live, its memory maintenance, and removing it from this browser.
	 */
	let { backend }: { backend: BackendConnection } = $props();

	let confirmingRemove = $state(false);
	const ready = $derived(backend.providers.filter((provider) => provider.configured).length);

	async function remove(): Promise<void> {
		harness.removeBackend(backend.id);
		await goto(generalSettingsHref('backends'), { replaceState: true });
	}
</script>

<SettingsSection title={backend.name} description={backend.url} icon="server">
	{#snippet actions()}
		<span class="mt-1.5 max-sm:hidden"><ConnectionBadge {backend} /></span>
	{/snippet}

	{#if backend.lastError}<Banner tone="error">{backend.lastError}</Banner>{/if}
	{#if backend.connection.status !== 'ready'}
		<Banner tone="warning">
			{#if backend.connection.status === 'connecting' || backend.connection.status === 'reconnecting'}
				Connecting to {backend.name}…
			{:else}
				{backend.name} is offline.{backend.connection.error ? ` ${backend.connection.error}` : ''}
			{/if}
		</Banner>
	{/if}

	{#if backend.supports('server-status')}
		<DeployBanner status={backend.status} dismissed={harness.dismissedDeploys} ondismiss={(deploy) => harness.dismissDeploy(deploy)} />
		<SettingsGroup title="Status">
			<SettingsRow label="Release" hint="The commit this backend runs." control="full">
				<ReleaseLine release={backend.status?.release} deploy={backend.status?.deploy} />
			</SettingsRow>
			<SettingsRow label="Machine" hint="Disk space on the host." control="full">
				<MachineLine status={backend.status} />
			</SettingsRow>
		</SettingsGroup>
	{/if}

	<SettingsGroup title="This backend">
		<SettingsRow label="Name" hint="Only for you, in this browser." for="backend-name">
			<AutoInput id="backend-name" value={backend.name} commit={(next) => harness.renameBackend(backend.id, next)} />
		</SettingsRow>
		<SettingsRow label="Address" hint="Where the app connects." control="auto">
			<div class="flex min-w-0 items-center gap-1 sm:max-w-80">
				<code class="min-w-0 flex-1 rounded-lg bg-(--chat-surface-2)/60 px-2.5 py-1.5 font-mono text-xs break-all">{backend.url}</code>
				<CopyButton text={backend.url} label="Copy the address" />
			</div>
		</SettingsRow>
		{#if backend.supports('credentials') || backend.supports('logins')}
			<a
				href={backendSettingsHref(backend.id, 'accounts')}
				data-link="accounts"
				class="flex min-h-14 items-center gap-3 px-4 py-3 transition-colors hover:bg-(--chat-surface-2)/50 sm:px-5"
			>
				<span class="flex min-w-0 flex-1 flex-col">
					<span class="text-sm font-semibold">Accounts and API keys</span>
					<span class="text-[0.8125rem] text-muted-foreground">Sign in to a subscription or paste a key.</span>
				</span>
				{#if backend.providers.length > 0}
					<StatusChip tone={ready > 0 ? 'ok' : 'warn'}>{ready} of {backend.providers.length} ready</StatusChip>
				{/if}
				<ChevronRightIcon class="size-4 shrink-0 text-(--chat-fg-subtle)" aria-hidden="true" />
			</a>
		{/if}
	</SettingsGroup>

	{#if backend.supports('memory-maintenance')}
		<MemoryMaintenanceGroup {backend} />
	{/if}

	{#if backend.authBackendId || backend.connection.error?.includes('Pair') || backend.connection.error?.includes('signed out')}<DevicesSection {backend} />{/if}

	<SettingsGroup title="Remove" tone="danger">
		<SettingsRow
			label="Remove this backend"
			hint="Forgets it in this browser. Its projects and data stay on the server."
			control="auto"
		>
			{#if confirmingRemove}
				<div class="flex flex-wrap gap-2 sm:justify-end">
					<Button variant="outline" class="max-sm:h-11" onclick={() => (confirmingRemove = false)}>Keep it</Button>
					<Button variant="destructive" class="max-sm:h-11" onclick={() => void remove()}>Remove {backend.name}</Button>
				</div>
			{:else}
				<Button variant="destructive" class="max-sm:h-11" onclick={() => (confirmingRemove = true)}>Remove</Button>
			{/if}
		</SettingsRow>
	</SettingsGroup>
</SettingsSection>
