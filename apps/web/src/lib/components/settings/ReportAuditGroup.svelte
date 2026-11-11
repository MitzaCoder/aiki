<script lang="ts">
	import { onMount } from 'svelte';
	import { DEFAULT_REPORT_AUDIT, type ReportAuditSettings } from '@aiki/protocol';
	import type { BackendConnection } from '#lib/harness.svelte.js';
	import { modelKey, modelOptions } from '#lib/models.js';
	import { parseReportAuditBudget, reportAuditStatusLines, reportAuditSupported } from '#lib/report-audit.js';
	import { exactTime } from '#lib/relative-time.js';
	import { SaveState } from '#lib/save-state.svelte.js';
	import AutoInput from './AutoInput.svelte';
	import Combobox from './Combobox.svelte';
	import SettingsGroup from './SettingsGroup.svelte';
	import SettingsRow from './SettingsRow.svelte';

	let { backend, projectId }: { backend: BackendConnection; projectId: string } = $props();
	const project = $derived(backend.projects.find(entry => entry.id === projectId));
	const settings = $derived(project?.reportAudit ?? DEFAULT_REPORT_AUDIT);
	const supported = $derived(reportAuditSupported(backend.connection.features));
	const options = $derived(modelOptions(backend.models, backend.providers));
	let pendingMode = $state<ReportAuditSettings['mode'] | undefined>(undefined);
	let pendingModel = $state<string | undefined>(undefined);
	let busy = $state(false);
	let now = $state(Date.now());
	const save = new SaveState();
	const mode = $derived(pendingMode ?? settings.mode);
	const model = $derived(pendingModel ?? (settings.model ? modelKey(settings.model) : ''));
	const statusLines = $derived(reportAuditStatusLines(project?.reportAuditStatus, settings.dailyTokens, backend.models, backend.providers, now));
	const modeOptions = [
		{ value: 'auto', label: 'Automatic', description: 'Uses an available small model. The default.' },
		{ value: 'off', label: 'Off', description: 'Do not check reports with a model.' },
		{ value: 'model', label: 'Choose a model', description: 'Use a specific model from this backend.' }
	];
	onMount(() => {
		const timer = setInterval(() => { now = Date.now(); }, 30_000);
		return () => clearInterval(timer);
	});

	async function saveChoice(next: ReportAuditSettings): Promise<void> {
		if (busy) return;
		busy = true;
		try {
			if (await save.run(() => backend.configureProject(projectId, { reportAudit: next }))) {
				pendingMode = undefined;
				pendingModel = undefined;
			}
		} finally { busy = false; }
	}

	function pickMode(next: string): void {
		pendingMode = next as ReportAuditSettings['mode'];
		save.reset();
		if (next === 'model' && !settings.model) return;
		void saveChoice({ ...settings, mode: pendingMode });
	}

	function pickModel(key: string): void {
		const chosen = backend.models.find(entry => modelKey(entry) === key);
		if (!chosen) return;
		pendingModel = key;
		void saveChoice({ ...settings, mode: 'model', model: { provider: chosen.provider, modelId: chosen.modelId } });
	}

	async function saveBudget(text: string): Promise<void> {
		const dailyTokens = parseReportAuditBudget(text);
		if (dailyTokens === undefined) throw new Error('Enter a whole number from 0 to 10,000,000.');
		busy = true;
		try { await backend.configureProject(projectId, { reportAudit: { ...settings, dailyTokens } }); }
		finally { busy = false; }
	}
</script>

{#if supported}
	<SettingsGroup title="Report check" description="A small model checks once an hour whether active tasks’ reports missed something, and asks the coordinator to update them.">
		<SettingsRow label="Mode" hint="Automatic uses a signed-in small model: Claude Haiku 5.5, then GPT-5 nano, then a small ChatGPT model." for="report-audit-mode" status={save} onretry={() => mode === 'model' ? pickModel(model) : pickMode(mode)}>
			<Combobox id="report-audit-mode" options={modeOptions} value={mode} onchange={pickMode} disabled={busy} invalid={save.status === 'failed'} />
		</SettingsRow>
		{#if mode === 'model'}
			<SettingsRow label="Report check model" hint={settings.mode === 'model' ? 'The daily token limit still applies.' : 'Choose a model to save this mode. The daily token limit still applies.'} for="report-audit-model">
				<Combobox id="report-audit-model" {options} value={model} onchange={pickModel} placeholder={backend.modelsLoaded ? 'Choose a model…' : 'Loading models…'} searchPlaceholder="Search models or providers…" disabled={busy || !backend.modelsLoaded} invalid={save.status === 'failed'} />
			</SettingsRow>
		{/if}
		<SettingsRow label="Daily token budget" hint="Resets at midnight UTC. Includes input and output tokens; 0 prevents calls. Saves on Enter or when you leave the field." for="report-audit-budget" control="auto">
			<AutoInput id="report-audit-budget" type="number" min={0} max={10_000_000} step={1} value={String(settings.dailyTokens)} class="w-36" disabled={busy} commit={saveBudget} />
		</SettingsRow>
		<div class="flex flex-col gap-1 px-4 py-3 text-[0.8125rem] text-(--chat-fg-subtle) sm:px-5" role="status" aria-live="polite" title={project?.reportAuditStatus?.lastRunAt ? exactTime(project.reportAuditStatus.lastRunAt) : undefined}>
			{#each statusLines as line}<p>{line}</p>{/each}
		</div>
	</SettingsGroup>
{/if}
