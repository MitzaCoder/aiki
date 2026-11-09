<script lang="ts">
	import { page } from '$app/state';
	import BackendDetailSection from '#lib/components/settings/BackendDetailSection.svelte';
	import NotFoundNote from '#lib/components/settings/NotFoundNote.svelte';
	import { harness } from '#lib/harness.svelte.js';
	import { generalSettingsHref } from '#lib/settings.js';

	const backend = $derived(harness.backend(page.params.id ?? ''));
</script>

{#if backend}
	<BackendDetailSection {backend} />
{:else}
	<NotFoundNote title="Unknown backend">
		No backend with the ID "{page.params.id}" is in this browser.
		<a class="underline" href={generalSettingsHref('backends')}>Back to the backends</a>
	</NotFoundNote>
{/if}
