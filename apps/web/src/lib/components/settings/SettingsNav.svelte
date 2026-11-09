<script lang="ts">
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import SettingsIcon from '#lib/components/settings/SettingsIcon.svelte';
	import StatusChip from '#lib/components/settings/StatusChip.svelte';
	import type { SettingsSectionInfo } from '#lib/settings.js';

	export type SettingsNavItem = SettingsSectionInfo & {
		href: string;
		/** A state worth seeing before opening the section: "No model", "2 paused". */
		chip?: { label: string; tone: 'ok' | 'warn' | 'err' | 'info' | 'muted' };
	};

	/**
	 * The list of sections. Beside the content on a wide screen (icon and name, the current one raised); on a phone it
	 * is the whole screen, a row per section with its hint and a chevron, each row at least 44px tall.
	 */
	let { items, activeId, label }: { items: readonly SettingsNavItem[]; activeId?: string; label: string } = $props();
</script>

<nav aria-label={label} class="flex flex-col gap-1 max-md:gap-2" data-settings-nav>
	{#each items as item (item.id)}
		{@const active = item.id === activeId}
		<a
			href={item.href}
			aria-current={active ? 'page' : undefined}
			data-section={item.id}
			class="group relative flex min-h-11 items-center gap-3 rounded-xl px-2.5 py-2 transition-colors hover:bg-(--chat-surface-2)/70 max-md:bg-card max-md:px-3 max-md:py-2.5 max-md:shadow-[0_1px_2px_0_rgb(0_0_0/0.04)] max-md:ring-1 max-md:ring-foreground/10 {active
				? 'bg-(--chat-surface-2) text-(--chat-fg) shadow-[inset_0_0_0_1px_var(--chat-border-strong)]'
				: 'text-(--chat-fg-muted)'}"
		>
			{#if active}
				<span
					class="absolute top-2.5 bottom-2.5 -left-px w-[3px] rounded-r-full max-md:hidden"
					style:background="var(--chat-grad)"
					aria-hidden="true"
				></span>
			{/if}
			<span
				class="grid size-8 shrink-0 place-items-center rounded-lg transition-colors max-md:size-10 {active
					? 'bg-card text-(--accent-2) shadow-xs ring-1 ring-foreground/10'
					: 'bg-(--chat-surface-2)/70 text-(--chat-fg-muted) group-hover:text-(--chat-fg)'}"
			>
				<SettingsIcon name={item.icon} class="size-4 max-md:size-[1.15rem]" />
			</span>
			<span class="flex min-w-0 flex-1 flex-col">
				<span class="truncate text-sm leading-5 font-medium {active ? 'font-semibold' : 'max-md:text-(--chat-fg)'}">
					{item.label}
				</span>
				<span class="truncate text-xs leading-4 text-(--chat-fg-subtle) md:hidden">{item.hint}</span>
			</span>
			{#if item.chip}
				<StatusChip tone={item.chip.tone} class="h-5 px-2 text-[0.6875rem] max-md:hidden lg:inline-flex">
					{item.chip.label}
				</StatusChip>
			{/if}
			<ChevronRightIcon class="size-4 shrink-0 text-(--chat-fg-subtle) md:hidden" aria-hidden="true" />
		</a>
	{/each}
</nav>
