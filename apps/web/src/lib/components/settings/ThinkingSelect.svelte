<script lang="ts">
	import Combobox from '#lib/components/settings/Combobox.svelte';
	import { thinkingBars, thinkingOptions } from '#lib/thinking.js';
	import type { ThinkingLevel } from '@aiki/protocol';

	/**
	 * A model's thinking level as a dropdown: "Model default" and the levels the model lists, each with four small bars
	 * that fill with the effort. Empty string is "Model default" (null on the wire).
	 */
	let {
		levels,
		value,
		onchange,
		id,
		disabled = false,
		class: className
	}: {
		levels: readonly ThinkingLevel[];
		value: ThinkingLevel | null;
		onchange: (level: ThinkingLevel | null) => void;
		id?: string;
		disabled?: boolean;
		class?: string;
	} = $props();

	const options = $derived(thinkingOptions(levels, value));
	const asLevel = (key: string): ThinkingLevel | null => (key === '' ? null : (key as ThinkingLevel));
</script>

{#snippet bars(key: string)}
	<span class="flex h-3.5 shrink-0 items-end gap-[2px]" aria-hidden="true">
		{#each [1, 2, 3, 4] as bar (bar)}
			<span
				class="w-[3px] rounded-full {bar <= thinkingBars(asLevel(key)) ? 'bg-(--accent-2)' : 'bg-(--chat-border-strong)'}"
				style:height="{35 + bar * 16}%"
			></span>
		{/each}
	</span>
{/snippet}

<Combobox
	{id}
	{options}
	{disabled}
	class={className}
	value={value ?? ''}
	onchange={(key) => onchange(asLevel(key))}
	aria-label="Thinking level"
	placeholder="Model default"
>
	{#snippet selected(option)}
		<span class="flex items-center gap-2.5">
			{@render bars(option?.value ?? '')}
			<span class="truncate font-medium">{option?.label ?? 'Model default'}</span>
		</span>
	{/snippet}
	{#snippet option(entry)}
		<span class="flex items-center gap-2.5">
			{@render bars(entry.value)}
			<span class="flex min-w-0 flex-col">
				<span class="truncate font-medium">{entry.label}</span>
				{#if entry.description}
					<span class="truncate text-[0.6875rem] leading-4 text-(--chat-fg-subtle)">{entry.description}</span>
				{/if}
			</span>
		</span>
	{/snippet}
</Combobox>
