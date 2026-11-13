<script lang="ts">
	import { overlayScroll } from '#lib/scrollbars.js';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import SearchIcon from '@lucide/svelte/icons/search';
	import Banner from '#lib/components/Banner.svelte';
	import ContextUsage from '#lib/components/ContextUsage.svelte';
	import CopyButton from '#lib/components/CopyButton.svelte';
	import Markdown from '#lib/components/markdown/Markdown.svelte';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import * as Collapsible from '#lib/components/ui/collapsible/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import {
		contextFileRows,
		contextFilesByKind,
		contextOverview,
		contextPaths,
		filterSkills,
		filterTools,
		groupTools,
		humanPath,
		skillGroups,
		skillSourceGroups,
		systemPromptStats,
		type ContextFileRow,
		type ContextSection,
		type SkillSourceGroup
	} from '#lib/context.js';
	import type { ConversationContext, SkillInfo, ToolInfo } from '@kemiri/protocol';
	import type { Snippet } from 'svelte';

	/**
	 * The sidebar's Info tab: what this conversation's model is given besides the
	 * transcript. The overview's four numbers jump to the sections: where it works,
	 * the system prompt files and the AGENTS.md files, the skills it was offered
	 * (the ones it read first), its tools by extension, and the full system prompt.
	 * Long lists are one line per item and open on click, with a filter once they grow.
	 *
	 * Live: the server pushes the whole context on every change, so this renders the
	 * current one without any state of its own.
	 */
	let {
		context,
		loaded,
		error,
		canCompact = false,
		compacting = false,
		compactError,
		oncompact,
		extra
	}: {
		context: ConversationContext | undefined;
		/** The first `conversation.context` answer has arrived. */
		loaded: boolean;
		error?: string;
		/** Only the coordinator's conversation can be compacted from the app. */
		canCompact?: boolean;
		/** A compaction is running, from the screen's request or the server's usage. */
		compacting?: boolean;
		compactError?: string;
		oncompact?: (instructions?: string) => void | Promise<void>;
		/** More sections at the top, such as the conversation's artifacts. */
		extra?: Snippet;
	} = $props();

	let panel = $state<HTMLDivElement>();
	let skillQuery = $state('');
	let toolQuery = $state('');
	let availableOpen = $state(false);
	/** Only the first context seeds the available group's open state; later pushes keep the user's choice. */
	let seededAvailableOpen = false;

	const paths = $derived(context === undefined ? [] : contextPaths(context));
	const fileKinds = $derived(context === undefined ? undefined : contextFilesByKind(context.contextFiles));
	/** pi's two system prompt files, SYSTEM.md (the override) and APPEND_SYSTEM.md (the additions), then the model notes. */
	const promptFileRows = $derived(
		context === undefined
			? []
			: contextFileRows(
					[...(fileKinds?.system ?? []), ...(fileKinds?.append ?? []), ...(fileKinds?.model ?? [])],
					context
				)
	);
	/** The AGENTS.md files inherited from the agent directory, the project and its parents. */
	const agentsRows = $derived(
		context === undefined ? [] : contextFileRows(fileKinds?.agents ?? [], context)
	);
	const skills = $derived(skillGroups(context?.skills ?? []));
	const readSources = $derived(skillSourceGroups(skills.read));
	const availableSources = $derived(skillSourceGroups(skills.available));
	const matchedSkills = $derived(skillGroups(filterSkills(context?.skills ?? [], skillQuery)));
	const matchedSources = $derived(skillSourceGroups([...matchedSkills.read, ...matchedSkills.available]));
	const matchedSkillCount = $derived(matchedSkills.read.length + matchedSkills.available.length);
	const toolGroups = $derived(groupTools(filterTools(context?.tools ?? [], toolQuery)));
	const overview = $derived(context === undefined ? [] : contextOverview(context));
	const promptStats = $derived(systemPromptStats(context?.systemPrompt ?? ''));

	const heading = 'text-[0.6875rem] font-semibold tracking-wide text-(--chat-fg-subtle) uppercase';
	const sourceHeading = 'px-1.5 pt-1.5 text-[0.6875rem] font-semibold text-(--chat-fg-muted)';
	const scopeHeading = 'px-3.5 pt-1 text-[0.625rem] font-semibold tracking-wide text-(--chat-fg-subtle) uppercase';

	// A handful of skills can stay open; a long list starts folded so the read ones are what you see.
	$effect(() => {
		if (seededAvailableOpen || context === undefined) return;
		seededAvailableOpen = true;
		availableOpen = skills.available.length <= 6;
	});

	function jumpTo(section: ContextSection): void {
		const target = panel?.querySelector<HTMLElement>(`[data-context-section="${section}"]`);
		if (target === null || target === undefined) return;
		const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		target.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
	}

	function skillPath(skill: SkillInfo): string {
		return context === undefined ? skill.path : humanPath(skill.path, context).short;
	}
</script>

{#snippet skillRow(entry: SkillInfo, showRead = true)}
	<Collapsible.Root>
		<Collapsible.Trigger
			class="group flex w-full min-w-0 items-center gap-1.5 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-(--chat-surface-2)"
		>
			<ChevronRightIcon
				class="size-3 shrink-0 text-(--chat-fg-subtle) transition-transform group-data-[state=open]:rotate-90"
			/>
			<span class="min-w-0 flex-1 truncate text-xs font-medium">{entry.name}</span>
			{#if entry.read && showRead}
				<span
					class="shrink-0 rounded-full bg-(--chat-success)/15 px-1.5 py-0.5 text-[0.625rem] font-semibold text-(--chat-success)"
					title="This conversation read this SKILL.md">read</span
				>
			{/if}
		</Collapsible.Trigger>
		<Collapsible.Content>
			<div class="flex flex-col gap-1 pr-1 pb-2 pl-6">
				{#if entry.description.length > 0}
					<p class="text-xs break-words text-(--chat-fg-muted)">{entry.description}</p>
				{/if}
				<div class="flex min-w-0 items-center gap-1">
					<code
						class="min-w-0 flex-1 truncate font-mono text-[0.6875rem] text-(--chat-fg-subtle)"
						title={entry.path}>{skillPath(entry)}</code
					>
					<CopyButton text={entry.path} label="Copy the skill's path" class="shrink-0" />
				</div>
			</div>
		</Collapsible.Content>
	</Collapsible.Root>
{/snippet}

{#snippet skillSourceRows(sources: SkillSourceGroup[], showRead = true)}
	{#each sources as group (group.source)}
		<p class={sourceHeading}>
			{group.label}
			<span class="font-normal text-[0.625rem] text-(--chat-fg-subtle)">({group.skills.length})</span>
		</p>
		{#each group.scopes as scopeGroup (scopeGroup.scope)}
			<p class={scopeHeading}>
				{scopeGroup.label}
				<span class="font-normal normal-case">({scopeGroup.skills.length})</span>
			</p>
			{#each scopeGroup.skills as skill (skill.path)}
				{@render skillRow(skill, showRead)}
			{/each}
		{/each}
	{/each}
{/snippet}

{#snippet fileRow(row: ContextFileRow)}
	<!-- A system prompt file is labelled by what it is, an AGENTS.md by where it comes from. -->
	{@const badge = row.kind === 'agents' ? row.originLabel : row.kindLabel}
	<Collapsible.Root>
		<Collapsible.Trigger
			class="group flex w-full min-w-0 items-center gap-1.5 rounded-lg px-1.5 py-1.5 text-left transition-colors hover:bg-(--chat-surface-2)"
		>
			<ChevronRightIcon
				class="size-3.5 shrink-0 text-(--chat-fg-subtle) transition-transform group-data-[state=open]:rotate-90"
			/>
			<Badge variant="outline" class="max-w-[55%] shrink-0 text-[0.625rem]">
				<span class="truncate">{badge}</span>
			</Badge>
			{#if row.kind === 'agents'}
				<span
					class="min-w-0 flex-1 truncate font-mono text-[0.6875rem] text-(--chat-fg-muted)"
					title={row.full}>{row.short}</span
				>
			{:else}
				<!--
					A system prompt file is named by its kind, so its path would only be truncated here; it is in the
					expanded row, with its copy button. The origin says whether it is the harness's own or the project's.
				-->
				{#if row.kind === 'model'}
					<!-- Model notes are picked by their name's model pattern, so the name says why this file applies. -->
					<span
						class="min-w-0 flex-1 truncate font-mono text-[0.6875rem] text-(--chat-fg-muted)"
						title={row.full}
						data-model-notes={row.name}>{row.name}</span
					>
				{:else}
					<span class="shrink-0 text-[0.625rem] text-(--chat-fg-subtle)">{row.originLabel}</span>
					<span class="min-w-0 flex-1" title={row.full}></span>
				{/if}
			{/if}
			<span class="shrink-0 text-[0.625rem] text-(--chat-fg-subtle)">{row.size}</span>
		</Collapsible.Trigger>
		<Collapsible.Content class="px-1.5 pt-1 pb-2">
			<div class="mb-1.5 flex min-w-0 items-center gap-1 pl-6">
				<code
					class="min-w-0 flex-1 truncate font-mono text-[0.6875rem] text-(--chat-fg-subtle)"
					title={row.full}>{row.full}</code
				>
				<CopyButton text={row.full} label="Copy the file's path" class="shrink-0" />
			</div>
			<div class="rounded-xl border border-(--chat-border) bg-(--chat-surface)/30 p-2.5">
				<Markdown source={row.file.content} />
			</div>
		</Collapsible.Content>
	</Collapsible.Root>
{/snippet}

<div class="relative flex min-h-0 flex-1 flex-col">
<div
	bind:this={panel}
	data-context-panel
	use:overlayScroll={'parent'}
	class="@container min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3"
>
	<div class="mx-auto flex w-full max-w-3xl flex-col gap-4">
		{#if error}
			<Banner tone="error">{error}</Banner>
		{/if}

		{@render extra?.()}

		{#if context === undefined}
			{#if !loaded && !error}
				<p class="px-1 py-3 text-sm text-(--chat-fg-subtle)">Loading the conversation's context…</p>
			{:else if !error}
				<p class="px-1 py-3 text-sm text-(--chat-fg-subtle)">
					This conversation's context is not available.
				</p>
			{/if}
		{:else}
			{#if context.usage}
				<ContextUsage
					usage={context.usage}
					{canCompact}
					{compacting}
					{compactError}
					{oncompact}
				/>
			{/if}

			<section aria-label="Overview" class="grid grid-cols-2 gap-1.5 @min-[34rem]:grid-cols-4">
				{#each overview as item (item.section)}
					<button
						type="button"
						class="flex min-w-0 flex-col items-start gap-0.5 rounded-xl border border-(--chat-border) bg-(--chat-surface)/30 px-2.5 py-2 text-left transition-colors hover:border-(--chat-border-strong) hover:bg-(--chat-surface-2) focus-visible:ring-2 focus-visible:ring-(--chat-fg-subtle) focus-visible:outline-none"
						onclick={() => jumpTo(item.section)}
						title="Jump to {item.label}"
					>
						<span class="w-full truncate text-sm font-semibold tabular-nums">{item.value}</span>
						<span class="w-full truncate text-[0.625rem] font-semibold tracking-wide text-(--chat-fg-subtle) uppercase"
							>{item.label}</span
						>
						{#if item.detail}
							<span class="w-full truncate text-[0.625rem] text-(--chat-fg-subtle)">{item.detail}</span>
						{/if}
					</button>
				{/each}
			</section>

			<section aria-label="Paths" class="flex flex-col gap-2">
				{#each paths as row (row.label)}
					<div class="flex min-w-0 flex-col gap-0.5">
						<span class={`${heading} px-1`}>{row.label}</span>
						<div class="flex min-w-0 items-center gap-1">
							<code
								class="min-w-0 flex-1 truncate px-1 font-mono text-xs text-(--chat-fg-muted)"
								title={row.full}>{row.short}</code
							>
							<CopyButton text={row.full} label="Copy the path" class="shrink-0" />
						</div>
					</div>
				{/each}
			</section>

			<section
				data-context-section="system"
				aria-label="System prompt files"
				class="flex scroll-mt-2 flex-col gap-1"
			>
				<h3 class={`${heading} flex items-center gap-1.5 px-1`}>
					System prompt files
					<span class="font-normal normal-case">({promptFileRows.length})</span>
				</h3>
				{#if promptFileRows.length === 0}
					<p class="px-1 text-xs text-(--chat-fg-subtle)">
						No SYSTEM.md or APPEND_SYSTEM.md: the harness's own sections and the AGENTS.md files only.
					</p>
				{/if}
				{#each promptFileRows as row (row.full)}
					{@render fileRow(row)}
				{/each}
			</section>

			<section
				data-context-section="agents"
				aria-label="AGENTS.md files"
				class="flex scroll-mt-2 flex-col gap-1"
			>
				<h3 class={`${heading} flex items-center gap-1.5 px-1`}>
					AGENTS.md
					<span class="font-normal normal-case">({agentsRows.length})</span>
				</h3>
				{#if agentsRows.length === 0}
					<p class="px-1 text-xs text-(--chat-fg-subtle)">No AGENTS.md files in the system prompt.</p>
				{/if}
				{#each agentsRows as row (row.full)}
					{@render fileRow(row)}
				{/each}
			</section>

			<section data-context-section="skills" aria-label="Skills" class="flex scroll-mt-2 flex-col gap-1">
				<h3 class={`${heading} flex items-center gap-1.5 px-1`}>
					Skills
					<span class="font-normal normal-case">({context.skills.length})</span>
				</h3>
				{#if context.skills.length === 0}
					<p class="px-1 text-xs text-(--chat-fg-subtle)">No skills are offered to this conversation.</p>
				{:else}
					{#if context.skills.length > 8}
						<div class="relative">
							<SearchIcon
								class="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-(--chat-fg-subtle)"
							/>
							<Input
								bind:value={skillQuery}
								type="search"
								placeholder="Filter skills"
								aria-label="Filter skills"
								class="h-8 rounded-lg border-(--chat-border) bg-(--chat-surface)/30 pr-2 pl-7 text-xs md:text-xs"
							/>
						</div>
					{/if}

					{#if skillQuery.trim().length > 0}
						<p class={`${heading} px-1.5 pt-1`}>
							Matches
							<span class="font-normal normal-case">({matchedSkillCount})</span>
						</p>
						{@render skillSourceRows(matchedSources)}
						{#if matchedSkillCount === 0}
							<p class="px-1.5 py-2 text-xs text-(--chat-fg-subtle)">No skills match "{skillQuery.trim()}".</p>
						{/if}
					{:else}
						{#if skills.read.length > 0}
							<p class={`${heading} px-1.5 pt-1`}>
								Read in this conversation
								<span class="font-normal normal-case">({skills.read.length})</span>
							</p>
							{@render skillSourceRows(readSources, false)}
						{/if}

						{#if skills.available.length > 0}
							<Collapsible.Root bind:open={availableOpen}>
								<Collapsible.Trigger
									class="group flex w-full min-w-0 items-center gap-1.5 rounded-lg px-1.5 py-1.5 text-left transition-colors hover:bg-(--chat-surface-2)"
								>
									<ChevronRightIcon
										class="size-3.5 shrink-0 text-(--chat-fg-subtle) transition-transform group-data-[state=open]:rotate-90"
									/>
									<span class={`${heading} min-w-0 flex-1 truncate text-(--chat-fg-muted)`}>Available</span>
									<span class="shrink-0 text-[0.625rem] text-(--chat-fg-subtle)">
										({skills.available.length})
									</span>
								</Collapsible.Trigger>
								<Collapsible.Content class="flex flex-col gap-0.5 pt-0.5">
									{@render skillSourceRows(availableSources)}
								</Collapsible.Content>
							</Collapsible.Root>
						{/if}
					{/if}
				{/if}
			</section>

			<section data-context-section="tools" aria-label="Tools" class="flex scroll-mt-2 flex-col gap-1">
				<h3 class={`${heading} flex items-center gap-1.5 px-1`}>
					Tools
					<span class="font-normal normal-case">({context.tools.length})</span>
				</h3>
				{#if context.tools.length === 0}
					<p class="px-1 text-xs text-(--chat-fg-subtle)">This conversation has no tools.</p>
				{:else}
					{#if context.tools.length > 15}
						<div class="relative">
							<SearchIcon
								class="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-(--chat-fg-subtle)"
							/>
							<Input
								bind:value={toolQuery}
								type="search"
								placeholder="Filter tools"
								aria-label="Filter tools"
								class="h-8 rounded-lg border-(--chat-border) bg-(--chat-surface)/30 pr-2 pl-7 text-xs md:text-xs"
							/>
						</div>
					{/if}

					{#each toolGroups as group (group.key)}
						<div class="flex flex-col gap-0.5 pt-1">
							<p class="flex min-w-0 items-baseline gap-1.5 px-1.5" title={group.extension ?? undefined}>
								<span class={`${heading} min-w-0 truncate`}>{group.label}</span>
								<span class="shrink-0 text-[0.625rem] text-(--chat-fg-subtle)">{group.tools.length}</span>
							</p>
							{#each group.tools as tool (tool.name)}
								{#if tool.description.length > 0}
									<Collapsible.Root>
										<Collapsible.Trigger
											class="group flex w-full min-w-0 items-center gap-1.5 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-(--chat-surface-2)"
										>
											<ChevronRightIcon
												class="size-3 shrink-0 text-(--chat-fg-subtle) transition-transform group-data-[state=open]:rotate-90"
											/>
											<span class="min-w-0 flex-1 truncate font-mono text-[0.6875rem] font-medium">{tool.name}</span>
										</Collapsible.Trigger>
										<Collapsible.Content>
											<p class="pr-1 pb-2 pl-6 text-xs break-words text-(--chat-fg-muted)">{tool.description}</p>
										</Collapsible.Content>
									</Collapsible.Root>
								{:else}
									<p class="truncate px-1.5 py-1 pl-6 font-mono text-[0.6875rem] font-medium">{tool.name}</p>
								{/if}
							{/each}
						</div>
					{/each}
					{#if toolGroups.length === 0}
						<p class="px-1.5 py-2 text-xs text-(--chat-fg-subtle)">No tools match "{toolQuery.trim()}".</p>
					{/if}
				{/if}
			</section>

			<section
				data-context-section="prompt"
				aria-label="System prompt"
				class="flex scroll-mt-2 flex-col gap-1 pb-2"
			>
				<div class="flex min-w-0 items-start gap-1">
					<Collapsible.Root class="min-w-0 flex-1">
						<Collapsible.Trigger
							class="group flex w-full min-w-0 items-center gap-1.5 rounded-lg px-1.5 py-1.5 text-left transition-colors hover:bg-(--chat-surface-2)"
						>
							<ChevronRightIcon
								class="size-3.5 shrink-0 text-(--chat-fg-subtle) transition-transform group-data-[state=open]:rotate-90"
							/>
							<span class={`${heading} shrink-0 text-(--chat-fg-muted)`}>System prompt</span>
							<span class="min-w-0 flex-1 truncate text-right text-[0.625rem] text-(--chat-fg-subtle)">
								{promptStats.size}<span class="hidden @min-[20rem]:inline"> · {promptStats.tokens}</span>
							</span>
						</Collapsible.Trigger>
						<Collapsible.Content>
							<div class="relative">
							<pre
								use:overlayScroll={'parent'}
								class="mt-1 max-h-[60vh] overflow-auto rounded-xl border border-(--chat-border) bg-(--chat-surface)/40 p-2.5 font-mono text-[0.6875rem] leading-relaxed break-words whitespace-pre-wrap text-(--chat-fg-muted)">{context.systemPrompt}</pre>
							</div>
						</Collapsible.Content>
					</Collapsible.Root>
					<CopyButton text={context.systemPrompt} label="Copy the system prompt" class="mt-0.5 shrink-0" />
				</div>
			</section>
		{/if}
	</div>
</div>
</div>
