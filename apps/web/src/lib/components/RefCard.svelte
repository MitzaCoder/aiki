<script lang="ts">
	import CircleDotIcon from '@lucide/svelte/icons/circle-dot';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import GitMergeIcon from '@lucide/svelte/icons/git-merge';
	import GitPullRequestClosedIcon from '@lucide/svelte/icons/git-pull-request-closed';
	import GitPullRequestDraftIcon from '@lucide/svelte/icons/git-pull-request-draft';
	import GitPullRequestIcon from '@lucide/svelte/icons/git-pull-request';
	import TicketIcon from '@lucide/svelte/icons/ticket';
	import type { BoardTaskStatus, RefDetails, RefStatus } from '@kemiri/protocol';
	import {
		type CardRef,
		type TaskMention,
		cardKindWords,
		cardRefLabel,
		changeWords,
		checksTone,
		checksWords,
		failingChecksWords,
		githubStateWords,
		openWords,
		reviewLines
	} from '#lib/ref-card.js';
	import { refStatusToneClass, refStatusWords } from '#lib/refs.js';
	import { exactTime, relativeTime } from '#lib/relative-time.js';
	import { taskStatusToneClass } from '#lib/tasks.js';

	/**
	 * What a ticket or pull request's card says: what it is and where it stands, then the details the backend read (a pull
	 * request's branches, checks, reviews and size; an issue's people; a ticket's people, parent and sprint), the tasks
	 * that name it and the way out to GitHub or Jira. Without details it says what is known: the label, the link and the
	 * state last read for the board.
	 */
	let {
		cardRef,
		href,
		details,
		status,
		loading,
		tasks,
		taskHref,
		onleave
	}: {
		cardRef: CardRef;
		href: string;
		details: RefDetails | undefined;
		status: RefStatus | undefined;
		loading: boolean;
		tasks: readonly TaskMention[];
		taskHref: ((taskId: string) => string) | undefined;
		/** A link inside the card was followed. */
		onleave: () => void;
	} = $props();

	const label = $derived(cardRefLabel(cardRef));
	const kind = $derived(cardKindWords(cardRef, details, status));
	const title = $derived(details?.title || status?.title || '');
	const now = Date.now();

	/** The state in a word and its colour: from the details when read, else the state last read for the board. */
	const state = $derived.by((): { words: string; tone: string } | undefined => {
		if (details?.kind === 'jira') {
			const tone = details.category === 'done' ? 'done' : details.category === 'in_progress' ? 'working' : 'todo';
			return { words: details.status, tone: `task-status-${tone}` };
		}
		if (details?.kind === 'pull') {
			const tone = details.state === 'open' ? 'working' : details.state === 'draft' ? 'todo' : details.state === 'merged' ? 'done' : 'dropped';
			return { words: githubStateWords(details), tone: `task-status-${tone}` };
		}
		if (details?.kind === 'issue') {
			const tone = details.state === 'open' ? 'working' : details.closedAs === 'completed' ? 'done' : 'dropped';
			return { words: githubStateWords(details), tone: `task-status-${tone}` };
		}
		if (status !== undefined) return { words: refStatusWords(status), tone: refStatusToneClass(status) };
		return undefined;
	});

	const pullState = $derived(details?.kind === 'pull' ? details.state : status?.kind === 'pull' ? status.state : undefined);
	const isOpenPull = $derived(pullState === 'open' || pullState === 'draft');

	const row = 'grid grid-cols-[4.75rem_minmax(0,1fr)] items-baseline gap-x-2';
	const term = 'text-(--chat-fg-subtle)';
</script>

{#snippet kindIcon()}
	{#if cardRef.source === 'jira'}
		<TicketIcon class="size-3.5" />
	{:else if pullState === 'merged'}
		<GitMergeIcon class="size-3.5" />
	{:else if pullState === 'closed'}
		<GitPullRequestClosedIcon class="size-3.5" />
	{:else if pullState === 'draft'}
		<GitPullRequestDraftIcon class="size-3.5" />
	{:else if pullState === 'open' || cardRef.kind === 'pull'}
		<GitPullRequestIcon class="size-3.5" />
	{:else}
		<CircleDotIcon class="size-3.5" />
	{/if}
{/snippet}

{#snippet byline(at: string | null, author?: string | null)}
	<p class="flex flex-wrap items-center gap-x-1.5 text-[0.6875rem] text-(--chat-fg-subtle)">
		<span>{kind}{#if author}&nbsp;by <span class="text-(--chat-fg-muted)">{author}</span>{/if}</span>
		{#if at}<span aria-hidden="true">·</span><span title={exactTime(at)}>updated {relativeTime(at, now)}</span>{/if}
	</p>
{/snippet}

{#snippet excerpt(text: string | null)}
	<!-- A description that only repeats the title (a link to a spec named like the ticket) says nothing new. -->
	{#if text && text.trim() !== title.trim()}
		<p class="line-clamp-3 border-l-2 border-(--chat-border) pl-2 text-xs leading-relaxed whitespace-pre-line text-(--chat-fg-muted)">{text}</p>
	{/if}
{/snippet}

<div class="flex flex-col gap-2.5 p-3.5">
	<header class="flex min-w-0 flex-col gap-1">
		<div class="flex min-w-0 items-center gap-2 text-xs text-(--chat-fg-muted)">
			<span class="shrink-0 {state?.tone ?? ''}" style={state === undefined ? undefined : 'color: var(--task-status)'} aria-hidden="true">{@render kindIcon()}</span>
			{#if cardRef.source === 'github'}
				<span class="flex min-w-0 items-baseline gap-1 font-mono text-[0.75rem]" title="{cardRef.repo} #{cardRef.number}"
					><span class="min-w-0 truncate">{cardRef.repo}</span><span class="shrink-0 text-(--chat-fg)">#{cardRef.number}</span></span
				>
			{:else}
				<span class="min-w-0 truncate font-mono text-[0.75rem] text-(--chat-fg)">{label}</span>
			{/if}
			{#if state !== undefined}
				<span class="task-status-badge {state.tone} ml-auto max-w-[45%] shrink-0"><span class="truncate">{state.words}</span></span>
			{/if}
		</div>
		{#if title}
			<p class="line-clamp-3 text-sm leading-snug font-semibold break-words text-(--chat-fg)">{title}</p>
		{/if}
		{#if details?.kind === 'pull' || details?.kind === 'issue'}
			{@render byline(details.updatedAt, details.author)}
		{:else if details?.kind === 'jira'}
			{@render byline(details.updatedAt)}
		{:else}
			{@render byline(null)}
		{/if}
	</header>

	{#if details === undefined && loading}
		<div class="flex flex-col gap-1.5" aria-hidden="true">
			<span class="h-3 w-3/4 animate-pulse rounded bg-(--chat-surface-2)"></span>
			<span class="h-3 w-1/2 animate-pulse rounded bg-(--chat-surface-2)"></span>
			<span class="h-3 w-2/3 animate-pulse rounded bg-(--chat-surface-2)"></span>
		</div>
	{:else if details?.kind === 'pull'}
		<div class="flex flex-col gap-1.5 text-xs">
			<div class={row}>
				<span class={term}>Branch</span>
				<span class="min-w-0">
					<span class="block truncate font-mono text-[0.71875rem] text-(--chat-fg)" title={details.headBranch}>{details.headBranch}</span>
					<span class="block truncate font-mono text-[0.71875rem] text-(--chat-fg-muted)" title="into {details.baseBranch}"
						><span class="text-(--chat-fg-subtle)" aria-label="into">→</span> {details.baseBranch}</span
					>
					{#if isOpenPull && details.conflicts !== null}
						<span class="block {details.conflicts ? 'text-(--chat-danger)' : 'text-(--chat-fg-subtle)'}"
							>{details.conflicts ? 'Has conflicts with the base branch' : 'No conflicts'}</span
						>
					{/if}
				</span>
			</div>
			<div class={row}>
				<span class={term}>Checks</span>
				{#if details.checks === null}
					<span class="text-(--chat-fg-subtle)">None</span>
				{:else}
					{@const failing = failingChecksWords(details.checks)}
					<span class="min-w-0">
						<span class="inline-flex items-center gap-1.5 text-(--chat-fg) task-status-{checksTone(details.checks)}"
							><span class="task-status-dot" aria-hidden="true"></span>{checksWords(details.checks)}</span
						>
						{#if failing}
							<span class="block break-words text-(--chat-fg-muted)">Failing: {failing}</span>
						{/if}
					</span>
				{/if}
			</div>
			<div class={row}>
				<span class={term}>Reviews</span>
				<span class="flex min-w-0 flex-col">
					{#each reviewLines(details.reviews) as line (line.text)}
						<span class="flex min-w-0 items-baseline gap-1.5 text-(--chat-fg) task-status-{line.tone}"
							><span class="task-status-dot shrink-0 -translate-y-px" aria-hidden="true"></span><span class="min-w-0 break-words">{line.text}</span></span
						>
					{/each}
				</span>
			</div>
			<div class={row}>
				<span class={term}>Changes</span>
				<span class="text-(--chat-fg)">{changeWords(details)}</span>
			</div>
		</div>
	{:else if details?.kind === 'issue'}
		<div class="flex flex-col gap-1.5 text-xs">
			<div class={row}>
				<span class={term}>Assignees</span>
				<span class="min-w-0 truncate {details.assignees.length === 0 ? 'text-(--chat-fg-subtle)' : 'text-(--chat-fg)'}"
					>{details.assignees.length === 0 ? 'Nobody' : details.assignees.join(', ')}</span
				>
			</div>
			{#if details.labels.length > 0}
				<div class={row}>
					<span class={term}>Labels</span>
					<span class="flex min-w-0 flex-wrap gap-1">
						{#each details.labels as name (name)}<span class="task-ref max-w-[10rem] truncate font-sans">{name}</span>{/each}
					</span>
				</div>
			{/if}
			<div class={row}>
				<span class={term}>Comments</span>
				<span class="text-(--chat-fg)">{details.comments}</span>
			</div>
		</div>
		{@render excerpt(details.excerpt)}
	{:else if details?.kind === 'jira'}
		<div class="flex flex-col gap-1.5 text-xs">
			{#if details.priority}
				<div class={row}><span class={term}>Priority</span><span class="text-(--chat-fg)">{details.priority}</span></div>
			{/if}
			<div class={row}>
				<span class={term}>Assignee</span>
				<span class="min-w-0 truncate {details.assignee === null ? 'text-(--chat-fg-subtle)' : 'text-(--chat-fg)'}">{details.assignee ?? 'Unassigned'}</span>
			</div>
			{#if details.reporter}
				<div class={row}><span class={term}>Reporter</span><span class="min-w-0 truncate text-(--chat-fg)">{details.reporter}</span></div>
			{/if}
			{#if details.parent}
				<div class={row}>
					<span class={term}>{details.parent.type ?? 'Parent'}</span>
					<a
						href={details.parent.url}
						target="_blank"
						rel="noopener noreferrer"
						onclick={onleave}
						class="min-w-0 truncate text-(--chat-fg) underline decoration-(--chat-border-strong) underline-offset-2 hover:decoration-current"
						title="{details.parent.key} · {details.parent.title}"
						><span class="font-mono text-[0.71875rem]">{details.parent.key}</span> {details.parent.title}</a
					>
				</div>
			{/if}
			{#if details.sprint}
				<div class={row}><span class={term}>Sprint</span><span class="min-w-0 truncate text-(--chat-fg)">{details.sprint}</span></div>
			{/if}
		</div>
		{@render excerpt(details.excerpt)}
	{/if}

	{#if tasks.length > 0}
		<div class="flex flex-col gap-1 border-t border-(--chat-border) pt-2.5">
			<p class="text-[0.6875rem] font-medium text-(--chat-fg-subtle)">{tasks.length === 1 ? 'Task' : 'Tasks'} naming it</p>
			<ul class="flex flex-col">
				{#each tasks as task (task.id)}
					<li class="flex min-w-0">
						{#if taskHref}
							<a
								href={taskHref(task.id)}
								onclick={onleave}
								class="-mx-1.5 flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-xs hover:bg-(--chat-surface-2) {taskStatusToneClass(task.status as BoardTaskStatus)}"
							>
								<span class="task-status-dot shrink-0" aria-hidden="true"></span>
								<span class="shrink-0 font-mono font-semibold text-(--accent-2)">{task.id}</span>
								<span class="min-w-0 truncate text-(--chat-fg)">{task.title}</span>
							</a>
						{:else}
							<span class="flex min-w-0 flex-1 items-center gap-2 py-1 text-xs {taskStatusToneClass(task.status as BoardTaskStatus)}">
								<span class="task-status-dot shrink-0" aria-hidden="true"></span>
								<span class="shrink-0 font-mono font-semibold text-(--accent-2)">{task.id}</span>
								<span class="min-w-0 truncate text-(--chat-fg)">{task.title}</span>
							</span>
						{/if}
					</li>
				{/each}
			</ul>
		</div>
	{/if}

	<a
		{href}
		target="_blank"
		rel="noopener noreferrer"
		onclick={onleave}
		class="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-(--chat-border) bg-(--chat-surface-2)/60 px-3 text-xs font-medium text-(--chat-fg) transition-colors hover:bg-(--chat-surface-2) focus-visible:outline-2 focus-visible:outline-(--accent-2)"
	>
		{openWords(cardRef)}<ExternalLinkIcon class="size-3.5" aria-hidden="true" />
	</a>
</div>
