<script lang="ts">
	import ArchiveRestoreIcon from '@lucide/svelte/icons/archive-restore';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import { projectHref } from '#lib/backends.js';
	import type { BackendConnection } from '#lib/harness.svelte.js';
	import { archivedHeading, archivedProjects } from '#lib/projects.js';

	/**
	 * One backend's archived projects: a collapsed "Archived (N)" toggle (nothing when there are none, or the backend
	 * cannot archive), and under it each project as a link that still opens it, with an Unarchive button that puts it
	 * back as it was. `nav` is the drawer and sidebar's compact look, `page` the backends page's.
	 */
	let {
		backend,
		variant = 'nav',
		forceOpen = false,
		onnavigate
	}: {
		backend: BackendConnection;
		variant?: 'nav' | 'page';
		/** Keep it open, e.g. because the page shows one of these projects. */
		forceOpen?: boolean;
		/** Called when a project is opened from here, so a drawer can close. */
		onnavigate?: () => void;
	} = $props();

	const archived = $derived(backend.supports('project-archive') ? archivedProjects(backend.projects) : []);
	let toggled = $state(false);
	const open = $derived(toggled || forceOpen);
	let busyId = $state<string | undefined>(undefined);
	let error = $state<string | undefined>(undefined);

	async function unarchive(projectId: string): Promise<void> {
		busyId = projectId;
		error = undefined;
		try {
			await backend.configureProject(projectId, { archived: false });
		} catch (failure) {
			error = failure instanceof Error ? failure.message : String(failure);
		} finally {
			busyId = undefined;
		}
	}
</script>

{#if archived.length > 0}
	<div class="flex flex-col" data-archived-projects>
		<button
			type="button"
			class="flex items-center gap-1 rounded-lg text-left font-medium text-(--chat-fg-muted) transition-colors hover:bg-(--chat-surface-2) {variant ===
			'nav'
				? 'px-1.5 py-1 text-[0.75rem]'
				: 'px-2 py-1.5 text-sm'}"
			aria-expanded={open}
			onclick={() => (toggled = !toggled)}
		>
			<ChevronRightIcon class="size-3.5 shrink-0 transition-transform motion-reduce:transition-none {open ? 'rotate-90' : ''}" />
			{archivedHeading(archived.length)}
		</button>
		{#if open}
			<ul class="flex flex-col gap-0.5 {variant === 'nav' ? 'pl-3' : 'pl-5'}">
				{#each archived as project (project.id)}
					<li class="flex items-center gap-1">
						<a
							href={projectHref(backend.id, project.id)}
							onclick={() => onnavigate?.()}
							class="min-w-0 flex-1 truncate rounded-lg px-1.5 py-1.5 text-(--chat-fg-muted) transition-colors hover:bg-(--chat-surface-2) {variant ===
							'nav'
								? 'text-[0.8125rem]'
								: 'text-sm'}"
							title="{project.name} is archived. Open it."
						>
							{project.name}
						</a>
						<Button
							variant="ghost"
							size="icon-sm"
							class="shrink-0"
							disabled={busyId !== undefined}
							onclick={() => void unarchive(project.id)}
							aria-label="Unarchive {project.name}"
							title="Unarchive"
						>
							{#if busyId === project.id}<Spinner />{:else}<ArchiveRestoreIcon />{/if}
						</Button>
					</li>
				{/each}
			</ul>
			{#if error}
				<p class="px-1.5 py-1 text-[0.6875rem] leading-4 break-words text-destructive" role="alert">{error}</p>
			{/if}
		{/if}
	</div>
{/if}
