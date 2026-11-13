<script lang="ts">
	import type { BackendConnection } from '#lib/harness.svelte.js';
	import { deliverySettingsSupport, integrationBranchMode, parseDeployFeedPath, parseIntegrationBranch } from '#lib/delivery-settings.js';
	import { SaveState } from '#lib/save-state.svelte.js';
	import AutoInput from './AutoInput.svelte';
	import Combobox from './Combobox.svelte';
	import SettingsGroup from './SettingsGroup.svelte';
	import SettingsRow from './SettingsRow.svelte';

	let { backend, projectId }: { backend: BackendConnection; projectId: string } = $props();
	const project = $derived(backend.projects.find(entry => entry.id === projectId));
	const support = $derived(deliverySettingsSupport(backend.connection.features));
	let pendingIntegrationMode = $state<'auto' | 'custom' | 'off' | undefined>(undefined);
	let pendingFeedMode = $state<'off' | 'file' | undefined>(undefined);
	let busy = $state(false);
	const integrationMode = $derived(pendingIntegrationMode ?? integrationBranchMode(project?.integrationRef));
	const feedMode = $derived(pendingFeedMode ?? (project?.deployFeed ? 'file' : 'off'));
	const integrationSave = new SaveState();
	const feedSave = new SaveState();
	const integrationOptions = [
		{ value: 'auto', label: 'Automatic (main or master)' },
		{ value: 'custom', label: 'Custom ref' },
		{ value: 'off', label: 'Off' }
	];
	const feedOptions = [{ value: 'off', label: 'Off' }, { value: 'file', label: 'File path' }];

	async function pickIntegration(next: string): Promise<void> {
		pendingIntegrationMode = next as typeof pendingIntegrationMode;
		integrationSave.reset();
		if (next === 'custom') return;
		busy = true;
		try {
			if (await integrationSave.run(() => backend.configureProject(projectId, { integrationRef: next === 'off' ? null : 'auto' }))) pendingIntegrationMode = undefined;
		} finally { busy = false; }
	}

	async function saveRef(text: string): Promise<void> {
		const integrationRef = parseIntegrationBranch(text);
		if (integrationRef === undefined) throw new Error('Use a branch name or a valid local ref such as refs/heads/trunk.');
		busy = true;
		try {
			await backend.configureProject(projectId, { integrationRef });
			pendingIntegrationMode = undefined;
		} finally { busy = false; }
	}

	async function pickFeed(next: string): Promise<void> {
		pendingFeedMode = next as typeof pendingFeedMode;
		feedSave.reset();
		if (next === 'file') return;
		busy = true;
		try {
			if (await feedSave.run(() => backend.configureProject(projectId, { deployFeed: null }))) pendingFeedMode = undefined;
		} finally { busy = false; }
	}

	async function saveFeed(text: string): Promise<void> {
		const deployFeed = parseDeployFeedPath(text);
		if (deployFeed === undefined) throw new Error('Use an absolute local file path, up to 4096 characters.');
		busy = true;
		try {
			await backend.configureProject(projectId, { deployFeed });
			pendingFeedMode = undefined;
		} finally { busy = false; }
	}
</script>

{#if support.integration || support.deploy}
	<SettingsGroup title="Delivery">
		{#if support.integration}
			<SettingsRow label="Integration branch" hint="Commits with a Kemiri-Task: T12 line that land here are shown on their tasks." for="integration-branch-mode" status={integrationSave} onretry={() => void pickIntegration(integrationMode)}>
				<Combobox id="integration-branch-mode" options={integrationOptions} value={integrationMode} onchange={(next) => void pickIntegration(next)} disabled={busy} invalid={integrationSave.status === 'failed'} />
			</SettingsRow>
			{#if integrationMode === 'custom'}
				<SettingsRow label="Git ref" hint="Use refs/heads/trunk or a branch name such as trunk. Saves on Enter or when you leave the field." for="integration-branch-ref">
					<AutoInput id="integration-branch-ref" value={integrationBranchMode(project?.integrationRef) === 'custom' ? project?.integrationRef ?? '' : ''} placeholder="refs/heads/trunk" disabled={busy} commit={saveRef} mono />
				</SettingsRow>
			{/if}
		{/if}
		{#if support.deploy}
			<SettingsRow label="Deploy status feed" hint="A JSON journal your deploy scripts write; deploy results then appear on every task they shipped. The harness only reads it." for="deploy-feed-mode" status={feedSave} onretry={() => void pickFeed(feedMode)}>
				<Combobox id="deploy-feed-mode" options={feedOptions} value={feedMode} onchange={(next) => void pickFeed(next)} disabled={busy} invalid={feedSave.status === 'failed'} />
			</SettingsRow>
			{#if feedMode === 'file'}
				<SettingsRow label="Journal file" hint="Absolute local path on {backend.name}. Saves on Enter or when you leave the field." for="deploy-feed-path">
					<AutoInput id="deploy-feed-path" value={project?.deployFeed ?? ''} placeholder="/tmp/deploy-journal.json" disabled={busy} commit={saveFeed} mono />
				</SettingsRow>
			{/if}
		{/if}
	</SettingsGroup>
{/if}
