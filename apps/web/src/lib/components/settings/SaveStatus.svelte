<script lang="ts">
	import CheckIcon from '@lucide/svelte/icons/check';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import type { SaveState } from '#lib/save-state.svelte.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';

	/**
	 * A field's save state: a spinner while it saves, a check for a moment after, and on a failure the reason, kept
	 * until the next try. It reserves its line so a row does not jump when the state changes. A failure is announced
	 * at once, the other two politely.
	 */
	let {
		state,
		onretry,
		reserve = true
	}: {
		state: SaveState;
		onretry?: () => void;
		/** Keep the line's height while idle, so a row does not jump; off where nothing sits below. */
		reserve?: boolean;
	} = $props();
</script>

<div class="text-xs leading-5 {reserve ? 'min-h-5' : ''}" data-save-status={state.status}>
	{#if state.status === 'saving'}
		<span class="inline-flex items-center gap-1.5 text-muted-foreground" role="status">
			<Spinner class="size-3" aria-label="Saving" /> Saving…
		</span>
	{:else if state.status === 'saved'}
		<span class="inline-flex items-center gap-1 font-medium text-(--chat-success)" role="status">
			<CheckIcon class="size-3.5" aria-hidden="true" /> Saved
		</span>
	{:else if state.status === 'failed'}
		<span class="inline-flex flex-wrap items-center gap-x-1.5 text-destructive" role="alert">
			<CircleAlertIcon class="size-3.5 shrink-0" aria-hidden="true" />
			<span class="min-w-0 break-words">{state.error ?? 'Not saved.'}</span>
			{#if onretry}
				<button type="button" class="rounded px-1 font-medium underline underline-offset-2" onclick={onretry}>
					Try again
				</button>
			{/if}
		</span>
	{/if}
</div>
