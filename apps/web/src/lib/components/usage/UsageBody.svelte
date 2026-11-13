<script lang="ts">
	import { overlayScroll } from '#lib/scrollbars.js';
	import GaugeIcon from '@lucide/svelte/icons/gauge';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import XIcon from '@lucide/svelte/icons/x';
	import { onMount } from 'svelte';
	import type { SubscriptionUsage } from '@kemiri/protocol';
	import Banner from '#lib/components/Banner.svelte';
	import Orb from '#lib/components/Orb.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import UsageAnalysis from '#lib/components/usage/UsageAnalysis.svelte';
	import { USAGE_TABS, usageTabAfterKey, usageTabKey, type UsageTab } from '#lib/usage-analysis.js';
	import SubscriptionCard from '#lib/components/usage/SubscriptionCard.svelte';
	import UsageSkeleton from '#lib/components/usage/UsageSkeleton.svelte';
	import { backendSettingsHref, generalSettingsHref } from '#lib/settings.js';
	import { connectionDotClass, connectionView } from '#lib/connection.js';
	import { harness, type BackendConnection } from '#lib/harness.svelte.js';
	import { updatedLabel } from '#lib/subscription-usage.js';
	import { usageBoard } from '#lib/subscription-usage.svelte.js';
	import { cacheStatsBoard } from '#lib/cache-stats.svelte.js';
	import { usageModal } from '#lib/usage-modal.svelte.js';

	/**
	 * Subscription usage across every connected backend that reports it: a card per logged-in subscription (each backend
	 * has its own logins), a gauge and a chart per rate-limit window. Mounted while the modal is open, so reads start
	 * then and stop on close. Numbers follow the server's pushes; the refresh button makes each backend read its
	 * providers now.
	 */
	const reporting = $derived(harness.backends.filter((backend) => backend.supports('subscription-usage')));
	const silent = $derived(harness.backends.filter((backend) => !backend.supports('subscription-usage')));
	const usages = $derived(reporting.map((backend) => usageBoard.for(backend)));
	const all = $derived(usages.flatMap((usage) => usage.subscriptions));
	const allLoaded = $derived(usages.length > 0 && usages.every((usage) => usage.loaded));
	const refreshing = $derived(usages.some((usage) => usage.refreshing));
	const empty = $derived(allLoaded && all.length === 0);
	const newestUpdate = $derived(newest(all));
	/** Prompt cache numbers, from the backends that keep a request log. */
	const caches = $derived(
		harness.backends.filter((backend) => backend.supports('cache-stats')).map((backend) => cacheStatsBoard.for(backend))
	);

	/** The clock every countdown, pace and "updated" reads; ticks so they age on their own. */
	let now = $state(Date.now());
	let tab = $state<UsageTab>('Overview');
	let period = $state<1 | 7 | 30>(30);
	let panel = $state<HTMLDivElement | null>(null);
	function selectTab(next: UsageTab): void {
		tab = next;
		if (panel) panel.scrollTop = 0;
	}
	function tabKeydown(event: KeyboardEvent): void {
		const next = usageTabAfterKey(tab, event.key);
		if (!next) return;
		event.preventDefault();
		selectTab(next);
		const parent = (event.currentTarget as HTMLElement).parentElement;
		parent?.querySelector<HTMLButtonElement>(`#usage-tab-${usageTabKey(next)}`)?.focus();
	}

	onMount(() => {
		const timer = setInterval(() => (now = Date.now()), 10_000);
		return () => clearInterval(timer);
	});

	$effect(() => {
		const started = usages;
		for (const usage of started) usage.start();
		return () => {
			for (const usage of started) usage.stop();
		};
	});

	$effect(() => {
		const started = caches;
		for (const cache of started) {
			cache.days = period;
			cache.calendarToday = period === 1;
			cache.start();
		}
		return () => {
			for (const cache of started) cache.stop();
		};
	});

	function newest(subscriptions: SubscriptionUsage[]): string | null {
		let best: string | null = null;
		for (const subscription of subscriptions) {
			const at = subscription.updatedAt;
			if (at !== null && (best === null || Date.parse(at) > Date.parse(best))) best = at;
		}
		return best;
	}

	async function refresh(): Promise<void> {
		now = Date.now();
		await Promise.allSettled([...usages.map((usage) => usage.load(true)), ...caches.map((cache) => cache.load())]);
		now = Date.now();
	}

	/** Where this backend's logins live: its Accounts and API keys page. */
	function loginsHref(backend: BackendConnection): string {
		return backendSettingsHref(backend.id, 'accounts');
	}
</script>

<Dialog.Header
	class="shrink-0 gap-1 border-b border-(--chat-border) px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-3 sm:px-6 sm:pt-5"
>
	<div class="flex items-center gap-2">
		<Dialog.Title class="min-w-0 flex-1 text-xl leading-tight font-bold tracking-tight">Usage</Dialog.Title>
		{#if newestUpdate}
			<span class="text-xs whitespace-nowrap text-(--chat-fg-subtle) tabular-nums"
				>{updatedLabel(newestUpdate, now)}</span
			>
		{/if}
		<Button
			variant="outline"
			size="sm"
			onclick={refresh}
			disabled={refreshing || usages.every((usage) => !usage.backend.ready)}
			aria-label="Read every provider now"
			title="Read every provider now"
		>
			<RefreshCwIcon class="size-4 {refreshing ? 'animate-spin motion-reduce:animate-none' : ''}" />
			<span class="max-sm:sr-only">{refreshing ? 'Refreshing…' : 'Refresh'}</span>
		</Button>
		<Dialog.Close>
			{#snippet child({ props })}
				<Button variant="ghost" size="icon-sm" {...props}>
					<XIcon />
					<span class="sr-only">Close</span>
				</Button>
			{/snippet}
		</Dialog.Close>
	</div>
	<Dialog.Description class="text-sm text-muted-foreground">
		Subscription capacity and where recorded tokens go. Compare callers, models and tasks before changing defaults.
	</Dialog.Description>
</Dialog.Header>

<div class="shrink-0 border-b border-(--chat-border) px-4 py-3 sm:px-6">
	<div role="tablist" aria-label="Usage views" class="flex flex-wrap gap-1">
		{#each USAGE_TABS as label (label)}
			<button
				type="button"
				role="tab"
				id="usage-tab-{usageTabKey(label)}"
				aria-controls="usage-panel"
				aria-selected={tab === label}
				tabindex={tab === label ? 0 : -1}
				onclick={() => selectTab(label)}
				onkeydown={tabKeydown}
				class="rounded-lg px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent-2) {tab ===
				label
					? 'bg-(--chat-surface-2) text-(--chat-fg)'
					: 'text-(--chat-fg-muted) hover:bg-(--chat-surface)'}">{label}</button
			>
		{/each}
	</div>
	<div class="mt-3 flex flex-wrap items-center gap-2 text-xs">
		<span class="text-(--chat-fg-muted)">Recorded period</span>
		<div class="flex gap-1 rounded-lg border border-(--chat-border) p-0.5" role="group" aria-label="Recorded period">
			{#each [1, 7, 30] as days (days)}<button
					type="button"
					aria-pressed={period === days}
					onclick={() => (period = days as 1 | 7 | 30)}
					class="rounded-md px-2.5 py-1 {period === days
						? 'bg-(--chat-surface-2) font-semibold'
						: 'text-(--chat-fg-muted)'}">{days === 1 ? 'Today' : `${days} days`}</button
				>{/each}
		</div>
		<span class="text-(--chat-fg-subtle)">Live subscription windows stay unchanged.</span>
	</div>
</div>

<!-- The scrollbars live in this wrapper, not in the scroller: inside, they scroll with the content and jump. -->
<div class="relative min-h-0 flex-1">
	<div
		use:overlayScroll={'parent'}
		bind:this={panel}
		id="usage-panel"
		role="tabpanel"
		aria-labelledby="usage-tab-{usageTabKey(tab)}"
		tabindex="0"
		class="absolute inset-0 flex flex-col gap-5 overflow-y-auto overscroll-contain px-4 pt-4 *:shrink-0 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-6"
	>
		{#if tab === 'Overview'}
			{#if harness.backends.length === 0}
				<section
					class="flex flex-col items-center gap-3 rounded-3xl border border-dashed border-(--chat-border-strong) px-6 py-14 text-center"
				>
					<Orb size={48} />
					<h2 class="text-lg font-semibold">No backends yet</h2>
					<p class="max-w-sm text-sm text-(--chat-fg-muted)">Add a backend, then log in to a subscription there.</p>
					<Button
						href={generalSettingsHref('backends')}
						variant="outline"
						size="sm"
						onclick={() => (usageModal.open = false)}>Add a backend</Button
					>
				</section>
			{:else if reporting.length === 0}
				<section
					class="flex flex-col items-center gap-3 rounded-3xl border border-dashed border-(--chat-border-strong) px-6 py-14 text-center"
				>
					<GaugeIcon class="size-8 text-(--chat-fg-subtle)" />
					<h2 class="text-lg font-semibold">No backend reports usage</h2>
					<p class="max-w-sm text-sm text-(--chat-fg-muted)">
						{silent.map((backend) => backend.name).join(', ')}
						{silent.length === 1 ? 'runs' : 'run'} a release without subscription usage. It appears here after the next deploy.
					</p>
				</section>
			{:else if empty}
				<section
					class="relative flex animate-rise flex-col items-center gap-3 overflow-hidden rounded-3xl border border-(--chat-border) bg-(--chat-surface)/50 px-6 py-14 text-center motion-reduce:animate-none"
				>
					<Orb size={56} />
					<h2 class="text-lg font-semibold">No subscription is logged in</h2>
					<p class="max-w-md text-sm text-(--chat-fg-muted)">
						Log in to Claude or ChatGPT, or add an OpenCode Go key, on a backend and its limits show up here, with how
						fast you are using them.
					</p>
					<div class="flex flex-wrap justify-center gap-2 pt-1">
						{#each reporting as backend (backend.id)}
							<Button href={loginsHref(backend)} variant="outline" size="sm" onclick={() => (usageModal.open = false)}>
								Logins on {backend.name}
							</Button>
						{/each}
					</div>
				</section>
			{:else}
				{#each usages as usage (usage.backend.id)}
					{@const backend = usage.backend}
					{@const view = connectionView(backend.connection)}
					<section class="flex flex-col gap-3" aria-label={backend.name}>
						<div class="flex items-center gap-2 px-1">
							<span class="size-2 rounded-full {connectionDotClass(view.tone)}" title={view.title ?? view.label}></span>
							<h2 class="text-sm font-semibold tracking-tight">{backend.name}</h2>
							<span class="text-xs text-(--chat-fg-subtle)">
								{#if usage.loaded}
									{usage.subscriptions.length} subscription{usage.subscriptions.length === 1 ? '' : 's'}
								{:else}
									{view.label}
								{/if}
							</span>
							<span class="h-px flex-1 bg-(--chat-border)"></span>
						</div>
						{#if usage.error}
							<Banner tone={usage.loaded ? 'warning' : 'error'}>
								Could not read usage from {backend.name}: {usage.error}
							</Banner>
						{/if}
						{#if !usage.loaded && !usage.error}
							<div class="grid gap-4 md:grid-cols-2">
								<UsageSkeleton />
								<div class="max-md:hidden"><UsageSkeleton /></div>
							</div>
						{:else if usage.loaded && usage.subscriptions.length === 0}
							<p
								class="rounded-2xl border border-dashed border-(--chat-border-strong) px-4 py-5 text-sm text-(--chat-fg-muted)"
							>
								No subscription is logged in here.
								<a
									class="font-medium text-(--chat-fg) underline underline-offset-4"
									href={loginsHref(backend)}
									onclick={() => (usageModal.open = false)}
								>
									Log in from settings
								</a>.
							</p>
						{:else}
							<div class="grid grid-cols-[repeat(auto-fit,minmax(min(100%,28rem),1fr))] items-start gap-4">
								{#each usage.subscriptions as subscription, index (subscription.providerId)}
									<SubscriptionCard {subscription} {now} {index} backend={usage.backend} />
								{/each}
							</div>
						{/if}
					</section>
				{/each}

				{#if silent.length > 0}
					<p class="px-1 text-xs text-(--chat-fg-subtle)">
						{silent.map((backend) => backend.name).join(', ')}
						{silent.length === 1 ? 'does' : 'do'} not report subscription usage yet.
					</p>
				{/if}
			{/if}
		{/if}

		{#if caches.length === 0 && tab !== 'Overview'}<p class="text-sm text-(--chat-fg-muted)">
				No backend reports recorded usage yet.
			</p>{/if}
		{#each caches as cache (cache.backend.id)}
			<section class="flex flex-col gap-3" aria-label="Recorded usage on {cache.backend.name}">
				{#if caches.length > 1 || tab !== 'Overview' || reporting.length === 0}
					<h2 class="px-1 text-sm font-semibold tracking-tight">{cache.backend.name}</h2>
				{/if}
				<UsageAnalysis {cache} {tab} />
			</section>
		{/each}
	</div>
</div>
