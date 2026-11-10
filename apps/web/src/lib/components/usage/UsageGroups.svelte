<script lang="ts">
	import type { UsageGroup } from '@aiki/protocol';
	import { money, tokens } from '#lib/cache-stats.js';
	import { usageCostShare, usageTokenTotal } from '#lib/usage-analysis.js';
	let {
		groups,
		total,
		title,
		empty = 'No recorded requests in this period.'
	}: { groups: UsageGroup[]; total: number; title: string; empty?: string } = $props();
</script>

<section class="flex min-w-0 flex-col gap-3" aria-label={title}>
	<h3 class="text-sm font-semibold tracking-tight">{title}</h3>
	{#if groups.length === 0}<p
			class="rounded-xl border border-dashed border-(--chat-border) p-4 text-sm text-(--chat-fg-muted)"
		>
			{empty}
		</p>
	{:else}<div class="grid gap-3 md:grid-cols-2">
			{#each groups as group (group.key)}
				<article class="min-w-0 rounded-xl border border-(--chat-border) bg-(--chat-surface)/55 p-3">
					<div class="flex items-start justify-between gap-3">
						<h4 class="min-w-0 break-words text-sm font-medium">{group.label}</h4>
						<div class="shrink-0 text-right tabular-nums">
							<strong class="text-sm">{money(group.cost)}</strong><span class="ml-2 text-xs text-(--chat-fg-muted)"
								>{usageCostShare(group, total).toFixed(1)}%</span
							>
						</div>
					</div>
					<div class="my-2 h-1 overflow-hidden rounded-full bg-(--chat-surface-2)" aria-hidden="true">
						<div
							class="h-full rounded-full bg-(--accent-2)"
							style:width="{Math.min(100, usageCostShare(group, total))}%"
						></div>
					</div>
					<p class="mb-2 text-xs text-(--chat-fg-muted)">
						{group.requests.toLocaleString()} requests · {tokens(usageTokenTotal(group))} total tokens
					</p>
					<dl class="grid grid-cols-4 gap-2 text-xs tabular-nums">
						{#each [['Input', group.inputTokens], ['Cache read', group.cacheReadTokens], ['Cache write', group.cacheWriteTokens], ['Output', group.outputTokens]] as [label, count]}
							<div>
								<dt class="text-(--chat-fg-subtle)">{label}</dt>
								<dd class="mt-0.5 font-medium" title={Number(count).toLocaleString()}>{tokens(Number(count))}</dd>
							</div>
						{/each}
					</dl>
				</article>
			{/each}
		</div>{/if}
</section>
