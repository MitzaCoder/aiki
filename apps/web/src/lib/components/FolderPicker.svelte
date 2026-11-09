<script lang="ts">
	import { tick } from 'svelte';
	import BookmarkIcon from '@lucide/svelte/icons/bookmark';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import CornerLeftUpIcon from '@lucide/svelte/icons/corner-left-up';
	import EllipsisIcon from '@lucide/svelte/icons/ellipsis';
	import FolderIcon from '@lucide/svelte/icons/folder';
	import FolderPlusIcon from '@lucide/svelte/icons/folder-plus';
	import HouseIcon from '@lucide/svelte/icons/house';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import SearchIcon from '@lucide/svelte/icons/search';
	import TrashIcon from '@lucide/svelte/icons/trash';
	import { overlayScroll } from '#lib/scrollbars.js';
	import Banner from '#lib/components/Banner.svelte';
	import FolderActionDialog, { type FolderAction } from '#lib/components/FolderActionDialog.svelte';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import * as Popover from '#lib/components/ui/popover/index.js';
	import {
		completeInput,
		expandHome,
		filterEntries,
		isPathInput,
		keyAction,
		modifiedText,
		quickPlaces,
		readPickerMemory,
		repoLabel,
		rowActions,
		shortPath,
		sortEntries,
		withLastFolder,
		withoutFolder,
		withRecentPick,
		writePickerMemory
	} from '#lib/folder-picker.js';
	import type { BackendConnection } from '#lib/harness.svelte.js';
	import type {
		DirectoryEntry,
		FilesystemCompleteResponse,
		FilesystemListResponse
	} from '@mihai-harness/protocol';

	let {
		backend,
		open = false,
		onclose,
		onadd
	}: {
		/** The backend whose host folders are listed. */
		backend: BackendConnection;
		open: boolean;
		onclose: () => void;
		/** Add the picked host directory as a project on this backend. A rejection is shown inside the picker. */
		onadd: (path: string) => Promise<void>;
	} = $props();

	let listing = $state<FilesystemListResponse | undefined>(undefined);
	let loading = $state(false);
	let error = $state<string | undefined>(undefined);
	let adding = $state(false);
	let showHidden = $state(false);
	/** The text field: a filter for this folder, or (starting with / or ~) a path to go to. */
	let filter = $state('');
	let completion = $state<(FilesystemCompleteResponse & { input: string }) | undefined>(undefined);
	/** When the listing was read, for the relative times on its rows. */
	let listedAt = $state(Date.now());
	let action = $state<FolderAction | undefined>(undefined);
	let menuFor = $state<string | undefined>(undefined);
	let placesOpen = $state(false);
	let field = $state<HTMLInputElement | null>(null);
	let list = $state<HTMLUListElement | null>(null);
	let wasOpen = false;
	/** Answers from an older directory must not replace a newer one. */
	let requestToken = 0;
	let completeToken = 0;

	const canEdit = $derived(backend.supports('filesystem-edit'));
	const canComplete = $derived(backend.supports('filesystem-complete'));
	const pathMode = $derived(isPathInput(filter));
	const completionFresh = $derived(completion !== undefined && completion.input === filter);

	const sorted = $derived(sortEntries(listing?.entries ?? []));
	const rows = $derived<DirectoryEntry[]>(
		pathMode ? (completionFresh && completion !== undefined ? completion.entries : []) : filterEntries(sorted, filter)
	);
	const places = $derived(
		listing === undefined
			? []
			: quickPlaces({
					home: listing.home,
					projectPaths: backend.projects.map((project) => project.path),
					recent: readPickerMemory()[backend.id]?.recent ?? []
				})
	);

	const crumbs = $derived.by(() => {
		const path = listing?.path;
		if (path === undefined) return [];
		const result = [{ label: 'root', path: '/' }];
		let current = '';
		for (const part of path.split('/').filter((segment) => segment.length > 0)) {
			current += `/${part}`;
			result.push({ label: part, path: current });
		}
		return result;
	});

	function errorText(value: unknown): string {
		return value instanceof Error ? value.message : String(value);
	}

	/** On a touch screen focusing the field would raise the keyboard over the list, so it waits for a tap. */
	function finePointer(): boolean {
		return typeof matchMedia !== 'function' || !matchMedia('(pointer: coarse)').matches;
	}

	function focusField(): void {
		if (finePointer()) field?.focus();
	}

	function focusRow(index: number): void {
		list?.querySelector<HTMLElement>(`[data-row-open="${index}"]`)?.focus();
	}

	/** A folder the user just made or renamed gets the focus once its dialog has closed. */
	let focusAfterClose: string | undefined;

	async function focusPath(path: string): Promise<void> {
		await tick();
		const index = rows.findIndex((entry) => entry.path === path);
		if (index >= 0) focusRow(index);
		else focusField();
	}

	function remember(update: (memory: ReturnType<typeof readPickerMemory>) => ReturnType<typeof readPickerMemory>): void {
		writePickerMemory(update(readPickerMemory()));
	}

	/**
	 * Show a directory. `quiet` is for the remembered start folder: when it is gone the picker falls back to Home
	 * instead of opening on an error.
	 */
	async function load(
		path: string | undefined,
		hidden: boolean = showHidden,
		options: { quiet?: boolean; keepFilter?: boolean } = {}
	): Promise<boolean> {
		const token = ++requestToken;
		loading = true;
		error = undefined;
		try {
			const next = await backend.listDirectory({
				...(path === undefined ? {} : { path }),
				showHidden: hidden
			});
			if (token !== requestToken) return false;
			listing = next;
			listedAt = Date.now();
			if (options.keepFilter !== true) filter = '';
			completion = undefined;
			remember((memory) => withLastFolder(memory, backend.id, next.path));
			return true;
		} catch (value) {
			if (token !== requestToken) return false;
			if (options.quiet === true && path !== undefined) {
				remember((memory) => withoutFolder(memory, backend.id, path));
				loading = false;
				return load(undefined, hidden);
			}
			// Keep the folder that is already shown; an unreadable folder is an error, not a broken picker.
			error = errorText(value);
			return false;
		} finally {
			if (token === requestToken) loading = false;
		}
	}

	async function go(path: string | undefined): Promise<void> {
		if (await load(path)) focusField();
	}

	async function useFolder(path: string | undefined = listing?.path): Promise<void> {
		if (path === undefined) return;
		adding = true;
		error = undefined;
		try {
			await onadd(path);
			remember((memory) => withRecentPick(memory, backend.id, path));
			onclose();
		} catch (value) {
			error = errorText(value);
		} finally {
			adding = false;
		}
	}

	/** Enter in the text field. */
	async function submitField(): Promise<void> {
		const text = filter.trim();
		if (text === '') return;
		if (!pathMode) {
			if (rows.length === 1 && rows[0] !== undefined) await go(rows[0].path);
			else if (rows.length > 1) focusRow(0);
			return;
		}
		if (completionFresh && completion !== undefined) {
			if (completion.exact !== null) return go(completion.exact);
			if (completion.entries.length === 1 && completion.entries[0] !== undefined) return go(completion.entries[0].path);
			if (completion.entries.length > 1) {
				// Several folders match: finish what they share, or step into the list to choose one.
				const next = completeInput(filter, completion.entries);
				if (next !== filter) filter = next;
				else focusRow(0);
				return;
			}
		}
		// Not completed yet (or no completion on this backend): ask for the folder itself.
		await go(expandHome(text, listing?.home ?? '/'));
	}

	function onFieldKeydown(event: KeyboardEvent): void {
		// Escape belongs to the dialog's handler below: it clears the field first, then closes.
		if (event.key === 'Escape') return;
		if (event.key === 'Enter') {
			event.preventDefault();
			void submitField();
			return;
		}
		if (event.key === 'Tab' && pathMode && completionFresh && completion !== undefined && !event.shiftKey) {
			const next = completeInput(filter, completion.entries);
			if (next === filter && completion.entries.length === 0) return;
			// Finish what the matches share; when that adds nothing, Tab steps into the matches.
			event.preventDefault();
			if (next !== filter) filter = next;
			else focusRow(0);
			return;
		}
		const result = keyAction(event.key, { focus: 'field', text: filter, rows: rows.length, index: -1 });
		if (result.kind === 'none') return;
		event.preventDefault();
		apply(result);
	}

	function onListKeydown(event: KeyboardEvent): void {
		const item = (event.target as HTMLElement).closest<HTMLElement>('[data-index]');
		if (item === null) return;
		const index = Number(item.dataset.index);
		if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
			// Typing while on a row goes to the field, so the filter is always one keystroke away.
			field?.focus();
			return;
		}
		const result = keyAction(event.key, { focus: 'row', text: filter, rows: rows.length, index });
		if (result.kind === 'none' || result.kind === 'close') return;
		event.preventDefault();
		apply(result);
	}

	function apply(result: ReturnType<typeof keyAction>): void {
		switch (result.kind) {
			case 'focus-row':
				focusRow(result.index);
				break;
			case 'focus-field':
				field?.focus();
				break;
			case 'go-up':
				if (listing?.parent != null) void go(listing.parent);
				break;
			case 'clear':
				filter = '';
				field?.focus();
				break;
			case 'close':
				onclose();
				break;
		}
	}

	async function perform(current: FolderAction, name: string): Promise<void> {
		if (current.kind === 'create') {
			const entry = await backend.createDirectory(current.parent, name);
			await load(listing?.path, showHidden, { keepFilter: true });
			filter = '';
			focusAfterClose = entry.path;
		} else if (current.kind === 'rename') {
			const entry = await backend.renameDirectory(current.entry.path, name);
			await load(listing?.path, showHidden, { keepFilter: true });
			focusAfterClose = entry.path;
		} else {
			await backend.deleteDirectory(current.entry.path);
			remember((memory) => withoutFolder(memory, backend.id, current.entry.path));
			await load(listing?.path, showHidden, { keepFilter: true });
			focusField();
		}
	}

	function openAction(next: FolderAction): void {
		menuFor = undefined;
		placesOpen = false;
		action = next;
	}

	$effect(() => {
		if (open && !wasOpen) {
			wasOpen = true;
			showHidden = false;
			listing = undefined;
			error = undefined;
			filter = '';
			completion = undefined;
			action = undefined;
			void load(readPickerMemory()[backend.id]?.last, false, { quiet: true, keepFilter: true });
		} else if (!open && wasOpen) {
			wasOpen = false;
		}
	});

	// A typed path asks the backend for matching folders, a moment after the last key.
	$effect(() => {
		const text = filter.trim();
		if (!open || listing === undefined || !isPathInput(text) || !canComplete) return;
		const token = ++completeToken;
		const typed = filter;
		const timer = setTimeout(async () => {
			try {
				const result = await backend.completeDirectory(text, { showHidden });
				if (token === completeToken) completion = { ...result, input: typed };
			} catch {
				// Completion is a convenience; Enter still tries the path and shows the real error.
				if (token === completeToken) completion = undefined;
			}
		}, 120);
		return () => clearTimeout(timer);
	});
</script>

{#snippet rowMenu(entry: DirectoryEntry)}
	{@const actions = rowActions(entry, canEdit)}
	{#if actions.available}
		<Popover.Root
			open={menuFor === entry.path}
			onOpenChange={(next) => {
				if (next) menuFor = entry.path;
				else if (menuFor === entry.path) menuFor = undefined;
			}}
		>
			<Popover.Trigger
				class="inline-flex size-10 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 aria-expanded:bg-muted aria-expanded:text-foreground sm:size-8"
				aria-label="Actions for {entry.name}"
				title="Rename or delete"
				disabled={adding}
			>
				<EllipsisIcon class="size-4" />
			</Popover.Trigger>
			<Popover.Content side="bottom" align="end" class="w-56 gap-1 p-1">
				<Button
					variant="ghost"
					size="sm"
					class="h-10 w-full justify-start gap-2 px-2 font-normal sm:h-8"
					disabled={!actions.rename.enabled}
					onclick={() => openAction({ kind: 'rename', entry })}
				>
					<PencilIcon class="size-4 text-muted-foreground" />
					Rename…
				</Button>
				<Button
					variant="ghost"
					size="sm"
					class="h-10 w-full justify-start gap-2 px-2 font-normal text-destructive hover:text-destructive sm:h-8"
					disabled={!actions.delete.enabled}
					onclick={() => openAction({ kind: 'delete', entry })}
				>
					<TrashIcon class="size-4" />
					Delete…
				</Button>
				{#if actions.rename.reason}
					<p class="px-2 py-1 text-xs text-muted-foreground">{actions.rename.reason}</p>
				{/if}
			</Popover.Content>
		</Popover.Root>
	{/if}
{/snippet}

<Dialog.Root
	{open}
	onOpenChange={(next) => {
		// Escape, the backdrop and the close button all end here; the parent owns `open`.
		if (!next) onclose();
	}}
>
	<Dialog.Content
		class="flex h-dvh max-h-dvh w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none p-0 max-sm:top-0 max-sm:left-0 sm:max-h-[min(85dvh,720px)] sm:max-w-xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl"
		showCloseButton={false}
		onOpenAutoFocus={(event) => {
			// A phone keeps its keyboard down until the field is tapped.
			if (!finePointer() || field === null) return;
			event.preventDefault();
			field.focus();
		}}
		onEscapeKeydown={(event) => {
			// Escape clears the field first and only then closes.
			if (keyAction('Escape', { focus: 'field', text: filter, rows: rows.length, index: -1 }).kind === 'clear') {
				event.preventDefault();
				filter = '';
				field?.focus();
			}
		}}
	>
		<Dialog.Header
			class="flex-row items-start gap-3 border-b px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 sm:px-6 sm:pt-5"
		>
			<div class="flex min-w-0 flex-1 flex-col gap-1">
				<Dialog.Title class="text-base font-semibold">Choose a folder</Dialog.Title>
				<Dialog.Description class="text-sm text-muted-foreground">
					Folders on {backend.name} where the coordinator will work.
				</Dialog.Description>
			</div>
			<Dialog.Close>
				{#snippet child({ props })}
					<Button {...props} variant="outline" size="sm">Close</Button>
				{/snippet}
			</Dialog.Close>
		</Dialog.Header>

		<div class="flex flex-wrap items-center gap-2 px-4 pt-2 sm:px-6">
			<Button
				variant="outline"
				size="sm"
				type="button"
				aria-label="Home"
				title="Home"
				disabled={loading || listing === undefined || listing.path === listing.home}
				onclick={() => void go(listing?.home)}
			>
				<HouseIcon class="size-4" />
				<span class="max-sm:sr-only">Home</span>
			</Button>
			<Button
				variant="outline"
				size="sm"
				type="button"
				aria-label="Up one folder"
				title="Up one folder (Backspace)"
				disabled={loading || listing?.parent === undefined || listing?.parent === null}
				onclick={() => void go(listing?.parent ?? undefined)}
			>
				<CornerLeftUpIcon class="size-4" />
				<span class="max-sm:sr-only">Up</span>
			</Button>
			<Popover.Root bind:open={placesOpen}>
				<Popover.Trigger
					class="inline-flex h-8 items-center gap-1.5 rounded-lg border bg-background px-2.5 text-sm font-medium transition-all outline-none hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-expanded:bg-muted disabled:pointer-events-none disabled:opacity-50"
					disabled={listing === undefined}
					aria-label="Places"
					title="Home, project folders and recent picks"
				>
					<BookmarkIcon class="size-4" />
					Places
				</Popover.Trigger>
				<Popover.Content side="bottom" align="start" class="max-h-[min(22rem,60dvh)] w-[min(22rem,calc(100vw-2rem))] gap-0 p-1">
					<div class="relative max-h-[inherit]">
					<div use:overlayScroll={'parent'} class="flex max-h-[inherit] flex-col overflow-y-auto">
						{#each places as place (place.path)}
							<Button
								variant="ghost"
								size="sm"
								class="h-10 w-full justify-start gap-2 px-2 font-normal sm:h-8"
								title={place.path}
								onclick={() => {
									placesOpen = false;
									void go(place.path);
								}}
							>
								{#if place.kind === 'home'}
									<HouseIcon class="size-4 shrink-0 text-muted-foreground" />
								{:else if place.kind === 'recent'}
									<ClockIcon class="size-4 shrink-0 text-muted-foreground" />
								{:else}
									<FolderIcon class="size-4 shrink-0 text-muted-foreground" />
								{/if}
								<span class="min-w-0 flex-1 truncate text-left font-mono text-xs">{place.label}</span>
								{#if place.kind === 'recent'}
									<span class="text-xs text-muted-foreground">recent</span>
								{/if}
							</Button>
						{/each}
					</div>
					</div>
				</Popover.Content>
			</Popover.Root>
			{#if canEdit}
				<Button
					variant="outline"
					size="sm"
					type="button"
					aria-label="New folder"
					title="New folder here"
					disabled={loading || listing === undefined}
					onclick={() => listing !== undefined && openAction({ kind: 'create', parent: listing.path })}
				>
					<FolderPlusIcon class="size-4" />
					<span class="max-sm:sr-only">New folder</span>
				</Button>
			{/if}
			<div class="ml-auto flex items-center gap-2">
				<Checkbox
					id="picker-show-hidden"
					checked={showHidden}
					onCheckedChange={(checked) => {
						showHidden = checked === true;
						void load(listing?.path, showHidden, { keepFilter: true });
					}}
				/>
				<Label for="picker-show-hidden" class="text-sm font-normal text-muted-foreground">
					<span class="sm:hidden">Hidden</span><span class="max-sm:hidden">Show hidden</span>
				</Label>
			</div>
		</div>

		<div class="px-4 pt-2 pb-2 sm:px-6">
			<div class="relative">
				<SearchIcon class="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
				<Input
					bind:ref={field}
					bind:value={filter}
					class="pl-8 font-mono"
					placeholder="Filter, or type a path (/ or ~)"
					aria-label="Filter folders, or type a path"
					autocomplete="off"
					autocapitalize="off"
					autocorrect="off"
					spellcheck={false}
					enterkeyhint="go"
					onkeydown={onFieldKeydown}
				/>
			</div>
		</div>

		{#if listing !== undefined}
			<div class="relative">
			<nav
				use:overlayScroll={'parent'}
				class="flex items-center gap-0.5 overflow-x-auto border-y px-4 py-1.5 font-mono text-xs whitespace-nowrap sm:px-6"
				aria-label="Folder path"
			>
				{#each crumbs as crumb, index (crumb.path)}
					{#if index > 0}<span class="text-muted-foreground" aria-hidden="true">/</span>{/if}
					<Button
						variant="link"
						size="xs"
						type="button"
						class="font-mono text-xs {index === crumbs.length - 1
							? 'font-semibold text-foreground no-underline disabled:opacity-100'
							: ''}"
						title={crumb.path}
						disabled={loading || index === crumbs.length - 1}
						aria-current={index === crumbs.length - 1 ? 'page' : undefined}
						onclick={() => void go(crumb.path)}
					>
						{crumb.label}
					</Button>
				{/each}
			</nav>
			</div>
		{/if}

		{#if error}
			<div class="px-4 pt-3 sm:px-6">
				<Banner tone="error">{error}</Banner>
			</div>
		{/if}

		<div class="relative flex min-h-0 flex-1 flex-col">
		<div use:overlayScroll={'parent'} class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3 sm:px-4" aria-busy={loading}>
			{#if listing === undefined}
				<p class="px-3 py-3 text-sm text-muted-foreground">
					{loading ? 'Loading folders…' : 'No folder loaded.'}
				</p>
			{:else}
				{#if pathMode && completionFresh && completion?.directory}
					<p class="truncate px-3 pt-2 pb-1 font-mono text-xs text-muted-foreground" title={completion.directory}>
						in {shortPath(completion.directory, listing.home)}
					</p>
				{/if}
				{#if rows.length > 0}
					<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
					<ul bind:this={list} class="flex flex-col" aria-label={pathMode ? 'Matching folders' : 'Folders'} onkeydown={onListKeydown}>
						{#each rows as entry, index (entry.path)}
							{@const label = repoLabel(entry)}
							{@const modified = modifiedText(entry, listedAt)}
							<li data-index={index} data-path={entry.path} class="flex items-center gap-1 border-b py-1 pl-1">
								<button
									type="button"
									data-row-open={index}
									class="flex min-w-0 flex-1 items-center gap-3 rounded-md px-2 py-2 text-left transition-colors outline-none hover:bg-muted focus-visible:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
									disabled={loading || adding}
									onclick={() => void go(entry.path)}
								>
									<FolderIcon class="size-4 shrink-0 {entry.isRepo ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}" />
									<span class="flex min-w-0 flex-1 flex-col gap-0.5">
										<span class="truncate text-sm font-medium">{entry.name}</span>
										{#if label !== null || entry.projectId || modified.short !== ''}
											<span class="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
												{#if label !== null}
													<Badge
														variant="outline"
														class="h-4 border-emerald-600/40 px-1.5 text-[0.6875rem] text-emerald-700 dark:border-emerald-400/40 dark:text-emerald-300"
													>
														{label}
													</Badge>
												{/if}
												{#if entry.projectId}
													<Badge variant="secondary" class="h-4 px-1.5 text-[0.6875rem]">added</Badge>
												{/if}
												{#if modified.short !== ''}
													<span title={modified.title}>{modified.short}</span>
												{/if}
											</span>
										{/if}
									</span>
								</button>
								<Button
									variant="outline"
									size="sm"
									type="button"
									class="shrink-0 max-sm:h-9"
									aria-label="Use {entry.name}"
									title="Add {entry.name} as a project"
									disabled={loading || adding}
									onclick={() => void useFolder(entry.path)}
								>
									Use
								</Button>
								{#if !pathMode}
									{@render rowMenu(entry)}
								{:else if canEdit}
									<!-- Keeps "Use" where it is in a listing. -->
									<span class="size-10 shrink-0 sm:size-8" aria-hidden="true"></span>
								{/if}
							</li>
						{/each}
					</ul>
				{:else if loading}
					<p class="px-3 py-3 text-sm text-muted-foreground">Loading folders…</p>
				{:else if pathMode}
					<p class="px-3 py-3 text-sm text-muted-foreground">
						{canComplete && completionFresh
							? 'No folder starts with that. Enter tries the path anyway.'
							: 'Press Enter to go to this path.'}
					</p>
				{:else if filter.trim() !== ''}
					<p class="px-3 py-3 text-sm text-muted-foreground">No folder here matches “{filter.trim()}”.</p>
				{:else}
					<p class="px-3 py-3 text-sm text-muted-foreground">This folder has no subfolders.</p>
				{/if}
				{#if loading && rows.length > 0}
					<p class="px-3 py-3 text-sm text-muted-foreground">Loading folders…</p>
				{/if}
				{#if listing.truncated && !pathMode}
					<p class="px-3 py-3 text-sm text-muted-foreground">
						Showing the first {listing.entries.length} folders. Go into a folder, or type a path, to narrow it down.
					</p>
				{/if}
				{#if pathMode && completion?.truncated && completionFresh}
					<p class="px-3 py-3 text-sm text-muted-foreground">More folders match. Keep typing to narrow it down.</p>
				{/if}
			{/if}
		</div>
		</div>

		<Dialog.Footer
			class="flex-row flex-wrap items-center gap-3 border-t px-4 pt-3 pb-[max(0.85rem,env(safe-area-inset-bottom))] sm:px-6 sm:pb-4"
		>
			<div class="min-w-0 flex-1">
				<p class="font-mono text-xs break-words text-muted-foreground">{listing?.path ?? '…'}</p>
				{#if listing?.projectId}
					<p class="text-sm text-muted-foreground">This folder is already a project.</p>
				{/if}
			</div>
			<Button
				type="button"
				disabled={loading || adding || listing === undefined}
				onclick={() => void useFolder()}
			>
				{adding ? 'Adding…' : 'Use this folder'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<FolderActionDialog
	{action}
	onsubmit={perform}
	onclose={() => {
		action = undefined;
		const path = focusAfterClose;
		focusAfterClose = undefined;
		// After the dialog has given the focus back, or it would take it from the row.
		if (path === undefined) focusField();
		else setTimeout(() => void focusPath(path), 0);
	}}
/>
