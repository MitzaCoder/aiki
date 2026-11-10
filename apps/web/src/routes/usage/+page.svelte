<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { usageModal } from '#lib/usage-modal.svelte.js';

	// Old links and bookmarks: the usage modal opens over the home page. The dialog is mounted by the layout after this
	// page, and opening it in the same flush as its mount shows nothing, so wait a tick.
	onMount(() => {
		void tick().then(() => {
			usageModal.open = true;
			void goto('/', { replaceState: true });
		});
	});
</script>

<svelte:head>
	<title>Usage · Aiki</title>
</svelte:head>
