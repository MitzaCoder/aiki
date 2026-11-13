<script lang="ts">
	import { overlayScroll } from '#lib/scrollbars.js';
	import CheckIcon from '@lucide/svelte/icons/check';
	import SearchIcon from '@lucide/svelte/icons/search';
	import type { Snippet } from 'svelte';
	import { groupModels } from '#lib/models.js';
	import type { ModelInfo, ProviderInfo } from '@kemiri/protocol';

	/**
	 * The searchable model catalog: a filter over every model a backend offers,
	 * grouped by provider. The composer's pickers and the project settings page all
	 * show it; each caller owns its popover and decides what a pick does.
	 */
	let {
		models,
		providers = [],
		selected,
		onpick,
		placeholder = 'Search models…',
		listClass = 'max-h-[min(20rem,46dvh)]',
		clearOnPick = true,
		top,
		trailing,
		footer
	}: {
		models: readonly ModelInfo[];
		providers?: readonly ProviderInfo[];
		/** Whether a row shows as chosen: a check on the right. */
		selected?: (model: ModelInfo) => boolean;
		onpick: (model: ModelInfo) => void;
		placeholder?: string;
		/** The scroll area's height; the pickers and the settings list differ. */
		listClass?: string;
		/** Reset the search after a pick; off when the caller adds several models in a row. */
		clearOnPick?: boolean;
		/** Rendered above the providers, e.g. the worker picker's "Coordinator's choice". */
		top?: Snippet;
		/** Rendered on the right of each row, before the check, e.g. a model's context size. */
		trailing?: Snippet<[ModelInfo]>;
		/** Rendered below the list, e.g. the worker picker's thinking levels. */
		footer?: Snippet;
	} = $props();

	let query = $state('');
	let input = $state<HTMLInputElement | undefined>(undefined);

	const groups = $derived(groupModels(models, providers, query));
	const isSelected = $derived(selected ?? (() => false));

	function pick(model: ModelInfo): void {
		onpick(model);
		if (clearOnPick) query = '';
	}

	function pickFirst(): void {
		const first = groups.find((group) => group.models.length > 0)?.models[0];
		if (first !== undefined) pick(first);
	}

	$effect(() => {
		// On touch devices focusing would pop the keyboard over the list.
		if (!matchMedia('(pointer: coarse)').matches) {
			const timer = setTimeout(() => input?.focus({ preventScroll: true }), 50);
			return () => clearTimeout(timer);
		}
	});
</script>

<div class="flex items-center gap-2 border-b border-(--chat-border) px-3.5 py-2.5">
	<SearchIcon class="size-4 shrink-0 text-(--chat-fg-subtle)" />
	<input
		bind:this={input}
		bind:value={query}
		class="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-(--chat-fg-subtle) focus-visible:outline-none sm:text-sm"
		{placeholder}
		onkeydown={(event) => {
			if (event.key !== 'Enter') return;
			pickFirst();
		}}
	/>
</div>

<div class="relative">
<div use:overlayScroll={'parent'} class="{listClass} overflow-y-auto overscroll-contain p-1.5">
	{@render top?.()}

	{#each groups as group (group.id)}
		<p class="px-2.5 pt-2.5 pb-1 text-[0.6875rem] font-semibold tracking-wide text-(--chat-fg-subtle) uppercase">
			{group.label}
		</p>
		{#each group.models as entry (`${entry.provider}/${entry.modelId}`)}
			{@const chosen = isSelected(entry)}
			<button
				type="button"
				class="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-(--chat-surface-2) {chosen
					? 'bg-(--chat-surface-2)'
					: ''}"
				onclick={() => pick(entry)}
			>
				<span class="min-w-0 flex-1">
					<span class="block truncate text-sm font-medium">
						{entry.name}{entry.configured ? '' : ' (no credential)'}
					</span>
					<span class="block truncate font-mono text-[0.6875rem] text-(--chat-fg-subtle)">{entry.modelId}</span>
				</span>
				<span class="flex shrink-0 items-center gap-1.5 text-(--chat-fg-subtle)">
					{@render trailing?.(entry)}
					<CheckIcon class="size-4 {chosen ? 'text-(--accent-2)' : 'invisible'}" />
				</span>
			</button>
		{/each}
	{:else}
		<p class="px-3 py-4 text-center text-sm text-(--chat-fg-subtle)">No models offered.</p>
	{/each}
</div>
</div>

{@render footer?.()}
