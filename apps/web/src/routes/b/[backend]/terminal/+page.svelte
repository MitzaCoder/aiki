<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import TerminalPage from '#lib/components/terminal/TerminalPage.svelte';
	import { harness } from '#lib/harness.svelte.js';

	const backendId = $derived(page.params.backend ?? '');
	const backend = $derived(harness.backend(backendId));
	const projectId = $derived(page.url.searchParams.get('project') ?? undefined);
	const workerId = $derived(page.url.searchParams.get('worker') ?? undefined);
	const sessionName = $derived(page.url.searchParams.get('session') ?? undefined);

	// Load the stored backend list before the first render so a reload on this route does not flash "unknown backend".
	harness.load();

	onMount(() => {
		harness.start();
	});
</script>

<svelte:head>
	<title>Terminal · {backend?.name ?? backendId} · Kemiri</title>
</svelte:head>

{#if backend}
	<TerminalPage {backend} {projectId} {workerId} {sessionName} />
{:else}
	<main
		class="mx-auto flex w-full max-w-3xl flex-col gap-3 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-5"
	>
		<header class="flex items-center gap-2 pb-1">
			<div class="flex flex-1 flex-col gap-1">
				<h1 class="text-xl font-bold">Unknown backend</h1>
				<p class="text-sm text-muted-foreground">
					No backend with the ID "{backendId}" is configured in this browser.
				</p>
			</div>
		</header>
		<p><a class="underline" href="/">Back to projects</a></p>
	</main>
{/if}
