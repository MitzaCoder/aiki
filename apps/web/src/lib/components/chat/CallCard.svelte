<script lang="ts">
	import type { MemoryScope, WorkerSummary } from '@mihai-harness/protocol';
	import { BOARD_TOOL_NAME, boardCallView } from '#lib/board.js';
	import { hasThreadCard, threadIdOfCall, type ThreadCards } from '#lib/threads.js';
	import { workerForToolCall } from '#lib/workers.js';
	import { ARTIFACT_SAVE_TOOL } from '#lib/artifacts.js';
	import { isCodemodeTool } from '#lib/chat/codemode.js';
	import { isMemoryTool } from '#lib/chat/memory-tools.js';
	import type { ToolPart } from '#lib/transcript.js';
	import ArtifactCallCard from '#lib/components/artifacts/ArtifactCallCard.svelte';
	import BoardCallCard from './BoardCallCard.svelte';
	import CodemodeCallCard from './CodemodeCallCard.svelte';
	import MemoryCallCard from './MemoryCallCard.svelte';
	import ThreadCallCard from './ThreadCallCard.svelte';
	import ThreadCallLine from './ThreadCallLine.svelte';
	import ToolCard from './ToolCard.svelte';
	import WorkerCallCard from './WorkerCallCard.svelte';

	/**
	 * One tool call, as the card its kind asks for: a worker's card, a thread's,
	 * memory's, the board's, an artifact's, a code mode script's, or the generic
	 * card. A turn draws it on its own or as a step inside a folded run of calls.
	 */
	let {
		part,
		cwd,
		workers = [],
		workerHref,
		scheduleName,
		workerTitlesBefore,
		onopentopic,
		onopenboard,
		threadCards
	}: {
		part: ToolPart;
		/** The project directory, to shorten paths in the summary. */
		cwd?: string;
		/** The project's workers, so a `worker_*` call shows the worker it acted on. */
		workers?: readonly WorkerSummary[];
		workerHref?: (worker: WorkerSummary) => string;
		/** The title of the schedule behind a worker, for workers a schedule started. */
		scheduleName?: (scheduleId: string) => string | undefined;
		/** Each retitling `worker_send`'s previous worker title, by call ID. */
		workerTitlesBefore?: ReadonlyMap<string, string>;
		/** A memory topic a card names opens in the Memory tab. */
		onopentopic?: (fileId: string, scope: MemoryScope) => void;
		/** Open the Board tab, from a `board` call's card. */
		onopenboard?: () => void;
		/** The project's threads, so a `thread_*` call shows the thread it started or acted on, live. */
		threadCards?: ThreadCards;
	} = $props();

	const worker = $derived(workerForToolCall(workers, part));
	const boardView = $derived(part.name === BOARD_TOOL_NAME ? boardCallView(part) : undefined);
	/** A `thread_*` call with a card of its own, when the caller holds the project's threads. */
	const threadCard = $derived(threadCards !== undefined && hasThreadCard(part.name));
	const threadId = $derived(threadCard ? threadIdOfCall(part) : undefined);
</script>

{#if worker !== undefined}
	<WorkerCallCard
		{part}
		{worker}
		href={workerHref?.(worker)}
		{scheduleName}
		previousTitle={workerTitlesBefore?.get(part.callId)}
	/>
{:else if threadCard && threadCards !== undefined}
	<ThreadCallCard
		{part}
		{threadId}
		thread={threadId === undefined ? undefined : threadCards.threads.find((entry) => entry.id === threadId)}
		href={threadId === undefined ? undefined : threadCards.href(threadId)}
		scheduleName={threadCards.scheduleName}
	/>
{:else if part.name.startsWith('thread_')}
	<ThreadCallLine {part} threads={threadCards?.threads} />
{:else if isMemoryTool(part.name)}
	<MemoryCallCard {part} {onopentopic} />
{:else if boardView !== undefined}
	<BoardCallCard {part} view={boardView} {onopenboard} />
{:else if part.name === ARTIFACT_SAVE_TOOL}
	<ArtifactCallCard {part} />
{:else if isCodemodeTool(part.name)}
	<CodemodeCallCard {part} />
{:else}
	<ToolCard {part} {cwd} />
{/if}
