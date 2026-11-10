<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import Banner from '#lib/components/Banner.svelte';
	import ConnectionBadge from '#lib/components/ConnectionBadge.svelte';
	import NotFoundNote from '#lib/components/settings/NotFoundNote.svelte';
	import SettingsShell from '#lib/components/settings/SettingsShell.svelte';
	import type { SettingsNavItem } from '#lib/components/settings/SettingsNav.svelte';
	import { projectHref } from '#lib/backends.js';
	import { harness } from '#lib/harness.svelte.js';
	import {
		PROJECT_SECTIONS,
		projectSectionAvailable,
		projectSettingsHref,
		settingsLocation,
		settingsParentHref
	} from '#lib/settings.js';
	import type { LayoutProps } from './$types';

	/** Project settings: the frame (section list and content) for one project. Each section is a route below. */
	let { children }: LayoutProps = $props();

	const backendId = $derived(page.params.backend ?? '');
	const projectId = $derived(page.params.id ?? '');
	const backend = $derived(harness.backend(backendId));
	const project = $derived(backend?.projects.find((entry) => entry.id === projectId));

	harness.load();
	onMount(() => {
		harness.start();
		void backend?.ensureLoaded();
	});

	const location = $derived(settingsLocation(page.url.pathname));
	const activeId = $derived(location?.scope === 'project' ? location.section : undefined);

	const items = $derived.by<SettingsNavItem[]>(() => {
		if (backend === undefined) return [];
		const has = {
			supports: (feature: string) => backend.supports(feature),
			links: project?.links !== undefined,
			longPromptCache: project?.longPromptCache !== undefined
		};
		return PROJECT_SECTIONS.filter((section) => projectSectionAvailable(section.id, has)).map((section) => ({
			...section,
			href: projectSettingsHref(backendId, projectId, section.id),
			chip:
				section.id === 'coordinator' && project !== undefined && project.coordinator.model === null
					? { label: 'No model', tone: 'warn' as const }
					: undefined
		}));
	});
</script>

<svelte:head>
	<title>Project settings · Aiki</title>
</svelte:head>

{#if backend === undefined}
	<main class="mx-auto flex w-full max-w-3xl flex-col gap-3 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-5">
		<NotFoundNote title="Unknown backend">
			No backend with the ID "{backendId}" is configured in this browser. <a class="underline" href="/">Back to projects</a>
		</NotFoundNote>
	</main>
{:else}
	<SettingsShell
		{items}
		{activeId}
		navLabel="Project settings sections"
		leaveHref={projectHref(backendId, projectId)}
		leaveLabel="Back to chat"
		parentHref={settingsParentHref(page.url.pathname)}
		parentLabel="{project?.name ?? 'Project'} settings"
	>
		{#snippet header()}
			<div class="flex items-start gap-2">
				<div class="flex min-w-0 flex-1 flex-col gap-0.5">
					<h1 class="text-2xl font-bold tracking-tight break-words">{project?.name ?? 'Project settings'}</h1>
					<p class="font-mono text-xs break-words text-muted-foreground">
						{backend.name}{project ? ` · ${project.path}` : ''}
					</p>
				</div>
				<ConnectionBadge {backend} />
			</div>
		{/snippet}

		<div class="flex flex-col gap-5">
			{#if backend.lastError}<Banner tone="error">{backend.lastError}</Banner>{/if}
			{#if project === undefined}
				<NotFoundNote title={backend.projectsLoaded ? 'This project is gone' : 'Loading project…'}>
					{#if backend.projectsLoaded}
						This project no longer exists on {backend.name}. <a class="underline" href="/">Back to projects</a>
					{:else}
						Waiting for {backend.name}.
					{/if}
				</NotFoundNote>
			{:else}
				{#if project.state === 'failed'}
					<Banner tone="error">{project.failure ?? 'The project failed to open.'}</Banner>
				{/if}
				{@render children()}
			{/if}
		</div>
	</SettingsShell>
{/if}
