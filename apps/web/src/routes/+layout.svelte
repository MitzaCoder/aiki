<script lang="ts">
	import { clearPairFragment } from '#lib/pair-inbox.js';
	import PairingApproval from '#lib/components/PairingApproval.svelte';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { harness } from '#lib/harness.svelte.js';
	import { reportInteraction, startInteractionReporting } from '#lib/interaction.js';
	import { notifications } from '#lib/notifications.svelte.js';
	import { projectsNav } from '#lib/projects-nav.svelte.js';
	import { currentProject, projectSeenKey } from '#lib/projects.js';
	import { suggestedBackends } from '#lib/suggested-backends.svelte.js';
	import ProjectsSidebar from '#lib/components/ProjectsSidebar.svelte';
	import UsageModal from '#lib/components/usage/UsageModal.svelte';
	import { theme } from '#lib/themes/theme.svelte.js';
	import type { LayoutProps } from './$types';
	import '../app.css';

	let { children }: LayoutProps = $props();

	// Read the browser's backend list and sidebar state before children render; connected in onMount.
	clearPairFragment();
	harness.load();
	theme.load();
	projectsNav.load();

	/** The project this route shows, if any: its chat, settings or a worker's transcript. */
	const showing = $derived(currentProject(page.url.pathname));

	// A project on screen is read as it arrives: its latest reply is what this browser has seen.
	$effect(() => {
		const target = showing;
		if (target === undefined) return;
		const backend = harness.backend(target.backendId);
		const project = backend?.projects.find((entry) => entry.id === target.projectId);
		if (backend === undefined || project === undefined) return;
		projectsNav.markSeen(projectSeenKey(backend.id, project.id), project.activity);
	});

	// The drawer is a transient menu: following a link in it closes it.
	$effect(() => {
		const path = page.url.pathname;
		void path;
		projectsNav.closeDrawer();
	});

	/**
	 * Notifications on every backend: ask each one what it offers and register this device where it is missing. The
	 * signature makes the effect run when a backend connects (or its features arrive), not on every render.
	 */
	$effect(() => {
		const backends = harness.backends;
		const signature = backends
			.map((backend) => `${backend.id}:${backend.authSessionId ?? "anonymous"}:${backend.connection.status}:${(backend.features ?? []).length}`)
			.join('|');
		void signature;
		if (backends.some((backend) => backend.ready)) void notifications.sync(backends);
	});

	/**
	 * Presence: whether this page is visible, on connect, on every route change and on `visibilitychange` (below). A
	 * visible page makes the backend hold pushes for 15 s; a closed socket is forgotten on its side.
	 */
	$effect(() => {
		const path = page.url.pathname;
		const signature = harness.backends
			.map((backend) => `${backend.id}:${backend.ready ? 'ready' : 'away'}`)
			.join('|');
		const registered = Object.values(notifications.backends)
			.map((entry) => (entry.device === null ? '' : entry.backendId))
			.join(',');
		void signature;
		void registered;
		for (const backend of harness.backends) {
			if (!backend.ready) notifications.forgetPresence(backend.id);
		}
		if (harness.backends.some((backend) => backend.ready)) {
			void notifications.reportPresence(harness.backends, path);
		}
	});

	onMount(() => {
		if (page.url.pathname === '/pair') return;
		harness.start();
		void harness.discoverLocal();
		// The worker is what makes the app installable and what shows a push; registering it early keeps it current.
		void notifications.start();
		// The published list of backends beside the app: offered as one-tap adds, empty when the host publishes none.
		suggestedBackends.load();
		const onVisibility = (): void => {
			void notifications.reportPresence(harness.backends, page.url.pathname);
		};
		document.addEventListener('visibilitychange', onVisibility);
		// Using the app drops the notifications the backends are holding for it (throttled, see lib/interaction.ts).
		const stopInteraction = startInteractionReporting(window, () =>
			reportInteraction(harness.backends, notifications.deviceId)
		);
		return () => {
			document.removeEventListener('visibilitychange', onVisibility);
			stopInteraction();
		};
	});
</script>

{#if page.url.pathname === '/pair'}
	{@render children()}
{:else}
<div class="flex h-dvh w-full overflow-hidden">
	<ProjectsSidebar />
	<div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
		{@render children()}
	</div>
</div>
<UsageModal />
<PairingApproval />
{/if}
