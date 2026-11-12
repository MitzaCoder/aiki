<script lang="ts">
	import { cn } from '#lib/utils.js';

	export type SegmentedOption = { value: string; label: string; disabled?: boolean };

	/**
	 * A short choice shown whole, as one raised bar of buttons: a radio group underneath, so the arrows move between
	 * the choices. For a handful of options (thinking levels); a long list is a combobox. Wraps on a narrow screen.
	 */
	let {
		options,
		value,
		onchange,
		label,
		disabled = false,
		compact = false,
		class: className
	}: {
		options: readonly SegmentedOption[];
		value: string;
		onchange: (value: string) => void;
		label: string;
		disabled?: boolean;
		/** Short desktop rows; phone choices keep their 44px touch target. */
		compact?: boolean;
		class?: string;
	} = $props();

	function onkeydown(event: KeyboardEvent): void {
		if (disabled) return;
		const keys: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
		const step = keys[event.key];
		if (step === undefined) return;
		event.preventDefault();
		const enabled = options.filter((option) => !option.disabled);
		const at = enabled.findIndex((option) => option.value === value);
		const next = enabled[(at + step + enabled.length) % enabled.length];
		if (next !== undefined) {
			const group = event.currentTarget as HTMLElement;
			onchange(next.value);
			queueMicrotask(() => group.querySelector<HTMLElement>('[aria-checked="true"]')?.focus());
		}
	}
</script>

<div
	role="radiogroup"
	aria-label={label}
	{onkeydown}
	tabindex="-1"
	class={cn('flex flex-wrap gap-1 max-sm:grid max-sm:grid-cols-3 rounded-xl bg-(--chat-surface-2)/70 p-1 ring-1 ring-foreground/10', compact && 'sm:rounded-lg sm:p-0.5', className)}
>
	{#each options as option (option.value)}
		{@const checked = option.value === value}
		<button
			type="button"
			role="radio"
			aria-checked={checked}
			tabindex={checked || (value === '' && option === options[0]) ? 0 : -1}
			disabled={disabled || option.disabled}
			class="min-h-11 flex-1 rounded-lg px-3 text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 {compact ? 'sm:min-h-7 sm:px-2 sm:text-xs' : 'sm:min-h-8'} {checked
				? 'bg-card text-(--chat-fg) shadow-sm ring-1 ring-foreground/10'
				: 'text-(--chat-fg-muted) hover:text-(--chat-fg)'}"
			onclick={() => onchange(option.value)}
		>
			{option.label}
		</button>
	{/each}
</div>
