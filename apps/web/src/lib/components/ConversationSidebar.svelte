<script lang="ts">
	import Maximize2Icon from '@lucide/svelte/icons/maximize-2';
	import Minimize2Icon from '@lucide/svelte/icons/minimize-2';
	import XIcon from '@lucide/svelte/icons/x';
	import { onMount, type Snippet } from 'svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import {
		DEFAULT_SIDEBAR_WIDTH,
		MIN_SIDEBAR_WIDTH,
		clampSidebarWidth,
		loadSidebarState,
		maxSidebarWidth,
		persistedSidebarOpen,
		resolveSidebarTab,
		restoreSidebarOpen,
		saveSidebarState,
		sidebarTabLabel,
		sidebarWidthAfterKey,
		sidebarWidthFromPointer,
		type SidebarTab
	} from '#lib/sidebar.js';

	/**
	 * The chat's right sidebar: one panel for the project's board, one for main's background threads, one for the
	 * conversation's context, one for its memory. Its left edge drags, remembers its width in this browser, and
	 * expands to fill the chat area; below 72rem it is a full-screen sheet instead,
	 * with no resize and no expand.
	 *
	 * The available panels and their bodies come from the screen, so the coordinator's chat and a
	 * worker's transcript share this shell. Only the chat header switches panels; this shell shows a title and close.
	 */
	let {
		open = $bindable(false),
		tab = $bindable<SidebarTab>('info'),
		expanded = $bindable(false),
		tabs,
		labels = {},
		label,
		infoPanel,
		boardPanel,
		backgroundPanel,
		memoryPanel
	}: {
		open?: boolean;
		tab?: SidebarTab;
		expanded?: boolean;
		/** The tabs this backend offers; the caller renders no sidebar when it is empty. */
		tabs: readonly SidebarTab[];
		/** Tab names that differ from the usual ones. */
		labels?: Partial<Record<SidebarTab, string>>;
		/** What the sidebar belongs to, for the aside's label; the panel heading names the sheet. */
		label: string;
		/** The board's body; told whether the sidebar is full width (expanded, or the sheet), where the board fits. */
		boardPanel?: Snippet<[boolean]>;
		backgroundPanel?: Snippet;
		infoPanel?: Snippet;
		memoryPanel?: Snippet;
	} = $props();

	/** Wide enough for a sidebar beside the chat: below it the same state is a sheet. */
	const wide = new MediaQuery('(min-width: 72rem)');
	/** The width the user chose, kept as chosen so a narrow window does not overwrite it. */
	let width = $state(DEFAULT_SIDEBAR_WIDTH);
	let viewportWidth = $state(0);
	let dragging = $state(false);
	let hydrating = $state(true);
	/** What the desktop sidebar should restore on the next wide load, kept while a phone only has a sheet. */
	let desktopOpen = $state(false);
	const maxWidth = $derived(viewportWidth > 0 ? maxSidebarWidth(viewportWidth) : DEFAULT_SIDEBAR_WIDTH * 2);
	/** What is drawn: the chosen width, kept inside this window's bounds. */
	const drawnWidth = $derived(clampSidebarWidth(width, viewportWidth > 0 ? viewportWidth : maxWidth));
	const body = $derived(
		tab === 'background' ? backgroundPanel : tab === 'info' ? infoPanel : memoryPanel
	);

	onMount(() => {
		viewportWidth = window.innerWidth;
		const stored = loadSidebarState();
		width = clampSidebarWidth(stored.width, window.innerWidth);
		const resolved = resolveSidebarTab(stored.tab, tabs);
		if (resolved !== undefined) tab = resolved;
		desktopOpen = stored.open;
		// Below 72rem the same state is a sheet, which never opens itself: the user taps for it.
		if (restoreSidebarOpen(stored.open, wide.current)) open = true;
		hydrating = false;
	});

	// A narrower window may leave no room for the width the user chose; `drawnWidth` shrinks it without forgetting it.
	$effect(() => {
		const measure = (): void => {
			viewportWidth = window.innerWidth;
		};
		window.addEventListener('resize', measure);
		return () => window.removeEventListener('resize', measure);
	});

	// Width, open state and tab are per browser. The sheet's own open state is not the stored one.
	$effect(() => {
		if (hydrating || !wide.current) return;
		desktopOpen = open;
	});

	$effect(() => {
		if (hydrating) return;
		saveSidebarState({ width, open: persistedSidebarOpen(open, wide.current, desktopOpen), tab });
	});

	// A tab that a backend lost cannot stay selected.
	$effect(() => {
		const resolved = resolveSidebarTab(tab, tabs);
		if (resolved !== undefined && resolved !== tab) tab = resolved;
	});

	// Desktop has no dialog focus scope: closing returns keyboard users to the header toggle.
	let headerTrigger: HTMLElement | undefined;
	$effect(() => {
		// Switching panels while open should remember the most recent header toggle too.
		if (!open || !tabs.includes(tab)) return;
		const focused = document.activeElement;
		if (focused instanceof HTMLElement && focused.closest('header')) headerTrigger = focused;
	});

	function close(): void {
		open = false;
		expanded = false;
		if (wide.current) headerTrigger?.focus();
	}

	function startResize(event: PointerEvent): void {
		if (event.button !== 0 || expanded) return;
		event.preventDefault();
		dragging = true;
		try {
			(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		} catch {
			// A pointer the browser no longer tracks: the drag still follows the moves that arrive.
		}
	}

	function stopResize(event: PointerEvent): void {
		if (!dragging) return;
		dragging = false;
		const handle = event.currentTarget as HTMLElement;
		try {
			if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
		} catch {
			// The capture was never taken.
		}
	}

	function resizeTo(event: PointerEvent): void {
		if (!dragging) return;
		width = sidebarWidthFromPointer(event.clientX, window.innerWidth);
	}

	function resizeByKey(event: KeyboardEvent): void {
		if (expanded) return;
		const next = sidebarWidthAfterKey(width, event.key, window.innerWidth, {
			step: event.shiftKey ? 64 : undefined
		});
		if (next === undefined) return;
		event.preventDefault();
		width = next;
	}

	function resetWidth(): void {
		width = DEFAULT_SIDEBAR_WIDTH;
	}
</script>

{#snippet panel(closable: boolean)}
	<div class="flex min-h-0 flex-1 flex-col">
		<div class="flex shrink-0 items-center gap-1 border-b border-(--chat-border) px-2 py-1.5">
			<div class="mx-auto flex w-full max-w-3xl items-center gap-1">
				{#if closable}
					<Dialog.Title id="sidebar-heading" class="min-w-0 flex-1 truncate px-2 text-sm font-semibold">
						{sidebarTabLabel(tab, labels)}
					</Dialog.Title>
				{:else}
					<h2 id="sidebar-heading" class="min-w-0 flex-1 truncate px-2 text-sm font-semibold">
						{sidebarTabLabel(tab, labels)}
					</h2>
				{/if}
				{#if !closable}
					<Button
						variant="ghost"
						size="icon-sm"
						onclick={() => (expanded = !expanded)}
						aria-label={expanded ? 'Collapse the sidebar' : 'Expand the sidebar'}
						title={expanded ? 'Collapse' : 'Expand'}
						aria-pressed={expanded}
					>
						{#if expanded}<Minimize2Icon />{:else}<Maximize2Icon />{/if}
					</Button>
				{/if}
				<Button variant="ghost" size="icon-sm" onclick={close} aria-label="Close the sidebar" title="Close">
					<XIcon />
				</Button>
			</div>
		</div>
		<div
			id="sidebar-panel"
			role="region"
			aria-labelledby="sidebar-heading"
			class="flex min-h-0 flex-1 flex-col overflow-hidden"
		>
			{#if tab === 'board'}
				{@render boardPanel?.(closable || expanded)}
			{:else if body !== undefined}
				{@render body()}
			{/if}
		</div>
	</div>
{/snippet}

{#if wide.current}
	{#if open}
		<aside
			class="relative flex shrink-0 flex-col border-l border-(--chat-border) bg-(--chat-surface)/25 transition-[width] duration-300 ease-out motion-reduce:transition-none"
			class:transition-none={dragging}
			style:width={expanded ? '100%' : `${drawnWidth}px`}
			aria-label={label}
		>
			{#if !expanded}
				<div
					role="slider"
					aria-orientation="vertical"
					aria-label="Resize the sidebar"
					aria-valuenow={drawnWidth}
					aria-valuetext={`${drawnWidth} pixels`}
					aria-valuemin={MIN_SIDEBAR_WIDTH}
					aria-valuemax={maxWidth}
					aria-controls="sidebar-panel"
					tabindex="0"
					class="absolute inset-y-0 -left-1 z-20 w-2 cursor-col-resize touch-none rounded-full bg-transparent transition-colors hover:bg-(--accent-2)/40 focus-visible:bg-(--accent-2)/40 {dragging
						? 'bg-(--accent-2)/60'
						: ''}"
					onpointerdown={startResize}
					onpointermove={resizeTo}
					onpointerup={stopResize}
					onpointercancel={stopResize}
					ondblclick={resetWidth}
					onkeydown={resizeByKey}
				></div>
			{/if}
			{@render panel(false)}
		</aside>
	{/if}
{:else}
	<Dialog.Root bind:open>
		<Dialog.Content
			showCloseButton={false}
			class="inset-0 top-0 left-0 flex h-dvh max-h-dvh w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none p-0 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] sm:max-w-none"
		>
			{@render panel(true)}
		</Dialog.Content>
	</Dialog.Root>
{/if}
