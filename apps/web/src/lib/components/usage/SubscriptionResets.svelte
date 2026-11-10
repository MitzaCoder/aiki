<script lang="ts">
	import type { SubscriptionResetCredit, SubscriptionUsage } from '@aiki/protocol';
	import type { BackendConnection } from '#lib/harness.svelte.js';
	import { Button } from '#lib/components/ui/button/index.js';
	let { subscription, backend }: { subscription: SubscriptionUsage; backend?: BackendConnection } = $props();
	let confirming = $state<SubscriptionResetCredit | null>(null);
	let pending = $state(false);
	let message = $state('');
	let uncertain = $state(false);
	const resets = $derived(subscription.manualResets);
	async function consume(): Promise<void> {
		const credit = confirming;
		if (!backend || !credit || pending) return;
		pending = true;
		confirming = null;
		try {
			const answer = await backend.client.resetSubscription({
				providerId: subscription.providerId,
				creditId: credit.id,
				program: credit.program,
				requestId: crypto.randomUUID(),
				confirmed: true
			});
			uncertain = answer.code === 'unknown_outcome';
			message = answer.ok
				? 'Reset applied. Subscription limits have been refreshed.'
				: uncertain
					? 'The outcome is unknown. Check the provider before trying another reset.'
					: `Reset not applied: ${answer.code.replaceAll('_', ' ')}.`;
		} catch {
			uncertain = true;
			message = 'The outcome is unknown. Check the provider before trying another reset.';
		} finally {
			pending = false;
		}
	}
</script>

<section class="rounded-xl border border-(--chat-border) bg-(--chat-bg)/45 p-3" aria-label="Saved subscription resets">
	<div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
		<h3 class="text-xs font-semibold">Saved resets</h3>
		<span class="text-xs text-(--chat-fg-muted)"
			>{resets == null ? 'Not reported by this provider' : `${resets.available} available`}</span
		>
	</div>
	{#if resets?.reason}<p class="mt-1 text-xs text-(--chat-fg-muted)">
			{resets.reason === 'surface' ? 'This offer is restricted to the provider website.' : resets.reason}
		</p>{/if}
	{#each resets?.credits.filter((credit) => credit.remaining > 0) ?? [] as credit (`${credit.program}:${credit.id}`)}
		<div class="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-(--chat-border) pt-2">
			<div class="min-w-0 text-xs">
				<p class="font-medium">{credit.label} · {credit.remaining} remaining</p>
				<p class="mt-1 text-(--chat-fg-muted)">
					Covers {credit.clears.join(', ')}{#if credit.expiresAt}
						· expires {new Date(credit.expiresAt).toLocaleString()}{/if}{#if !credit.usable}
						· not usable now{/if}
				</p>
			</div>
			{#if backend?.supports('subscription-resets')}<Button
					size="sm"
					variant="outline"
					disabled={!credit.usable || pending || uncertain}
					onclick={() => {
						confirming = credit;
						message = '';
					}}>Use a reset…</Button
				>{/if}
		</div>
	{/each}
	{#if confirming}
		<div class="mt-3 rounded-lg border border-(--chat-warning)/40 bg-(--chat-warning)/10 p-3" role="alert">
			<p class="text-sm font-semibold">Use one saved reset for {subscription.label}?</p>
			<p class="mt-1 text-xs text-(--chat-fg-muted)">
				This spends one reset now and cannot be undone. Covers {confirming.clears.join(', ')}. It is not an
				automatic-reset setting.
			</p>
			<div class="mt-3 flex gap-2">
				<Button size="sm" onclick={consume}>Confirm · use 1 reset</Button><Button
					size="sm"
					variant="outline"
					onclick={() => (confirming = null)}>Cancel</Button
				>
			</div>
		</div>
	{/if}
	{#if pending || message}<p class="mt-2 text-xs text-(--chat-fg-muted)" role="status">
			{pending ? 'Applying one reset…' : message}
		</p>{/if}
</section>
