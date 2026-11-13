<script lang="ts">
	import Banner from '#lib/components/Banner.svelte';
	import AutoInput from '#lib/components/settings/AutoInput.svelte';
	import Combobox from '#lib/components/settings/Combobox.svelte';
	import SettingsGroup from '#lib/components/settings/SettingsGroup.svelte';
	import SettingsRow from '#lib/components/settings/SettingsRow.svelte';
	import StatusChip from '#lib/components/settings/StatusChip.svelte';
	import ThinkingSelect from '#lib/components/settings/ThinkingSelect.svelte';
	import type { ComboOption } from '#lib/combobox.js';
	import type { BackendConnection } from '#lib/harness.svelte.js';
	import {
		DEFAULT_MEMORY_MAINTENANCE,
		maintenanceThinkingLevels,
		memoryMaintenanceOff,
		memoryMaintenanceSummary,
		parseAfterWrites,
		parseNightlyTime
	} from '#lib/memory.js';
	import { modelKey, modelOptions } from '#lib/models.js';
	import type { MemoryMaintenanceSettings, ThinkingLevel } from '@kemiri/protocol';

	/**
	 * A backend's memory maintenance: the model and thinking level a maintenance run uses, the nightly time in the
	 * backend's timezone and how many writes to a scope start a run. No model means Off. Each field saves at once
	 * (`memory.settings.set`, one request at a time); the backend's saving flag and error show under the group.
	 */
	let { backend }: { backend: BackendConnection } = $props();

	const settings = $derived(backend.memoryMaintenance ?? DEFAULT_MEMORY_MAINTENANCE);
	const timezone = $derived(backend.memoryTimezone ?? "the backend's timezone");
	const off = $derived(memoryMaintenanceOff(settings));
	const levels = $derived(settings.model === null ? [] : maintenanceThinkingLevels(settings.model, backend.models));
	const options = $derived<ComboOption[]>([
		{ value: '', label: 'No model (off)', description: 'Maintenance does not run' },
		...modelOptions(backend.models, backend.providers)
	]);

	function save(next: Partial<MemoryMaintenanceSettings>): void {
		void backend.saveMemoryMaintenance({ ...settings, ...next });
	}

	function pick(key: string): void {
		const model = backend.models.find((entry) => modelKey(entry) === key);
		const level = settings.thinkingLevel;
		// A level the new model does not offer would be refused, so it goes back to the model's own default.
		const keep = model !== undefined && level !== null && model.thinkingLevels.includes(level);
		save({
			model: model === undefined ? null : { provider: model.provider, modelId: model.modelId },
			thinkingLevel: keep ? level : null
		});
	}

	function commitTime(text: string): void {
		const time = parseNightlyTime(text);
		if (time === undefined) throw new Error('Use a time like 03:00.');
		save({ time });
	}

	function commitWrites(text: string): void {
		const afterWrites = parseAfterWrites(text);
		if (afterWrites === undefined) throw new Error('Enter a whole number from 1 to 1000.');
		save({ afterWrites });
	}
</script>

<SettingsGroup title="Memory maintenance" description="Tidies the memory notes on this backend, one commit per run.">
	{#snippet actions()}
		<StatusChip tone={off ? 'muted' : 'ok'}>{off ? 'Off' : 'On'}</StatusChip>
	{/snippet}
	{#if backend.memoryMaintenance === undefined}
		<p class="px-5 py-5 text-sm text-muted-foreground" role="status">
			{backend.memoryMaintenanceError ?? 'Reading the maintenance settings…'}
		</p>
	{:else}
		<SettingsRow label="Model" hint="Pick a model to turn maintenance on." for="maintenance-model-{backend.id}">
			{#snippet learn()}
				A run merges duplicates, resolves contradictions, fixes titles, tags and links, and archives stale memories.
				A scope is maintained only when it changed since its last run. Undoing an extraction or a run from the Memory
				tab works whether this is on or off.
			{/snippet}
			<Combobox
				id="maintenance-model-{backend.id}"
				{options}
				value={settings.model === null ? '' : modelKey(settings.model)}
				onchange={pick}
				placeholder="Choose a model…"
				searchPlaceholder="Search models or providers…"
				disabled={backend.models.length === 0}
			/>
		</SettingsRow>
		<SettingsRow label="Thinking level" hint="How hard the model thinks during a run." for="maintenance-thinking-{backend.id}">
			<ThinkingSelect
				id="maintenance-thinking-{backend.id}"
				{levels}
				value={settings.thinkingLevel as ThinkingLevel | null}
				onchange={(level) => save({ thinkingLevel: level })}
				disabled={off}
			/>
		</SettingsRow>
		<SettingsRow label="Nightly at" hint="Backend time ({timezone})." for="maintenance-time-{backend.id}" control="auto">
			<AutoInput id="maintenance-time-{backend.id}" type="time" class="w-36" value={settings.time} disabled={off} commit={commitTime} />
		</SettingsRow>
		<SettingsRow label="After writes" hint="Also run once a scope has this many new writes." for="maintenance-writes-{backend.id}" control="auto">
			<AutoInput
				id="maintenance-writes-{backend.id}"
				type="number"
				min={1}
				max={1000}
				class="w-28"
				value={String(settings.afterWrites)}
				disabled={off}
				commit={commitWrites}
			/>
		</SettingsRow>
		<div class="flex flex-wrap items-center gap-x-3 px-4 py-2.5 text-xs text-muted-foreground sm:px-5" aria-live="polite">
			<span>{memoryMaintenanceSummary(settings, timezone)}</span>
			{#if backend.memoryMaintenanceSaving}<span>Saving…</span>{/if}
		</div>
		{#if backend.memoryMaintenanceError !== undefined}
			<div class="px-4 pb-3 sm:px-5"><Banner tone="error">{backend.memoryMaintenanceError}</Banner></div>
		{/if}
	{/if}
</SettingsGroup>
