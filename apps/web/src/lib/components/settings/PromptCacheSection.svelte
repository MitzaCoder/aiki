<script lang="ts">
	import Switch from '#lib/components/settings/Switch.svelte';
	import Segmented from '#lib/components/settings/Segmented.svelte';
	import SettingsGroup from '#lib/components/settings/SettingsGroup.svelte';
	import SettingsRow from '#lib/components/settings/SettingsRow.svelte';
	import SettingsSection from '#lib/components/settings/SettingsSection.svelte';
	import type { BackendConnection } from '#lib/harness.svelte.js';
	import { SaveState } from '#lib/save-state.svelte.js';
	import { DEFAULT_LONG_PROMPT_CACHE, type LongPromptCache } from '@kemiri/protocol';

	/** Project → Prompt cache: who gets the one-hour cache. One choice, saved when picked. */
	let { backend, projectId }: { backend: BackendConnection; projectId: string } = $props();

	const project = $derived(backend.projects.find((entry) => entry.id === projectId));
	let pending = $state<LongPromptCache | undefined>(undefined);
	const save = new SaveState();
    const warmSave = new SaveState();
    const warmSupported = $derived(backend.supports('cache-keep-warm'));
    const providerSupported = $derived(backend.models.some(model => model.provider === project?.coordinator.model?.provider && model.modelId === project?.coordinator.model?.modelId && model.provider === 'anthropic' && model.api === 'anthropic-messages'));
    async function setWarm(change: { keepPromptCacheWarm?: boolean; promptCacheWarmHours?: 1 | 2 | 4 | 8 }): Promise<void> {
        await warmSave.run(() => backend.configureProject(projectId, change));
    }
	const value = $derived(pending ?? project?.longPromptCache ?? DEFAULT_LONG_PROMPT_CACHE);

	async function pick(next: string): Promise<void> {
		pending = next as LongPromptCache;
		await save.run(() => backend.configureProject(projectId, { longPromptCache: next as LongPromptCache }));
		pending = undefined;
	}
</script>

<SettingsSection title="Prompt cache" description="How long Claude keeps a conversation it has already read." icon="database-zap">
	<SettingsGroup title="One-hour cache">
		<SettingsRow
			label="Keep the cache for an hour for"
			hint="Costs more per write, saves paying for the whole conversation again after a long wait."
			control="full"
			status={save}
			onretry={() => void pick(value)}
		>
			{#snippet learn()}
				Claude keeps what it has read for 5 minutes, and the next request pays a tenth of the price for it. A
				coordinator often waits longer than that for its workers. An hour makes each write dearer (twice the input
				price instead of 1.25 times). Workers rarely wait 5 minutes, so for them the dearer writes usually cost more
				than they save. Codex models ignore this. A change applies from the next request.
			{/snippet}
			<Segmented
				label="Keep the cache for an hour for"
                class="max-sm:grid-cols-1"
				value={value}
				onchange={(next) => void pick(next)}
				options={[
					{ value: 'coordinators', label: 'Coordinators (default)' },
					{ value: 'all', label: 'Coordinators and workers' },
					{ value: 'off', label: 'Nobody' }
				]}
			/>
		</SettingsRow>
	</SettingsGroup>
    {#if warmSupported}
        <SettingsGroup title="While idle">
            <SettingsRow label="Keep coordinator cache warm" hint="Uses cached-input tokens while idle. Claude only." status={warmSave}>
                <Switch label="Keep coordinator cache warm" checked={project?.keepPromptCacheWarm ?? true} disabled={!providerSupported || warmSave.status === 'saving'} onchange={(checked) => void setWarm({ keepPromptCacheWarm: checked })} />
            </SettingsRow>
            {#if !providerSupported}<p class="px-4 pb-3 text-xs text-(--chat-fg-subtle)">Not supported for this provider</p>{/if}
            <SettingsRow label="Stop after" hint="From the last real request, not the last refresh. 8 h by default." control="full">
                <Segmented class="max-sm:grid-cols-4" disabled={!providerSupported} label="Keep-warm idle limit" value={String(project?.promptCacheWarmHours ?? 8)} onchange={(next) => void setWarm({ promptCacheWarmHours: Number(next) as 1 | 2 | 4 | 8 })} options={[1,2,4,8].map(hours => ({ value: String(hours), label: `${hours} h` }))} />
            </SettingsRow>
        </SettingsGroup>
    {/if}
</SettingsSection>
