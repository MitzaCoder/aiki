<script lang="ts">
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import ClockAlertIcon from '@lucide/svelte/icons/clock-alert';
	import type { SubscriptionUsage } from '@aiki/protocol';
	import ProviderMark from './ProviderMark.svelte';
	import UsageWindowRow from './UsageWindowRow.svelte';
	import { exactTime } from '#lib/relative-time.js';
	import { isStale, sourceLabel, updatedLabel } from '#lib/subscription-usage.js';

	/** One subscription: who it is (provider, plan, account), how fresh its numbers are, and each of its windows. */
	let { subscription, now, index = 0 }: { subscription: SubscriptionUsage; now: number; index?: number } = $props();

	const stale = $derived(isStale(subscription.updatedAt, now));
</script>

<article
	class="usage-card @container relative flex animate-rise flex-col gap-2.5 overflow-hidden rounded-2xl border border-(--chat-border) bg-(--chat-surface)/55 p-2.5 shadow-(--chat-shadow) motion-reduce:animate-none sm:p-3"
	style:animation-delay="{index * 70}ms"
>
	<header class="flex items-center gap-2.5">
		<ProviderMark providerId={subscription.providerId} label={subscription.label} size={32} />
		<div class="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
			<h2 class="text-base font-semibold tracking-tight">{subscription.label}</h2>
			{#if subscription.plan}
				<span class="plan rounded-full px-2 py-px text-[0.6875rem] font-semibold">{subscription.plan}</span>
			{/if}
			{#if subscription.account}
				<span class="min-w-0 truncate text-xs text-(--chat-fg-muted)" title={subscription.account}>{subscription.account}</span>
			{/if}
		</div>
		<span
			class="flex shrink-0 items-center gap-1 text-[0.6875rem] text-(--chat-fg-subtle) tabular-nums"
			class:text-(--chat-warning)={stale}
			title={subscription.updatedAt === null ? sourceLabel(subscription.source) : `${exactTime(subscription.updatedAt)} · ${sourceLabel(subscription.source)}`}
		>
			{#if stale}<ClockAlertIcon class="size-3.5" />{/if}
			{updatedLabel(subscription.updatedAt, now)}
		</span>
	</header>

	{#if subscription.error}
		<p class="flex items-start gap-2 rounded-xl bg-(--chat-warning)/10 px-3 py-2 text-xs text-(--chat-fg-muted) ring-1 ring-(--chat-warning)/25">
			<CircleAlertIcon class="mt-px size-3.5 shrink-0 text-(--chat-warning)" />
			<span class="min-w-0 break-words">
				<span class="font-medium text-(--chat-fg)">The last read failed</span>{subscription.windows.length > 0 ? ' — these are the numbers from before' : ''}: {subscription.error}
			</span>
		</p>
	{/if}

	{#if subscription.windows.length === 0}
		<p class="rounded-xl border border-dashed border-(--chat-border-strong) px-3 py-4 text-center text-sm text-(--chat-fg-muted)">
			{subscription.source === 'none' ? 'This provider reports no limits for the plan.' : 'No limits read yet.'}
		</p>
	{:else}
		<div class="grid items-start gap-2 @3xl:grid-cols-2 @6xl:grid-cols-3">
			{#each subscription.windows as window (window.id)}
				<UsageWindowRow {window} {now} />
			{/each}
		</div>
	{/if}
</article>

<style>
	.usage-card::before {
		content: '';
		position: absolute;
		inset: 0 0 auto;
		height: 1px;
		background: var(--chat-grad);
		opacity: 0.7;
	}
	.plan {
		color: var(--accent-2);
		background: color-mix(in oklab, var(--accent-2) 12%, transparent);
		box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--accent-2) 25%, transparent);
	}
</style>
