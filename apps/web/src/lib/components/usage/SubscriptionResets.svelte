<script lang="ts">
	import type { SubscriptionUsage } from '@aiki/protocol';
	import type { BackendConnection } from '#lib/harness.svelte.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import { groupResets, resetExplanation, resetExpiry, resetUnavailableReason, type ResetGroup } from '#lib/subscription-resets.js';
	let { subscription, backend }: { subscription: SubscriptionUsage; backend?: BackendConnection } = $props();
	let confirming = $state<ResetGroup | null>(null);
	let pending = $state(false);
	let message = $state('');
	let uncertain = $state(false);
	const resets = $derived(subscription.manualResets);
	const groups = $derived(groupResets(resets?.credits ?? []));
	async function consume(): Promise<void> {
		const group = confirming;
		if (!backend || !group || pending) return;
		pending = true;
		confirming = null;
		try {
			const answer = await backend.client.resetSubscription({
				providerId: subscription.providerId,
				creditId: group.credit.id,
				program: group.credit.program,
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

<section class="rounded-xl border border-(--chat-border) bg-(--chat-bg)/45 p-3" aria-label="Limit resets">
	<div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
		<h3 class="text-xs font-semibold">Limit resets</h3>
		<span class="text-xs text-(--chat-fg-muted)">{resets == null ? 'Not reported by this provider' : `${resets.available} available`}</span>
	</div>
	{#if resets?.reason}<p class="mt-1 text-xs text-(--chat-fg-muted)">{resets.reason.replaceAll('_', ' ')}</p>{/if}
	{#each groups as group (`${group.credit.program}:${group.credit.id}`)}
		<div class="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-(--chat-border) pt-2">
			<div class="min-w-0 flex-1 text-xs">
				<p class="font-medium">{group.credit.label}{group.remaining > 1 ? ` · ${group.remaining}` : ''} · {resetExpiry(group.credit.expiresAt, group.remaining)}</p>
				<p class="mt-1 text-(--chat-fg-muted)">{resetExplanation(group.credit)}</p>
				{#if !group.credit.usable}<p class="mt-1 text-(--chat-fg-muted)">{resetUnavailableReason(group.credit)}</p>{/if}
			</div>
			{#if backend?.supports('subscription-resets')}<Button
					class="min-h-12" size="sm" variant="outline"
					aria-label={`Reset for free using 1 ${group.credit.label}`}
					disabled={!group.credit.usable || pending || uncertain}
					onclick={() => { confirming = group; message = ''; }}>Reset for free</Button>{/if}
		</div>
	{/each}
	{#if pending}<p class="mt-2 text-xs" role="status">Applying one reset…</p>{/if}
	{#if message}<div class="sticky bottom-2 z-50 mt-3 flex items-center justify-between gap-3 rounded-lg border border-(--chat-border) bg-(--chat-bg) p-3 text-sm shadow-lg" role="status"><span>{message}</span><Button class="min-h-12" size="sm" variant="ghost" aria-label="Dismiss reset result" onclick={() => message = ''}>Dismiss</Button></div>{/if}
</section>
<Dialog.Root open={confirming !== null} onOpenChange={(open) => { if (!open) confirming = null; }}>
	<Dialog.Content class="max-w-md">
		<Dialog.Header>
			<Dialog.Title>Use 1 of {confirming?.remaining} {confirming?.credit.label}s?</Dialog.Title>
			<Dialog.Description>{confirming ? resetExplanation(confirming.credit) : ''} It can't be undone.</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button class="min-h-12" variant="outline" onclick={() => confirming = null}>Cancel</Button>
			<Button class="min-h-12" onclick={consume}>Confirm</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
