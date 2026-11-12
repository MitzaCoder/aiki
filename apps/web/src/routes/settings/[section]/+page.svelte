<script lang="ts">
	import { page } from '$app/state';
	import AboutSection from '#lib/components/settings/AboutSection.svelte';
	import AppearanceSection from '#lib/components/settings/AppearanceSection.svelte';
	import ArchivedSection from '#lib/components/settings/ArchivedSection.svelte';
	import NotificationsSection from '#lib/components/settings/NotificationsSection.svelte';
	import RedirectWhenWide from '#lib/components/settings/RedirectWhenWide.svelte';
	import { generalSettingsHref } from '#lib/settings.js';

	const section = $derived(page.params.section);
</script>

{#if section === 'appearance'}
	<AppearanceSection />
{:else if section === 'about'}
	<AboutSection />
{:else if section === 'notifications'}
	<NotificationsSection />
{:else if section === 'archived'}
	<ArchivedSection />
{:else}
	<!-- Not a section: back to the list (a wide screen continues to the first section). -->
	<RedirectWhenWide href={generalSettingsHref('appearance')} />
{/if}
