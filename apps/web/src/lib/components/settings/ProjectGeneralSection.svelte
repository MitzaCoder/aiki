<script lang="ts">
	import ArchiveSection from '#lib/components/ArchiveSection.svelte';
	import ConnectionBadge from '#lib/components/ConnectionBadge.svelte';
	import CopyButton from '#lib/components/CopyButton.svelte';
	import SettingsGroup from '#lib/components/settings/SettingsGroup.svelte';
	import SettingsRow from '#lib/components/settings/SettingsRow.svelte';
	import SettingsSection from '#lib/components/settings/SettingsSection.svelte';
	import AutoInput from '#lib/components/settings/AutoInput.svelte';
	import type { BackendConnection } from '#lib/harness.svelte.js';

	/** Project → General: its name (saved when you leave the field or press Enter), where it lives, and archiving. */
	let { backend, projectId }: { backend: BackendConnection; projectId: string } = $props();

	const project = $derived(backend.projects.find((entry) => entry.id === projectId));
	async function commitName(next: string): Promise<void> {
		if (next.length === 0) throw new Error('A project needs a name.');
		await backend.configureProject(projectId, { name: next });
	}
</script>

<SettingsSection title="General" description="What this project is called and where it lives." icon="folder">
	{#if project !== undefined}
		<SettingsGroup title="Project">
			<SettingsRow label="Name" hint="Shown in the sidebar and the chat's header." for="project-name">
				<AutoInput id="project-name" value={project.name} commit={commitName} />
			</SettingsRow>
			<SettingsRow label="Folder" hint="On {backend.name}. The folder cannot be changed here." control="auto">
				<div class="flex min-w-0 items-center gap-1 sm:max-w-80">
					<code class="min-w-0 flex-1 rounded-lg bg-(--chat-surface-2)/60 px-2.5 py-1.5 font-mono text-xs break-all">{project.path}</code>
					<CopyButton text={project.path} label="Copy the folder path" />
				</div>
			</SettingsRow>
			<SettingsRow label="Backend" hint="The server that runs this project." control="auto">
				<ConnectionBadge {backend} />
			</SettingsRow>
		</SettingsGroup>

		{#if backend.supports('project-archive')}
			<ArchiveSection {backend} {projectId} />
		{/if}
	{/if}
</SettingsSection>
