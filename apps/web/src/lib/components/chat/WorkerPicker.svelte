<script lang="ts">
	import BotIcon from '@lucide/svelte/icons/bot';
	import CheckIcon from '@lucide/svelte/icons/check';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import * as Popover from '#lib/components/ui/popover/index.js';
	import ModelSearchList from '#lib/components/ModelSearchList.svelte';
	import { sameModel } from '#lib/models.js';
	import {
		THINKING_LEVELS,
		type ModelInfo,
		type ModelRef,
		type ProviderInfo,
		type ThinkingLevel
	} from '@mihai-harness/protocol';

	/**
	 * The worker model and thinking level carried by the coordinator's messages:
	 * one chip in the composer, next to the coordinator's own pickers. Picking one
	 * stores it on the backend at once (`workers.defaults.set`), and it also rides
	 * on the next message for a backend that predates that request. The coordinator
	 * can still name a model when it delegates.
	 *
	 * `null` means "let the coordinator or the project decide".
	 */
	let {
		models,
		providers = [],
		model,
		thinkingLevel,
		onModelChange,
		onThinkingChange,
		disabled = false
	}: {
		models: readonly ModelInfo[];
		providers?: readonly ProviderInfo[];
		model: ModelRef | null;
		thinkingLevel: ThinkingLevel | null;
		onModelChange: (model: ModelInfo | null) => void;
		onThinkingChange: (level: ThinkingLevel | null) => void;
		disabled?: boolean;
	} = $props();

	let open = $state(false);

	const current = $derived(
		model === null
			? undefined
			: models.find((entry) => entry.provider === model?.provider && entry.modelId === model?.modelId)
	);
	const levels = $derived<readonly ThinkingLevel[]>(current?.thinkingLevels ?? THINKING_LEVELS);

	function chooseDefault(): void {
		onModelChange(null);
		open = false;
	}
</script>

<Popover.Root bind:open>
	<Popover.Trigger
		class="chip max-w-[min(13rem,100%)] max-sm:w-8 max-sm:shrink-0 max-sm:justify-center max-sm:px-0"
		{disabled}
		title="Worker model and thinking level"
		aria-label="Worker model: {current?.name ?? 'default'}"
	>
		<BotIcon class="size-3.5 shrink-0 text-(--accent-2)" />
		<span class="truncate max-sm:hidden">{current?.name ?? 'Worker default'}</span>
		{#if thinkingLevel !== null}
			<span class="shrink-0 text-(--chat-fg-subtle) max-sm:hidden">· {thinkingLevel}</span>
		{/if}
		<ChevronDownIcon class="size-3 shrink-0 opacity-60 max-sm:hidden" />
	</Popover.Trigger>

	<Popover.Content side="top" align="start" class="w-[26rem] max-w-[calc(100vw-1.5rem)] gap-0 p-0">
		<ModelSearchList
			{models}
			{providers}
			selected={(entry) => model !== null && sameModel(entry, model)}
			onpick={(entry) => onModelChange(entry)}
			placeholder="Search models for new workers…"
		>
			{#snippet top()}
				<button
					type="button"
					class="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-(--chat-surface-2) {model ===
					null
						? 'bg-(--chat-surface-2)'
						: ''}"
					onclick={chooseDefault}
				>
					<BotIcon class="size-4 shrink-0 text-(--chat-fg-subtle)" />
					<span class="min-w-0 flex-1">
						<span class="block text-sm font-medium">Coordinator's choice</span>
						<span class="block text-[0.6875rem] text-(--chat-fg-subtle)">
							Whatever the coordinator names, else the project's worker models
						</span>
					</span>
					<CheckIcon class="size-4 shrink-0 {model === null ? 'text-(--accent-2)' : 'invisible'}" />
				</button>
			{/snippet}

			{#snippet footer()}
				<div class="border-t border-(--chat-border) p-2">
					<p
						class="px-1.5 pt-0.5 pb-1.5 text-[0.6875rem] font-semibold tracking-wide text-(--chat-fg-subtle) uppercase"
					>
						Thinking level
					</p>
					<div class="flex flex-wrap gap-1">
						<button
							type="button"
							class="level {thinkingLevel === null ? 'level-on' : ''}"
							onclick={() => {
								onThinkingChange(null);
								open = false;
							}}
						>
							Model default
						</button>
						{#each levels as level (level)}
							<button
								type="button"
								class="level {thinkingLevel === level ? 'level-on' : ''}"
								onclick={() => {
									onThinkingChange(level);
									open = false;
								}}
							>
								{level}
							</button>
						{/each}
					</div>
				</div>
			{/snippet}
		</ModelSearchList>
	</Popover.Content>
</Popover.Root>

<style>
	.level {
		padding: 0.25rem 0.625rem;
		border-radius: 999px;
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--chat-fg-muted);
		transition:
			background 0.15s,
			color 0.15s;
	}
	.level:hover {
		background: var(--chat-surface-2);
		color: var(--chat-fg);
	}
	.level-on {
		background: color-mix(in oklab, var(--accent-2) 16%, transparent);
		color: var(--accent-2);
	}
</style>
