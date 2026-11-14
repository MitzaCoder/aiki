<script lang="ts">
	import { formatWallTime } from '#lib/time-format.ts';
	import { cn } from '#lib/utils.js';

	/** Keep the native editor's HH:mm value, but never let its locale override the displayed clock preference. */
	let {
		value = $bindable(''), id, disabled = false, onchange, class: className,
		'aria-label': label, 'aria-invalid': invalid
	}: {
		value?: string;
		id?: string;
		disabled?: boolean;
		onchange?: (value: string) => void;
		class?: string;
		'aria-label'?: string;
		'aria-invalid'?: boolean;
	} = $props();
	let picker: HTMLInputElement;
	let nativeFallback = $state(false);
	function openPicker(): void {
		try {
			if (typeof picker.showPicker === 'function') { picker.showPicker(); return; }
		} catch { /* Older browsers may expose showPicker without supporting time inputs. */ }
		nativeFallback = true;
		queueMicrotask(() => picker.focus());
	}
</script>

<div class="relative inline-flex">
	<button
		{id} type="button" {disabled} aria-label={label ? `${label}: ${formatWallTime(value)}` : undefined}
		onclick={openPicker}
		class={cn('inline-flex min-h-11 items-center justify-center rounded-md border border-input bg-transparent px-3 text-base tabular-nums shadow-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50', className)}
	>{formatWallTime(value) || 'Choose time'}</button>
	<input
		bind:this={picker} type="time" {value} {disabled} aria-label={`${label ?? 'Time of day'}, edit time`} aria-invalid={invalid}
		tabindex={nativeFallback ? 0 : -1} aria-hidden={!nativeFallback}
		class={nativeFallback ? 'absolute top-full z-10 mt-1 rounded-md border border-input bg-background p-2 text-base shadow-md' : 'sr-only'}
		onchange={(event) => {
			value = event.currentTarget.value;
			onchange?.(value);
			nativeFallback = false;
		}}
		onblur={() => { nativeFallback = false; }}
	/>
</div>
