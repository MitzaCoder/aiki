<script lang="ts">
	import { overlayScroll } from '#lib/scrollbars.js';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Banner from '#lib/components/Banner.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import { decodeConnectHash } from '#lib/connect.js';
	import { harness } from '#lib/harness.svelte.js';

	/**
	 * A connect link's landing page: what the link carries, before anything is added. The list is in the fragment, so it
	 * is read here, never sent anywhere; confirming adds the backends this browser does not have and opens the projects.
	 */
	const decoded = $derived(decodeConnectHash(page.url.hash));
	const offered = $derived(decoded.ok ? decoded.backends : []);
	const missing = $derived(
		offered.filter((entry) => !harness.backends.some((backend) => backend.url === entry.url)),
	);

	let error = $state<string | undefined>(undefined);
	let busy = $state(false);

	async function confirm(): Promise<void> {
		busy = true;
		error = undefined;
		for (const entry of missing) {
			// A URL already added is skipped, never duplicated.
			if (harness.backends.some((backend) => backend.url === entry.url)) continue;
			try {
				harness.addBackend(entry.name, entry.url);
			} catch (value) {
				error = value instanceof Error ? value.message : String(value);
			}
		}
		busy = false;
		if (error === undefined) await goto('/', { replaceState: true });
	}
</script>

<svelte:head>
	<title>Connect · Aiki</title>
</svelte:head>

<div class="relative mx-auto h-full w-full max-w-xl">
<main
	use:overlayScroll={'parent'}
	class="flex h-full w-full flex-col gap-3 overflow-y-auto px-3 *:shrink-0 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-5"
>
	<Card.Root>
		<Card.Header>
			<Card.Title>{decoded.ok ? 'Import backend addresses' : 'This link cannot be used'}</Card.Title>
			<Card.Description>
				{#if decoded.ok}
					This import-only link carries {offered.length === 1 ? 'a backend address' : `${offered.length} backend addresses`}, not access credentials. Backends that require sign-in still need a separate pairing link.
				{:else}
					{decoded.reason} Ask for a fresh link from the Backends page of a device that is already set up.
				{/if}
			</Card.Description>
		</Card.Header>

		<Card.Content class="flex flex-col gap-3">
			{#if decoded.ok}
				<div class="flex flex-col gap-2">
					{#each offered as entry (entry.url)}
						<div class="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2">
							<div class="flex min-w-0 flex-1 flex-col">
								<span class="font-medium" data-testid="connect-backend-name">{entry.name}</span>
								<span class="font-mono text-xs break-words text-muted-foreground">{entry.url}</span>
							</div>
							{#if !missing.some((candidate) => candidate.url === entry.url)}
								<span class="text-xs text-muted-foreground">Already added</span>
							{/if}
						</div>
					{/each}
				</div>

				{#if error}
					<Banner tone="error">{error}</Banner>
				{/if}

				<div class="flex flex-wrap items-center gap-2">
					<Button type="button" disabled={busy} onclick={() => void confirm()}>
						{busy
							? 'Adding…'
							: missing.length === 0
								? 'Open the projects'
								: `Add ${missing.length === 1 ? 'this backend' : `${missing.length} backends`}`}
					</Button>
					<Button variant="outline" type="button" href="/">Cancel</Button>
				</div>
			{:else}
				<div>
					<Button href="/">Go to the backends</Button>
				</div>
			{/if}
		</Card.Content>
	</Card.Root>
</main>
</div>
