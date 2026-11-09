<script lang="ts">
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import type { Component, Snippet } from 'svelte';
	import { clockTime, fullTime } from '#lib/chat/time.js';

	/**
	 * One quiet line in the transcript for something the harness posted about a task (a worker's report, a check-in, a
	 * thread's result, a board change). The line says what happened and names the task; the whole text opens under it
	 * when there is some. The row toggles on a tap anywhere but a link, so a phone gets a big target.
	 */
	let {
		icon: Icon,
		tone = 'quiet',
		timestamp,
		children,
		details,
		...rest
	}: {
		icon: Component<{ class?: string }>;
		tone?: 'quiet' | 'report' | 'done' | 'failed';
		timestamp?: number;
		/** The line itself. */
		children: Snippet;
		/** What the line opens into; without it the line does not open. */
		details?: Snippet;
		[attribute: string]: unknown;
	} = $props();

	let open = $state(false);

	function toggle(event: MouseEvent): void {
		if (details === undefined) return;
		if ((event.target as Element).closest('a,button') !== null) return;
		open = !open;
	}

	const TONES = {
		quiet: 'border-dashed border-(--chat-border) bg-(--chat-surface)/40',
		report: 'border-(--accent-2)/30 bg-(--chat-surface)/60',
		done: 'border-(--chat-success)/35 bg-(--chat-surface)/60',
		failed: 'border-(--chat-danger)/40 bg-(--chat-danger)/6'
	} as const;
	const ICONS = {
		quiet: 'text-(--chat-fg-subtle)',
		report: 'text-(--accent-2)',
		done: 'text-(--chat-success)',
		failed: 'text-(--chat-danger)'
	} as const;
</script>

<div class="animate-rise overflow-hidden rounded-lg border {TONES[tone]}" data-task-line {...rest}>
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div
		class="flex min-h-9 items-center gap-2 px-3 sm:min-h-7 {details ? 'cursor-pointer transition-colors hover:bg-(--chat-surface-2)/40' : ''}"
		onclick={toggle}
	>
		<Icon class="size-4 shrink-0 {ICONS[tone]}" />
		<div class="flex min-w-0 flex-1 items-center gap-2 text-sm whitespace-nowrap">
			{@render children()}
		</div>
		{#if timestamp !== undefined}
			<time class="hidden shrink-0 text-xs sm:block text-(--chat-fg-subtle)" datetime={new Date(timestamp).toISOString()} title={fullTime(timestamp)}>
				{clockTime(timestamp)}
			</time>
		{/if}
		{#if details}
			<button
				type="button"
				class="-mr-1.5 grid size-8 shrink-0 place-items-center rounded-lg sm:size-7 text-(--chat-fg-subtle) transition-colors hover:text-(--chat-fg)"
				onclick={() => (open = !open)}
				aria-expanded={open}
				aria-label={open ? 'Hide the full text' : 'Show the full text'}
				title={open ? 'Hide the full text' : 'Show the full text'}
			>
				<ChevronRightIcon class="size-3.5 transition-transform {open ? 'rotate-90' : ''}" />
			</button>
		{:else}
			<span class="-mr-1.5 size-8 shrink-0 sm:size-7" aria-hidden="true"></span>
		{/if}
	</div>

	{#if open && details}
		<div class="border-t border-(--chat-border)/70">
			{#if timestamp !== undefined}
				<p class="px-3.5 pt-2 text-xs text-(--chat-fg-subtle) sm:hidden">{fullTime(timestamp)}</p>
			{/if}
			{@render details()}
		</div>
	{/if}
</div>
