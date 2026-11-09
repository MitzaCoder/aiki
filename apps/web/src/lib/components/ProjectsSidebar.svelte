<script lang="ts">
	import { overlayScroll } from '#lib/scrollbars.js';
	import ChevronsLeftIcon from '@lucide/svelte/icons/chevrons-left';
	import ChevronsRightIcon from '@lucide/svelte/icons/chevrons-right';
	import GaugeIcon from '@lucide/svelte/icons/gauge';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import XIcon from '@lucide/svelte/icons/x';
	import { page } from '$app/state';
	import { MediaQuery } from 'svelte/reactivity';
	import { usageModal } from '#lib/usage-modal.svelte.js';
	import ConnectionBadge from '#lib/components/ConnectionBadge.svelte';
	import ArchivedProjects from '#lib/components/ArchivedProjects.svelte';
	import FolderPicker from '#lib/components/FolderPicker.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import { projectHref } from '#lib/backends.js';
	import { connectionDotClass, connectionView } from '#lib/connection.js';
	import { harness, type BackendConnection } from '#lib/harness.svelte.js';
	import { attentionCount, needsYouLinks, sidebarStatus } from '#lib/sidebar-attention.js';
	import NeedsYou from '#lib/components/NeedsYou.svelte';
	import { projectsNav } from '#lib/projects-nav.svelte.js';
	import {
		PROJECTS_NAV_WIDE_QUERY,
		activeProjects,
		archivedProjects,
		currentProject,
		projectInitial,
		projectRow,
		projectSeenKey,
		projectToneDotClass,
		type ProjectRow,
	} from '#lib/projects.js';
	import type { ProjectSummary } from '@mihai-harness/protocol';

	/**
	 * The projects sidebar: every backend's projects, grouped by backend, always beside
	 * the page. Wide screens get a persistent panel that collapses to an icon rail (this
	 * browser remembers which); narrow screens get the same content in a drawer opened
	 * from a page header and closed on navigation.
	 *
	 * A row says what its project is doing — the coordinator working or failed, how many
	 * workers run, when it last answered — and marks a reply this browser has not seen.
	 * The footer opens Usage (subscription limits, a modal) and General settings (theme, backends, notifications,
	 * archived projects).
	 */
	const wide = new MediaQuery(PROJECTS_NAV_WIDE_QUERY);
	const current = $derived(currentProject(page.url.pathname));
	const usageOpen = $derived(usageModal.open);
	const attentionLinks = $derived(needsYouLinks(harness.backends));
	const settingsOpen = $derived(page.url.pathname === '/settings' || page.url.pathname.startsWith('/settings/'));

	let pickerBackend = $state<BackendConnection | undefined>(undefined);
	/** Relative times ("4m ago") age on their own; a new reply already redraws the rows. */
	let now = $state(Date.now());

	$effect(() => {
		const timer = setInterval(() => (now = Date.now()), 30_000);
		return () => clearInterval(timer);
	});

	function isCurrent(backendId: string, projectId: string): boolean {
		return current?.backendId === backendId && current.projectId === projectId;
	}

	function row(backend: BackendConnection, project: ProjectSummary) {
		return projectRow(project, projectsNav.seen(projectSeenKey(backend.id, project.id)), now);
	}

	/** A rail tile's tooltip and accessible name: which backend, which project, what it is doing. */
	function railTitle(backend: BackendConnection, project: ProjectSummary, status: ProjectRow): string {
		return `${backend.name}: ${project.name} — ${sidebarStatus(project, status).label}`;
	}

	function backendTitle(backend: BackendConnection): string {
		const view = connectionView(backend.connection);
		const detail = view.title === undefined ? '' : ` · ${view.title}`;
		return `${backend.name} — ${view.label}${detail}`;
	}

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
</script>

{#snippet navBody(rail: boolean, drawer: boolean)}
	<div class="flex h-full min-h-0 flex-col">
		<div
			class="flex shrink-0 items-center gap-1 px-1.5 pt-[max(0.5rem,env(safe-area-inset-top))] pb-1"
			class:justify-center={rail}
		>
			{#if !rail}
				<h2 class="min-w-0 flex-1 truncate px-1.5 text-[0.6875rem] font-semibold tracking-wide uppercase text-(--chat-fg-subtle)">
					Projects
				</h2>
			{/if}
			{#if drawer}
				<Button
					variant="ghost"
					size="icon-sm"
					onclick={() => projectsNav.closeDrawer()}
					aria-label="Close projects"
					title="Close"
				>
					<XIcon />
				</Button>
			{:else}
				<Button
					variant="ghost"
					size="icon-sm"
					onclick={() => projectsNav.toggleCollapsed()}
					aria-label={rail ? 'Expand the projects sidebar' : 'Collapse the projects sidebar'}
					title={rail ? 'Expand' : 'Collapse'}
					aria-expanded={!rail}
				>
					{#if rail}<ChevronsRightIcon />{:else}<ChevronsLeftIcon />{/if}
				</Button>
			{/if}
		</div>

		<div class="relative flex min-h-0 flex-1 flex-col">
		<nav
			aria-label="Projects"
			use:overlayScroll={'parent'}
			class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 pb-2"
			class:flex={rail}
			class:flex-col={rail}
			class:items-center={rail}
		>
			{#if !rail}<NeedsYou links={attentionLinks} onnavigate={() => projectsNav.closeDrawer()} />{/if}
			{#if harness.backends.length === 0}
				{#if !rail}
					<p class="px-1.5 py-2 text-xs leading-5 text-(--chat-fg-subtle)">
						No backends yet. <a class="underline" href="/settings/backends">Add one</a> to see its projects here.
					</p>
				{/if}
			{/if}

			{#each harness.backends as backend (backend.id)}
				{@const view = connectionView(backend.connection)}
				{@const projects = activeProjects(backend.projects)}
				<div class="flex flex-col gap-0.5" class:items-center={rail} class:w-full={rail}>
					{#if rail}
						<span class="sr-only">{backend.name}</span>
						<span
							class="my-1 flex w-9 shrink-0 items-center justify-center gap-1"
							title={backendTitle(backend)}
						>
							<span class="h-px flex-1 rounded-full bg-(--chat-border)" aria-hidden="true"></span>
							<span
								class="size-1.5 rounded-full {connectionDotClass(view.tone)}"
								aria-hidden="true"
							></span>
						</span>
					{:else}
						<div class="flex flex-wrap items-center gap-1 px-1.5 pt-1.5 pb-0.5">
							<span
								class="min-w-0 flex-1 truncate text-[0.6875rem] font-semibold tracking-wide uppercase text-(--chat-fg-subtle)"
								title={backendTitle(backend)}
							>
								{backend.name}
							</span>
							{#if !backend.ready}<ConnectionBadge {backend} />{/if}
							{#if backend.supports('filesystem') && backend.ready}
								<Button
									variant="ghost"
									size="icon-xs"
									onclick={() => openPicker(backend)}
									aria-label="Add a project to {backend.name}"
									title="Add a project"
								>
									<PlusIcon />
								</Button>
							{/if}
						</div>
					{/if}

					{#if projects.length === 0}
						{#if !rail}
							<p class="px-1.5 py-1 text-[0.6875rem] leading-4 text-(--chat-fg-subtle)">
								{#if !backend.ready}
									Waiting for {backend.name}…
								{:else if backend.supports('projects') && archivedProjects(backend.projects).length > 0}
									No projects, only archived ones.
								{:else if backend.supports('projects')}
									No projects yet.
								{:else}
									This backend has no projects.
								{/if}
							</p>
						{/if}
					{/if}

					{#each projects as project (project.id)}
						{@const status = row(backend, project)}
						{@const count = attentionCount(project)}
						{@const summary = sidebarStatus(project, status)}
						{#if rail}
							<a
								href={projectHref(backend.id, project.id)}
								onclick={() => projectsNav.closeDrawer()}
								class="relative grid size-9 shrink-0 place-items-center rounded-lg text-xs font-semibold transition-colors hover:bg-(--chat-surface-2)"
								class:bg-(--chat-surface-2)={isCurrent(backend.id, project.id)}
								class:text-(--chat-fg)={isCurrent(backend.id, project.id)}
								class:text-(--chat-fg-muted)={!isCurrent(backend.id, project.id)}
								class:ring-2={status.unread}
								class:ring-(--primary)={status.unread}
								class:ring-offset-0={status.unread}
								aria-current={isCurrent(backend.id, project.id) ? 'page' : undefined}
								aria-label="{railTitle(backend, project, status)}{status.unread ? ', new reply' : ''}{count ? `, ${count} outstanding actions` : ''}"
								title={`${railTitle(backend, project, status)}${count ? ` · ${count} outstanding actions` : ''}`}
							>
								{projectInitial(project.name)}
								{#if count}
									<span
										class="absolute -top-1 -right-1 grid min-w-4 place-items-center rounded-full px-1 text-[0.625rem] leading-4 font-semibold text-white"
										style:background={summary.urgent ? 'var(--chat-warning)' : 'var(--chat-surface-2)'}
										style:color={summary.urgent ? 'var(--chat-bg)' : 'var(--chat-fg-muted)'}
										aria-hidden="true"
										data-attention-count
									>
										{count > 9 ? '9+' : count}
									</span>
								{/if}
								<span
									class="absolute right-0.5 bottom-0.5 size-2 rounded-full {projectToneDotClass(status.tone)}"
									aria-hidden="true"
								></span>
							</a>
						{:else}
							<a
								href={projectHref(backend.id, project.id)}
								onclick={() => projectsNav.closeDrawer()}
								class="project-link"
								class:selected={isCurrent(backend.id, project.id)}
								class:urgent={summary.urgent}
								aria-current={isCurrent(backend.id, project.id) ? 'page' : undefined}
								title={`${status.title} · ${summary.label}`}
							>
								<span class="status-glyph" class:working={summary.working} aria-hidden="true">{summary.glyph}</span>
								<span class="project-label"><strong>{project.name}</strong><small>{summary.label}</small></span>
								{#if status.unread}<span class="unread-dot" aria-label="New reply since you last looked"></span>{/if}
							</a>
						{/if}
					{/each}
					{#if !rail}
						<ArchivedProjects
							{backend}
							forceOpen={current?.backendId === backend.id &&
								archivedProjects(backend.projects).some((entry) => entry.id === current?.projectId)}
							onnavigate={() => projectsNav.closeDrawer()}
						/>
					{/if}
				</div>
			{/each}
		</nav>
		</div>

		<div class="flex shrink-0 flex-col gap-1 border-t border-(--chat-border) p-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))]">
			<button
				type="button"
				onclick={() => {
					projectsNav.closeDrawer();
					usageModal.open = true;
				}}
				class="flex items-center gap-2 rounded-lg text-left transition-colors hover:bg-(--chat-surface-2)"
				class:justify-center={rail}
				class:size-9={rail}
				class:px-1.5={!rail}
				class:py-1.5={!rail}
				class:text-(--chat-fg-muted)={!usageOpen}
				class:text-(--chat-fg)={usageOpen}
				class:bg-(--chat-surface-2)={usageOpen}
				aria-haspopup="dialog"
				aria-label="Usage: subscription limits and when they reset"
				title="Usage: subscription limits and when they reset"
			>
				<GaugeIcon class="size-4 shrink-0" />
				{#if !rail}
					<span class="flex min-w-0 flex-col">
						<span class="truncate text-[0.8125rem] font-medium">Usage</span>
						<span class="truncate text-[0.6875rem] leading-4 text-(--chat-fg-subtle)">
							Subscription limits
						</span>
					</span>
				{/if}
			</button>
			<a
				href="/settings"
				onclick={() => projectsNav.closeDrawer()}
				class="flex items-center gap-2 rounded-lg transition-colors hover:bg-(--chat-surface-2)"
				class:justify-center={rail}
				class:size-9={rail}
				class:px-1.5={!rail}
				class:py-1.5={!rail}
				class:text-(--chat-fg-muted)={!settingsOpen}
				class:text-(--chat-fg)={settingsOpen}
				class:bg-(--chat-surface-2)={settingsOpen}
				aria-current={settingsOpen ? 'page' : undefined}
				aria-label="Settings: theme, backends, notifications, archived projects"
				title="Settings: theme, backends, notifications, archived projects"
			>
				<SettingsIcon class="size-4 shrink-0" />
				{#if !rail}
					<span class="flex min-w-0 flex-col">
						<span class="truncate text-[0.8125rem] font-medium">Settings</span>
						<span class="truncate text-[0.6875rem] leading-4 text-(--chat-fg-subtle)">
							Theme, backends, alerts
						</span>
					</span>
				{/if}
			</a>
		</div>
	</div>
{/snippet}

{#if wide.current}
	<aside
		class="flex h-full shrink-0 flex-col border-r border-(--chat-border) bg-(--chat-surface)/40 transition-[width] duration-200 ease-out motion-reduce:transition-none"
		style:width={projectsNav.collapsed ? '3.5rem' : '16.5rem'}
		aria-label="Projects sidebar"
	>
		{@render navBody(projectsNav.collapsed, false)}
	</aside>
{:else}
	<Dialog.Root
		open={projectsNav.drawerOpen}
		onOpenChange={(open) => projectsNav.setDrawer(open)}
	>
		<Dialog.Content
			showCloseButton={false}
			class="inset-y-0 top-0 left-0 flex h-dvh max-h-dvh w-[min(86vw,19rem)] max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none p-0 ring-1 sm:max-w-none"
		>
			<Dialog.Title class="sr-only">Projects</Dialog.Title>
			{@render navBody(false, true)}
		</Dialog.Content>
	</Dialog.Root>
{/if}

{#if pickerBackend}
	<FolderPicker
		backend={pickerBackend}
		open={true}
		onclose={() => (pickerBackend = undefined)}
		onadd={addFolder}
	/>
{/if}

<style>
	.project-link { display: flex; align-items: center; gap: 9px; min-height: 50px; padding: 8px; margin: 2px 0; border: 1px solid transparent; border-radius: 10px; transition: background 150ms, border-color 150ms; }
	.project-link:hover { background: var(--chat-surface-2); }
	.project-link.selected { background: color-mix(in oklab, var(--accent-2) 7%, var(--chat-surface)); border-color: color-mix(in oklab, var(--accent-2) 25%, var(--chat-border)); }
	.project-link:focus-visible { outline: 2px solid var(--accent-2); outline-offset: -2px; }
	.status-glyph { display: grid; place-items: center; flex-shrink: 0; width: 20px; height: 24px; border-radius: 8px; font-size: 17px; color: var(--chat-fg-subtle); }
	.urgent .status-glyph, .urgent small { color: var(--chat-warning); }
	.working { color: var(--accent-2); animation: breathe 2.8s ease-in-out infinite; }
	.project-label { min-width: 0; flex: 1; }
	.project-label strong, .project-label small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.project-label strong { font-size: 12px; font-weight: 550; }
	.project-label small { margin-top: 3px; color: var(--chat-fg-subtle); font-size: 10px; }
	.unread-dot { width: 6px; height: 6px; flex-shrink: 0; border-radius: 50%; background: var(--accent-2); }
	@keyframes breathe { 50% { box-shadow: 0 0 0 4px color-mix(in oklab, var(--accent-2) 8%, transparent); } }
	@media (prefers-reduced-motion: reduce) { .project-link { transition: none; } .working { animation: none; } }
</style>
