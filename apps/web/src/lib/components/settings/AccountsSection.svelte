<script lang="ts">
	import { onMount } from 'svelte';
	import Banner from '#lib/components/Banner.svelte';
	import Combobox from '#lib/components/settings/Combobox.svelte';
	import ProviderPanel from '#lib/components/settings/ProviderPanel.svelte';
	import SettingsGroup from '#lib/components/settings/SettingsGroup.svelte';
	import SettingsRow from '#lib/components/settings/SettingsRow.svelte';
	import SettingsSection from '#lib/components/settings/SettingsSection.svelte';
	import StatusChip from '#lib/components/settings/StatusChip.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import type { ComboOption } from '#lib/combobox.js';
	import type { BackendConnection } from '#lib/harness.svelte.js';
	import type { ProviderInfo } from '@mihai-harness/protocol';

	/**
	 * General → Backends → one backend → Accounts and API keys. Credentials belong to the backend that holds them, so
	 * they live here and not in a project. Providers that already work are listed with how (signed in, a key, the
	 * environment); the rest are one search away, so a long provider list stays short.
	 */
	let { backend }: { backend: BackendConnection } = $props();

	let expanded = $state<Record<string, boolean>>({});
	let adding = $state('');

	onMount(() => {
		void backend.ensureLoaded();
	});

	function how(provider: ProviderInfo): { label: string; tone: 'ok' | 'info' } {
		const stored = backend.credentials.find((credential) => credential.providerId === provider.id);
		if (stored?.type === 'oauth') return { label: 'Signed in', tone: 'ok' };
		if (stored?.type === 'api_key') return { label: 'API key', tone: 'ok' };
		return { label: 'From environment', tone: 'info' };
	}

	const inProgress = (provider: ProviderInfo): boolean =>
		backend.loginFor(provider.id) !== undefined || backend.finishedLoginFor(provider.id) !== undefined;

	const configured = $derived(backend.providers.filter((provider) => provider.configured));
	const others = $derived(backend.providers.filter((provider) => !provider.configured));
	const signingIn = $derived(others.filter((provider) => inProgress(provider) && provider.id !== adding));
	const addOptions = $derived<ComboOption[]>(
		others.map((provider) => ({
			value: provider.id,
			label: provider.name,
			description: provider.oauth ? `${provider.id} · ${provider.oauth.name}` : provider.id,
			keywords: provider.oauth?.name ?? '',
			...(provider.oauth?.isSubscription ? { badge: 'subscription' } : {})
		}))
	);
	const addProvider = $derived(others.find((provider) => provider.id === adding));
	const supported = $derived(backend.supports('credentials') || backend.supports('logins'));
</script>

<SettingsSection
	title="Accounts and API keys"
	description="Signed-in accounts and keys for {backend.name}. They stay on that backend."
	icon="key-round"
>
	{#snippet actions()}
		{#if backend.providers.length > 0}
			<StatusChip tone={configured.length > 0 ? 'ok' : 'warn'} class="mt-1.5 max-sm:hidden">
				{configured.length} of {backend.providers.length} ready
			</StatusChip>
		{/if}
	{/snippet}

	{#if backend.lastError}<Banner tone="error">{backend.lastError}</Banner>{/if}

	{#if !supported}
		<Banner tone="warning">This backend does not advertise accounts or API keys.</Banner>
	{:else if backend.providers.length === 0}
		<p class="text-sm text-muted-foreground" role="status">Loading providers…</p>
	{:else}
		{#if signingIn.length > 0}
			<SettingsGroup title="Signing in">
				{#each signingIn as provider (provider.id)}
					<SettingsRow label={provider.name} hint={provider.oauth?.name ?? provider.id} control="full">
						{#snippet below()}<ProviderPanel {backend} {provider} />{/snippet}
					</SettingsRow>
				{/each}
			</SettingsGroup>
		{/if}

		<SettingsGroup
			title="Ready to use"
			description={configured.length === 0 ? 'No provider has a credential yet; add one below.' : undefined}
		>
			{#each configured as provider (provider.id)}
				{@const state = how(provider)}
				{@const open = expanded[provider.id] === true || inProgress(provider)}
				<SettingsRow label={provider.name} hint={provider.oauth ? `${provider.id} · ${provider.oauth.name}` : provider.id} control="auto">
					<div class="flex flex-wrap items-center gap-2 sm:justify-end">
						<StatusChip tone={state.tone}>{state.label}</StatusChip>
						<Button
							variant="outline"
							class="max-sm:h-11"
							aria-expanded={open}
							onclick={() => (expanded[provider.id] = !open)}
						>
							{open ? 'Close' : 'Manage'}
						</Button>
					</div>
					{#snippet below()}
						{#if open}<ProviderPanel {backend} {provider} />{/if}
					{/snippet}
				</SettingsRow>
			{/each}
		</SettingsGroup>

		{#if others.length > 0}
			<SettingsGroup title="Add a provider">
				<SettingsRow label="Provider" hint="Pick one, then sign in or paste a key." for="add-provider">
					{#snippet learn()}
						Subscriptions sign in with OAuth. Open the link, finish signing in in your browser, then paste the code
						or the final redirect URL back here: the browser cannot reach the backend's localhost callback. A
						provider whose key is in the backend's environment already shows as ready.
					{/snippet}
					<Combobox
						id="add-provider"
						options={addOptions}
						value={adding}
						onchange={(next) => (adding = next)}
						placeholder="Choose a provider…"
						searchPlaceholder="Search providers…"
					/>
					{#snippet below()}
						{#if addProvider}<ProviderPanel {backend} provider={addProvider} />{/if}
					{/snippet}
				</SettingsRow>
			</SettingsGroup>
		{/if}
	{/if}
</SettingsSection>
