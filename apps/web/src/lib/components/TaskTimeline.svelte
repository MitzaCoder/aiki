<script lang="ts">
	import { markdownText } from '@aiki/protocol';
	import CircleDotIcon from '@lucide/svelte/icons/circle-dot';
	import CircleHelpIcon from '@lucide/svelte/icons/circle-help';
	import FlagIcon from '@lucide/svelte/icons/flag';
	import LinkIcon from '@lucide/svelte/icons/link';
	import MessageSquareIcon from '@lucide/svelte/icons/message-square';
	import ScaleIcon from '@lucide/svelte/icons/scale';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import PlayIcon from '@lucide/svelte/icons/play';
	import UserCogIcon from '@lucide/svelte/icons/user-cog';
	import { tick } from 'svelte';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import { timelineClock, timelineGroupNames, timelineGroupRange, timelineGroupTone, visibleTimelineGroups } from '#lib/timeline-groups.js';
	import { orderedTimeline, timelineDay, timelineDetail, timelineStatus, timelineTone } from '#lib/task-timeline.js';
	import { timelineOrder } from '#lib/timeline-order.svelte.js';
	import { exactTime, relativeTime } from '#lib/relative-time.js';
	import { TIMELINE_KINDS, timelineCounts, visibleTimeline } from '#lib/task-relations.js';
	import type { BoardTimelineEntry, BoardTimelineFact, BoardTimelineGroup, BoardTimelineKind, BoardWriter } from '@aiki/protocol';

	/**
	 * Everything that happened to a task, newest first by default: feedback and what became of it, status moves, workers, questions,
	 * decisions, milestones and link changes. Filter chips turn a kind off; only the kinds the task has show a chip. The
	 * sheet reads the entries (`board.task.timeline`) and passes them in.
	 */
	let {
		entries,
		groups,
		error,
		writerName,
		workerHref,
		taskHref
	}: {
		/** Undefined while the first read is on its way. */
		entries: readonly BoardTimelineEntry[] | undefined;
		/** Absent means legacy flat rendering; an empty array is an authoritative empty result. */
		groups?: readonly BoardTimelineGroup[];
		error?: string | undefined;
		writerName: (writer: BoardWriter) => string;
		/** Where a worker opens; undefined for one the project forgot. */
		workerHref?: (workerId: string) => string | undefined;
		taskHref: (taskId: string) => string;
	} = $props();

	let hidden = $state<ReadonlySet<BoardTimelineKind>>(new Set());

	let expandedGroups = $state<ReadonlySet<string>>(new Set());
	const sourceEntries = $derived(groups === undefined ? entries : groups.flatMap(group => group.entries));
	const counts = $derived(timelineCounts(sourceEntries ?? []));
	const shownGroups = $derived(groups === undefined ? undefined : visibleTimelineGroups(groups, hidden, timelineOrder.order));
	const shown = $derived(orderedTimeline(visibleTimeline(entries ?? [], hidden), timelineOrder.order));
	let viewport = $state<HTMLDivElement | null>(null);
	$effect(() => {
		const order = timelineOrder.order;
		void hidden;
		// On open, direction or filter changes, start at the most recent end. Live updates do not steal the scroll.
		void tick().then(() => { if (viewport) viewport.scrollTop = order === 'newest' ? 0 : viewport.scrollHeight; });
	});
	const kinds = $derived(TIMELINE_KINDS.filter((entry) => (counts.get(entry.kind) ?? 0) > 0));

	function toggle(kind: BoardTimelineKind): void {
		const next = new Set(hidden);
		if (next.has(kind)) next.delete(kind);
		else next.add(kind);
		hidden = next;
	}

	function toggleGroup(id: string): void {
		const next = new Set(expandedGroups);
		if (next.has(id)) next.delete(id); else next.add(id);
		expandedGroups = next;
	}

	function iconOf(entry: BoardTimelineEntry) {
		if (entry.kind === 'worker') {
			if (timelineTone(entry) === 'danger') return TriangleAlertIcon;
			if (timelineTone(entry) === 'success') return CircleCheckIcon;
			if (/\bstarted\b/i.test(entry.label)) return PlayIcon;
		}
		switch (entry.kind) {
			case 'feedback':
				return MessageSquareIcon;
			case 'status':
				return CircleDotIcon;
			case 'worker':
				return UserCogIcon;
			case 'question':
				return CircleHelpIcon;
			case 'decision':
				return ScaleIcon;
			case 'milestone':
				return FlagIcon;
			case 'link':
				return LinkIcon;
		}
	}
</script>

{#snippet timelineEntry(entry: BoardTimelineEntry, fact?: BoardTimelineFact)}
	{@const Icon = iconOf(entry)}
	{@const status = entry.kind === 'status' ? timelineStatus(entry.label) : undefined}
					<!-- svelte-ignore a11y_no_noninteractive_tabindex (Grouped facts are focusable for keyboard inspection.) -->
	<li tabindex={fact ? 0 : undefined} class="timeline-entry" data-timeline-kind={entry.kind} data-state={entry.state} data-tone={fact?.outcome === 'failed' || fact?.outcome === 'rolled_back' ? 'danger' : timelineTone(entry)}>
						<span class="timeline-icon"><Icon class="size-3.5" aria-hidden="true" /></span>
						<div class="min-w-0 flex-1">
							<div class="timeline-meta">
								<span>{fact?.actor?.name ?? (entry.by ? writerName(entry.by) : 'Recorded event')}</span>
								{#if fact && fact.endAt !== fact.at}
									<span class="shrink-0" title={exactTime(fact.at) + ' → ' + exactTime(fact.endAt)}><time datetime={fact.at}>{timelineClock(fact.at)}</time> → {fact.outcome.replaceAll('_', ' ')} <time datetime={fact.endAt}>{timelineClock(fact.endAt)}</time></span>
								{:else}<time datetime={entry.at} title={exactTime(entry.at)} aria-label={exactTime(entry.at)}>{relativeTime(entry.at, Date.now())}</time>{/if}
							</div>
							{#if status}
								<p class="timeline-status" aria-label={entry.label}><span>{status[0]}</span><span aria-hidden="true">→</span><span>{status[1]}</span></p>
							{:else}
								<p class="timeline-summary" title={entry.label}>
									{#if entry.kind === 'link' && entry.ref !== undefined}
										<a href={taskHref(entry.ref)}>{entry.label}</a>
									{:else if entry.kind === 'worker' && entry.ref !== undefined && workerHref?.(entry.ref) !== undefined}
										<a href={workerHref(entry.ref)}>{entry.label}</a>
									{:else}{entry.label}{/if}
								</p>
							{/if}
							{#if entry.detail}
								<details class="timeline-detail">
									<summary aria-label="Details: {timelineDetail(entry.detail)}"><span>{timelineDetail(entry.detail)}</span></summary>
									<p>{markdownText(entry.detail)}</p>
								</details>
							{/if}
						</div>
					</li>
{/snippet}

<div class="flex flex-col gap-3" data-task-timeline>
	{#if error}
		<p class="text-xs text-(--chat-danger)" role="alert">{error}</p>
	{:else if sourceEntries === undefined}
		<div class="flex flex-col gap-2" role="status" aria-busy="true" aria-label="Loading the timeline">
			<div class="skeleton h-3.5 w-2/3"></div>
			<div class="skeleton h-3.5 w-full"></div>
			<div class="skeleton h-3.5 w-4/5"></div>
			<span class="sr-only">Loading the timeline…</span>
		</div>
	{:else if sourceEntries.length === 0}
		<p class="text-xs text-(--chat-fg-subtle)">Nothing has happened yet.</p>
	{:else}
		<div class="flex flex-wrap items-center gap-1.5" role="group" aria-label="Show these kinds">
			{#each kinds as entry (entry.kind)}
				{@const on = !hidden.has(entry.kind)}
				<button
					type="button"
					class="inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs transition-colors {on
						? 'border-(--chat-border-strong) bg-(--chat-surface-2) font-medium text-(--chat-fg)'
						: 'border-(--chat-border)/70 text-(--chat-fg-subtle) line-through hover:text-(--chat-fg)'}"
					aria-pressed={on}
					data-timeline-filter={entry.kind}
					onclick={() => toggle(entry.kind)}
				>
					{entry.label}<span class="tabular-nums opacity-70">{counts.get(entry.kind)}</span>
				</button>
			{/each}
		</div>
		{#if (shownGroups ?? shown).length === 0}
			<p class="text-xs text-(--chat-fg-subtle)">Every kind is hidden.</p>
		{:else}
			<!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard users must be able to scroll this bounded region.) -->
			<div class="timeline-viewport" bind:this={viewport} tabindex="0" role="region" aria-label="Timeline events" data-timeline-scroll>
			<ol class="timeline relative flex flex-col" data-timeline-list>
				{#if shownGroups !== undefined}
					{#each shownGroups as group, index (group.id)}
						{@const day = timelineDay(group.hour)}
						{@const expanded = expandedGroups.has(group.id)}
						{@const tone = timelineGroupTone(group)}
						{@const GroupIcon = tone === 'danger' ? TriangleAlertIcon : tone === 'warning' ? CircleHelpIcon : group.kind === 'delivery' ? FlagIcon : group.kind === 'decisions' ? ScaleIcon : UserCogIcon}
						{#if index === 0 || timelineDay(shownGroups[index - 1]!.hour) !== day}<li class="timeline-day">{day}</li>{/if}
						<li class="timeline-group" data-tone={tone} data-timeline-group={group.id}>
							<button type="button" class="timeline-group-button" aria-expanded={expanded} aria-controls="timeline-group-{group.id}"
								aria-label="{timelineGroupRange(group)} · {timelineGroupNames[group.kind]} · {group.label} · {group.factCount} {group.factCount === 1 ? 'fact' : 'facts'}"
								onclick={() => toggleGroup(group.id)}>
								<span class="timeline-icon"><GroupIcon class="size-3.5" aria-hidden="true" /></span>
								<span class="min-w-0 flex-1">
									<span class="group-meta"><span title={exactTime(group.range.start) + ' – ' + exactTime(group.range.end)}>{timelineGroupRange(group)}</span><span>{timelineGroupNames[group.kind]}</span><span>{group.factCount} {group.factCount === 1 ? 'fact' : 'facts'}</span></span>
									<span class="group-label">{group.label}</span>
								</span>
								<ChevronRightIcon class="size-4 shrink-0 {expanded ? 'rotate-90' : ''}" aria-hidden="true" />
							</button>
							<ol id="timeline-group-{group.id}" class="timeline-group-entries" hidden={!expanded}>
								{#if expanded}{#each (timelineOrder.order === 'newest' ? [...group.entries].reverse() : group.entries) as fact (fact.id)}{@render timelineEntry(fact, fact)}{/each}{/if}
							</ol>
						</li>
					{/each}
				{:else}
				{#each shown as entry, index (index)}
					{@const day = timelineDay(entry.at)}
					{#if index === 0 || timelineDay(shown[index - 1]!.at) !== day}<li class="timeline-day">{day}</li>{/if}
					{@render timelineEntry(entry)}
				{/each}
				{/if}
			</ol>
			</div>
		{/if}
	{/if}
</div>

<style>
	.timeline-group { --event-tone: var(--accent-2); border-bottom: 1px solid var(--chat-border); }
	.timeline-group[data-tone='activity'] { --event-tone: var(--chat-fg-muted); }
	.timeline-group[data-tone='warning'] { --event-tone: var(--chat-warning); }
	.timeline-group[data-tone='danger'] { --event-tone: var(--chat-danger); }
	.timeline-group[data-tone='success'] { --event-tone: var(--chat-success); }
	.timeline-group-button { display: flex; align-items: center; gap: 0.65rem; width: 100%; min-height: 3rem; padding: 0.65rem 0; text-align: left; border-radius: 0.4rem; }
	.timeline-group-button:focus-visible, .timeline-entry:focus-visible { outline: 2px solid var(--accent-2); outline-offset: -2px; }
	.group-meta { display: flex; flex-wrap: wrap; gap: 0.2rem 0.6rem; font-size: 0.6875rem; color: var(--chat-fg-subtle); }
	.group-label { display: block; font-size: 0.8125rem; font-weight: 600; overflow-wrap: anywhere; }
	.timeline-group[data-tone='danger'] > button .group-label, .timeline-group[data-tone='warning'] > button .group-label { color: var(--event-tone); }
	.timeline-group-entries { padding-left: 0.75rem; border-left: 1px solid var(--chat-border); margin: 0 0 0.5rem 0.85rem; }
	.timeline-group-entries[hidden] { display: none; }
	.timeline-viewport { max-height: min(25rem, 48dvh); overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable; padding-right: 0.35rem; }
	.timeline-day { position: sticky; top: 0; z-index: 2; padding: 0.4rem 0.1rem; margin-bottom: 0.35rem; background: var(--chat-surface); color: var(--chat-fg-muted); font-size: 0.6875rem; font-weight: 650; border-bottom: 1px solid var(--chat-border); }
	.timeline-entry { --event-tone: var(--accent-2); display: flex; gap: 0.65rem; padding: 0.6rem 0; border-bottom: 1px solid color-mix(in oklab, var(--chat-border) 55%, transparent); }
	.timeline-entry[data-tone='activity'] { --event-tone: var(--chat-fg-muted); }
	.timeline-entry[data-tone='warning'] { --event-tone: var(--chat-warning); }
	.timeline-entry[data-tone='danger'] { --event-tone: var(--chat-danger); }
	.timeline-entry[data-tone='success'] { --event-tone: var(--chat-success); }
	.timeline-icon { display: flex; align-items: center; justify-content: center; width: 1.75rem; height: 1.75rem; flex-shrink: 0; border-radius: 0.55rem; color: var(--event-tone); background: color-mix(in oklab, var(--event-tone) 9%, transparent); }
	.timeline-meta { display: flex; justify-content: space-between; gap: 0.5rem; color: var(--chat-fg-subtle); font-size: 0.6875rem; }
	.timeline-meta > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	time { flex-shrink: 0; }
	.timeline-summary { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 0.8125rem; font-weight: 600; line-height: 1.6; }
	a { text-decoration: underline; text-decoration-color: var(--chat-border-strong); text-underline-offset: 2px; }
	.timeline-status { display: flex; align-items: center; flex-wrap: wrap; gap: 0.4rem; font-size: 0.6875rem; margin-top: 0.2rem; }
	.timeline-status span:not(:nth-child(2)) { padding: 0.1rem 0.45rem; border: 1px solid var(--chat-border); background: var(--chat-surface-2); border-radius: 0.4rem; }
	.timeline-detail { color: var(--chat-fg-muted); font-size: 0.75rem; line-height: 1.6; }
	.timeline-detail summary { display: flex; align-items: baseline; gap: 0.35rem; cursor: pointer; }
	.timeline-detail summary::before { content: '›'; flex-shrink: 0; }
	.timeline-detail[open] summary::before { transform: rotate(90deg); }
	.timeline-detail summary span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
	.timeline-detail p { white-space: pre-wrap; overflow-wrap: anywhere; padding: 0.4rem 0; }
</style>
