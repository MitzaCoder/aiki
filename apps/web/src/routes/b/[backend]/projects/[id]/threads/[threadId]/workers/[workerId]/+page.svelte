<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import WorkerTranscript from '#lib/components/WorkerTranscript.svelte';
	import { harness } from '#lib/harness.svelte.js';

	const backendId = $derived(page.params.backend ?? '');
	const projectId = $derived(page.params.id ?? '');
	const workerId = $derived(page.params.workerId ?? '');
	const threadId = $derived(page.params.threadId ?? '');
	const backend = $derived(harness.backend(backendId));

	// Load the stored backend list before the first render so a reload on this route does not flash "unknown backend".
	harness.load();

	onMount(() => {
		harness.start();
	});
</script>

<svelte:head>
	<title>Worker {workerId} · Kemiri</title>
</svelte:head>

{#if backend}
	<WorkerTranscript {backend} {projectId} {workerId} {threadId} />
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
