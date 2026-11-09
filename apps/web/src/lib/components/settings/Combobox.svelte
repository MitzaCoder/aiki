<script lang="ts">
	import CheckIcon from '@lucide/svelte/icons/check';
	import ChevronsUpDownIcon from '@lucide/svelte/icons/chevrons-up-down';
	import SearchIcon from '@lucide/svelte/icons/search';
	import type { Snippet } from 'svelte';
	import * as Popover from '#lib/components/ui/popover/index.js';
	import { filterOptions, moveActive, selectable, type ComboOption } from '#lib/combobox.js';
	import { cn } from '#lib/utils.js';

	/**
	 * A select you can search. The button shows the current value (its name and a second line); opening it shows a
	 * search box and the options grouped under headings, which filter as you type.
	 *
	 * Keyboard: Enter or the arrows open it from the button; in the list, the arrows, Home and End move, Enter picks,
	 * Escape closes and returns to the button. The focus stays in the search box and the list follows it
	 * (`aria-activedescendant`), the pattern for a combobox with a popup. On a touch screen the box is not focused on
	 * open, so the keyboard does not cover the list.
	 */
	let {
		options,
		value,
		onchange,
		id,
		placeholder = 'Choose…',
		searchPlaceholder = 'Search…',
		emptyText = 'Nothing matches.',
		disabled = false,
		invalid = false,
		searchable,
		class: className,
		'aria-label': ariaLabel,
		selected,
		option: optionRow
	}: {
		options: readonly ComboOption[];
		value: string;
		onchange: (value: string) => void;
		id?: string;
		placeholder?: string;
		searchPlaceholder?: string;
		emptyText?: string;
		disabled?: boolean;
		invalid?: boolean;
		/** Show the search box. By default only when the list is long (more than 8 options). */
		searchable?: boolean;
		class?: string;
		'aria-label'?: string;
		/** Replaces how the button shows the current option; it gets undefined when nothing is chosen. */
		selected?: Snippet<[ComboOption | undefined]>;
		/** Replaces a row's content (the label, description and chip). */
		option?: Snippet<[ComboOption]>;
	} = $props();

	const uid = $props.id();
	const listId = `${uid}-list`;

	let open = $state(false);
	let query = $state('');
	let active = $state(-1);
	let input = $state<HTMLInputElement | null>(null);

	const showSearch = $derived(searchable ?? options.length > 8);
	const groups = $derived(filterOptions(options, query));
	const flat = $derived(selectable(groups));
	const current = $derived(options.find((entry) => entry.value === value));
	const optionId = (entry: ComboOption): string => `${uid}-o-${options.indexOf(entry)}`;
	const activeId = $derived(active >= 0 && flat[active] !== undefined ? optionId(flat[active]) : undefined);

	// A fresh search each time it opens, with the current value under the cursor.
	$effect(() => {
		if (!open) return;
		query = '';
		const at = selectable(filterOptions(options)).findIndex((entry) => entry.value === value);
		active = at >= 0 ? at : 0;
		if (!matchMedia('(pointer: coarse)').matches) {
			const timer = setTimeout(() => input?.focus({ preventScroll: true }), 30);
			return () => clearTimeout(timer);
		}
	});

	// Typing narrows the list: the cursor goes to the first match.
	$effect(() => {
		void query;
		active = flat.length > 0 ? 0 : -1;
	});

	$effect(() => {
		const target = activeId;
		if (target === undefined || !open) return;
		document.getElementById(target)?.scrollIntoView({ block: 'nearest' });
	});

	function choose(entry: ComboOption): void {
		if (entry.disabled) return;
		open = false;
		if (entry.value !== value) onchange(entry.value);
	}

	function onkeydown(event: KeyboardEvent): void {
		const keys: Record<string, 'next' | 'previous' | 'first' | 'last'> = {
			ArrowDown: 'next',
			ArrowUp: 'previous',
			Home: 'first',
			End: 'last'
		};
		const move = keys[event.key];
		if (move !== undefined) {
			event.preventDefault();
			active = moveActive(active, flat.length, move);
		} else if (event.key === 'Enter') {
			event.preventDefault();
			const entry = flat[active];
			if (entry !== undefined) choose(entry);
		} else if (event.key === 'Tab') {
			open = false;
		}
	}
</script>

<Popover.Root bind:open>
	<Popover.Trigger
		{id}
		{disabled}
		role="combobox"
		aria-haspopup="listbox"
		aria-expanded={open}
		aria-controls={open ? listId : undefined}
		aria-label={ariaLabel}
		aria-invalid={invalid || undefined}
		data-combobox
		class={cn(
			'flex min-h-11 w-full items-center gap-2 rounded-xl border border-input bg-background px-3 py-1.5 text-left text-sm shadow-xs transition-colors outline-none hover:bg-(--chat-surface-2)/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive sm:min-h-10 dark:bg-input/30',
			className
		)}
	>
		<span class="flex min-w-0 flex-1 flex-col">
			{#if selected}
				{@render selected(current)}
			{:else if current}
				<span class="truncate font-medium">{current.label}</span>
				{#if current.description}
					<span class="truncate font-mono text-[0.6875rem] leading-4 text-(--chat-fg-subtle)">{current.description}</span>
				{/if}
			{:else}
				<span class="truncate text-muted-foreground">{placeholder}</span>
			{/if}
		</span>
		<ChevronsUpDownIcon class="size-4 shrink-0 text-(--chat-fg-subtle)" aria-hidden="true" />
	</Popover.Trigger>
	<Popover.Content
		align="start"
		sideOffset={6}
		class="w-(--bits-popover-anchor-width) min-w-[min(18rem,calc(100vw-1.5rem))] gap-0 overflow-hidden rounded-xl p-0 shadow-lg"
	>
		<div class={showSearch ? 'flex items-center gap-2 border-b border-(--chat-border) px-3 py-1' : 'sr-only'}>
			<SearchIcon class="size-4 shrink-0 text-(--chat-fg-subtle)" aria-hidden="true" />
			<input
				bind:this={input}
				bind:value={query}
				{onkeydown}
				class="h-11 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-(--chat-fg-subtle) sm:h-10 sm:text-sm"
				type="text"
				role="combobox"
				aria-expanded="true"
				aria-controls={listId}
				aria-activedescendant={activeId}
				aria-autocomplete="list"
				aria-label={ariaLabel ?? searchPlaceholder}
				placeholder={searchPlaceholder}
				autocomplete="off"
				autocapitalize="off"
				spellcheck="false"
			/>
		</div>
		<div id={listId} role="listbox" aria-label={ariaLabel} class="max-h-[min(20rem,50dvh)] overflow-y-auto overscroll-contain p-1.5">
			{#each groups as group (group.id)}
				<div role="group" aria-label={group.label} class="flex flex-col">
					{#if group.label}
						<p
							class="px-2.5 pt-2 pb-1 text-[0.6875rem] font-semibold tracking-wide text-(--chat-fg-subtle) uppercase"
							aria-hidden="true"
						>
							{group.label}
						</p>
					{/if}
					{#each group.options as entry (entry.value)}
						{@const index = flat.indexOf(entry)}
						{@const chosen = entry.value === value}
						<div
							id={optionId(entry)}
							role="option"
							tabindex="-1"
							aria-selected={chosen}
							aria-disabled={entry.disabled || undefined}
							data-active={index === active || undefined}
							class="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2.5 py-1.5 text-sm transition-colors aria-disabled:cursor-not-allowed aria-disabled:opacity-50 data-active:bg-(--chat-surface-2) sm:min-h-10"
							onpointerdown={(event) => event.preventDefault()}
							onpointermove={() => {
								if (index >= 0 && index !== active) active = index;
							}}
							onclick={() => choose(entry)}
							onkeydown={(event) => {
								if (event.key === 'Enter' || event.key === ' ') choose(entry);
							}}
						>
							<span class="flex min-w-0 flex-1 flex-col">
								{#if optionRow}
									{@render optionRow(entry)}
								{:else}
									<span class="truncate font-medium">{entry.label}</span>
									{#if entry.description}
										<span class="truncate font-mono text-[0.6875rem] leading-4 text-(--chat-fg-subtle)">{entry.description}</span>
									{/if}
								{/if}
							</span>
							{#if entry.badge}
								<span
									class="shrink-0 rounded-full border px-2 text-[0.6875rem] leading-5 font-medium"
									style:color={entry.badgeTone === 'warn' ? 'color-mix(in oklab, var(--chat-warning) 80%, var(--chat-fg))' : 'var(--chat-fg-muted)'}
									style:border-color={entry.badgeTone === 'warn' ? 'color-mix(in oklab, var(--chat-warning) 35%, transparent)' : 'var(--chat-border-strong)'}
								>
									{entry.badge}
								</span>
							{/if}
							<CheckIcon class="size-4 shrink-0 text-(--accent-2) {chosen ? '' : 'invisible'}" aria-hidden="true" />
						</div>
					{/each}
				</div>
			{:else}
				<p class="px-3 py-6 text-center text-sm text-(--chat-fg-subtle)" role="status">{emptyText}</p>
			{/each}
		</div>
	</Popover.Content>
</Popover.Root>
