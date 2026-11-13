<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import SettingsShell from '#lib/components/settings/SettingsShell.svelte';
	import type { SettingsNavItem } from '#lib/components/settings/SettingsNav.svelte';
	import { harness } from '#lib/harness.svelte.js';
	import { notifications } from '#lib/notifications.svelte.js';
	import { archivedProjects } from '#lib/projects.js';
	import {
		GENERAL_SECTIONS,
		generalSettingsHref,
		settingsLocation,
		settingsParentHref,
		backendSettingsHref
	} from '#lib/settings.js';
	import type { LayoutProps } from './$types';

	/** General settings: the frame (section list and content). Each section is a route under /settings. */
	let { children }: LayoutProps = $props();

	harness.load();
	onMount(() => harness.start());

	const location = $derived(settingsLocation(page.url.pathname));
	const activeId = $derived(location?.scope === 'general' ? location.section : undefined);
	const parentHref = $derived(settingsParentHref(page.url.pathname));

	const archivedCount = $derived(
		harness.backends.reduce((count, backend) => count + archivedProjects(backend.projects).length, 0)
	);
	const offline = $derived(harness.backends.filter((backend) => !backend.ready).length);

	const chips: Record<string, SettingsNavItem['chip']> = $derived({
		backends: offline > 0 ? { label: `${offline} offline`, tone: 'warn' } : undefined,
		notifications: notifications.enabled ? { label: 'On', tone: 'ok' } : { label: 'Off', tone: 'muted' },
		archived: archivedCount > 0 ? { label: String(archivedCount), tone: 'muted' } : undefined
	});

	const items = $derived<SettingsNavItem[]>(
		GENERAL_SECTIONS.map((section) => ({ ...section, href: generalSettingsHref(section.id), chip: chips[section.id] }))
	);

	/** What the phone's back button names: the screen it goes to. */
	const parentLabel = $derived.by(() => {
		if (parentHref === undefined) return undefined;
		if (parentHref === generalSettingsHref()) return 'Settings';
		if (parentHref === generalSettingsHref('backends')) return 'Backends';
		const backend = harness.backends.find((entry) => backendSettingsHref(entry.id) === parentHref);
		return backend?.name ?? 'Back';
	});
</script>

<svelte:head>
	<title>Settings · Kemiri</title>
</svelte:head>

<SettingsShell
	{items}
	{activeId}
	navLabel="Settings sections"
	leaveHref="/"
	leaveLabel="Projects"
	{parentHref}
	{parentLabel}
>
	{#snippet header()}
		<h1 class="text-2xl font-bold tracking-tight">Settings</h1>
		<p class="text-sm text-muted-foreground">This browser and its backends.</p>
	{/snippet}
	{@render children()}
</SettingsShell>
