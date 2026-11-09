<script lang="ts">
	import type { ArtifactFilter, HarnessClient } from '@mihai-harness/client';
	import type { Artifact, ArtifactKind } from '@mihai-harness/protocol';
	import { artifactTitle, filterByKind, formatBytes, formatMediaDuration, kindCounts, kindLabel, savedByLabel } from '#lib/artifacts.js';
	import { useArtifactFeed } from '#lib/artifacts.svelte.js';
	import { exactTime, relativeTime } from '#lib/relative-time.js';
	import ArtifactDialog from './ArtifactDialog.svelte';
	import ArtifactThumb from './ArtifactThumb.svelte';

	/**
	 * A project's artifacts with fixed filters, live: as a grid of cards or as rows, with chips to narrow by kind once
	 * there is more than one. A click opens the artifact in full. Give `items` to show a list read elsewhere.
	 */
	let {
		client,
		projectId,
		filter = {},
		items,
		layout = 'grid',
		limit,
		collapsedCount,
		emptyText = 'No artifacts yet.',
		onloaded
	}: {
		client: HarnessClient;
		projectId: string;
		filter?: ArtifactFilter;
		/** Show these instead of reading a list. */
		items?: readonly Artifact[];
		layout?: 'grid' | 'rows';
		limit?: number;
		/** Show this many until "Show all" is pressed. */
		collapsedCount?: number;
		/** Shown when the list is empty; an empty string shows nothing. */
		emptyText?: string;
		/** How many the list holds, once read. */
		onloaded?: (count: number) => void;
	} = $props();

	const feed = useArtifactFeed(() =>
		items === undefined ? { client, projectId, filter: { threadId: filter.threadId, workerId: filter.workerId, taskId: filter.taskId }, limit } : undefined
	);
	const all = $derived(items ?? feed.current?.artifacts ?? []);
	const loaded = $derived(items !== undefined || feed.current?.loaded === true);
	const counts = $derived(kindCounts(all));
	let kind = $state<ArtifactKind | 'all'>('all');
	let expanded = $state(false);
	const narrowed = $derived(filterByKind(all, kind));
	const shown = $derived(collapsedCount === undefined || expanded ? narrowed : narrowed.slice(0, collapsedCount));
	let openId = $state<string | undefined>(undefined);
	let dialogOpen = $state(false);
	const opened = $derived(all.find((artifact) => artifact.id === openId));

	$effect(() => {
		if (loaded) onloaded?.(all.length);
	});
	// A kind whose last artifact went away falls back to all.
	$effect(() => {
		if (kind !== 'all' && !counts.some((entry) => entry.kind === kind)) kind = 'all';
	});

	function open(artifact: Artifact): void {
		openId = artifact.id;
		dialogOpen = true;
	}

	function meta(artifact: Artifact): string {
		return [formatMediaDuration(artifact.durationSeconds), artifact.size >= 0 ? formatBytes(artifact.size) : '', savedByLabel(artifact)]
			.filter((part) => part !== '')
			.join(' · ');
	}
</script>

<div class="flex min-w-0 flex-col gap-2" data-artifact-list>
	{#if counts.length > 1}
		<div class="flex flex-wrap gap-1" role="group" aria-label="Filter by kind">
			<button type="button" class="chip" aria-pressed={kind === 'all'} onclick={() => (kind = 'all')}>All <span>{all.length}</span></button>
			{#each counts as entry (entry.kind)}
				<button type="button" class="chip" aria-pressed={kind === entry.kind} onclick={() => (kind = entry.kind)}>
					{kindLabel(entry.kind, entry.count > 1)} <span>{entry.count}</span>
				</button>
			{/each}
		</div>
	{/if}

	{#if feed.current?.error && all.length === 0}
		<p class="text-xs text-(--chat-danger)">Could not read the artifacts: {feed.current.error}</p>
	{:else if !loaded}
		<p class="text-xs text-(--chat-fg-subtle)">Reading the artifacts…</p>
	{:else if all.length === 0}
		{#if emptyText}<p class="text-xs text-(--chat-fg-subtle)">{emptyText}</p>{/if}
	{:else if layout === 'grid'}
		<ul class="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-2">
			{#each shown as artifact (artifact.id)}
				<li class="min-w-0">
					<button type="button" class="card group flex w-full min-w-0 flex-col overflow-hidden rounded-xl text-left" onclick={() => open(artifact)} data-artifact={artifact.id}>
						<ArtifactThumb {artifact} {client} class="aspect-video w-full" />
						<span class="flex min-w-0 flex-col gap-0.5 px-2.5 py-2">
							<span class="truncate text-[0.8125rem] font-medium" title={artifactTitle(artifact)}>{artifactTitle(artifact)}</span>
							<span class="truncate text-[0.6875rem] text-(--chat-fg-subtle)">
								{#if artifact.createdAt}<time datetime={artifact.createdAt} title={exactTime(artifact.createdAt)}>{relativeTime(artifact.createdAt, Date.now())}</time>{/if}
								{#if artifact.size >= 0} · {formatBytes(artifact.size)}{/if}
							</span>
						</span>
					</button>
				</li>
			{/each}
		</ul>
	{:else}
		<ul class="flex flex-col gap-1">
			{#each shown as artifact (artifact.id)}
				<li class="min-w-0">
					<button type="button" class="row flex w-full min-w-0 items-center gap-2.5 rounded-xl p-1.5 text-left" onclick={() => open(artifact)} data-artifact={artifact.id}>
						<ArtifactThumb {artifact} {client} class="h-10 w-14 rounded-lg" duration={false} />
						<span class="flex min-w-0 flex-1 flex-col">
							<span class="truncate text-[0.8125rem] font-medium" title={artifactTitle(artifact)}>{artifactTitle(artifact)}</span>
							<span class="truncate text-[0.6875rem] text-(--chat-fg-subtle)">{meta(artifact)}</span>
						</span>
						{#if artifact.createdAt}
							<time class="shrink-0 text-[0.6875rem] text-(--chat-fg-subtle)" datetime={artifact.createdAt} title={exactTime(artifact.createdAt)}>{relativeTime(artifact.createdAt, Date.now())}</time>
						{/if}
					</button>
				</li>
			{/each}
		</ul>
	{/if}

	{#if collapsedCount !== undefined && narrowed.length > collapsedCount}
		<button type="button" class="self-start px-1 text-xs font-medium text-(--accent-2) hover:underline" onclick={() => (expanded = !expanded)}>
			{expanded ? 'Show fewer' : `Show all ${narrowed.length}`}
		</button>
	{/if}
</div>

<ArtifactDialog artifact={opened} {client} bind:open={dialogOpen} />

<style>
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		border-radius: 9999px;
		border: 1px solid var(--chat-border);
		padding: 0.125rem 0.55rem;
		font-size: 0.6875rem;
		font-weight: 500;
		color: var(--chat-fg-muted);
		transition:
			background-color 120ms,
			border-color 120ms,
			color 120ms;
	}
	.chip span {
		color: var(--chat-fg-subtle);
		font-variant-numeric: tabular-nums;
	}
	.chip:hover {
		background: var(--chat-surface-2);
	}
	.chip[aria-pressed='true'] {
		border-color: color-mix(in oklab, var(--accent-2) 45%, var(--chat-border));
		background: color-mix(in oklab, var(--accent-2) 12%, transparent);
		color: var(--chat-fg);
	}
	.card {
		border: 1px solid var(--chat-border);
		background: color-mix(in oklab, var(--chat-surface) 60%, transparent);
		transition:
			border-color 120ms,
			transform 160ms ease,
			box-shadow 160ms ease;
	}
	.card:hover {
		border-color: var(--chat-border-strong);
		transform: translateY(-1px);
		box-shadow: 0 6px 18px -10px rgb(0 0 0 / 0.35);
	}
	.row {
		transition: background-color 120ms;
	}
	.row:hover {
		background: color-mix(in oklab, var(--chat-surface-2) 70%, transparent);
	}
	.card:focus-visible,
	.row:focus-visible {
		outline: 2px solid var(--accent-2);
		outline-offset: 1px;
	}
</style>
