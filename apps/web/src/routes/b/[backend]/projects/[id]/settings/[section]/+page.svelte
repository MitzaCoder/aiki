<script lang="ts">
	import { page } from '$app/state';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import CoordinatorSection from '#lib/components/settings/CoordinatorSection.svelte';
	import NotFoundNote from '#lib/components/settings/NotFoundNote.svelte';
	import ProjectGeneralSection from '#lib/components/settings/ProjectGeneralSection.svelte';
	import PromptCacheSection from '#lib/components/settings/PromptCacheSection.svelte';
	import RedirectWhenWide from '#lib/components/settings/RedirectWhenWide.svelte';
	import TicketsSection from '#lib/components/settings/TicketsSection.svelte';
	import WorkersSection from '#lib/components/settings/WorkersSection.svelte';
	import SchedulesSection from '#lib/components/SchedulesSection.svelte';
	import StorageSection from '#lib/components/StorageSection.svelte';
	import { harness } from '#lib/harness.svelte.js';
	import { PROJECT_SECTIONS, projectSectionAvailable, projectSettingsHref } from '#lib/settings.js';

	/** One section of a project's settings, by the last URL segment. */
	const backend = $derived(harness.backend(page.params.backend ?? ''));
	const projectId = $derived(page.params.id ?? '');
	const section = $derived(page.params.section ?? '');
	const project = $derived(backend?.projects.find((entry) => entry.id === projectId));
	const known = $derived(PROJECT_SECTIONS.some((entry) => entry.id === section));
	const available = $derived(
		backend !== undefined &&
			PROJECT_SECTIONS.some(
				(entry) =>
					entry.id === section &&
					projectSectionAvailable(entry.id, {
						supports: (feature) => backend.supports(feature),
						links: project?.links !== undefined,
						longPromptCache: project?.longPromptCache !== undefined
					})
			)
	);
</script>

{#if backend !== undefined && project !== undefined}
	{#if !known}
		<RedirectWhenWide href={projectSettingsHref(backend.id, projectId, 'general')} />
	{:else if !available}
		<NotFoundNote title="Not available here">
			{backend.name} does not offer this section.
			<a class="underline" href={projectSettingsHref(backend.id, projectId)}>
				<ArrowLeftIcon class="inline size-3.5" aria-hidden="true" /> Settings
			</a>
		</NotFoundNote>
	{:else if section === 'general'}
		<ProjectGeneralSection {backend} {projectId} />
	{:else if section === 'coordinator'}
		<CoordinatorSection {backend} {projectId} />
	{:else if section === 'workers'}
		<WorkersSection {backend} {projectId} />
	{:else if section === 'schedules'}
		<SchedulesSection {backend} {projectId} />
	{:else if section === 'tickets'}
		<TicketsSection {backend} {projectId} />
	{:else if section === 'cache'}
		<PromptCacheSection {backend} {projectId} />
	{:else if section === 'storage'}
		<StorageSection {backend} {projectId} />
	{/if}
{/if}
