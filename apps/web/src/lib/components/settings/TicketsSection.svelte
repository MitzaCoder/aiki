<script lang="ts">
	import WandSparklesIcon from '@lucide/svelte/icons/wand-sparkles';
	import AutoInput from '#lib/components/settings/AutoInput.svelte';
	import SettingsGroup from '#lib/components/settings/SettingsGroup.svelte';
	import SettingsRow from '#lib/components/settings/SettingsRow.svelte';
	import SettingsSection from '#lib/components/settings/SettingsSection.svelte';
	import StatusChip from '#lib/components/settings/StatusChip.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import type { BackendConnection } from '#lib/harness.svelte.js';
	import { SaveState } from '#lib/save-state.svelte.js';
	import { normalizeGithubRepo, normalizeJiraSite } from '@aiki/protocol';

	/**
	 * Project → Tickets and pull requests: which ticket keys and repositories turn into links. Each field saves when
	 * it is left; "Fill in automatically" hands all three back to the backend, which fills them from the project's git
	 * remotes, its commit messages and the machine's Jira sign-in.
	 */
	let { backend, projectId }: { backend: BackendConnection; projectId: string } = $props();

	const project = $derived(backend.projects.find((entry) => entry.id === projectId));
	const links = $derived(project?.links);
	const autoSave = new SaveState();

	function listOf(text: string): string[] {
		return text
			.split(/[\s,]+/)
			.map((entry) => entry.trim())
			.filter((entry) => entry.length > 0);
	}

	async function write(change: { jiraSite?: string | null; jiraProjects?: string[]; githubRepos?: string[] }): Promise<void> {
		if (links === undefined) return;
		await backend.configureProject(projectId, {
			links: {
				jiraSite: change.jiraSite !== undefined ? change.jiraSite : (links.jiraSite ?? null),
				jiraProjects: change.jiraProjects ?? links.jiraProjects,
				githubRepos: change.githubRepos ?? links.githubRepos
			}
		});
	}

	async function commitSite(text: string): Promise<void> {
		if (text.length === 0) return write({ jiraSite: null });
		const site = normalizeJiraSite(text);
		if (site === undefined) throw new Error('The Jira site should be an address, like acme.atlassian.net.');
		await write({ jiraSite: site });
	}

	async function commitPrefixes(text: string): Promise<void> {
		await write({ jiraProjects: listOf(text).map((prefix) => prefix.toUpperCase()) });
	}

	async function commitRepos(text: string): Promise<void> {
		const repos = listOf(text);
		const unknown = repos.filter((repo) => normalizeGithubRepo(repo) === undefined);
		if (unknown.length > 0) throw new Error(`Write each repository as owner/name: ${unknown.join(', ')}`);
		await write({ githubRepos: repos });
	}
</script>

<SettingsSection
	title="Tickets and pull requests"
	description="Ticket keys and pull request numbers become links."
	icon="ticket"
>
	{#if links !== undefined}
		<SettingsGroup title="Links">
			{#snippet actions()}
				<StatusChip tone={links.detected ? 'info' : 'muted'}>{links.detected ? 'Filled in automatically' : 'Set by you'}</StatusChip>
			{/snippet}
			<SettingsRow label="Jira site" hint="Where ticket keys like EX-1234 open." for="links-jira-site">
				{#snippet learn()}
					Keys link in the chat, in task reports and in titles. A task's tickets and pull requests also show where
					they stand (open, merged, in review) when this backend's machine is signed in to GitHub (gh) and Jira
					(acli).
				{/snippet}
				<AutoInput
					id="links-jira-site"
					placeholder="acme.atlassian.net"
					value={links.jiraSite?.replace(/^https:\/\//, '') ?? ''}
					commit={commitSite}
				/>
			</SettingsRow>
			<SettingsRow label="Ticket prefixes" hint="Keys with these prefixes link everywhere." for="links-jira-projects">
				{#snippet learn()}
					Other keys link only inside a task's own tickets, so words like UTF-8 stay plain.
				{/snippet}
				<AutoInput id="links-jira-projects" placeholder="MT, CORE" value={links.jiraProjects.join(', ')} commit={commitPrefixes} />
			</SettingsRow>
			<SettingsRow label="GitHub repositories" hint="owner/name, separated by commas." for="links-github-repos">
				{#snippet learn()}
					With one repository, #1234 links to it. With several, write the name before the number, like web#1234.
				{/snippet}
				<AutoInput id="links-github-repos" placeholder="owner/name" value={links.githubRepos.join(', ')} commit={commitRepos} />
			</SettingsRow>
			<SettingsRow
				label="Fill in automatically"
				hint="From git remotes, commit messages and the machine's Jira sign-in."
				control="auto"
				status={autoSave}
				onretry={() => void autoSave.run(() => backend.configureProject(projectId, { links: null }))}
			>
				<Button
					variant="outline"
					class="max-sm:h-11"
					disabled={autoSave.status === 'saving'}
					onclick={() => void autoSave.run(() => backend.configureProject(projectId, { links: null }))}
				>
					<WandSparklesIcon data-icon="inline-start" /> Fill in again
				</Button>
			</SettingsRow>
		</SettingsGroup>
	{/if}
</SettingsSection>
