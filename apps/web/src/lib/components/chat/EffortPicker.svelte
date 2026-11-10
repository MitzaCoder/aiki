<script lang="ts" module>
	import type { ThinkingLevel } from '@aiki/protocol';

	const ORDER: ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

	/** How many of the four bars are lit for a level. */
	function intensity(level: ThinkingLevel | null): number {
		if (level === null) return 0;
		return { off: 0, minimal: 1, low: 1, medium: 2, high: 3, xhigh: 4, max: 4 }[level];
	}

	function label(level: ThinkingLevel | null): string {
		return level === null ? 'Model default' : level;
	}
</script>

<script lang="ts">
	import CheckIcon from '@lucide/svelte/icons/check';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import * as Popover from '#lib/components/ui/popover/index.js';

	/**
	 * The coordinator's thinking level, as a chip in the composer. `null` means
	 * the model's own default.
	 */
	let {
		levels,
		value,
		onchange,
		disabled = false
	}: {
		levels: readonly ThinkingLevel[];
		value: ThinkingLevel | null;
		onchange: (level: ThinkingLevel | null) => void;
		disabled?: boolean;
	} = $props();

	let open = $state(false);
	const sorted = $derived([...levels].sort((left, right) => ORDER.indexOf(left) - ORDER.indexOf(right)));
</script>

{#snippet bars(level: ThinkingLevel | null)}
	<span class="flex h-3 items-end gap-[2px]" aria-hidden="true">
		{#each [1, 2, 3, 4] as bar (bar)}
			<span
				class="w-[3px] rounded-full {bar <= intensity(level) ? 'bar-on' : 'bg-(--chat-border-strong)'}"
				style:height="{35 + bar * 16}%"
			></span>
		{/each}
	</span>
{/snippet}

<Popover.Root bind:open>
	<Popover.Trigger
		class="chip max-sm:w-8 max-sm:shrink-0 max-sm:justify-center max-sm:px-0"
		{disabled}
		title="Thinking level"
		aria-label="Thinking level: {label(value)}"
	>
		{@render bars(value)}
		<span class="max-sm:hidden">{label(value)}</span>
		<ChevronDownIcon class="size-3 shrink-0 opacity-60 max-sm:hidden" />
	</Popover.Trigger>
	<Popover.Content side="top" align="start" class="w-56 gap-0 p-1.5">
		<p class="px-2.5 pt-1.5 pb-1 text-[0.6875rem] font-semibold tracking-wide text-(--chat-fg-subtle) uppercase">
			Thinking
		</p>
		<button
			type="button"
			class="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left text-sm transition-colors hover:bg-(--chat-surface-2) {value ===
			null
				? 'bg-(--chat-surface-2)'
				: ''}"
			onclick={() => {
				onchange(null);
				open = false;
			}}
		>
			{@render bars(null)}
			<span class="flex-1 font-medium">Model default</span>
			<CheckIcon class="size-4 {value === null ? 'text-(--accent-2)' : 'invisible'}" />
		</button>
		{#each sorted as level (level)}
			{@const selected = level === value}
			<button
				type="button"
				class="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left text-sm transition-colors hover:bg-(--chat-surface-2) {selected
					? 'bg-(--chat-surface-2)'
					: ''}"
				onclick={() => {
					onchange(level);
					open = false;
				}}
			>
				{@render bars(level)}
				<span class="flex-1 font-medium">{label(level)}</span>
				<CheckIcon class="size-4 {selected ? 'text-(--accent-2)' : 'invisible'}" />
			</button>
		{/each}
	</Popover.Content>
</Popover.Root>

<style>
	.bar-on {
		background: var(--chat-grad);
		background-size: 400% 100%;
	}
</style>
