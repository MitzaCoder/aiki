<script lang="ts">
	import { overlayScroll } from '#lib/scrollbars.js';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import SearchIcon from '@lucide/svelte/icons/search';
	import { onDestroy } from 'svelte';
	import Banner from '#lib/components/Banner.svelte';
	import Markdown from '#lib/components/markdown/Markdown.svelte';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import type { ProjectMemory } from '#lib/harness.svelte.js';
	import {
		MEMORY_SCOPES,
		memoryChangeRows,
		memoryLinkViews,
		memoryMaintenanceSummary,
		memoryScopeLabel,
		memoryLinkTarget,
		memorySearchRows,
		memorySourceView,
		memoryStatusLabel,
		memoryStatusView,
		splitMemoryFiles,
		type MemoryChangeRow,
		type MemoryFileRow
	} from '#lib/memory.js';
	import { exactTime, relativeTime } from '#lib/relative-time.js';

	/**
	 * The sidebar's Memory tab: what this backend remembers about the user (global) and about
	 * this project, read-only. The overview is the scope switch, a search box and the two
	 * views: the topic files by title, summary, tags and when they changed (archived ones
	 * behind a toggle), and the scope's commits. Opening a file shows its front matter — tags,
	 * links to related memories, where it came from — and its markdown body.
	 *
	 * Live: `memory.changed` and a reconnect re-read what the panel shows; a search and an open
	 * file are re-read too, so the reading keeps up with the coordinator's writes.
	 */
	let {
		memory,
		hrefForProject
	}: {
		memory: ProjectMemory | undefined;
		/** A project's chat URL, for the conversation a memory came from. */
		hrefForProject?: (projectId: string) => string;
	} = $props();

	type MemoryMode = 'files' | 'history';

	let mode = $state<MemoryMode>('files');
	let query = $state('');
	let body = $state<HTMLDivElement | undefined>(undefined);
	/** Relative times tick while the panel is open, so "5 min ago" stays true. */
	let now = $state(Date.now());
	let searchTimer: ReturnType<typeof setTimeout> | undefined;
	/** The change a confirmation is for; undo is the only write in the panel. */
	let undoTarget = $state<MemoryChangeRow | undefined>(undefined);

	const heading = 'text-[0.6875rem] font-semibold tracking-wide text-(--chat-fg-subtle) uppercase';
	const chip =
		'max-w-full truncate rounded-full border border-(--chat-border) bg-(--chat-surface-2) px-1.5 py-0.5 text-[0.625rem] text-(--chat-fg-muted)';
	const card =
		'flex w-full min-w-0 flex-col gap-1 rounded-xl border border-(--chat-border) bg-(--chat-surface)/30 px-3 py-2 text-left transition-colors hover:border-(--chat-border-strong) hover:bg-(--chat-surface-2) focus-visible:ring-2 focus-visible:ring-(--chat-fg-subtle) focus-visible:outline-none';
	/** A commit is read, not clicked, so its card has no hover affordance. */
	const historyCard =
		'flex w-full min-w-0 flex-col gap-1 rounded-xl border border-(--chat-border) bg-(--chat-surface)/30 px-3 py-2';

	const split = $derived(splitMemoryFiles(memory?.files ?? [], memory?.includeArchived === true, now));
	const searchRows = $derived(memorySearchRows(memory?.hits ?? []));
	const changeRows = $derived(memoryChangeRows(memory?.changes ?? [], now));
	const file = $derived(memory?.file);
	const linkViews = $derived(
		memoryLinkViews(file?.file.links ?? [], memory?.scope ?? 'global', memory?.files ?? [])
	);
	const source = $derived(memorySourceView(file?.file.source ?? null));
	/** The memory that replaced this one, when the file is superseded. */
	const superseded = $derived(
		file === undefined || file.file.supersededBy === null
			? undefined
			: memoryLinkTarget(file.file.supersededBy, memory?.scope ?? "global")
	);
	const term = $derived(memory?.term);

	const ticker = setInterval(() => (now = Date.now()), 60_000);
	onDestroy(() => {
		clearInterval(ticker);
		if (searchTimer !== undefined) clearTimeout(searchTimer);
	});

	/** Ask the server a moment after typing stops, not on every key; a search leaves the open file for its results. */
	function onQueryInput(value: string): void {
		query = value;
		if (query.trim().length > 0) memory?.closeFile();
		if (searchTimer !== undefined) clearTimeout(searchTimer);
		searchTimer = setTimeout(() => {
			searchTimer = undefined;
			void memory?.search(query);
		}, 200);
	}

	function switchScope(scope: (typeof MEMORY_SCOPES)[number]): void {
		if (memory === undefined || memory.scope === scope) return;
		memory.setScope(scope);
	}

	function showMode(next: MemoryMode): void {
		mode = next;
		if (next === 'history' && memory !== undefined && !memory.changesLoaded) void memory.loadHistory();
	}

	/** Jump from a `##` section name to that heading in the rendered body. */
	function jumpToHeading(name: string): void {
		const target = [...(body?.querySelectorAll('h2') ?? [])].find(
			(element) => (element.textContent ?? '').trim() === name
		);
		if (target === undefined) return;
		const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		target.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
	}

	function openLinked(fileId: string, scope: (typeof MEMORY_SCOPES)[number]): void {
		void memory?.open(fileId, scope);
	}

	/** A history row's link to the compaction it came from lands on that marker in the chat. */
	function compactionHref(projectId: string | null | undefined, entryId: number): string | undefined {
		if (projectId === null || projectId === undefined || hrefForProject === undefined) return undefined;
		return `${hrefForProject(projectId)}#entry-${entryId}`;
	}

	function confirmUndo(row: MemoryChangeRow): void {
		undoTarget = undefined;
		if (memory === undefined) return;
		void memory.undo(memory.scope, row.change.commit);
	}
</script>

{#snippet fileRow(row: MemoryFileRow)}
	<button type="button" class={card} onclick={() => memory?.open(row.file.fileId)}>
		<span class="flex w-full min-w-0 items-baseline gap-2">
			<span class="min-w-0 flex-1 truncate text-[0.8125rem] font-semibold">{row.file.title}</span>
			{#if row.file.status !== 'active'}
				<Badge variant="outline" class="shrink-0 text-[0.625rem]">
					{memoryStatusLabel(row.file.status)}
				</Badge>
			{/if}
			<time
				class="shrink-0 text-[0.6875rem] text-(--chat-fg-subtle)"
				datetime={row.file.updated}
				title={row.updatedTitle}>{row.updated}</time
			>
		</span>
		{#if row.file.summary.length > 0}
			<span class="line-clamp-2 w-full text-xs break-words text-(--chat-fg-muted)">{row.file.summary}</span>
		{/if}
		{#if row.tags.length > 0}
			<span class="flex w-full flex-wrap gap-1">
				{#each row.tags as tag (tag)}
					<span class={`${chip} max-w-24`}>{tag}</span>
				{/each}
			</span>
		{/if}
	</button>
{/snippet}

<div class="flex min-h-0 flex-1 flex-col">
	{#if memory !== undefined}
		<div class="shrink-0 border-b border-(--chat-border)/70 px-3 py-2">
			<div class="mx-auto flex w-full max-w-3xl flex-col gap-2">
				<div
					role="group"
					aria-label="Memory scope"
					class="flex min-w-0 rounded-lg border border-(--chat-border) p-0.5 text-xs font-semibold"
				>
					{#each MEMORY_SCOPES as scope (scope)}
						<button
							type="button"
							aria-pressed={memory.scope === scope}
							class="min-w-0 flex-1 truncate rounded-md px-2 py-1 transition-colors"
							class:bg-(--chat-surface-2)={memory.scope === scope}
							class:text-(--chat-fg)={memory.scope === scope}
							class:text-(--chat-fg-subtle)={memory.scope !== scope}
							class:hover:text-(--chat-fg)={memory.scope !== scope}
							onclick={() => switchScope(scope)}
						>
							{memoryScopeLabel(scope)}
						</button>
					{/each}
				</div>

				<div class="relative">
					<SearchIcon
						class="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-(--chat-fg-subtle)"
					/>
					<Input
						value={query}
						type="search"
						placeholder="Search all memory"
						aria-label="Search memory"
						class="h-8 rounded-lg border-(--chat-border) bg-(--chat-surface)/30 pr-2 pl-7 text-xs md:text-xs"
						oninput={(event) => onQueryInput(event.currentTarget.value)}
					/>
				</div>

				{#if term === undefined && memory.fileId === undefined}
					<div
						role="group"
						aria-label="Memory view"
						class="flex min-w-0 items-center gap-0.5 text-[0.6875rem] font-semibold"
					>
						<button
							type="button"
							aria-pressed={mode === 'files'}
							class="min-w-0 flex-1 truncate rounded-md px-2 py-1 transition-colors"
							class:bg-(--chat-surface-2)={mode === 'files'}
							class:text-(--chat-fg)={mode === 'files'}
							class:text-(--chat-fg-subtle)={mode !== 'files'}
							class:hover:text-(--chat-fg)={mode !== 'files'}
							onclick={() => showMode('files')}
						>
							Files
							<span class="font-normal text-(--chat-fg-subtle)">({split.active})</span>
						</button>
						<button
							type="button"
							aria-pressed={mode === 'history'}
							class="min-w-0 flex-1 truncate rounded-md px-2 py-1 transition-colors"
							class:bg-(--chat-surface-2)={mode === 'history'}
							class:text-(--chat-fg)={mode === 'history'}
							class:text-(--chat-fg-subtle)={mode !== 'history'}
							class:hover:text-(--chat-fg)={mode !== 'history'}
							onclick={() => showMode('history')}
						>
							History
							{#if memory.changesLoaded}
								<span class="font-normal text-(--chat-fg-subtle)">({memory.changes.length})</span>
							{/if}
						</button>
					</div>
				{/if}
			</div>
		</div>
	{/if}

	<div class="relative flex min-h-0 flex-1 flex-col">
	<div use:overlayScroll={'parent'} class="@container min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3">
		<div class="mx-auto flex w-full max-w-3xl flex-col gap-2">
			{#if memory === undefined}
				<p class="px-1 py-3 text-sm text-(--chat-fg-subtle)">Loading memory…</p>
			{:else}
				{#if memory.error}
					<Banner tone="error">{memory.error}</Banner>
				{/if}

				{#if file !== undefined}
					<!-- An open file: its front matter first, then the markdown body. -->
					<div class="flex min-w-0 flex-col gap-2 pb-2">
						<button
							type="button"
							class="flex min-w-0 items-center gap-1 self-start rounded-lg px-1.5 py-1 text-xs font-medium text-(--chat-fg-subtle) transition-colors hover:bg-(--chat-surface-2) hover:text-(--chat-fg)"
							onclick={() => memory.closeFile()}
						>
							<ArrowLeftIcon class="size-3.5" />
							<span class="truncate">
								{term === undefined ? 'All files' : 'Results'}
							</span>
						</button>
						<div class="flex min-w-0 flex-col gap-1">
							<h3 class="min-w-0 text-sm font-semibold break-words">{file.file.title}</h3>
							{#if file.file.summary.length > 0}
								<p class="text-xs break-words text-(--chat-fg-muted)">{file.file.summary}</p>
							{/if}
							<div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[0.625rem] text-(--chat-fg-subtle)">
								<span class="font-mono">{file.file.fileId}</span>
								<span>·</span>
								<time datetime={file.file.updated} title={exactTime(file.file.updated)}>
									updated {relativeTime(file.file.updated, now)}
								</time>
							</div>
						</div>

						<section
							aria-label="Front matter"
							class="flex flex-col gap-2 rounded-xl border border-(--chat-border) bg-(--chat-surface)/30 p-2.5"
						>
							<div class="flex flex-col gap-1">
								<span class={heading}>Status and tags</span>
								<div class="flex flex-wrap gap-1">
									<Badge variant="outline" class="text-[0.625rem]">
										{memoryStatusLabel(file.file.status)}
									</Badge>
									{#each file.file.tags as tag (tag)}
										<span class={chip}>{tag}</span>
									{/each}
									{#if file.file.tags.length === 0}
										<span class="text-[0.625rem] text-(--chat-fg-subtle)">No tags</span>
									{/if}
								</div>
								{#if superseded !== undefined}
									<button
										type="button"
										class="self-start text-[0.625rem] text-(--chat-fg-muted) underline"
										onclick={() => openLinked(superseded.fileId, superseded.scope)}
									>
										Superseded by {superseded.fileId}
									</button>
								{/if}
							</div>

							{#if linkViews.length > 0}
								<div class="flex flex-col gap-1">
									<span class={heading}>Links ({linkViews.length})</span>
									<div class="flex flex-wrap gap-1">
										{#each linkViews as link (`${link.scope}:${link.fileId}`)}
											<button
												type="button"
												class={`${chip} transition-colors hover:border-(--chat-border-strong) hover:text-(--chat-fg)`}
												class:font-mono={!link.known}
												title="{link.scope}:{link.fileId}"
												onclick={() => openLinked(link.fileId, link.scope)}
											>
												{link.label}
											</button>
										{/each}
									</div>
								</div>
							{/if}

							{#if file.file.headings.length > 0}
								<div class="flex flex-col gap-1">
									<span class={heading}>Sections ({file.file.headings.length})</span>
									<div class="flex flex-wrap gap-1">
										{#each file.file.headings as name (name)}
											<button
												type="button"
												class={`${chip} transition-colors hover:border-(--chat-border-strong) hover:text-(--chat-fg)`}
												onclick={() => jumpToHeading(name)}
											>
												{name}
											</button>
										{/each}
									</div>
								</div>
							{/if}

							<div class="flex min-w-0 flex-col gap-1">
								<span class={heading}>Source</span>
								<p class="min-w-0 text-[0.6875rem] break-words text-(--chat-fg-muted)">
									{#if source === undefined}
										No recorded source.
									{:else if source.projectId !== null && hrefForProject !== undefined}
										<a class="underline" href={hrefForProject(source.projectId)}>{source.text}</a>
									{:else}
										{source.text}
									{/if}
								</p>
							</div>

							<div class="flex flex-wrap gap-x-3 gap-y-1 text-[0.625rem] text-(--chat-fg-subtle)">
								<span>Created {relativeTime(file.file.created, now)}</span>
								<span>Updated {relativeTime(file.file.updated, now)}</span>
							</div>
						</section>

						<div
							bind:this={body}
							class="rounded-xl border border-(--chat-border) bg-(--chat-surface)/30 p-2.5 [&_h2]:scroll-mt-2"
						>
							<Markdown source={file.body} />
						</div>
					</div>
				{:else if memory.fileId !== undefined}
					<p class="px-1 py-3 text-sm text-(--chat-fg-subtle)">Opening {memory.fileId}…</p>
				{:else if term !== undefined}
					<!-- Search results: the section and the snippet, with the server's matches marked. -->
					{#if memory.searching}
						<p class="px-1 py-2 text-xs text-(--chat-fg-subtle)">Searching for "{term}"…</p>
					{:else if searchRows.length === 0}
						<p class="px-1 py-2 text-xs text-(--chat-fg-subtle)">
							No memories in either scope match "{term}".
						</p>
					{:else}
						<p class={`${heading} px-1`}>
							Matches
							<span class="font-normal normal-case">({searchRows.length})</span>
						</p>
						{#each searchRows as row (`${row.hit.scope}:${row.hit.fileId}:${row.hit.heading ?? ''}`)}
							<button
								type="button"
								class={card}
								onclick={() => memory.open(row.hit.fileId, row.hit.scope)}
							>
								<span class="flex w-full min-w-0 items-baseline gap-2">
									<span class="min-w-0 flex-1 truncate text-[0.8125rem] font-semibold">
										{row.hit.title}
									</span>
									<span
										class="shrink-0 rounded-full border border-(--chat-border) px-1.5 py-0.5 text-[0.625rem] font-semibold text-(--chat-fg-muted)"
									>
										{row.scopeLabel}
									</span>
								</span>
								<span class="w-full truncate text-[0.625rem] text-(--chat-fg-subtle)">{row.heading}</span>
								<p class="line-clamp-3 w-full text-xs break-words text-(--chat-fg-muted)">
									{#each row.parts as part, index (index)}{#if part.match}<mark
												class="rounded-sm bg-(--chat-warning)/30 px-0.5 font-medium text-(--chat-fg)">{part.text}</mark
											>{:else}{part.text}{/if}{/each}
								</p>
							</button>
						{/each}
					{/if}
				{:else if mode === 'history'}
					<!-- The scope's commits, newest first: who made each change, and the undo trail of the automatic ones. -->
					{#if memory.maintenanceEnabled}
						<!-- The scope's maintenance state, read with the history: last run, next run, the writes waiting. -->
						<section
							aria-label="Maintenance"
							class="flex min-w-0 flex-col gap-1.5 rounded-xl border border-(--chat-border) bg-(--chat-surface)/30 px-3 py-2"
						>
							{#if memory.status === undefined}
								<p class="text-[0.6875rem] text-(--chat-fg-subtle)">
									{memory.maintenanceError ?? 'Reading maintenance state…'}
								</p>
							{:else}
								{@const view = memoryStatusView(memory.status, now)}
								<div
									class="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 text-[0.6875rem] text-(--chat-fg-subtle)"
								>
									{#if view.running || memory.maintenanceStarting}
										<span class="flex items-center gap-1 font-medium text-(--chat-fg-muted)" role="status">
											<Spinner class="size-3" />
											Maintaining…
										</span>
									{:else if view.last}
										<span class={view.last.failed ? 'text-(--chat-warning)' : ''} title={view.last.title}>
											Last run {view.last.text}
										</span>
									{:else}
										<span>No maintenance run yet</span>
									{/if}
									{#if view.off}
										<span>Maintenance off</span>
									{:else if view.next}
										<span title={view.next.title}>Next run {view.next.text}</span>
									{/if}
									<span>· {view.writes}</span>
								</div>
								<div class="flex min-w-0 flex-wrap items-center gap-2">
									<Button
										variant="outline"
										size="sm"
										type="button"
										class="h-7 px-2 text-[0.6875rem]"
										disabled={view.running || memory.maintenanceStarting || view.off}
										title={view.off ? 'Choose a model on the backends page first' : 'Run maintenance on this scope now'}
										onclick={() => void memory?.runMaintenance()}
									>
										Run maintenance now
									</Button>
									{#if memory.maintenance !== undefined && memory.timezone !== undefined}
										<span class="min-w-0 text-[0.625rem] text-(--chat-fg-subtle)">
											{memoryMaintenanceSummary(memory.maintenance, memory.timezone)}
										</span>
									{/if}
								</div>
							{/if}
							{#if memory.maintenanceError !== undefined && memory.status !== undefined}
								<Banner tone="error">{memory.maintenanceError}</Banner>
							{/if}
						</section>
					{/if}
					{#if !memory.changesLoaded && !memory.error}
						<p class="px-1 py-2 text-xs text-(--chat-fg-subtle)">Loading history…</p>
					{:else if changeRows.length === 0}
						<p class="px-1 py-2 text-xs text-(--chat-fg-subtle)">
							No changes yet in the {memoryScopeLabel(memory.scope).toLowerCase()} scope.
						</p>
					{:else}
						<p class={`${heading} px-1`}>
							Commits
							<span class="font-normal normal-case">({changeRows.length})</span>
						</p>
						{#each changeRows as row (row.change.commit)}
							<div class={historyCard}>
								<span
									class="flex w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[0.625rem] text-(--chat-fg-subtle)"
								>
									<span
										class="shrink-0 rounded-full border border-(--chat-border) px-1.5 py-0.5 font-semibold text-(--chat-fg-muted)"
									>
										{row.kind}
									</span>
									{#if row.compactionEntry !== undefined}
										{@const href = compactionHref(row.change.source?.projectId, row.compactionEntry)}
										{#if href === undefined}
											<span>compaction at entry #{row.compactionEntry}</span>
										{:else}
											<a
												class="underline"
												href={href}
												title="The compaction these memories were saved from"
											>
												compaction at entry #{row.compactionEntry}
											</a>
										{/if}
									{/if}
									<time class="ml-auto shrink-0" datetime={row.change.at} title={row.whenTitle}>
										{row.when}
									</time>
								</span>
								<span class="line-clamp-2 w-full min-w-0 text-[0.8125rem] font-semibold break-words">
									{row.subject.length > 0 ? row.subject : row.commit}
								</span>
								{#if row.body.length > 0}
									<p class="line-clamp-3 w-full text-xs whitespace-pre-line text-(--chat-fg-muted)">
										{row.body}
									</p>
								{/if}
								<span class="flex w-full min-w-0 flex-wrap items-center gap-1">
									<code
										class="shrink-0 font-mono text-[0.625rem] text-(--chat-fg-subtle)"
										title={row.change.commit}>{row.commit}</code
									>
									{#each row.files as name (name)}
										<span class={`${chip} font-mono`}>{name}</span>
									{/each}
									{#if row.undoable && memory.maintenanceEnabled}
										<Button
											variant="outline"
											size="sm"
											type="button"
											class="ml-auto h-6 px-2 text-[0.625rem]"
											disabled={memory.undoing === row.change.commit}
											title="Revert this change as one undo commit"
											onclick={() => (undoTarget = row)}
										>
											{#if memory.undoing === row.change.commit}<Spinner class="size-3" />{/if}
											Undo
										</Button>
									{:else if row.undoneBy !== undefined}
										<span
											class="ml-auto shrink-0 rounded-full border border-(--chat-border) px-1.5 py-0.5 text-[0.625rem] text-(--chat-fg-subtle)"
											title="Undone by {row.undoneBy}"
										>
											Undone
										</span>
									{/if}
								</span>
								{#if memory.undoError?.commit === row.change.commit}
									<Banner tone="error">{memory.undoError.message}</Banner>
								{/if}
							</div>
						{/each}
					{/if}
				{:else}
					<!-- The scope's topic files: title, summary, tags and when they changed. -->
					{#if !memory.filesLoaded && !memory.error}
						<p class="px-1 py-2 text-xs text-(--chat-fg-subtle)">Loading memory…</p>
					{:else if split.active === 0 && split.archived === 0}
						<p class="px-1 py-2 text-xs text-(--chat-fg-subtle)">
							No memory yet in the {memoryScopeLabel(memory.scope).toLowerCase()} scope. The coordinator writes it as it
							works.
						</p>
					{:else}
						<p class={`${heading} px-1`}>
							Files
							<span class="font-normal normal-case">({split.active})</span>
						</p>
						{#if split.shown.length === 0}
							<p class="px-1 py-2 text-xs text-(--chat-fg-subtle)">No active memories in this scope.</p>
						{/if}
						{#each split.shown as row (row.file.fileId)}
							{@render fileRow(row)}
						{/each}
						{#if split.archived > 0}
							<button
								type="button"
								aria-pressed={memory.includeArchived}
								class="mt-1 flex items-center gap-1.5 self-start rounded-lg px-1.5 py-1.5 text-xs font-medium text-(--chat-fg-subtle) transition-colors hover:bg-(--chat-surface-2) hover:text-(--chat-fg)"
								onclick={() => (memory.includeArchived = !memory.includeArchived)}
							>
								<ChevronRightIcon
									class="size-3.5 transition-transform {memory.includeArchived ? 'rotate-90' : ''}"
								/>
								Archived ({split.archived})
							</button>
						{/if}
					{/if}
				{/if}
			{/if}
		</div>
	</div>
	</div>
</div>

<Dialog.Root open={undoTarget !== undefined} onOpenChange={(open) => (undoTarget = open ? undoTarget : undefined)}>
	<Dialog.Content class="sm:max-w-sm">
		<Dialog.Header>
			<Dialog.Title>Undo this change?</Dialog.Title>
			<Dialog.Description>
				“{undoTarget?.subject ?? 'this commit'}” ({undoTarget?.kind ?? 'change'}, {undoTarget?.files.length ?? 0}
				{undoTarget?.files.length === 1 ? 'file' : 'files'}) is reverted as one undo commit. It is refused if later
				changes touched the same memories, and nothing is reverted then.
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Dialog.Close>
				{#snippet child({ props })}
					<Button {...props} variant="outline" size="sm" type="button">Cancel</Button>
				{/snippet}
			</Dialog.Close>
			<Button
				variant="destructive"
				size="sm"
				type="button"
				onclick={() => {
					if (undoTarget !== undefined) confirmUndo(undoTarget);
				}}
			>
				Undo
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
