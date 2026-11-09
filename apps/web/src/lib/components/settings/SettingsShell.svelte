<script lang="ts">
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import type { Snippet } from 'svelte';
	import ProjectsMenuButton from '#lib/components/ProjectsMenuButton.svelte';
	import SettingsNav, { type SettingsNavItem } from '#lib/components/settings/SettingsNav.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { overlayScroll } from '#lib/scrollbars.js';

	/**
	 * The frame of both settings areas. On a wide screen (768px and up) the section list stands on the left and the
	 * chosen section on the right. On a phone there is one screen at a time: the list, then a section with a back
	 * button to the screen one level up. The same markup does both; only what is hidden changes, so a section never
	 * remounts when the window is resized.
	 *
	 * `activeId` is undefined on the list itself (the area's own URL); `parentHref` is where a phone's back button goes
	 * from a section. `header` is the area's title block (its title, where it is, a connection chip).
	 */
	let {
		items,
		activeId,
		navLabel,
		leaveHref,
		leaveLabel,
		parentHref,
		parentLabel,
		header,
		children
	}: {
		items: readonly SettingsNavItem[];
		activeId?: string;
		navLabel: string;
		/** The way out of settings: back to chat, back to the projects. */
		leaveHref: string;
		leaveLabel: string;
		parentHref?: string;
		parentLabel?: string;
		header: Snippet;
		children?: Snippet;
	} = $props();

	const atList = $derived(activeId === undefined);
</script>

<div class="relative h-full w-full">
<main
	use:overlayScroll={'parent'}
	class="h-full w-full overflow-y-auto pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]"
>
	<div class="mx-auto flex w-full max-w-5xl flex-col gap-5 px-3 sm:px-5">
		<header class="flex flex-col gap-1 {atList ? '' : 'max-md:hidden'}">
			<div class="flex items-center gap-1">
				<ProjectsMenuButton />
				<Button href={leaveHref} variant="ghost" size="sm" class="-ml-1 w-fit px-2 max-md:h-11 max-md:px-3 lg:-ml-2">
					<ArrowLeftIcon data-icon="inline-start" /> {leaveLabel}
				</Button>
			</div>
			{@render header()}
		</header>

		{#if !atList && parentHref}
			<div class="md:hidden">
				<Button href={parentHref} variant="ghost" class="-ml-2 h-11 px-3 text-sm" data-settings-back>
					<ArrowLeftIcon data-icon="inline-start" /> {parentLabel ?? 'Back'}
				</Button>
			</div>
		{/if}

		<div class="md:grid md:grid-cols-[13.5rem_minmax(0,1fr)] md:items-start md:gap-8 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-10">
			<div class="{atList ? '' : 'max-md:hidden'} md:sticky md:top-3">
				<SettingsNav {items} {activeId} label={navLabel} />
			</div>
			<div class="min-w-0 {atList ? 'max-md:hidden' : ''}" data-settings-content>
				{@render children?.()}
			</div>
		</div>
	</div>
</main>
</div>
