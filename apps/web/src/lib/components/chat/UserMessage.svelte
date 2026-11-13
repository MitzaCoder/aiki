<script lang="ts">
	import { parseTaskReference } from '@kemiri/client';
	import CopyButton from '#lib/components/CopyButton.svelte';
	import { clockTime, fullTime } from '#lib/chat/time.js';
	import ImageStrip from './ImageStrip.svelte';
	import FileChips from './FileChips.svelte';
	import { splitFileMessage } from '@kemiri/protocol';
	import { dataUrl, imageCountLabel } from '#lib/chat/images.js';
	import type { TranscriptImage, WaitingInfo } from '#lib/transcript.js';
	import { waitingStatus } from '#lib/waiting.js';
	import { slide } from 'svelte/transition';
	import { MediaQuery } from 'svelte/reactivity';
	import { splitQuotes } from '#lib/chat/quotes.js';
	import Markdown from '#lib/components/markdown/Markdown.svelte';
	import QuoteBlock from './QuoteBlock.svelte';
	import TaskRef from './TaskRef.svelte';

	/**
	 * A message from the user: right-aligned bubble, images, then copy and time. A message about a task starts with
	 * `[task T12] `; that shows as the task's chip above the bubble and the text is shown without it. Blockquotes at the
	 * start of the text are what the user quoted: they show as small quotes at the top of the bubble.
	 */
	let {
		text: raw,
		images = [],
		imageCount,
		timestamp,
		waiting,
		target = 'coordinator',
		onedit,
		oncancel,
		onretry
	}: {
		text: string;
		images?: TranscriptImage[];
		/** Images that cannot be drawn (a waiting message from another device): shown as a count. */
		imageCount?: number;
		timestamp?: number;
		/**
		 * Set while the message has not reached the conversation: it is drawn dimmed with a status line and the actions
		 * below. When it clears, this same element is the placed message: the line folds away and the bubble settles.
		 */
		waiting?: WaitingInfo;
		/** Who the message is for, in the status line. */
		target?: 'coordinator' | 'thread';
		/** Take the message back into the composer (withdrawing it if it still waits). */
		onedit?: () => void;
		/** Withdraw it for good, or drop a message that did not send. */
		oncancel?: () => void;
		/** Send a failed message again. */
		onretry?: () => void;
	} = $props();

	const reduced = new MediaQuery('(prefers-reduced-motion: reduce)');
	const status = $derived(waiting === undefined ? undefined : waitingStatus(waiting, target));
	/** The bubble that just stopped waiting settles with one soft ring. */
	let landed = $state(false);
	let wasWaiting = false;
	$effect(() => {
		const isWaiting = waiting !== undefined;
		if (wasWaiting && !isWaiting && !reduced.current) {
			landed = true;
			const timer = setTimeout(() => (landed = false), 1000);
			wasWaiting = isWaiting;
			return () => clearTimeout(timer);
		}
		wasWaiting = isWaiting;
	});

	const attachedFiles = $derived(splitFileMessage(raw));
	const reference = $derived(parseTaskReference(attachedFiles.text));
	const text = $derived(reference.text);
	const parts = $derived(splitQuotes(text));
</script>

<div
	class="group flex animate-rise flex-col items-end gap-1.5 motion-reduce:animate-none"
	data-waiting={waiting?.state}
>
	{#if attachedFiles.files.length > 0}
		<div class="max-w-[90%]"><FileChips files={attachedFiles.files} /></div>
	{/if}
	{#if images.length > 0}
		<div class="flex max-w-[85%] justify-end transition-opacity {waiting !== undefined ? 'opacity-70' : ''}" data-message-images>
			<ImageStrip
				size="large"
				images={images.map((image, index) => ({ key: String(index), src: dataUrl(image), label: `Image ${index + 1} of ${images.length}`, status: 'ready' as const }))}
			/>
		</div>
	{/if}
	{#if imageCount !== undefined && imageCount > 0}
		<p class="max-w-[85%] text-xs text-(--chat-fg-subtle)" data-image-count>{imageCountLabel(imageCount)} attached</p>
	{/if}
	{#if reference.taskId !== null}
		<div class="flex max-w-[85%] justify-end sm:max-w-[75%]" data-task-reference={reference.taskId}>
			<TaskRef taskId={reference.taskId} />
		</div>
	{/if}
	{#if text}
		<div
			class="bubble flex min-w-0 max-w-[85%] flex-col gap-2 rounded-3xl rounded-br-lg border border-(--chat-user-border) px-4 py-2.5 text-[0.975rem] leading-relaxed sm:max-w-[75%]"
			class:waiting={waiting !== undefined}
			class:failed={waiting?.state === 'failed' || waiting?.state === 'withdrawn'}
			class:landed
		>
			{#each parts.quotes as quote, index (index)}
				<QuoteBlock {quote} />
			{/each}
			{#if parts.text}
				<Markdown source={parts.text} userMessage />
			{/if}
		</div>
	{/if}
	{#if status !== undefined && waiting !== undefined}
		<div
			class="flex max-w-[85%] flex-wrap items-center justify-end gap-x-1.5 gap-y-0.5 text-xs text-(--chat-fg-subtle) sm:max-w-[75%]"
			role="status"
			aria-live="polite"
			transition:slide={{ duration: reduced.current ? 0 : 220 }}
		>
			{#if waiting.state === 'sending' || waiting.state === 'waiting'}
				<span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>
			{/if}
			<span class="font-medium" class:text-(--chat-warning)={waiting.state === 'failed' || waiting.state === 'withdrawn'}>{status.label}</span>
			{#if status.detail}<span class="text-right">· {status.detail}</span>{/if}
			{#if !waiting.pending && waiting.state !== 'sending'}
				<span class="flex items-center">
					{#if waiting.state === 'failed' && onretry}
						<button type="button" class="act" onclick={onretry}>Retry</button>
					{/if}
					{#if onedit}
						<button type="button" class="act" onclick={onedit}>Edit</button>
					{/if}
					{#if oncancel}
						<button type="button" class="act" onclick={oncancel}>
							{waiting.state === 'waiting' ? 'Cancel' : 'Dismiss'}
						</button>
					{/if}
				</span>
			{:else if waiting.pending}
				<span>· Taking it back…</span>
			{/if}
		</div>
	{/if}
	{#if waiting === undefined && (text || timestamp !== undefined)}
		<div class="flex items-center gap-1 text-xs text-(--chat-fg-subtle)">
			{#if text}
				<div class="opacity-0 transition-opacity group-hover:opacity-100 max-sm:opacity-100">
					<CopyButton text={raw} label="Copy message" />
				</div>
			{/if}
			{#if timestamp !== undefined}
				<time datetime={new Date(timestamp).toISOString()} title={fullTime(timestamp)}>
					{clockTime(timestamp)}
				</time>
			{/if}
		</div>
	{/if}
</div>

<style>
	.bubble {
		background: var(--chat-user-bubble);
		overflow-wrap: anywhere;
		transition:
			background-color 0.45s ease,
			border-color 0.45s ease,
			opacity 0.45s ease;
	}
	/* Not placed yet: the bubble is a quieter version of itself, so it reads as pending and not as said. */
	.bubble.waiting {
		background: color-mix(in oklab, var(--chat-user-bubble) 40%, transparent);
		border-color: color-mix(in oklab, var(--chat-fg-subtle) 55%, transparent);
		opacity: 0.8;
	}
	.bubble.waiting.failed {
		border-color: color-mix(in oklab, var(--chat-warning) 70%, transparent);
	}
	.bubble.landed {
		animation: landed 0.9s ease-out;
	}
	@keyframes landed {
		from {
			box-shadow: 0 0 0 0 color-mix(in oklab, var(--primary) 40%, transparent);
		}
		to {
			box-shadow: 0 0 0 9px transparent;
		}
	}
	.act {
		min-height: 1.75rem;
		border-radius: 0.375rem;
		padding: 0 0.4rem;
		font-weight: 500;
		color: var(--chat-fg-muted);
		text-decoration: underline;
		text-decoration-color: color-mix(in oklab, currentColor 35%, transparent);
		text-underline-offset: 2px;
	}
	.act:hover {
		color: var(--chat-fg);
		background: var(--chat-surface-2);
	}
	.act:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 1px;
	}
	@media (pointer: coarse) {
		.act {
			min-height: 2.25rem;
			padding: 0 0.6rem;
		}
	}
	.dots {
		display: inline-flex;
		gap: 3px;
		align-items: center;
	}
	.dots i {
		width: 4px;
		height: 4px;
		border-radius: 999px;
		background: currentColor;
		animation: dot 1.2s ease-in-out infinite;
	}
	.dots i:nth-child(2) {
		animation-delay: 0.16s;
	}
	.dots i:nth-child(3) {
		animation-delay: 0.32s;
	}
	@keyframes dot {
		0%,
		70%,
		100% {
			opacity: 0.25;
		}
		35% {
			opacity: 1;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.dots i {
			animation: none;
			opacity: 0.6;
		}
		.bubble {
			transition: none;
		}
	}
</style>
