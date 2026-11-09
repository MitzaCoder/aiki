<script lang="ts">
	import { cn } from '#lib/utils.js';

	/**
	 * An on/off setting. The button is the whole 44px target on a phone; the track inside is the visible part. It is
	 * controlled: `onchange` asks for the new value and the caller saves it, so a failed save leaves the switch where
	 * it was.
	 */
	let {
		checked,
		onchange,
		id,
		label,
		disabled = false,
		class: className
	}: {
		checked: boolean;
		onchange: (checked: boolean) => void;
		id?: string;
		/** The accessible name when no `<label for>` names it. */
		label?: string;
		disabled?: boolean;
		class?: string;
	} = $props();
</script>

<button
	type="button"
	role="switch"
	{id}
	aria-checked={checked}
	aria-label={label}
	{disabled}
	class={cn(
		'group inline-flex h-11 min-w-11 shrink-0 items-center justify-center rounded-full outline-none disabled:cursor-not-allowed disabled:opacity-50 sm:h-8 sm:min-w-9',
		className
	)}
	onclick={() => onchange(!checked)}
>
	<span
		class="relative h-6 w-10 rounded-full ring-1 ring-foreground/15 transition-colors group-focus-visible:ring-3 group-focus-visible:ring-ring/50 motion-reduce:transition-none sm:h-5 sm:w-9 {checked
			? 'bg-primary'
			: 'bg-(--chat-surface-2)'}"
	>
		<span
			class="absolute top-0.5 left-0.5 size-5 rounded-full bg-card shadow-sm ring-1 ring-foreground/10 transition-transform motion-reduce:transition-none sm:size-4 {checked
				? 'translate-x-4'
				: ''}"
		></span>
	</span>
</button>
