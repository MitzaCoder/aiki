<script lang="ts">
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import { Button } from '#lib/components/ui/button/index.js';
	import Markdown from '#lib/components/markdown/Markdown.svelte';
	import TaskStatusBadge from '#lib/components/TaskStatusBadge.svelte';
	import type { ProjectBoard } from '#lib/board.svelte.js';
	import { exactTime, relativeTime } from '#lib/relative-time.js';
	import { hasChanges, REPORT_SECTIONS, taskChanges, type TaskState } from '#lib/tasks.js';
	import type { BoardTask, BoardTaskSnapshot, BoardWriter } from '@mihai-harness/protocol';

	/**
	 * A task's snapshots, one at a time: step with the arrows, then read what changed in that snapshot (against the one
	 * before it, or against the task as it is now) or the task as it was. Read when it opens, and again when a new
	 * snapshot is saved while it is open.
	 */
	let {
		board,
		task,
		writerName
	}: {
		board: ProjectBoard;
		task: BoardTask;
		writerName: (writer: BoardWriter) => string;
	} = $props();

	let snapshots = $state<BoardTaskSnapshot[] | undefined>(undefined);
	let error = $state<string | undefined>(undefined);
	let selectedSeq = $state<number | undefined>(undefined);
	let against = $state<'previous' | 'now'>('previous');
	let view = $state<'changes' | 'as-it-was'>('changes');

	$effect(() => {
		const id = task.id;
		void task.snapshots;
		let cancelled = false;
		board
			.history(id)
			.then((read) => {
				if (cancelled) return;
				snapshots = read;
				error = undefined;
			})
			.catch((cause: unknown) => {
				if (!cancelled) error = cause instanceof Error ? cause.message : String(cause);
			});
		return () => {
			cancelled = true;
		};
	});

	const list = $derived(snapshots ?? []);
	const found = $derived(list.findIndex((entry) => entry.seq === selectedSeq));
	const index = $derived(found === -1 ? list.length - 1 : found);
	const snapshot = $derived(list[index]);
	const before = $derived<TaskState | undefined>(index > 0 ? list[index - 1] : undefined);
	const now = $derived<TaskState>({ title: task.title, status: task.status, report: task.report });
	const changes = $derived(
		snapshot === undefined ? undefined : against === 'now' ? taskChanges(snapshot, now) : taskChanges(before, snapshot)
	);

	function step(delta: number): void {
		const next = list[index + delta];
		if (next !== undefined) selectedSeq = next.seq;
	}
</script>

<div class="flex flex-col gap-3" data-task-history>
	{#if error}
		<p class="text-xs text-(--chat-danger)" role="alert">{error}</p>
	{:else if snapshots === undefined}
		<div class="flex flex-col gap-2" role="status" aria-busy="true" aria-label="Loading the history">
			<div class="flex items-center gap-2">
				<div class="skeleton size-7 rounded-md"></div>
				<div class="skeleton h-3.5 flex-1"></div>
				<div class="skeleton size-7 rounded-md"></div>
			</div>
			<div class="skeleton h-3 w-2/3"></div>
			<div class="skeleton h-20 w-full"></div>
			<span class="sr-only">Loading the history…</span>
		</div>
	{:else if snapshot === undefined}
		<p class="text-xs text-(--chat-fg-subtle)">Nothing saved yet. A snapshot is saved at each milestone and each status change.</p>
	{:else}
		<div class="flex items-center gap-1">
			<Button variant="ghost" size="icon-sm" disabled={index === 0} onclick={() => step(-1)} aria-label="Earlier snapshot" title="Earlier">
				<ChevronLeftIcon />
			</Button>
			<div class="min-w-0 flex-1 text-center">
				<p class="text-task font-medium break-words" data-snapshot-label>{snapshot.label}</p>
				<p class="text-[0.6875rem] text-(--chat-fg-subtle)">
					{index + 1} of {list.length} ·
					<span title={exactTime(snapshot.at)}>{relativeTime(snapshot.at, Date.now())}</span>
					· {writerName(snapshot.by)}
				</p>
			</div>
			<Button
				variant="ghost"
				size="icon-sm"
				disabled={index >= list.length - 1}
				onclick={() => step(1)}
				aria-label="Later snapshot"
				title="Later"
			>
				<ChevronRightIcon />
			</Button>
		</div>

		<div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
			<div class="inline-flex rounded-lg border border-(--chat-border) p-0.5" role="group" aria-label="What to show">
				{#each [{ id: 'changes', label: 'What changed' }, { id: 'as-it-was', label: 'As it was' }] as const as option (option.id)}
					<button
						type="button"
						class="rounded-md px-2 py-0.5 transition-colors {view === option.id
							? 'bg-(--chat-surface-2) font-medium text-(--chat-fg)'
							: 'text-(--chat-fg-subtle) hover:text-(--chat-fg)'}"
						aria-pressed={view === option.id}
						onclick={() => (view = option.id)}
					>
						{option.label}
					</button>
				{/each}
			</div>
			{#if view === 'changes'}
				<label class="flex items-center gap-1.5 text-(--chat-fg-subtle)">
					Compared with
					<select
						bind:value={against}
						class="rounded-md border border-(--chat-border) bg-transparent px-1.5 py-0.5 text-xs text-(--chat-fg)"
					>
						<option value="previous">{before === undefined ? 'nothing before it' : 'the snapshot before'}</option>
						<option value="now">the task now</option>
					</select>
				</label>
			{/if}
		</div>

		{#if view === 'changes' && changes !== undefined}
			{#if !hasChanges(changes)}
				<p class="text-xs text-(--chat-fg-subtle)" data-no-changes>
					{against === 'now' ? 'The task says the same as it did then.' : 'Nothing differs from the snapshot before.'}
				</p>
			{:else}
				<div class="flex flex-col gap-2.5" data-changes>
					{#if changes.title}
						<p class="text-xs break-words text-(--chat-fg-muted)">
							<span class="font-semibold text-(--chat-fg)">Title</span>
							<span class="text-(--chat-fg-subtle) line-through">{changes.title.from}</span> → {changes.title.to}
						</p>
					{/if}
					{#if changes.status}
						<p class="flex flex-wrap items-center gap-1.5 text-xs text-(--chat-fg-muted)">
							<span class="font-semibold text-(--chat-fg)">Status</span>
							<TaskStatusBadge status={changes.status.from} />
							→
							<TaskStatusBadge status={changes.status.to} />
						</p>
					{/if}
					{#each changes.sections as section (section.key)}
						<div>
							<p class="mb-1 text-xs font-semibold text-(--chat-fg)">{section.label}</p>
							<ul class="overflow-hidden rounded-lg border border-(--chat-border) text-xs leading-5">
								{#each section.lines as line, position (position)}
									{#if line.kind === 'unchanged'}
										<li class="px-2 py-0.5 text-(--chat-fg-subtle) italic">{line.count} unchanged {line.count === 1 ? 'line' : 'lines'}</li>
									{:else}
										<li
											class="flex gap-2 px-2 py-0.5 break-words {line.kind === 'added'
												? 'diff-added text-(--chat-fg)'
												: 'diff-removed text-(--chat-fg-muted)'}"
											data-diff={line.kind}
										>
											<span class="w-3 shrink-0 text-center select-none" aria-hidden="true">{line.kind === 'added' ? '+' : '−'}</span>
											<span class="min-w-0 flex-1 whitespace-pre-wrap">{line.text}</span>
											<span class="sr-only">{line.kind === 'added' ? 'added' : 'removed'}</span>
										</li>
									{/if}
								{/each}
							</ul>
						</div>
					{/each}
				</div>
			{/if}
		{:else if view === 'as-it-was'}
			<div class="flex flex-col gap-3 rounded-xl border border-(--chat-border) px-3 py-2.5" data-as-it-was>
				<p class="flex flex-wrap items-center gap-1.5 text-[0.8125rem] font-medium">
					{snapshot.title}
					<TaskStatusBadge status={snapshot.status} />
				</p>
				{#each REPORT_SECTIONS as section (section.key)}
					{#if snapshot.report[section.key].trim().length > 0}
						<div>
							<p class="mb-0.5 text-xs font-semibold text-(--chat-fg-muted)">{section.label}</p>
							<Markdown source={snapshot.report[section.key]} class="report-md" />
						</div>
					{/if}
				{/each}
			</div>
		{/if}
	{/if}
</div>

<style>
	.diff-added {
		background: color-mix(in oklab, var(--chat-success) 12%, transparent);
	}
	.diff-removed {
		background: color-mix(in oklab, var(--chat-danger) 10%, transparent);
	}
	:global(.report-md.md) {
		font-size: var(--text-task);
		line-height: 1.6;
	}
</style>
