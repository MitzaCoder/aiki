<script lang="ts">
	import type { BackendCacheStats } from '#lib/cache-stats.svelte.js';
	import { money, tokens } from '#lib/cache-stats.js';
	import { promptReuse, usageTokenTotal, type UsageTab } from '#lib/usage-analysis.js';
	import UsageGroups from './UsageGroups.svelte';
	import CacheSection from './CacheSection.svelte';
	import Banner from '#lib/components/Banner.svelte';
	let { cache, tab }: { cache: BackendCacheStats; tab: UsageTab } = $props();
	const stats = $derived(cache.stats);
	const usage = $derived(stats?.usage);
	const total = $derived(usage?.totals.cost ?? 0);
	const reuse = $derived(usage ? promptReuse(usage.totals) : null);
</script>

<div class="flex min-w-0 flex-col gap-4" aria-busy={cache.loading}>
	{#if cache.error}<Banner tone="warning"
			>Could not read recorded usage: {cache.error}. Earlier numbers may be shown.</Banner
		>{/if}
	{#if !cache.backend.supports('usage-breakdown')}
		{#if tab === 'Overview' || tab === 'Waste'}<CacheSection {cache} />{:else}<p class="text-sm text-(--chat-fg-muted)">
				This backend needs an update for usage breakdowns.
			</p>{/if}
	{:else if !usage || !stats}
		<p class="text-sm text-(--chat-fg-muted)">
			{cache.loading ? 'Reading recorded requests…' : 'No usage analysis returned by this backend.'}
		</p>
	{:else}
		{#if tab === 'Overview'}
			<section class="rounded-2xl border border-(--chat-border) bg-(--chat-surface)/55 p-4">
				<div class="flex flex-wrap items-baseline justify-between gap-2">
					<h3 class="text-sm font-semibold">Recorded usage</h3>
					<span class="text-xs text-(--chat-fg-muted)"
						>{new Date(stats.from).toLocaleDateString()} – {new Date(stats.to).toLocaleDateString()}</span
					>
				</div>
				<div class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
					{#each [['Catalog equivalent', money(total)], ['Total tokens', tokens(usageTokenTotal(usage.totals))], ['Requests', usage.totals.requests.toLocaleString()], ['Prompt reuse', reuse === null ? 'Not measured' : `${reuse.toFixed(1)}%`]] as [label, value]}
						<div class="rounded-xl bg-(--chat-surface-2)/60 p-3">
							<p class="text-xs text-(--chat-fg-muted)">{label}</p>
							<p class="mt-1 text-xl font-semibold tracking-tight tabular-nums">{value}</p>
						</div>
					{/each}
				</div>
				<dl class="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
					{#each [['Full-price input', usage.totals.inputTokens], ['Cache read', usage.totals.cacheReadTokens], ['Cache write', usage.totals.cacheWriteTokens], ['Output', usage.totals.outputTokens]] as [label, count]}
						<div>
							<dt class="text-xs text-(--chat-fg-subtle)">{label}</dt>
							<dd class="font-medium tabular-nums" title={Number(count).toLocaleString()}>{tokens(Number(count))}</dd>
						</div>
					{/each}
				</dl>
			</section>
			<p class="text-xs leading-relaxed text-(--chat-fg-muted)">
				All recorded calls, including keep-warm. Catalog prices are comparison estimates, not your bill or subscription
				allowance. Other apps can use the same subscription.
			</p>
		{:else if tab === 'By role'}
			<p class="text-sm text-(--chat-fg-muted)">
				Which callers consume the most? Ranked by catalog equivalent; shares are of all recorded cost. Scheduled runs
				count once, separate from workers and threads.
			</p>
			<UsageGroups groups={usage.byRole} {total} title="Caller roles" />
			<p class="text-xs text-(--chat-fg-subtle)">
				Compaction and memory calls only accumulate from {usage.internalSince
					? new Date(usage.internalSince).toLocaleDateString()
					: 'this server update'}. Earlier internal calls are missing; ordinary roles include history.
			</p>
		{:else if tab === 'By model'}
			<p class="text-sm text-(--chat-fg-muted)">
				Compare each model's work by role before changing defaults. Input, cache reads, writes and output are separate;
				tokens do not have equal prices.
			</p>
			<UsageGroups groups={usage.byModel} {total} title="Models · all roles" />
			<UsageGroups groups={usage.byModelRole} {total} title="Models × caller role" />
		{:else if tab === 'Projects & tasks'}
			<UsageGroups groups={usage.byProject} {total} title="Projects" />
			<UsageGroups
				groups={usage.byTask}
				{total}
				title="Most expensive board tasks · top 30"
				empty="No board-task attribution in this period."
			/>
			<p class="text-xs text-(--chat-fg-muted)">
				Task totals cover attributed worker requests, not coordinator reasoning about a task. Unassigned and internal
				calls still count in projects.
			</p>
			<UsageGroups groups={usage.conversations} {total} title="Most expensive conversations & workers · top 30" />
		{:else if tab === 'Waste'}
			<p class="text-sm text-(--chat-fg-muted)">
				Signals to investigate, not proof of wasted work. Cache reuse is cached reads / all prompt tokens.
			</p>
			<div class="grid gap-3 sm:grid-cols-2">
				{#each [{ title: 'Prompt reuse', value: reuse === null ? 'Not measured' : `${reuse.toFixed(1)}%`, detail: `${tokens(usage.totals.cacheReadTokens)} cached prompt tokens read.` }, { title: 'Prompt billed again', value: money(stats.totals.missedCost), detail: `${tokens(stats.totals.missedTokens)} tokens in ${stats.totals.misses} inferred misses. Estimate, not a provider invoice.` }, { title: 'Failed or stopped responses', value: money(usage.failed.cost), detail: `${usage.failed.requests} responses with returned usage. Whole-run outcomes and errors without usage are not measured.` }, { title: 'Keep-warm', value: money(stats.keepWarm?.cost ?? 0), detail: `${stats.keepWarm?.refreshes ?? 0} refreshes; ${money(stats.keepWarm?.failedWriteCost ?? 0)} in unexpected writes. Usefulness is not known.` }, { title: 'Check-in pressure', value: `${usage.checkIns.requests} requests`, detail: `${money(usage.checkIns.cost)} for the check-in requests themselves, not their follow-up turns. No-action checks are not classified.` }, { title: 'Retries', value: `${usage.retries.requests} requests`, detail: `${money(usage.retries.cost)} in retry requests. Retries may be necessary.` }] as signal (signal.title)}
					<article class="rounded-xl border border-(--chat-border) bg-(--chat-surface)/55 p-3">
						<h3 class="text-xs text-(--chat-fg-muted)">{signal.title}</h3>
						<p class="mt-1 text-xl font-semibold tabular-nums">{signal.value}</p>
						<p class="mt-2 text-xs leading-relaxed text-(--chat-fg-muted)">{signal.detail}</p>
					</article>
				{/each}
			</div>
			<details class="rounded-xl border border-(--chat-border) p-3">
				<summary class="cursor-pointer text-sm font-medium">Largest prompts among the top-cost conversations</summary>
				<ul class="mt-3 space-y-2 text-xs text-(--chat-fg-muted)">
					{#each [...usage.conversations]
						.sort((a, b) => b.maxPromptTokens - a.maxPromptTokens)
						.slice(0, 10) as conversation (conversation.key)}<li class="flex justify-between gap-3">
							<span>{conversation.label}</span><strong class="shrink-0 tabular-nums"
								>{tokens(conversation.maxPromptTokens)}</strong
							>
						</li>{/each}
				</ul>
			</details>
			<details class="rounded-xl border border-(--chat-border) p-3">
				<summary class="cursor-pointer text-sm font-medium">Cache diagnosis & wake-up costs</summary>
				<div class="mt-4"><CacheSection {cache} showRange={false} /></div>
			</details>
			<p class="text-xs leading-relaxed text-(--chat-fg-subtle)">
				Not yet measurable: never-read writes, useless warming, compaction-caused resends, no-action check-ins and
				unused worker reports. These need new lifecycle or outcome recording, not guesses.
			</p>
		{/if}
		<p class="text-[0.6875rem] leading-relaxed text-(--chat-fg-subtle)">
			Request history kept for {stats.keptDays} days. Internal calls, uncaptured failures and provider quota conversion have
			coverage limits. Backfilled rows have no prompt fingerprints.
		</p>
	{/if}
</div>
