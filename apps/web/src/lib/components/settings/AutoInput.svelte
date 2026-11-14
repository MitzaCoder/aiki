<script lang="ts">
 import TimeInput from "#lib/components/TimeInput.svelte";
	import SaveStatus from '#lib/components/settings/SaveStatus.svelte';
	import { Input } from '#lib/components/ui/input/index.js';
	import { SaveState } from '#lib/save-state.svelte.js';
	import { cn } from '#lib/utils.js';

	/**
	 * A text or number field that saves when it is left or on Enter, and only if the value changed. `commit` gets the
	 * trimmed text and throws to refuse it (the message shows beside the field). While the user types, the field keeps
	 * its own draft, so a value that arrives from elsewhere does not overwrite what is being typed.
	 */
	let {
		value,
		commit,
		id,
		type = 'text',
		placeholder,
		min,
		max,
		step,
		suffix,
		mono = false,
		disabled = false,
		class: className,
		state: external
	}: {
		value: string;
		commit: (value: string) => Promise<unknown> | unknown;
		id?: string;
		type?: 'text' | 'number' | 'time';
		placeholder?: string;
		min?: number;
		max?: number;
		step?: number;
		/** Words after the field: "minutes". */
		suffix?: string;
		mono?: boolean;
		disabled?: boolean;
		class?: string;
		/** Pass a SaveState to let the parent row show the status instead of this field. */
		state?: SaveState;
	} = $props();

	let draft = $state<string | undefined>(undefined);
	const own = new SaveState();
	const save = $derived(external ?? own);
	const shown = $derived(draft ?? value);

	async function flush(): Promise<void> {
		if (draft === undefined) return;
		const next = draft.trim();
		if (next === value) {
			draft = undefined;
			return;
		}
		if (await save.run(async () => commit(next))) draft = undefined;
	}
</script>

<div class="flex min-w-0 flex-col gap-1.5">
	<div class="flex items-center gap-2">
        {#if type === 'time'}
            <TimeInput {id} {disabled} value={shown} class={className}
                aria-invalid={save.status === 'failed' || undefined}
                onchange={(value) => { draft = value; save.reset(); void flush(); }} />
        {:else}
		<Input
			{id}
			{type}
			{placeholder}
			{min}
			{max}
			{step}
			{disabled}
			autocomplete="off"
			spellcheck="false"
			value={shown}
			class={cn('max-sm:h-11', mono && 'font-mono', className)}
			aria-invalid={save.status === 'failed' || undefined}
			oninput={(event) => {
				draft = event.currentTarget.value;
				save.reset();
			}}
			onblur={() => void flush()}
			onkeydown={(event) => {
				if (event.key === 'Enter') void flush();
			}}
		/>
		{/if}
		{#if suffix}<span class="text-sm text-muted-foreground">{suffix}</span>{/if}
	</div>
	{#if !external}<SaveStatus state={own} reserve={false} onretry={() => void flush()} />{/if}
</div>
