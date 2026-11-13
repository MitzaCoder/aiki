<script lang="ts">
	import BrainIcon from '@lucide/svelte/icons/brain';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import CpuIcon from '@lucide/svelte/icons/cpu';
	import ImageIcon from '@lucide/svelte/icons/image';
	import * as Popover from '#lib/components/ui/popover/index.js';
	import ModelSearchList from '#lib/components/ModelSearchList.svelte';
	import { sameModel } from '#lib/models.js';
	import type { ModelInfo, ModelRef, ProviderInfo } from '@kemiri/protocol';

	/**
	 * The coordinator's model, as a chip in the composer: a searchable list of
	 * every model a backend offers, grouped by provider.
	 */
	let {
		models,
		providers = [],
		value,
		onchange,
		disabled = false
	}: {
		models: readonly ModelInfo[];
		providers?: readonly ProviderInfo[];
		value: ModelRef | null;
		onchange: (model: ModelInfo) => void;
		disabled?: boolean;
	} = $props();

	let open = $state(false);

	const current = $derived(
		value === null ? undefined : models.find((model) => model.provider === value?.provider && model.modelId === value?.modelId)
	);

	const compact = new Intl.NumberFormat(undefined, { notation: 'compact' });

	function select(model: ModelInfo): void {
		onchange(model);
		open = false;
	}
</script>

<Popover.Root bind:open>
	<Popover.Trigger
		class="chip max-w-[min(12rem,100%)] max-sm:min-w-0 sm:max-w-[18rem]"
		{disabled}
		title="Coordinator model"
		aria-label="Coordinator model: {current?.name ?? 'none'}"
	>
		<CpuIcon class="size-3.5 shrink-0 text-(--accent-2)" />
		<span class="truncate">{current?.name ?? value?.modelId ?? 'Choose a model'}</span>
		<ChevronDownIcon class="size-3 shrink-0 opacity-60" />
	</Popover.Trigger>
	<Popover.Content side="top" align="start" class="w-[26rem] max-w-[calc(100vw-1.5rem)] gap-0 p-0">
		<ModelSearchList
			{models}
			{providers}
			selected={(model) => value !== null && sameModel(model, value)}
			onpick={select}
			listClass="max-h-[min(24rem,60dvh)]"
		>
			{#snippet trailing(model)}
				{#if model.input.includes('image')}
					<span title="Accepts images"><ImageIcon class="size-3.5" /></span>
				{/if}
				{#if model.reasoning}
					<span title="Reasons"><BrainIcon class="size-3.5" /></span>
				{/if}
				<span class="w-9 text-right font-mono text-[0.6875rem]">{compact.format(model.contextWindow)}</span>
			{/snippet}
		</ModelSearchList>
	</Popover.Content>
</Popover.Root>
