<script lang="ts">
	import ArrowDownIcon from '@lucide/svelte/icons/arrow-down';
	import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';
	import XIcon from '@lucide/svelte/icons/x';
	import { onMount } from 'svelte';
	import AutoInput from '#lib/components/settings/AutoInput.svelte';
	import Combobox from '#lib/components/settings/Combobox.svelte';
	import SaveStatus from '#lib/components/settings/SaveStatus.svelte';
	import SettingsGroup from '#lib/components/settings/SettingsGroup.svelte';
	import SettingsRow from '#lib/components/settings/SettingsRow.svelte';
	import SettingsSection from '#lib/components/settings/SettingsSection.svelte';
	import StatusChip from '#lib/components/settings/StatusChip.svelte';
	import Switch from '#lib/components/settings/Switch.svelte';
	import ThinkingSelect from '#lib/components/settings/ThinkingSelect.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { modelLabel, type BackendConnection } from '#lib/harness.svelte.js';
	import { modelKey, modelOptions, sameModel } from '#lib/models.js';
	import { SaveState } from '#lib/save-state.svelte.js';
	import { moveWorkerModel, removeWorkerModel, setWorkerModelThinkingLevel } from '#lib/workers.js';
	import { THINKING_LEVELS, type ModelRef, type ThinkingLevel, type WorkerModel } from '@kemiri/protocol';

	/**
	 * Project → Workers: the ordered list of default worker models (each with the thinking level workers get on it)
	 * and the coordinator's check-ins while workers run. Every edit saves at once through `projects.configure`; the
	 * project summary the backend answers with is what shows, so another device's change appears here too.
	 */
	let { backend, projectId }: { backend: BackendConnection; projectId: string } = $props();

	const project = $derived(backend.projects.find((entry) => entry.id === projectId));
	const stored = $derived(project?.workerModels ?? []);

	// ---- default worker models
	let draft = $state<WorkerModel[]>([]);
	let initializedFor = $state<string | undefined>(undefined);
	const modelsSave = new SaveState();
	let adding = $state('');

	function signature(models: readonly WorkerModel[]): string {
		return `${projectId}|${models.map((model) => `${modelKey(model)}:${model.thinkingLevel ?? ''}`).join(',')}`;
	}

	$effect(() => {
		const next = signature(stored);
		if (initializedFor === next) return;
		initializedFor = next;
		draft = [...stored];
	});

	/** Saves run one at a time and always send the latest list, so a burst of clicks cannot land out of order. */
	let pending: WorkerModel[] | undefined;
	let running = false;

	async function persist(next: WorkerModel[]): Promise<void> {
		draft = next;
		pending = next;
		if (running) return;
		running = true;
		while (pending !== undefined) {
			const target = pending;
			pending = undefined;
			const ok = await modelsSave.run(() => backend.configureProject(projectId, { workerModels: target }));
			if (!ok) {
				pending = undefined;
				draft = [...stored];
				initializedFor = signature(stored);
				break;
			}
		}
		running = false;
	}

	const addable = $derived(
		modelOptions(
			backend.models.filter((model) => !draft.some((entry) => sameModel(entry, model))),
			backend.providers
		)
	);

	function add(key: string): void {
		const model = backend.models.find((entry) => modelKey(entry) === key);
		adding = '';
		if (model === undefined) return;
		void persist([...draft, { provider: model.provider, modelId: model.modelId, thinkingLevel: null }]);
	}

	function levelsFor(model: WorkerModel): readonly ThinkingLevel[] {
		return backend.models.find((entry) => sameModel(entry, model))?.thinkingLevels ?? THINKING_LEVELS;
	}

	function move(index: number, delta: number): void {
		const next = moveWorkerModel(draft, index, delta);
		if (next !== draft) void persist(next);
	}

	function remove(model: ModelRef): void {
		const next = removeWorkerModel(draft, model);
		if (next !== draft) void persist(next);
	}

	function setLevel(model: WorkerModel, level: ThinkingLevel | null): void {
		const next = setWorkerModelThinkingLevel(draft, model, level);
		if (next !== draft) void persist(next);
	}

	// ---- check-ins
	const checkInsSave = new SaveState();
	const checkIns = $derived(project?.checkIns ?? { enabled: true, intervalMinutes: 10 });

	async function saveCheckIns(next: { enabled: boolean; intervalMinutes: number }): Promise<void> {
		await backend.configureProject(projectId, { checkIns: next });
	}

	async function commitMinutes(text: string): Promise<void> {
		const minutes = Number(text);
		if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
			throw new Error('Enter a whole number of minutes between 1 and 1440.');
		}
		await saveCheckIns({ enabled: checkIns.enabled, intervalMinutes: minutes });
	}

	onMount(() => {
		void backend.ensureLoaded();
	});
</script>

<SettingsSection title="Workers" description="Which models workers run on, and when the coordinator checks on them." icon="users">
	<SettingsGroup title="Default worker models" description="Tried in this order when nothing else names a model.">
		{#each draft as model, index (modelKey(model))}
			{@const name = modelLabel(model, backend.models)}
			<div class="flex flex-wrap items-center gap-x-3 gap-y-2.5 px-4 py-3 sm:px-5" data-worker-model={modelKey(model)}>
				<span class="grid size-7 shrink-0 place-items-center rounded-full bg-(--chat-surface-2) text-xs font-semibold text-(--chat-fg-muted)">
					{index + 1}
				</span>
				<span class="flex min-w-0 flex-1 basis-40 flex-col">
					<span class="truncate text-sm font-semibold">{name}</span>
					<span class="truncate font-mono text-xs text-muted-foreground">{modelKey(model)}</span>
				</span>
				<div class="flex w-full items-center gap-1 sm:w-auto">
					<ThinkingSelect
						class="min-w-0 flex-1 sm:w-48 sm:flex-none"
						levels={levelsFor(model)}
						value={model.thinkingLevel ?? null}
						onchange={(level) => setLevel(model, level)}
					/>
					<Button variant="ghost" size="icon" class="max-sm:size-11" aria-label="Move {name} up" disabled={index === 0} onclick={() => move(index, -1)}>
						<ArrowUpIcon />
					</Button>
					<Button
						variant="ghost"
						size="icon"
						class="max-sm:size-11"
						aria-label="Move {name} down"
						disabled={index === draft.length - 1}
						onclick={() => move(index, 1)}
					>
						<ArrowDownIcon />
					</Button>
					<Button variant="ghost" size="icon" class="max-sm:size-11" aria-label="Remove {name}" onclick={() => remove(model)}>
						<XIcon />
					</Button>
				</div>
			</div>
		{:else}
			<p class="px-5 py-5 text-sm text-muted-foreground">
				None yet. The coordinator then has to name a model when it delegates, or you pick one in the composer.
			</p>
		{/each}
		<SettingsRow
			label="Add a model"
			hint="Pick one to put it at the end of the list."
			for="add-worker-model"
			status={modelsSave}
			onretry={() => void persist(draft)}
		>
			{#snippet learn()}
				New workers run on the model the coordinator names when it delegates, else the one picked in the composer,
				else the first of these that this backend offers. A model's thinking level applies unless the coordinator or
				the composer names one; "Model default" leaves it to the model.
			{/snippet}
			<Combobox
				id="add-worker-model"
				options={addable}
				value={adding}
				onchange={add}
				placeholder={addable.length === 0 ? 'Every model is in the list' : 'Add a model…'}
				searchPlaceholder="Search models or providers…"
				disabled={addable.length === 0}
			/>
		</SettingsRow>
	</SettingsGroup>

	<SettingsGroup title="Check-ins">
		<SettingsRow
			label="Wake the coordinator while workers run"
			hint="A short digest of each worker, so it can steer one that is stuck."
			for="check-ins-enabled"
			control="auto"
			status={checkInsSave}
		>
			{#snippet learn()}
				While at least one worker runs, the coordinator is woken every few minutes with each worker's status, how
				long since its last activity and its recent tool calls. The check-in waits for the coordinator's next turn
				instead of interrupting one, and nothing is sent while no worker runs.
			{/snippet}
			<div class="flex items-center gap-2">
				<StatusChip tone={checkIns.enabled ? 'ok' : 'muted'}>{checkIns.enabled ? 'On' : 'Off'}</StatusChip>
				<Switch
					id="check-ins-enabled"
					checked={checkIns.enabled}
					onchange={(on) =>
						void checkInsSave.run(() => saveCheckIns({ enabled: on, intervalMinutes: checkIns.intervalMinutes }))}
				/>
			</div>
		</SettingsRow>
		<SettingsRow label="Every" hint="Ten minutes by default; shorter costs more model turns." for="check-in-minutes" control="auto">
			<AutoInput
				id="check-in-minutes"
				type="number"
				min={1}
				max={1440}
				step={1}
				class="w-24"
				suffix="minutes"
				value={String(checkIns.intervalMinutes)}
				disabled={!checkIns.enabled}
				commit={commitMinutes}
			/>
		</SettingsRow>
	</SettingsGroup>
</SettingsSection>
