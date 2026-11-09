<script lang="ts">
	import ArchiveRestoreIcon from '@lucide/svelte/icons/archive-restore';
	import SaveStatus from '#lib/components/settings/SaveStatus.svelte';
	import SettingsGroup from '#lib/components/settings/SettingsGroup.svelte';
	import SettingsSection from '#lib/components/settings/SettingsSection.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import { projectHref } from '#lib/backends.js';
	import { harness, type BackendConnection } from '#lib/harness.svelte.js';
	import { archivedProjects } from '#lib/projects.js';
	import { SaveState } from '#lib/save-state.svelte.js';

	/**
	 * General → Archived projects: every backend's archived projects, each opening the project and carrying an
	 * Unarchive button. The sidebar keeps its own collapsed list; this is the page for it.
	 */
	const backends = $derived(harness.backends.filter((backend) => backend.supports('project-archive')));
	const total = $derived(backends.reduce((count, backend) => count + archivedProjects(backend.projects).length, 0));

	const saves: Record<string, SaveState> = {};
	const saveFor = (key: string): SaveState => (saves[key] ??= new SaveState());

	async function unarchive(backend: BackendConnection, projectId: string): Promise<void> {
		await saveFor(`${backend.id}/${projectId}`).run(() => backend.configureProject(projectId, { archived: false }));
	}
</script>

<SettingsSection title="Archived projects" description="Hidden from the project list; nothing is deleted." icon="archive">
	{#if total === 0}
		<SettingsGroup>
			<p class="px-5 py-8 text-center text-sm text-muted-foreground">
				No archived projects. Archive one from its own settings, under General.
			</p>
		</SettingsGroup>
	{:else}
		{#each backends as backend (backend.id)}
			{@const projects = archivedProjects(backend.projects)}
			{#if projects.length > 0}
				<SettingsGroup title={backend.name}>
					{#each projects as project (project.id)}
						{@const save = saveFor(`${backend.id}/${project.id}`)}
						<div class="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5">
							<a class="flex min-w-0 flex-1 flex-col rounded-md hover:underline" href={projectHref(backend.id, project.id)}>
								<span class="truncate text-sm font-semibold">{project.name}</span>
								<span class="truncate font-mono text-xs text-muted-foreground">{project.path}</span>
							</a>
							<div class="flex flex-col items-end gap-1">
								<Button variant="outline" class="max-sm:h-11" disabled={save.status === 'saving'} onclick={() => void unarchive(backend, project.id)}>
									{#if save.status === 'saving'}<Spinner data-icon="inline-start" />{:else}<ArchiveRestoreIcon data-icon="inline-start" />{/if}
									Unarchive
								</Button>
								{#if save.status === 'failed'}<SaveStatus state={save} />{/if}
							</div>
						</div>
					{/each}
				</SettingsGroup>
			{/if}
		{/each}
	{/if}
</SettingsSection>
