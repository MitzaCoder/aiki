<script lang="ts">
	import type { Snippet } from 'svelte';
	import SettingsIcon from '#lib/components/settings/SettingsIcon.svelte';
	import type { SettingsIconName } from '#lib/settings.js';

	/**
	 * What every section starts with: its icon, a title, one line saying what it is for, and its groups below. The
	 * icon sits on a chip with a wash of the theme's gradient.
	 */
	let {
		title,
		description,
		icon,
		actions,
		children
	}: {
		title: string;
		description?: string;
		icon: SettingsIconName;
		actions?: Snippet;
		children: Snippet;
	} = $props();
</script>

<div class="flex flex-col gap-6" data-settings-section={title}>
	<header class="flex items-start gap-3.5">
		<span
			class="grid size-11 shrink-0 place-items-center rounded-xl text-(--accent-2) ring-1 ring-foreground/10"
			style:background="linear-gradient(135deg, color-mix(in oklab, var(--accent-1) 18%, var(--chat-surface)), color-mix(in oklab, var(--accent-3) 16%, var(--chat-surface)))"
		>
			<SettingsIcon name={icon} class="size-5" />
		</span>
		<div class="flex min-w-0 flex-1 flex-col gap-0.5 pt-0.5">
			<h2 class="text-xl leading-7 font-bold tracking-tight">{title}</h2>
			{#if description}
				<p class="text-sm leading-5 text-muted-foreground">{description}</p>
			{/if}
		</div>
		{@render actions?.()}
	</header>
	{@render children()}
</div>
