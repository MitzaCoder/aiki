<script lang="ts">
	import ReportAuditGroup from './ReportAuditGroup.svelte';
	import BrainIcon from '@lucide/svelte/icons/brain';
	import ImageIcon from '@lucide/svelte/icons/image';
	import { onMount } from 'svelte';
	import Combobox from '#lib/components/settings/Combobox.svelte';
	import ThinkingSelect from '#lib/components/settings/ThinkingSelect.svelte';
	import SettingsGroup from '#lib/components/settings/SettingsGroup.svelte';
	import SettingsRow from '#lib/components/settings/SettingsRow.svelte';
	import SettingsSection from '#lib/components/settings/SettingsSection.svelte';
	import StatusChip from '#lib/components/settings/StatusChip.svelte';
	import Banner from '#lib/components/Banner.svelte';
	import type { BackendConnection } from '#lib/harness.svelte.js';
	import { contextSize, modelKey, modelOptions, providerName } from '#lib/models.js';
	import { SaveState } from '#lib/save-state.svelte.js';
	import { backendSettingsHref } from '#lib/settings.js';
	import { DEFAULT_UI_PROOF, type ThinkingLevel, type UiProof } from '@aiki/protocol';

	/**
	 * Project → Coordinator: which model the project's main agent runs on, and how hard it thinks. Each field saves the
	 * moment it changes and says so beside itself; there is no form to submit.
	 */
	let { backend, projectId }: { backend: BackendConnection; projectId: string } = $props();

	const project = $derived(backend.projects.find((entry) => entry.id === projectId));
	const storedModel = $derived(project === undefined ? '' : project.coordinator.model === null ? '' : modelKey(project.coordinator.model));
	const storedThinking = $derived(project?.coordinator.thinkingLevel ?? '');

	// The value on screen is the one being saved until the backend answers, so the control never jumps back.
	let pendingModel = $state<string | undefined>(undefined);
	let pendingThinking = $state<string | undefined>(undefined);
	let pendingUiProof = $state<UiProof | undefined>(undefined);
	const modelSave = new SaveState();
	const uiProofSave = new SaveState();
	const artifactPrivacySave = new SaveState();
	const thinkingSave = new SaveState();

	const modelValue = $derived(pendingModel ?? storedModel);
	const thinkingValue = $derived(pendingThinking ?? storedThinking);
	// An older backend does not send the setting, so the row stays out.
	const uiProofValue = $derived(pendingUiProof ?? project?.uiProof ?? DEFAULT_UI_PROOF);
	const uiProofOptions = [
		{ value: 'screenshots-and-videos', label: 'Screenshots and videos', description: 'Before/after screenshots and a short recording. The default.' },
		{ value: 'screenshots', label: 'Screenshots', description: 'Before/after screenshots only.' },
		{ value: 'off', label: 'Off', description: 'Agents are not asked to show UI changes.' }
	];
	const options = $derived(modelOptions(backend.models, backend.providers));
	const info = $derived(backend.models.find((model) => modelKey(model) === modelValue));
	const provider = $derived(info === undefined ? undefined : backend.providers.find((entry) => entry.id === info.provider));

	onMount(() => {
		void backend.ensureLoaded();
	});

	async function pickModel(next: string): Promise<void> {
		const chosen = backend.models.find((model) => modelKey(model) === next);
		if (chosen === undefined) return;
		// A level the new model lacks goes back to its default; one it has stays.
		const keep = storedThinking !== '' && chosen.thinkingLevels.includes(storedThinking as ThinkingLevel);
		pendingModel = next;
		if (!keep) pendingThinking = '';
		await modelSave.run(() =>
			backend.configureProject(projectId, {
				coordinatorModel: { provider: chosen.provider, modelId: chosen.modelId },
				coordinatorThinkingLevel: keep ? (storedThinking as ThinkingLevel) : null
			})
		);
		pendingModel = undefined;
		pendingThinking = undefined;
	}

	async function pickThinking(next: string): Promise<void> {
		pendingThinking = next;
		await thinkingSave.run(() =>
			backend.configureProject(projectId, { coordinatorThinkingLevel: next === '' ? null : (next as ThinkingLevel) })
		);
		pendingThinking = undefined;
	}

	async function pickUiProof(next: string): Promise<void> {
		pendingUiProof = next as UiProof;
		await uiProofSave.run(() => backend.configureProject(projectId, { uiProof: next as UiProof }));
		pendingUiProof = undefined;
	}
</script>

<SettingsSection title="Coordinator" description="The model this project's main agent runs on." icon="cpu">
	{#if project !== undefined && project.coordinator.model === null && pendingModel === undefined}
		<Banner tone="warning">This project has no coordinator model, so it cannot start a conversation. Choose one below.</Banner>
	{/if}

	<SettingsGroup title="Model">
		<SettingsRow
			label="Coordinator model"
			hint="Type to search every model this backend offers."
			for="coordinator-model"
			status={modelSave}
			onretry={() => void pickModel(pendingModel ?? modelValue)}
		>
			{#snippet learn()}
				There are no model defaults: every project names its own coordinator. Workers and background threads pick
				their own models; see Workers.
			{/snippet}
			<Combobox
				id="coordinator-model"
				{options}
				value={modelValue}
				onchange={(next) => void pickModel(next)}
				placeholder={backend.modelsLoaded ? 'Choose a model…' : 'Loading models…'}
				searchPlaceholder="Search models or providers…"
				emptyText="No model matches."
				disabled={!backend.modelsLoaded && options.length === 0}
				invalid={modelSave.status === 'failed'}
			/>
			{#snippet below()}
				{#if info !== undefined}
					<div class="flex flex-wrap items-center gap-1.5" data-model-summary>
						<StatusChip tone={provider?.configured ? 'ok' : 'warn'}>
							{providerName(backend.providers, info.provider)}{provider?.configured ? '' : ': no credential'}
						</StatusChip>
						<StatusChip tone="muted" dot={false}>{contextSize(info.contextWindow)} context</StatusChip>
						{#if info.reasoning}
							<StatusChip tone="muted" dot={false}><BrainIcon class="size-3.5" aria-hidden="true" /> Reasons</StatusChip>
						{/if}
						{#if info.input.includes('image')}
							<StatusChip tone="muted" dot={false}><ImageIcon class="size-3.5" aria-hidden="true" /> Sees images</StatusChip>
						{/if}
					</div>
					{#if provider !== undefined && !provider.configured}
						<p class="mt-2 text-[0.8125rem] leading-5 text-(--chat-warning)">
							{provider.name} has no credential on {backend.name}, so requests will fail.
							<a class="font-medium underline" href={backendSettingsHref(backend.id, 'accounts')}>Add one</a>
						</p>
					{/if}
				{/if}
			{/snippet}
		</SettingsRow>

		<SettingsRow
			label="Thinking level"
			hint={info === undefined ? 'Choose a model to see its levels.' : 'How much the model reasons before it answers.'}
			for="coordinator-thinking"
			status={thinkingSave}
			onretry={() => void pickThinking(pendingThinking ?? thinkingValue)}
		>
			{#snippet learn()}
				"Model default" leaves the level to the model. A higher level reasons longer: better on hard work, slower and
				dearer. The composer can still change it for one conversation.
			{/snippet}
			<ThinkingSelect
				id="coordinator-thinking"
				levels={info?.thinkingLevels ?? []}
				value={(thinkingValue === '' ? null : thinkingValue) as ThinkingLevel | null}
				onchange={(next) => void pickThinking(next ?? '')}
				disabled={info === undefined}
			/>
		</SettingsRow>
	</SettingsGroup>

	{#if project?.blockArtifactRequests !== undefined}
		<SettingsGroup title="Artifact pages">
			<SettingsRow label="Block artifact pages from sending data" hint="Blocks connections and form submissions. Allowed images, media, CDN files and links can still send requests." status={artifactPrivacySave}>
				<Combobox aria-label="Block artifact pages from sending data" options={[{value:'off',label:'Off (default)'},{value:'on',label:'On'}]} value={project.blockArtifactRequests ? 'on' : 'off'} onchange={(value) => void artifactPrivacySave.run(() => backend.configureProject(projectId, {blockArtifactRequests: value === 'on'}))} />
			</SettingsRow>
		</SettingsGroup>
	{/if}
	{#if project?.uiProof !== undefined}
		<SettingsGroup title="Show UI changes">
			<SettingsRow
				label="Prove UI work with"
				hint="Agents show web and app changes before review; backends and terminals are never recorded."
				for="coordinator-ui-proof"
				status={uiProofSave}
				onretry={() => void pickUiProof(uiProofValue)}
			>
				{#snippet learn()}
					Any change a user can see in a web page or an app screen is shown before it goes to review: a bug
					before and after, using the real UI in a headless browser, emulator or device. The agent saves the
					pictures (and the recording) on the task. The coordinator works out how to demo this project once and
					keeps the recipe in memory. A change reaches the coordinator on its next turn and workers started after it.
				{/snippet}
				<Combobox
					id="coordinator-ui-proof"
					options={uiProofOptions}
					value={uiProofValue}
					onchange={(next) => void pickUiProof(next)}
					aria-label="Show UI changes"
					invalid={uiProofSave.status === 'failed'}
				/>
			</SettingsRow>
		</SettingsGroup>
	{/if}
	<ReportAuditGroup {backend} {projectId} />
</SettingsSection>
