<script lang="ts">
	import { overlayScroll } from '#lib/scrollbars.js';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import { onMount } from 'svelte';
	import BackendForm from '#lib/components/BackendForm.svelte';
	import Banner from '#lib/components/Banner.svelte';
	import ConnectionBadge from '#lib/components/ConnectionBadge.svelte';
	import DeployBanner from '#lib/components/DeployBanner.svelte';
	import FolderPicker from '#lib/components/FolderPicker.svelte';
	import ProjectsMenuButton from '#lib/components/ProjectsMenuButton.svelte';
	import SuggestedBackends from '#lib/components/SuggestedBackends.svelte';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import { projectHref } from '#lib/backends.js';
	import { backendSettingsHref, generalSettingsHref, projectSettingsHref } from '#lib/settings.js';
	import { harness, modelLabel, type BackendConnection } from '#lib/harness.svelte.js';
	import { activeProjects, archivedProjects } from '#lib/projects.js';
	import { missingPublished } from '#lib/published-backends.js';
	import { suggestedBackends } from '#lib/suggested-backends.svelte.js';

	/** The published backends this browser does not have yet: offered on the first run and on this page. */
	const suggested = $derived(missingPublished(suggestedBackends.backends, harness.backends.map(({ url }) => url)));

	let pickerBackend = $state<BackendConnection | undefined>(undefined);
	onMount(() => {
		harness.start();
		// The machine line should say how full the disks are now, not when the app connected.
		for (const backend of harness.backends) {
			if (backend.ready && backend.supports('server-status')) void backend.refreshServerStatus();
		}
	});

	function openPicker(backend: BackendConnection): void {
		// The picker marks folders that are already projects, so its list must be current.
		void backend.refreshProjects();
		pickerBackend = backend;
	}

	async function addFolder(path: string): Promise<void> {
		const backend = pickerBackend;
		if (backend === undefined) return;
		await backend.addProject(path);
	}

	function addBackend(input: { name: string; url: string }): void {
		harness.addBackend(input.name, input.url);
	}
</script>

<svelte:head>
	<title>Projects · aiki</title>
</svelte:head>

<div class="relative mx-auto h-full w-full max-w-3xl">
<main
	use:overlayScroll={'parent'}
	class="flex h-full w-full flex-col gap-3 overflow-y-auto px-3 *:shrink-0 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-5"
>
	<header class="flex items-start gap-2 pb-1">
		<ProjectsMenuButton />
		<div class="flex flex-1 flex-col gap-1">
			<h1 class="text-xl font-bold">Projects</h1>
			<p class="text-sm text-muted-foreground">
				Every backend's projects, together in the sidebar. Backends and themes live in
				<a class="underline" href={generalSettingsHref()}>Settings</a>.
			</p>
		</div>
	</header>

	{#if harness.backends.length === 0}
		{#if suggested.length > 0}
			<Card.Root>
				<Card.Header>
					<Card.Title>Suggested backends</Card.Title>
					<Card.Description>
						Published beside the app. One tap adds a backend and connects to it; this browser's list stays local.
					</Card.Description>
				</Card.Header>
				<Card.Content>
					<SuggestedBackends backends={suggested} />
				</Card.Content>
			</Card.Root>
		{/if}
		<Card.Root>
			<Card.Header>
				<Card.Title>Add your first backend</Card.Title>
				<Card.Description>
					A backend is a harness server, reached over HTTPS. The app opens <code class="font-mono"
						>wss://&lt;url&gt;/ws</code
					>
					and keeps one connection per backend. Backends are stored in this browser.
				</Card.Description>
			</Card.Header>
			<Card.Content>
				<BackendForm onsubmit={addBackend} />
			</Card.Content>
		</Card.Root>
	{:else}
		{#each harness.backends as backend (backend.id)}
			<Card.Root>
				<Card.Header class="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-start">
					<div class="flex w-full min-w-0 flex-1 flex-col gap-1">
						<Card.Title>{backend.name}</Card.Title>
						<p class="font-mono text-xs break-words text-muted-foreground">{backend.url}</p>
					</div>
					<div class="flex flex-wrap items-center gap-2">
						<ConnectionBadge {backend} />
						<Button variant="outline" size="sm" type="button" href={backendSettingsHref(backend.id)}>
							Backend settings
						</Button>
					</div>
				</Card.Header>

				<Card.Content class="flex flex-col gap-3">
					{#if backend.supports('server-status')}
						<DeployBanner
							status={backend.status}
							dismissed={harness.dismissedDeploys}
							ondismiss={(deploy) => harness.dismissDeploy(deploy)}
						/>
					{/if}

					{#if backend.lastError}
						<Banner tone="error">{backend.lastError}</Banner>
					{/if}

					{#if backend.connection.status !== 'ready'}
						<Banner tone="warning">
							{#if backend.connection.status === 'connecting' || backend.connection.status === 'reconnecting'}
								Connecting to {backend.name}…
							{:else}
								{backend.name} is offline.{backend.connection.error ? ` ${backend.connection.error}` : ''}
							{/if}
						</Banner>
					{/if}

					{#if !backend.supports('projects')}
						<p class="text-muted-foreground">This backend does not advertise projects.</p>
					{:else}
						{@const projects = activeProjects(backend.projects)}
						{#if projects.length === 0}
							{#if backend.projectsLoaded && archivedProjects(backend.projects).length > 0}
								<p class="text-muted-foreground">
									No projects here, only <a class="underline" href={generalSettingsHref('archived')}>archived ones</a>.
								</p>
							{:else if backend.projectsLoaded}
								<p class="text-muted-foreground">No projects on this backend yet.</p>
							{:else if backend.ready}
								<p class="text-muted-foreground">Loading projects…</p>
							{/if}
						{:else}
							<div class="flex flex-col gap-2">
								{#each projects as project (project.id)}
									<Card.Root size="sm" class="bg-muted/40">
										<Card.Content class="flex flex-col gap-2">
											<div class="flex flex-wrap items-start gap-2">
												<div class="flex min-w-0 flex-1 flex-col gap-1">
													<h3 class="text-base font-semibold">
														<a class="hover:underline" href={projectHref(backend.id, project.id)}
															>{project.name}</a
														>
													</h3>
													<p class="font-mono text-xs break-words text-muted-foreground">{project.path}</p>
												</div>
												<Badge
													variant="outline"
													class={project.state === 'open'
														? 'border-emerald-600/40 text-emerald-700 dark:border-emerald-400/40 dark:text-emerald-300'
														: project.state === 'failed'
															? 'border-destructive/40 text-destructive'
															: 'border-amber-600/40 text-amber-700 dark:border-amber-400/40 dark:text-amber-300'}
												>
													{project.state}
												</Badge>
											</div>

											<div class="flex flex-wrap items-center gap-2 text-sm">
												<span class="flex-1 text-muted-foreground">
													Coordinator: {modelLabel(project.coordinator.model, backend.models)}
												</span>
												{#if backend.supports('models') || backend.supports('credentials') || backend.supports('logins')}
													<a class="underline" href={projectSettingsHref(backend.id, project.id)}>Settings</a>
												{/if}
											</div>

											{#if project.coordinator.model === null && backend.supports('models')}
												<Banner tone="warning">
													No coordinator model yet.
													<a class="underline" href={projectSettingsHref(backend.id, project.id, 'coordinator')}>Choose a model</a>
													before chatting.
												</Banner>
											{/if}

											{#if project.state === 'failed'}
												<Banner tone="error">{project.failure ?? 'The project failed to open.'}</Banner>
											{/if}
										</Card.Content>
									</Card.Root>
								{/each}
							</div>
						{/if}

						{#if backend.supports('filesystem')}
							{#if backend.ready}
								<div class="flex flex-wrap items-center gap-2">
									<Button type="button" onclick={() => openPicker(backend)}>
										<PlusIcon data-icon="inline-start" /> Add a project
									</Button>
									<span class="text-sm text-muted-foreground">Pick a folder on {backend.name}.</span>
								</div>
							{/if}
						{:else}
							<p class="text-sm text-muted-foreground">
								This backend has no folder picker; projects must be added elsewhere.
							</p>
						{/if}
					{/if}
				</Card.Content>
			</Card.Root>
		{/each}
	{/if}
</main>
</div>

{#if pickerBackend}
	<FolderPicker
		backend={pickerBackend}
		open={true}
		onclose={() => (pickerBackend = undefined)}
		onadd={addFolder}
	/>
{/if}
