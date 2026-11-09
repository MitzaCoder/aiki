<script lang="ts">
	import { goto } from '$app/navigation';
	import { MediaQuery } from 'svelte/reactivity';

	/**
	 * On the settings list: a wide screen shows a section beside the list, so it goes straight to the first one (the
	 * address is replaced, so Back does not bounce). A phone stays on the list. 48rem is the shell's split.
	 */
	let { href }: { href: string } = $props();
	const wide = new MediaQuery('(min-width: 48rem)');

	$effect(() => {
		if (wide.current) void goto(href, { replaceState: true });
	});
</script>
