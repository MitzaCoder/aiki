<script lang="ts">
	import { formatTime } from '#lib/time-format.ts';

	import CoinsIcon from '@lucide/svelte/icons/coins';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import LightbulbIcon from '@lucide/svelte/icons/lightbulb';
	import type { CacheGroup } from '@kemiri/protocol';
	import Banner from '#lib/components/Banner.svelte';
	import UsageSkeleton from '#lib/components/usage/UsageSkeleton.svelte';
	import {
		CACHE_STATS_RANGES,
		REASONS,
		changeLines,
		conversationLabel,
		dayBars,
		kindGroupLabel,
		longCacheLine,
		missHeadline,
		money,
		percent,
		reasonLabel,
		summaryLines,
		tokens,
		wakeAdvice,
		wakeLabel,
		wakePhrase
	} from '#lib/cache-stats.js';
	import type { BackendCacheStats } from '#lib/cache-stats.svelte.js';
	import { exactTime } from '#lib/relative-time.js';

	/**
	 * One backend's prompt cache statistics: what its model requests cost, how much of that billed a cached prompt again
	 * and why, where and after what, what would have helped, and each costly miss with what changed in the request.
	 */
	let { cache, showRange = true }: { cache: BackendCacheStats; showRange?: boolean } = $props();

	const stats = $derived(cache.stats);
	const summary = $derived(stats === undefined ? undefined : summaryLines(stats));
	const bars = $derived(stats === undefined ? [] : dayBars(stats));
	const ideas = $derived(
		stats === undefined ? [] : [longCacheLine(stats), ...wakeAdvice(stats, cache.days)].filter((line) => line !== undefined)
	);
	const wakes = $derived(stats?.byWake.filter((wake) => wake.wake !== 'continue') ?? []);
	const highestReason = $derived(Math.max(0, ...(stats?.byReason.map((group) => group.missedCost) ?? [])));
	const liveSince = $derived(stats?.liveSince ?? null);
	/** The miss list starts short; the reader asks for the rest. */
	const SHORT_LIST = 15;
	let allMisses = $state(false);
	const shownMisses = $derived(allMisses ? (stats?.misses ?? []) : (stats?.misses.slice(0, SHORT_LIST) ?? []));

	const where = $derived(
		stats === undefined
			? []
			: [
					{ title: 'By project', groups: stats.byProject, label: (group: CacheGroup) => group.label },
					{ title: 'By conversation', groups: stats.byKind, label: (group: CacheGroup) => kindGroupLabel(group.key) },
					{ title: 'By model', groups: stats.byModel, label: (group: CacheGroup) => group.label }
				]
	);
</script>

<div class="flex flex-col gap-3">
	<div class="flex flex-wrap items-center gap-2 px-1">
		<CoinsIcon class="size-4 text-(--chat-fg-subtle)" />
		<h3 class="text-sm font-semibold tracking-tight">Prompt cache</h3>
		<span class="h-px min-w-4 flex-1 bg-(--chat-border)"></span>
		{#if showRange}<div class="flex rounded-lg border border-(--chat-border) p-0.5 text-xs" role="group" aria-label="Range">
			{#each CACHE_STATS_RANGES as days (days)}
				<button
					type="button"
					class="rounded-md px-2 py-0.5 tabular-nums transition-colors {cache.days === days
						? 'bg-(--chat-surface-2) font-medium text-(--chat-fg)'
						: 'text-(--chat-fg-muted) hover:text-(--chat-fg)'}"
					aria-pressed={cache.days === days}
					disabled={cache.loading && cache.days === days}
					onclick={() => cache.load(days)}
				>
					{days} days
				</button>
			{/each}
		</div>{/if}
	</div>

	{#if cache.error}
		<Banner tone={stats ? 'warning' : 'error'}>Could not read the prompt cache numbers: {cache.error}</Banner>
	{/if}

	{#if stats === undefined || summary === undefined}
		{#if !cache.error}<UsageSkeleton />{/if}
	{:else}
		<article class="cache-card flex flex-col gap-3 rounded-2xl border border-(--chat-border) bg-(--chat-surface)/55 p-3 shadow-(--chat-shadow)" class:opacity-60={cache.loading}>
			<p class="text-sm text-(--chat-fg-muted)">
				A provider keeps the start of a conversation for a few minutes, so the next request reads it for a fraction of the price.
				When that copy is gone or no longer matches, the whole prompt is billed again in full.
			</p>
			<div class="grid gap-2 sm:grid-cols-3">
				<div class="rounded-xl bg-(--chat-surface-2)/60 px-3 py-2">
					<div class="text-xs text-(--chat-fg-subtle)">Spent</div>
					<div class="text-sm font-medium">{summary.spent}</div>
				</div>
				<div class="rounded-xl bg-(--chat-surface-2)/60 px-3 py-2">
					<div class="text-xs text-(--chat-fg-subtle)">Reused</div>
					<div class="text-sm font-medium">{summary.cached}</div>
				</div>
				<div class="rounded-xl px-3 py-2 {stats.totals.misses > 0 ? 'bg-(--chat-warning)/10 ring-1 ring-(--chat-warning)/25' : 'bg-(--chat-surface-2)/60'}">
					<div class="text-xs text-(--chat-fg-subtle)">Billed again</div>
					<div class="text-sm font-medium">{summary.rebilled}</div>
				</div>
			</div>

			{#if stats.keepWarm !== undefined}
                <p class="text-xs text-(--chat-fg-subtle)">Keep-warm cost: {money(stats.keepWarm.cost)} equivalent · {stats.keepWarm.refreshes} refreshes · {tokens(stats.keepWarm.cachedTokens)} cached-input tokens. Included in spend, not requests or misses.</p>
            {/if}

			{#if bars.length > 0}
				<figure class="flex flex-col gap-1">
					<div class="flex h-20 items-end gap-px" role="img" aria-label="Cost per day; the amber part was billed again">
						{#each bars as bar (bar.day)}
							<div
								class="relative flex h-full flex-1 flex-col justify-end"
								title="{bar.day}: {money(bar.cost)}, {money(bar.missedCost)} billed again"
							>
								<div class="w-full rounded-t-sm bg-(--accent-2)/45" style:height="{bar.height * 100}%">
									<div class="absolute inset-x-0 bottom-0 rounded-t-sm bg-(--chat-warning)/80" style:height="{bar.missedHeight * 100}%"></div>
								</div>
							</div>
						{/each}
					</div>
					<figcaption class="flex justify-between text-[0.6875rem] text-(--chat-fg-subtle) tabular-nums">
						<span>{bars[0]?.day}</span>
						<span>Cost per day; amber was billed again</span>
						<span>{bars.at(-1)?.day}</span>
					</figcaption>
				</figure>
			{/if}
		</article>

		<div class="grid items-start gap-3 md:grid-cols-2">
			<article class="cache-card flex flex-col gap-2 rounded-2xl border border-(--chat-border) bg-(--chat-surface)/55 p-3">
				<h4 class="text-sm font-semibold">Why it was billed again</h4>
				{#if stats.byReason.length === 0}
					<p class="text-sm text-(--chat-fg-muted)">Every request found its copy. Nothing was billed again.</p>
				{:else}
					<ul class="flex flex-col gap-2.5">
						{#each stats.byReason as group (group.key)}
							<li class="flex flex-col gap-1" title={REASONS[group.key as keyof typeof REASONS]?.detail}>
								<div class="flex items-baseline gap-2 text-sm">
									<span class="min-w-0 flex-1 truncate">{reasonLabel(group.key)}</span>
									<span class="text-xs text-(--chat-fg-subtle) tabular-nums">{group.misses}× · {tokens(group.missedTokens)}</span>
									<span class="font-medium tabular-nums">{money(group.missedCost)}</span>
								</div>
								<div class="h-1.5 overflow-hidden rounded-full bg-(--chat-surface-2)">
									<div class="h-full rounded-full bg-(--chat-warning)/80" style:width="{highestReason > 0 ? (100 * group.missedCost) / highestReason : 0}%"></div>
								</div>
								<p class="text-xs text-(--chat-fg-subtle)">{REASONS[group.key as keyof typeof REASONS]?.detail}</p>
							</li>
						{/each}
					</ul>
				{/if}
			</article>

			<article class="cache-card flex flex-col gap-2 rounded-2xl border border-(--chat-border) bg-(--chat-surface)/55 p-3">
				<h4 class="text-sm font-semibold">What woke the agents</h4>
				{#if wakes.length === 0}
					<p class="text-sm text-(--chat-fg-muted)">No requests in this range.</p>
				{:else}
					<table class="w-full text-sm">
						<thead class="text-left text-xs text-(--chat-fg-subtle)">
							<tr>
								<th class="font-normal">Woken by</th>
								<th class="text-right font-normal">Times</th>
								<th class="text-right font-normal" title="Every request until the next wake, divided by the wakes">Each</th>
								<th class="text-right font-normal">Billed again</th>
							</tr>
						</thead>
						<tbody>
							{#each wakes as wake (wake.wake)}
								<tr class="border-t border-(--chat-border)/60">
									<td class="py-1">{wakeLabel(wake.wake)}</td>
									<td class="text-right tabular-nums">{wake.wakes}</td>
									<td class="text-right tabular-nums">{money(wake.wakes > 0 ? wake.turnCost / wake.wakes : 0)}</td>
									<td class="text-right tabular-nums">{wake.misses > 0 ? money(wake.missedCost) : '—'}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				{/if}
			</article>
		</div>

		{#if ideas.length > 0}
			<article class="cache-card flex flex-col gap-2 rounded-2xl border border-(--chat-border) bg-(--chat-surface)/55 p-3">
				<h4 class="flex items-center gap-1.5 text-sm font-semibold"><LightbulbIcon class="size-4 text-(--accent-2)" />What would help</h4>
				<ul class="flex list-disc flex-col gap-1 pl-5 text-sm text-(--chat-fg-muted)">
					{#each ideas as idea (idea)}
						<li>{idea}</li>
					{/each}
				</ul>
			</article>
		{/if}

		<div class="grid items-start gap-3 lg:grid-cols-3">
			{#each where as part (part.title)}
				<article class="cache-card flex flex-col gap-1.5 rounded-2xl border border-(--chat-border) bg-(--chat-surface)/55 p-3">
					<h4 class="text-sm font-semibold">{part.title}</h4>
					<ul class="flex flex-col text-sm">
						{#each part.groups.slice(0, 8) as group (group.key)}
							<li class="flex items-baseline gap-2 border-t border-(--chat-border)/60 py-1 first:border-t-0">
								<span class="min-w-0 flex-1 truncate" title={group.key}>{part.label(group)}</span>
								<span class="text-xs text-(--chat-fg-subtle) tabular-nums" title="Cost">{money(group.cost)}</span>
								<span
									class="w-16 text-right tabular-nums {group.missedCost > 0 ? 'text-(--chat-warning)' : 'text-(--chat-fg-subtle)'}"
									title="Billed again: {percent(group.missedCost, group.cost)} of the cost"
								>
									{group.missedCost > 0 ? money(group.missedCost) : '—'}
								</span>
							</li>
						{/each}
					</ul>
				</article>
			{/each}
		</div>

		{#if stats.conversations.length > 0}
			<article class="cache-card flex flex-col gap-1.5 rounded-2xl border border-(--chat-border) bg-(--chat-surface)/55 p-3">
				<h4 class="text-sm font-semibold">Conversations that lost the most</h4>
				<ul class="flex flex-col text-sm">
					{#each stats.conversations.slice(0, 8) as conversation (`${conversation.projectId}:${conversation.conversationId}`)}
						<li class="flex items-baseline gap-2 border-t border-(--chat-border)/60 py-1 first:border-t-0">
							<span class="min-w-0 flex-1 truncate">
								{conversationLabel(conversation)}
								<span class="text-(--chat-fg-subtle)">· {conversation.projectName}</span>
							</span>
							<span class="text-xs text-(--chat-fg-subtle) tabular-nums">{conversation.misses}× of {conversation.requests}</span>
							<span class="w-16 text-right text-(--chat-warning) tabular-nums">{money(conversation.missedCost)}</span>
						</li>
					{/each}
				</ul>
			</article>
		{/if}

		{#if stats.misses.length > 0}
			<article class="cache-card flex flex-col gap-1.5 rounded-2xl border border-(--chat-border) bg-(--chat-surface)/55 p-3">
				<h4 class="text-sm font-semibold">
					The costliest misses <span class="font-normal text-(--chat-fg-subtle)">· {stats.misses.length} of {stats.totals.misses}, newest first</span>
				</h4>
				<ul class="flex flex-col text-sm">
					{#each shownMisses as miss (`${miss.projectId}:${miss.conversationId}:${miss.at}`)}
						<li class="border-t border-(--chat-border)/60 first:border-t-0">
							<details class="group">
								<summary class="flex cursor-pointer list-none items-baseline gap-2 py-1.5 [&::-webkit-details-marker]:hidden">
									<ChevronRightIcon class="size-3.5 shrink-0 self-center text-(--chat-fg-subtle) transition-transform group-open:rotate-90" />
									<span class="w-20 shrink-0 text-xs text-(--chat-fg-subtle) tabular-nums sm:w-24" title={exactTime(miss.at)}>
										{formatTime(miss.at, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }, undefined)}
									</span>
									<span class="min-w-0 flex-1 sm:truncate">
										{missHeadline(miss)}
										<span class="text-(--chat-fg-subtle)">· {conversationLabel(miss)} · {miss.projectName}</span>
									</span>
									<span class="text-xs text-(--chat-fg-subtle) tabular-nums max-sm:hidden">{tokens(miss.missedTokens)}</span>
									<span class="w-14 text-right text-(--chat-warning) tabular-nums">{money(miss.missedCost)}</span>
								</summary>
								<div class="flex flex-col gap-1 pb-2 pl-6 text-xs text-(--chat-fg-muted)">
									<p>
										{tokens(miss.missedTokens)} tokens billed again on {miss.model}, woken by {wakePhrase(miss.wake)}.
										{REASONS[miss.reason].detail}
									</p>
									<div>
										<span class="text-(--chat-fg-subtle)">What changed in the request:</span>
										<ul class="list-disc pl-5">
											{#each changeLines(miss.changes) as line (line)}
												<li>{line}</li>
											{/each}
										</ul>
									</div>
								</div>
							</details>
						</li>
					{/each}
				</ul>
				{#if stats.misses.length > SHORT_LIST}
					<button
						type="button"
						class="self-start text-xs font-medium text-(--chat-fg-muted) underline underline-offset-4 hover:text-(--chat-fg)"
						onclick={() => (allMisses = !allMisses)}
					>
						{allMisses ? 'Show fewer' : `Show all ${stats.misses.length}`}
					</button>
				{/if}
			</article>
		{/if}

		<p class="px-1 text-xs text-(--chat-fg-subtle)">
			Kept for {stats.keptDays} days.
			{#if liveSince}
				Recorded as they run since {new Date(liveSince).toLocaleDateString()}; earlier requests were read back from the
				transcripts, without what changed in each request.
			{/if}
		</p>
	{/if}
</div>

<style>
	.cache-card {
		position: relative;
	}
</style>
