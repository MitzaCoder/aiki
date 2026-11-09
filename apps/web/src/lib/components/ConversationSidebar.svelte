<script lang="ts">
	import BrainIcon from '@lucide/svelte/icons/brain';
	import InfoIcon from '@lucide/svelte/icons/info';
	import KanbanIcon from '@lucide/svelte/icons/square-kanban';
	import LayersIcon from '@lucide/svelte/icons/layers';
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
		sidebarTabLayout,
		sidebarTabName,
		sidebarWidthAfterKey,
		sidebarWidthFromPointer,
		type SidebarTab,
		type SidebarTabLayout
	} from '#lib/sidebar.js';

	/**
	 * The chat's right sidebar: one tab for the project's board, one for main's background threads, one for the
	 * conversation's context, one for its memory. Its left edge drags, remembers its width in this browser, and
	 * expands to fill the chat area; below 72rem it is a full-screen sheet instead,
	 * with no resize and no expand.
	 *
	 * The tabs and their bodies come from the screen, so the coordinator's chat and a
	 * worker's transcript share this shell.
	 */
	let {
		open = $bindable(false),
		tab = $bindable<SidebarTab>('info'),
		expanded = $bindable(false),
		tabs,
		badges = {},
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
		/** Counts shown on a tab (open questions, running threads); a zero or missing one shows nothing. */
		badges?: Partial<Record<SidebarTab, number>>;
		/** Tab names that differ from the usual ones. */
		labels?: Partial<Record<SidebarTab, string>>;
		/** What the sidebar belongs to, for the sheet's title and the aside's label. */
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
	let tablist = $state<HTMLDivElement | undefined>(undefined);
	let tablistWidth = $state(Number.POSITIVE_INFINITY);

	const TAB_ICONS = {
		board: KanbanIcon,
		background: LayersIcon,
		info: InfoIcon,
		memory: BrainIcon
	} as const;
	const tabLayout: SidebarTabLayout = $derived(sidebarTabLayout(tablistWidth, tabs, tab, badges));

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

	// The tab row's own width decides how many labels fit, whether the sidebar, its expanded form or the sheet holds it.
	$effect(() => {
		if (!tablist) return;
		const element = tablist;
		tablistWidth = element.clientWidth;
		const observer = new ResizeObserver(() => {
			tablistWidth = element.clientWidth;
		});
		observer.observe(element);
		return () => observer.disconnect();
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

	function close(): void {
		open = false;
		expanded = false;
	}

	function selectTab(next: SidebarTab): void {
		tab = next;
	}

	function onTabKeydown(event: KeyboardEvent): void {
		if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
		if (tabs.length < 2) return;
		event.preventDefault();
		const index = tabs.indexOf(tab);
		const next = tabs[(index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
		if (next === undefined) return;
		tab = next;
		tablist?.querySelector<HTMLElement>(`[data-sidebar-tab="${next}"]`)?.focus();
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
				<div
					bind:this={tablist}
					role="tablist"
					aria-label={label}
					tabindex={-1}
					class="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden"
					onkeydown={onTabKeydown}
				>
					{#each tabs as entry (entry)}
						{@const Icon = TAB_ICONS[entry]}
						{@const showLabel = tabLayout === 'labels' || (tabLayout === 'active-label' && tab === entry)}
						{@const badge = badges[entry]}
						<button
							type="button"
							role="tab"
							id="sidebar-tab-{entry}"
							data-sidebar-tab={entry}
							aria-selected={tab === entry}
							aria-controls="sidebar-panel"
							aria-label={sidebarTabName(entry, badge, labels)}
							title={showLabel ? undefined : sidebarTabName(entry, badge, labels)}
							tabindex={tab === entry ? 0 : -1}
							class="relative flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors"
							class:bg-(--chat-surface-2)={tab === entry}
							class:text-(--chat-fg)={tab === entry}
							class:text-(--chat-fg-subtle)={tab !== entry}
							class:hover:text-(--chat-fg)={tab !== entry}
							onclick={() => selectTab(entry)}
						>
							<Icon class="size-3.5 shrink-0" />
							{#if showLabel}<span class="whitespace-nowrap">{sidebarTabLabel(entry, labels)}</span>{/if}
							{#if badge !== undefined && badge > 0}
								<span
									class="grid min-w-4 place-items-center rounded-full px-1 text-[0.625rem] leading-4 font-semibold text-white {showLabel
										? ''
										: 'absolute -top-0.5 -right-0.5'}"
									style:background={entry === 'background' ? 'var(--accent-2)' : 'var(--primary)'}
									data-sidebar-tab-badge
								>
									{badge}
								</span>
							{/if}
						</button>
					{/each}
				</div>
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
			role="tabpanel"
			aria-labelledby="sidebar-tab-{tab}"
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
			<Dialog.Title class="sr-only">{label}</Dialog.Title>
			{@render panel(true)}
		</Dialog.Content>
	</Dialog.Root>
{/if}
