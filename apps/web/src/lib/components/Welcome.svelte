<script lang="ts">
	import { goto } from '$app/navigation';
	import FolderPicker from '#lib/components/FolderPicker.svelte';
	import AccountsSection from '#lib/components/settings/AccountsSection.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import { projectSettingsHref } from '#lib/settings.js';
	import type { BackendConnection } from '#lib/harness.svelte.js';

	let { backend }: { backend: BackendConnection } = $props();
	let showAccounts = $state(false);
	let showPicker = $state(false);
	const configured = $derived(backend.providers.some((provider) => provider.configured));

	async function addFolder(path: string): Promise<void> {
		const project = await backend.addProject(path);
		showPicker = false;
		await goto(projectSettingsHref(backend.id, project.id, 'coordinator'));
	}
</script>

<svelte:head><title>Welcome · Aiki</title></svelte:head>

<section class="flex flex-col gap-5 py-5 sm:py-10" aria-labelledby="welcome-title">
	<header class="flex flex-col gap-2">
		<p class="text-sm font-medium text-primary">Your computer. Your projects.</p>
		<h1 id="welcome-title" class="text-3xl font-bold tracking-tight">Welcome to Aiki</h1>
		<p class="max-w-lg text-muted-foreground">Connect a provider, then choose a project folder. Everything runs on this computer.</p>
	</header>

	<Card.Root>
		<Card.Header>
			<Card.Title>1. Connect a provider</Card.Title>
			<Card.Description>Use your own account or a paid API key. Credentials stay on this computer.</Card.Description>
		</Card.Header>
		<Card.Content class="flex flex-col items-start gap-3">
			{#if configured}
				<p class="text-sm text-emerald-700 dark:text-emerald-300" role="status">Provider ready. Choose your first project below.</p>
			{:else}
				<Button onclick={() => (showAccounts = !showAccounts)} aria-expanded={showAccounts}>
					{showAccounts ? 'Close accounts' : 'Sign in or add an API key'}
				</Button>
				<p class="text-xs text-muted-foreground">Subscription access depends on your provider’s terms. No Claude Code or Codex CLI needed.</p>
			{/if}
		</Card.Content>
	</Card.Root>

	{#if showAccounts && !configured}<AccountsSection {backend} />{/if}

	<Card.Root>
		<Card.Header>
			<Card.Title>2. Pick your first project</Card.Title>
			<Card.Description>A project is a folder on this computer. You’ll choose its coordinator model next.</Card.Description>
		</Card.Header>
		<Card.Content>
			<Button disabled={!configured} onclick={() => (showPicker = true)}>Choose a project folder</Button>
		</Card.Content>
	</Card.Root>
	<p class="text-xs text-muted-foreground">Local access only. Phone pairing is coming separately; don’t expose this server to the network.</p>
</section>

{#if showPicker}
	<FolderPicker {backend} open={true} onclose={() => (showPicker = false)} onadd={addFolder} />
{/if}
