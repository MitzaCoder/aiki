<script lang="ts">
	import type { ThemeId } from '#lib/themes/themes.js';

	/**
	 * A small drawing of the app in one theme, light or dark: the sidebar, a user bubble, a reply with its orb, the
	 * composer and the four gradient stops. It reads the theme's own tones through `data-theme-preview`, so it shows
	 * the theme whether or not it is the chosen one and whatever the page's mode is.
	 */
	let { id, dark = false }: { id: ThemeId; dark?: boolean } = $props();
</script>

<div
	data-theme-preview={id}
	class="{dark ? 'dark' : ''} pointer-events-none relative flex h-[5.5rem] select-none overflow-hidden"
	style:background="var(--tone-bg)"
	style:color="var(--tone-fg)"
	aria-hidden="true"
>
	<div
		class="flex w-[28%] flex-col gap-1 px-1.5 pt-2"
		style:background="var(--tone-surface)"
		style:border-right="1px solid var(--tone-border)"
	>
		<div class="h-1.5 w-3/4 rounded-full" style:background="var(--tone-surface-2)"></div>
		<div class="h-2 w-full rounded" style:background="var(--tone-surface-2)"></div>
		<div class="h-1.5 w-2/3 rounded-full opacity-60" style:background="var(--tone-fg-subtle)"></div>
		<div class="h-1.5 w-1/2 rounded-full opacity-60" style:background="var(--tone-fg-subtle)"></div>
	</div>
	<div class="flex min-w-0 flex-1 flex-col gap-1.5 p-2">
		<div
			class="ml-auto h-3 w-3/5 rounded-md"
			style:background="var(--tone-user-bubble)"
			style:border="1px solid var(--tone-user-border)"
		></div>
		<div class="flex items-start gap-1.5">
			<div
				class="mt-px size-3 shrink-0 rounded-full"
				style:background="linear-gradient(135deg, var(--tone-accent-1), var(--tone-accent-2), var(--tone-accent-3), var(--tone-accent-4))"
			></div>
			<div class="flex flex-1 flex-col gap-1 pt-0.5">
				<div class="h-1 w-full rounded-full opacity-70" style:background="var(--tone-fg-muted)"></div>
				<div class="h-1 w-4/5 rounded-full opacity-50" style:background="var(--tone-fg-muted)"></div>
			</div>
		</div>
		<div
			class="mt-auto flex h-4 items-center justify-end rounded-full pr-0.5"
			style:background="var(--tone-surface)"
			style:border="1px solid var(--tone-border-strong)"
		>
			<div class="size-3 rounded-full" style:background="var(--tone-primary)"></div>
		</div>
	</div>
	<div class="absolute inset-x-0 top-0 flex h-[3px]">
		<div class="flex-1" style:background="var(--tone-accent-1)"></div>
		<div class="flex-1" style:background="var(--tone-accent-2)"></div>
		<div class="flex-1" style:background="var(--tone-accent-3)"></div>
		<div class="flex-1" style:background="var(--tone-accent-4)"></div>
	</div>
</div>
