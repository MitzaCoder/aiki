<script lang="ts">
	import type { Snippet } from 'svelte';
	import LearnMore from '#lib/components/settings/LearnMore.svelte';
	import SaveStatus from '#lib/components/settings/SaveStatus.svelte';
	import type { SaveState } from '#lib/save-state.svelte.js';
	import { cn } from '#lib/utils.js';

	/**
	 * One setting: its label and a one-line hint on the left, the control on the right (stacked, full width, on a
	 * phone). `learn` is the longer explanation, behind a "Learn more" disclosure. `status` is this field's own save
	 * state. `below` spans the whole row, for a preview or a warning about this field.
	 *
	 * Pass the control's `id` as `for` so the label names it.
	 */
	let {
		label,
		hint,
		for: forId,
		learn,
		status,
		onretry,
		control = 'wide',
		below,
		children
	}: {
		label: string;
		hint?: string;
		for?: string;
		learn?: Snippet;
		status?: SaveState;
		onretry?: () => void;
		/** `wide` suits a combobox, `auto` a switch or a short input, `full` takes the whole row on a wide screen too. */
		control?: 'wide' | 'auto' | 'full';
		below?: Snippet;
		children?: Snippet;
	} = $props();

	const hintId = $props.id();
</script>

<div
	class={cn(
		'grid gap-x-8 px-4 py-3.5 sm:px-5',
		control === 'full' ? '' : 'sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start'
	)}
	data-settings-row
>
	<div class="flex min-w-0 flex-col gap-0.5">
		{#if forId}
			<label for={forId} class="text-sm leading-5 font-semibold">{label}</label>
		{:else}
			<span class="text-sm leading-5 font-semibold">{label}</span>
		{/if}
		{#if hint}
			<p id={hintId} class="text-[0.8125rem] leading-5 text-muted-foreground">{hint}</p>
		{/if}
		{#if learn}
			<LearnMore>{@render learn()}</LearnMore>
		{/if}
	</div>
	{#if children}
		<div
			class={cn(
				'mt-2.5 flex min-w-0 flex-col gap-1.5 sm:mt-0',
				control === 'wide' && 'sm:w-80',
				control === 'auto' && 'items-start sm:items-end'
			)}
		>
			{@render children()}
			{#if status}
				<div class={control === 'auto' ? 'sm:text-right' : ''}>
					<SaveStatus state={status} {onretry} />
				</div>
			{/if}
		</div>
	{/if}
	{#if below}
		<div class="has-[*]:mt-2.5 {control === 'full' ? '' : 'sm:col-span-2'}">{@render below()}</div>
	{/if}
</div>
