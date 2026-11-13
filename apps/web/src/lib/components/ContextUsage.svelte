<script lang="ts">
	import ArchiveIcon from '@lucide/svelte/icons/archive';
	import CoinsIcon from '@lucide/svelte/icons/coins';
	import Banner from '#lib/components/Banner.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import { cacheMissTotalsView } from '#lib/chat/cache.js';
	import { contextUsageView } from '#lib/context-usage.js';
	import type { ContextUsage } from '@kemiri/protocol';

	/**
	 * The Info tab's context usage block: how full the model's window is, where the background and blocking compaction
	 * thresholds sit, how many summaries this conversation has, its prompt cache misses (when the backend counts them), and —
	 * for the coordinator — a way to compact now with optional instructions.
	 *
	 * Drawn from `ConversationContext.usage`, which an older backend does not send at all; the panel leaves the block out
	 * then.
	 */
	let {
		usage,
		canCompact = false,
		compacting = false,
		compactError,
		oncompact
	}: {
		usage: ContextUsage;
		/** Only the coordinator's conversation can be compacted from the app. */
		canCompact?: boolean;
		/** A compaction is running, from this screen's request or the server's usage. */
		compacting?: boolean;
		compactError?: string;
		oncompact?: (instructions?: string) => void | Promise<void>;
	} = $props();

	const view = $derived(contextUsageView(usage, Date.now()));
	const cacheMisses = $derived(cacheMissTotalsView(usage.cacheMisses));

	let instructionsOpen = $state(false);
	let instructions = $state('');
	let sending = $state(false);

	const heading = 'text-[0.6875rem] font-semibold tracking-wide text-(--chat-fg-subtle) uppercase';
	const thresholds = $derived(
		[view.backgroundLabel, view.blockingLabel].filter((label): label is string => label !== undefined).join(' · ')
	);

	function openInstructions(): void {
		instructions = '';
		instructionsOpen = true;
	}

	async function compact(): Promise<void> {
		const text = instructions.trim();
		instructionsOpen = false;
		instructions = '';
		sending = true;
		try {
			await oncompact?.(text.length === 0 ? undefined : text);
		} finally {
			sending = false;
		}
	}
</script>

<section
	aria-label="Context usage"
	class="flex flex-col gap-2 rounded-xl border border-(--chat-border) bg-(--chat-surface)/30 px-2.5 py-2"
>
	<div class="flex min-w-0 items-center gap-2">
		<h3 class={`${heading} min-w-0 flex-1 truncate`}>Context usage</h3>
		{#if canCompact}
			<Button
				variant="outline"
				size="xs"
				type="button"
				disabled={compacting || sending}
				onclick={openInstructions}
				title="Summarize earlier messages now"
			>
				<ArchiveIcon data-icon="inline-start" />
				Compact now
			</Button>
		{/if}
	</div>

	{#if view.measured}
		<div
			role="meter"
			aria-label="Context used"
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={view.percent}
			aria-valuetext="{view.tokensLabel} tokens ({view.percentLabel})"
			class="relative h-2 w-full overflow-hidden rounded-full bg-(--chat-surface-2)"
		>
			<div
				class="h-full rounded-full bg-(--accent-2) transition-[width] duration-500 motion-reduce:transition-none"
				style:width="{view.percent}%"
			></div>
			{#if view.backgroundPercent !== undefined}
				<span
					aria-hidden="true"
					class="absolute inset-y-0 w-px bg-(--chat-fg-subtle)/60"
					style:left="{view.backgroundPercent}%"
					title={view.backgroundLabel}
				></span>
			{/if}
			{#if view.blockingPercent !== undefined}
				<span
					aria-hidden="true"
					class="absolute inset-y-0 w-px bg-(--chat-fg)/50"
					style:left="{view.blockingPercent}%"
					title={view.blockingLabel}
				></span>
			{/if}
		</div>
		<div class="flex items-baseline justify-between gap-2 text-xs text-(--chat-fg-muted)">
			<span class="min-w-0 truncate tabular-nums">{view.tokensLabel} tokens</span>
			<span class="shrink-0 font-semibold tabular-nums">{view.percentLabel}</span>
		</div>
	{:else}
		<p class="text-xs text-(--chat-fg-subtle)">
			No model is set, so there is no context window to measure.
		</p>
	{/if}

	{#if thresholds.length > 0}
		<p class="text-[0.625rem] text-(--chat-fg-subtle)">{thresholds}</p>
	{/if}

	<div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.6875rem] text-(--chat-fg-subtle)">
		<span title={view.lastCompactionTitle}>{view.compactionsLabel}</span>
		{#if compacting}
			<span class="flex items-center gap-1 text-(--chat-fg-muted)" role="status">
				<Spinner class="size-3" aria-label="Compacting" />
				Compacting…
			</span>
		{/if}
	</div>

	{#if cacheMisses}
		<p
			class="flex min-w-0 items-start gap-1.5 text-[0.6875rem] {cacheMisses.warning
				? 'text-(--chat-fg-muted)'
				: 'text-(--chat-fg-subtle)'}"
			title={cacheMisses.title}
		>
			<CoinsIcon
				class="mt-0.5 size-3 shrink-0 {cacheMisses.warning ? 'text-(--chat-warning)' : ''}"
				aria-hidden="true"
			/>
			<span class="min-w-0">{cacheMisses.label}</span>
		</p>
	{/if}

	{#if compactError}
		<Banner tone="error">{compactError}</Banner>
	{/if}
</section>

<Dialog.Root bind:open={instructionsOpen}>
	<Dialog.Content class="sm:max-w-sm">
		<Dialog.Header>
			<Dialog.Title>Compact the conversation</Dialog.Title>
			<Dialog.Description>
				Earlier messages are replaced by a summary. Tell it what to keep, or leave this empty for the usual summary.
			</Dialog.Description>
		</Dialog.Header>
		<div class="flex flex-col gap-1.5 px-4 pb-2 sm:px-6">
			<Label for="compact-instructions" class="text-xs font-medium">Instructions (optional)</Label>
			<Textarea
				id="compact-instructions"
				bind:value={instructions}
				rows={3}
				placeholder="Keep the deploy details and the open questions."
				class="min-h-16 text-sm md:text-sm"
			/>
		</div>
		<Dialog.Footer>
			<Dialog.Close>
				{#snippet child({ props })}
					<Button {...props} variant="outline" size="sm">Cancel</Button>
				{/snippet}
			</Dialog.Close>
			<Button size="sm" type="button" disabled={sending} onclick={compact}>
				{#if sending}<Spinner data-icon="inline-start" />{/if}
				Compact
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
