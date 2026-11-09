<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import RedirectWhenWide from '#lib/components/settings/RedirectWhenWide.svelte';
	import { projectSettingsHref } from '#lib/settings.js';

	/**
	 * `.../settings` is the list of sections on a phone and goes on to General on a wide screen. A schedule
	 * notification links here with `#schedule-<id>` (Android's route parser knows only `.../settings`), so that
	 * address goes straight to Scheduled tasks, on any screen, keeping the fragment.
	 */
	const backendId = $derived(page.params.backend ?? '');
	const projectId = $derived(page.params.id ?? '');
	const toSchedule = $derived(page.url.hash.startsWith('#schedule-'));

	$effect(() => {
		if (toSchedule) {
			void goto(`${projectSettingsHref(backendId, projectId, 'schedules')}${page.url.hash}`, { replaceState: true });
		}
	});
</script>

{#if !toSchedule}
	<RedirectWhenWide href={projectSettingsHref(backendId, projectId, 'general')} />
{/if}
