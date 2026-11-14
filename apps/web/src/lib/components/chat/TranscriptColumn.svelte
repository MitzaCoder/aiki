<script lang="ts">
	import { cacheWarmLabel, cacheWarmDetail } from '#lib/chat/cache-warm.js';
	import ArrowDownIcon from '@lucide/svelte/icons/arrow-down';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import { tick, untrack, onDestroy, type Snippet } from 'svelte';
	import { agentFinished, agentTurnWorking, showsAgentActivityRow } from '#lib/agent-activity.js';
	import { loadEarlierPage, shouldPrefetchEarlier } from '#lib/chat/earlier-paging.js';
	import type { WorkerSummary } from '@kemiri/protocol';
	import type { MemoryExtraction } from '#lib/memory.js';
	import type { MemoryScope } from '@kemiri/protocol';
	import AgentMascot from '#lib/components/AgentMascot.svelte';
	import { CHAT_COLUMN_CLASS } from '#lib/chat/layout.js';
	import type { TranscriptItem } from '#lib/transcript.js';
	import AssistantTurn from './AssistantTurn.svelte';
	import CompactionMarker from './CompactionMarker.svelte';
	import TurnNotice from './TurnNotice.svelte';
	import UserMessage from './UserMessage.svelte';
	import BoardNotice from './BoardNotice.svelte';
	import ReportsNotice from './ReportsNotice.svelte';
	import WorkerCheckIn from './WorkerCheckIn.svelte';
	import WorkerReport from './WorkerReport.svelte';
	import ThreadNotice from './ThreadNotice.svelte';
	import type { ThreadCards } from '#lib/threads.js';
	import { workerTitlesBeforeSend } from '#lib/workers.js';
	import VerticalOverlayScrollbar from '#lib/components/VerticalOverlayScrollbar.svelte';
	import SelectionQuote from './SelectionQuote.svelte';

	/**
	 * The scrolling transcript column: the items, paging back, the working
	 * indicator and the scroll-to-bottom button. Both the coordinator's chat and a
	 * worker's read-only transcript use it, so the reading experience is the same.
	 */
	let {
		items,
		cwd,
		workers = [],
		workerHref,
		scheduleName,
		reportHref,
		canLoadEarlier = false,
		loadingEarlier = false,
		onLoadEarlier,
		working = false,
		running = false,
		waitingForUser = false,
		connected = true,
		runFailed = false,
		extractionFor = undefined,
		onopentopic,
		onopenboard,
		threadCards,
		onundo,
		undoErrorFor,
		empty,
		onquote,
		onwaiting,
		waitingTarget = 'coordinator'
	}: {
		items: readonly TranscriptItem[];
		/** The directory tool cards shorten paths against. */
		cwd?: string;
		/** The project's workers, so a `worker_*` call can show the worker it acted on. */
		workers?: readonly WorkerSummary[];
		workerHref?: (worker: WorkerSummary) => string;
		/** The title of the schedule behind a worker, for workers a schedule started. */
		scheduleName?: (scheduleId: string) => string | undefined;
		/** A report's link to the worker that sent it. */
		reportHref?: (workerId: string) => string;
		canLoadEarlier?: boolean;
		loadingEarlier?: boolean;
		onLoadEarlier?: () => void | Promise<void>;
		/** The coordinator is working but no turn says so yet. */
		working?: boolean;
		running?: boolean;
		waitingForUser?: boolean;
		connected?: boolean;
		runFailed?: boolean;
		/**
		 * The memories a compaction entry saved, from the scope histories the screen already holds: a marker shows them and
		 * their undo without asking the server again.
		 */
		extractionFor?: (entryId: number) => MemoryExtraction | undefined;
		onopentopic?: (fileId: string, scope: MemoryScope) => void;
		onopenboard?: () => void;
		/** The project's threads: `thread_*` calls and what threads post become live thread cards. */
		threadCards?: ThreadCards;
		onundo?: (scope: MemoryScope, commit: string) => void;
		undoErrorFor?: (commit: string) => string | undefined;
		/** What to show when there is nothing to read yet. */
		empty?: Snippet;
		/** Text selected in the transcript can be quoted into the message; undefined where there is nothing to write. */
		onquote?: (quote: string) => void;
		/** An action on a message that has not reached the conversation: take it back, drop it, or send it again. */
		onwaiting?: (key: string, action: 'edit' | 'cancel' | 'retry') => void;
		/** Who a waiting message is for, in its status line. */
		waitingTarget?: 'coordinator' | 'thread';
	} = $props();

	const lastTurn = $derived(items.filter(item => item.kind === 'turn').at(-1));
	const liveTurn = $derived(items.some(item => item.kind === 'turn' && agentTurnWorking(item, running)));
	const failed = $derived(runFailed || (lastTurn?.parts.some(part => part.type === 'error' || part.type === 'stopped') ?? false));
	let completed = $state(false);
	let wasRunning = untrack(() => running);
	let completionTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		if (agentFinished(wasRunning, running, waitingForUser, connected, failed)) {
			completed = true;
			clearTimeout(completionTimer);
			completionTimer = setTimeout(() => { completed = false; }, 1300);
		} else if (running || waitingForUser || !connected || failed) completed = false;
		wasRunning = connected && running;
	});
	onDestroy(() => clearTimeout(completionTimer));

	let scroller = $state<HTMLDivElement | null>(null);
	let content = $state<HTMLDivElement | null>(null);
	/** Follow new output while the reader is at the bottom; leave their position alone otherwise. */
	let stick = $state(true);
	const workerTitlesBefore = $derived(workerTitlesBeforeSend(items, workers));

	export function scrollToBottom(behavior: ScrollBehavior = 'instant'): void {
		scroller?.scrollTo({ top: scroller.scrollHeight, behavior });
	}

	/** Follow new output from here on. */
	export function follow(): void {
		stick = true;
		scrollToBottom();
	}

	let lastScrollTop = 0;
	function onscroll(): void {
		const element = scroller;
		if (element == null) return;
		const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
		// Growth that lands between our own scroll and its event is not the reader leaving the bottom: only moving up is.
		if (nearBottom) stick = true;
		else if (element.scrollTop < lastScrollTop) stick = false;
		lastScrollTop = element.scrollTop;
		prefetchEarlier();
	}

	// New output, code that finished highlighting, a growing composer: follow it while stuck to the bottom.
	$effect(() => {
		const element = content;
		if (element == null) return;
		let previousHeight = element.getBoundingClientRect().height;
        let previousWarmHeight = 0;
        const observer = new ResizeObserver(() => {
            const warmHeight = [...element.querySelectorAll('[data-cache-warm]')].reduce((total, line) => total + line.getBoundingClientRect().height + 24, 0);
            const height = element.getBoundingClientRect().height;
            const onlyWarmChanged = warmHeight !== previousWarmHeight && Math.abs((height - previousHeight) - (warmHeight - previousWarmHeight)) < 3;
            previousHeight = height; previousWarmHeight = warmHeight;
			if (stick && !onlyWarmChanged) scrollToBottom();
			prefetchEarlier();
		});
		observer.observe(element);
		if (scroller) observer.observe(scroller);
		return () => observer.disconnect();
	});

	const realItemCount = $derived(items.filter(item => item.kind !== 'cacheWarm').length);
	const earlierPage = $state({ loading: false, failed: false });
	function prefetchEarlier(): void {
		const element = scroller;
		if (element && shouldPrefetchEarlier(element.scrollTop, element.clientHeight, canLoadEarlier,
			loadingEarlier || earlierPage.loading, earlierPage.failed)) void loadEarlier();
	}

	async function loadEarlier(): Promise<void> {
		if (!canLoadEarlier || loadingEarlier || !onLoadEarlier) return;
		await loadEarlierPage(earlierPage, onLoadEarlier);
	}

	// Recheck after each page even if no scroll event fired: fill a short viewport, or fetch the next page
	// when momentum has already carried the reader back into the prefetch zone. Initial bottom-follow runs first.
	$effect(() => {
		void realItemCount;
		void canLoadEarlier;
		void loadingEarlier;
		void earlierPage.loading;
		const frame = requestAnimationFrame(() => untrack(() => {
			if (stick) scrollToBottom();
			prefetchEarlier();
		}));
		return () => cancelAnimationFrame(frame);
	});

	// Snapshot immediately BEFORE the prepend, not before the network request. User scrolling during the
	// request is preserved. Correct a surviving visible row after DOM flush (before paint); browser anchoring
	// is disabled on this scroller so it cannot apply the same correction twice. Also anchor removal of the
	// exhausted-history spinner row; tail growth alone isn't a prepend.
	let firstKey: string | undefined;
	let hadEarlierRow = false;
	$effect.pre(() => {
		const nextKey = items[0]?.key;
		const hasEarlierRow = !!onLoadEarlier && (canLoadEarlier || loadingEarlier || earlierPage.loading);
		const previousKey = firstKey;
		const previousEarlierRow = hadEarlierRow;
		firstKey = nextKey;
		hadEarlierRow = hasEarlierRow;
		if (previousKey === undefined || (previousKey === nextKey && previousEarlierRow === hasEarlierRow)) return;
		untrack(() => {
			const element = scroller;
			if (!element || stick) return;
			const edge = element.getBoundingClientRect().top;
			const anchor = [...element.querySelectorAll<HTMLElement>('[data-transcript-key]')]
				.find(row => row.getBoundingClientRect().bottom > edge);
			if (!anchor) return;
			const offset = anchor.getBoundingClientRect().top;
			void tick().then(() => {
				if (scroller !== element || !anchor.isConnected || stick) return;
				element.scrollTop += anchor.getBoundingClientRect().top - offset;
				lastScrollTop = element.scrollTop;
			});
		});
	});
	const LINE_KINDS: ReadonlySet<string> = new Set(['report', 'checkin', 'thread', 'board', 'reports']);
</script>

<div class="relative min-h-0 flex-1">
	<div
		bind:this={scroller}
		{onscroll}
		class="absolute inset-0 overflow-x-hidden overflow-y-auto overscroll-contain"
		style="overflow-anchor: none"
	>
		<div bind:this={content} class="mx-auto flex min-h-full w-full {CHAT_COLUMN_CLASS} flex-col px-4 sm:px-6">
			{#if items.length === 0 && empty}
				{@render empty()}
			{:else}
				<div class="flex flex-col gap-6 pt-2 pb-8">
					{#if onLoadEarlier && (canLoadEarlier || loadingEarlier || earlierPage.loading)}
						<div class="flex h-8 items-center justify-center text-xs text-(--chat-fg-muted)" aria-live="polite">
							{#if loadingEarlier || earlierPage.loading}
								<Spinner class="size-4" aria-label="Loading earlier messages" />
							{:else if earlierPage.failed}
								<Button variant="ghost" size="sm" type="button" onclick={loadEarlier}>Couldn't load earlier messages · Retry</Button>
							{/if}
						</div>
					{/if}

					{#each items as item, index (item.key)}
						<div data-transcript-key={item.key} class={LINE_KINDS.has(item.kind) && LINE_KINDS.has(items[index - 1]?.kind ?? '') ? '-mt-[1.1rem]' : undefined}>
							{@render transcriptItem(item)}
						</div>
					{/each}
					{#snippet transcriptItem(item: (typeof items)[number])}
						{#if item.kind === 'user'}
							<UserMessage
								text={item.text}
								images={item.images}
								imageCount={item.imageCount}
								timestamp={item.timestamp}
								waiting={item.waiting}
								target={waitingTarget}
								onedit={onwaiting && (() => onwaiting(item.key, 'edit'))}
								oncancel={onwaiting && (() => onwaiting(item.key, 'cancel'))}
								onretry={onwaiting && (() => onwaiting(item.key, 'retry'))}
							/>
						{:else if item.kind === 'turn'}
							<AssistantTurn
								parts={item.parts}
								streaming={item.streaming === true}
								motion={agentTurnWorking(item, running) ? (waitingForUser ? 'waiting' : 'working') : completed && item.key === lastTurn?.key ? 'done' : 'idle'}
								{cwd}
								{workers}
								{workerHref}
								{scheduleName}
								{workerTitlesBefore}
								{onopentopic}
								{onopenboard}
								{threadCards}
								timestamp={item.timestamp}
								ended={item.ended}
								model={item.model}
								usage={item.usage}
								cacheMisses={item.cacheMisses}
							/>
						{:else if item.kind === 'report'}
							{@const worker = workers.find((entry) => entry.id === item.workerId)}
							<WorkerReport
								{item}
								href={reportHref?.(item.workerId)}
								taskId={worker?.taskId ?? undefined}
								workerTitle={worker?.title}
							/>
						{:else if item.kind === 'checkin'}
							<WorkerCheckIn {item} cards={threadCards} />
						{:else if item.kind === 'thread'}
							<ThreadNotice {item} cards={threadCards} />
						{:else if item.kind === 'reports'}
							<ReportsNotice {item} />
						{:else if item.kind === 'board'}
							<BoardNotice {item} cards={threadCards} />
						{:else if item.kind === 'cacheWarm'}
                            <details data-cache-warm class="relative ml-[2.4rem] text-xs text-(--chat-fg-subtle) sm:ml-[2.65rem]">
                                <summary class="w-fit cursor-pointer list-none rounded py-1 outline-offset-4 focus-visible:outline" title={cacheWarmDetail(item.stretch)}>{cacheWarmLabel(item.stretch)}</summary>
                                <p class="absolute z-20 mt-1 max-w-sm rounded-md border border-(--chat-border) bg-(--chat-bg) p-3 text-xs shadow-lg">{cacheWarmDetail(item.stretch)}</p>
                            </details>
						{:else if item.kind === 'compaction'}
							{@const extraction = item.entryId === undefined ? undefined : extractionFor?.(item.entryId)}
							<CompactionMarker
								{item}
								{extraction}
								{onopentopic}
								{onundo}
								undoError={extraction === undefined ? undefined : undoErrorFor?.(extraction.change.commit)}
							/>
						{:else}
							<TurnNotice {item} />
						{/if}
					{/snippet}

					{#if showsAgentActivityRow(waitingForUser, working, completed)}
						<div class="flex items-center gap-3 text-sm sm:gap-4 {((liveTurn && working) || (completed && lastTurn !== undefined)) ? 'sm:hidden' : ''}" data-agent-activity={completed ? 'done' : 'working'}>
							<AgentMascot state={completed ? 'done' : 'working'} />
							<span class="font-medium" class:shimmer-text={!completed}>{completed ? 'Done.' : 'Working…'}</span>
						</div>
					{/if}
				</div>
			{/if}
		</div>
	</div>

	<VerticalOverlayScrollbar {scroller} />

	{#if onquote}
		<SelectionQuote scope={scroller} {onquote} />
	{/if}

	{#if !stick && items.length > 0}
		<button
			type="button"
			class="absolute bottom-3 left-1/2 grid size-9 -translate-x-1/2 place-items-center rounded-full border border-(--chat-border) shadow-(--chat-shadow) glass"
			onclick={follow}
			aria-label="Scroll to the bottom"
			title="Scroll to the bottom"
		>
			<ArrowDownIcon class="size-4" />
		</button>
	{/if}
</div>
