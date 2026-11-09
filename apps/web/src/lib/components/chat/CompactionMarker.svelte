<script lang="ts">
	import ArchiveIcon from '@lucide/svelte/icons/archive';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import Banner from '#lib/components/Banner.svelte';
	import Markdown from '#lib/components/markdown/Markdown.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import * as Collapsible from '#lib/components/ui/collapsible/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import type { MemoryExtraction } from '#lib/memory.js';
	import type { TranscriptItem } from '#lib/transcript.js';
	import { exactTime, relativeTime } from '#lib/relative-time.js';
	import type { MemoryScope } from '@mihai-harness/protocol';

	/**
	 * A compaction in the transcript: a divider that says earlier messages were summarized and when, opening onto the
	 * summary itself. While a compaction runs it is one quiet line instead, because nothing is readable yet.
	 *
	 * When the compaction left memories behind (`extractionFor` finds the extraction commit whose source names this
	 * entry), the divider says how many and names the topics; a topic opens in the Memory tab and the whole extraction
	 * can be undone from here. The history is read once per scope by `ProjectMemory`, so this costs no request.
	 */
	let {
		item,
		extraction,
		onopentopic,
		onundo,
		undoError
	}: {
		item: Extract<TranscriptItem, { kind: 'compaction' }>;
		/** The memories this compaction saved, when the history has an extraction for it. */
		extraction?: MemoryExtraction;
		onopentopic?: (fileId: string, scope: MemoryScope) => void;
		onundo?: (scope: MemoryScope, commit: string) => void;
		/** Why undoing this extraction failed, if it did. */
		undoError?: string;
	} = $props();

	let open = $state(false);
	let confirming = $state(false);

	const when = $derived(
		item.timestamp === undefined ? undefined : relativeTime(new Date(item.timestamp).toISOString(), Date.now())
	);
	const exact = $derived(item.timestamp === undefined ? undefined : exactTime(new Date(item.timestamp).toISOString()));
	const saved = $derived(extraction === undefined ? undefined : extraction.change.files.length);
	const undone = $derived(extraction?.undoneBy !== undefined);

	function undo(): void {
		if (extraction === undefined || onundo === undefined) return;
		confirming = false;
		onundo(extraction.scope, extraction.change.commit);
	}
</script>

{#if item.running}
	<div class="flex animate-rise items-center justify-center gap-2 py-0.5 text-xs text-(--chat-fg-subtle) motion-reduce:animate-none" role="status">
		<Spinner class="size-3" aria-label="Compacting" />
		<span>Summarizing earlier messages…</span>
	</div>
{:else}
	<div
		id={item.entryId === undefined ? undefined : `entry-${item.entryId}`}
		class="flex animate-rise flex-col gap-1.5 motion-reduce:animate-none"
	>
		<Collapsible.Root bind:open>
			<div class="flex items-center gap-2 text-[0.6875rem] text-(--chat-fg-subtle)">
				<span aria-hidden="true" class="h-px flex-1 bg-(--chat-border)"></span>
				{#if item.summary}
					<Collapsible.Trigger
						class="group flex min-w-0 items-center gap-1.5 rounded-full border border-(--chat-border) bg-(--chat-surface)/50 px-2.5 py-1 font-medium transition-colors hover:bg-(--chat-surface-2) focus-visible:ring-2 focus-visible:ring-(--chat-fg-subtle) focus-visible:outline-none"
						aria-label="Earlier messages summarized{when === undefined ? '' : ` ${when}`}; show the summary"
					>
						<ArchiveIcon class="size-3 shrink-0" />
						<span class="truncate">Earlier messages summarized</span>
						{#if when}
							<span class="shrink-0 font-normal" title={exact}>· {when}</span>
						{/if}
						<ChevronDownIcon
							class="size-3 shrink-0 transition-transform group-data-[state=open]:rotate-180"
						/>
					</Collapsible.Trigger>
				{:else}
					<span
						class="flex min-w-0 items-center gap-1.5 rounded-full border border-(--chat-border) px-2.5 py-1 font-medium"
					>
						<ArchiveIcon class="size-3 shrink-0" />
						<span class="truncate">Earlier messages summarized</span>
						{#if when}
							<span class="shrink-0 font-normal" title={exact}>· {when}</span>
						{/if}
					</span>
				{/if}
				<span aria-hidden="true" class="h-px flex-1 bg-(--chat-border)"></span>
			</div>
			{#if item.summary}
				<Collapsible.Content>
					<div class="mt-2 rounded-2xl border border-(--chat-border) bg-(--chat-surface)/40 px-3.5 py-2.5">
						<Markdown source={item.summary} />
					</div>
				</Collapsible.Content>
			{/if}
		</Collapsible.Root>

		{#if extraction !== undefined && saved !== undefined && saved > 0}
			<div
				class="mx-auto flex max-w-full flex-wrap items-center justify-center gap-x-2 gap-y-1 px-1 text-[0.6875rem] text-(--chat-fg-subtle)"
			>
				<span class="font-medium">
					{saved === 1 ? '1 memory saved' : `${saved} memories saved`}
				</span>
				{#if extraction.topics.length > 0}
					<span class="flex flex-wrap items-center justify-center gap-1">
						{#each extraction.topics as topic (topic.fileId)}
							<button
								type="button"
								class="max-w-40 truncate rounded-full border border-(--chat-border) bg-(--chat-surface-2) px-1.5 py-0.5 text-[0.625rem] text-(--chat-fg-muted) transition-colors hover:border-(--chat-border-strong) hover:text-(--chat-fg)"
								title={topic.known ? topic.fileId : `${topic.fileId} (open it to read its title)`}
								onclick={() => onopentopic?.(topic.fileId, extraction.scope)}
							>
								{topic.title}
							</button>
						{/each}
					</span>
				{/if}
				{#if undone}
					<span class="rounded-full border border-(--chat-border) px-1.5 py-0.5 text-[0.625rem]">Undone</span>
				{:else if onundo !== undefined && extraction.change.undoable === true}
					<Button
						variant="ghost"
						size="sm"
						type="button"
						class="h-5 px-1.5 text-[0.625rem]"
						title="Undo this extraction"
						onclick={() => (confirming = true)}
					>
						Undo
					</Button>
				{/if}
				<span class="text-[0.625rem]">
					{extraction.scope === 'global' ? 'in your global memory' : "in this project's memory"}
				</span>
			</div>
			{#if undoError !== undefined}
				<Banner tone="error">{undoError}</Banner>
			{/if}
		{/if}
	</div>

	<Dialog.Root bind:open={confirming}>
		<Dialog.Content class="sm:max-w-sm">
			<Dialog.Header>
				<Dialog.Title>Undo these memories?</Dialog.Title>
				<Dialog.Description>
					This reverts the whole extraction commit ({saved ?? 0} {saved === 1 ? 'file' : 'files'}) as one undo
					commit. It is refused if later changes touched the same memories.
				</Dialog.Description>
			</Dialog.Header>
			<Dialog.Footer>
				<Dialog.Close>
					{#snippet child({ props })}
						<Button {...props} variant="outline" size="sm" type="button">Cancel</Button>
					{/snippet}
				</Dialog.Close>
				<Button variant="destructive" size="sm" type="button" onclick={undo}>Undo</Button>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>
{/if}
