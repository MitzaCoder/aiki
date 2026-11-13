<script lang="ts">
	import { fitQuestionDialogToViewport } from '#lib/question-dialog-viewport.js';
	import CardMarkdown from './markdown/CardMarkdown.svelte';
	import Markdown from './markdown/Markdown.svelte';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import Maximize2Icon from '@lucide/svelte/icons/maximize-2';
	import { markdownText } from '@kemiri/protocol';
	import CheckIcon from '@lucide/svelte/icons/check';
	import CircleHelpIcon from '@lucide/svelte/icons/circle-help';
	import LayersIcon from '@lucide/svelte/icons/layers';
	import SendIcon from '@lucide/svelte/icons/send';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import type { AnswerOutcome } from '#lib/board.svelte.js';
	import type { BoardQuestion } from '@kemiri/protocol';

	/**
	 * One question the coordinator asked: its text, the options it suggests as chips, and a free-text answer. Used in the
	 * Tasks tab, the task sheet and pinned above the composer. An answer is sent on the revision the question was read
	 * at; when the question moved on meanwhile the card says so and keeps what was typed. A warning looks different and
	 * has no options: the user acknowledges it, with a note if they like.
	 */
	let {
		question,
		taskLabel,
		askedBy,
		taskHref,
		onanswer,
		compact = false
	}: {
		question: BoardQuestion;
		/** "T4 · Fix parser recovery" when the question is about a task. */
		taskLabel?: string;
		/** The background thread that asked, by name; undefined for main. The answer goes to the thread that asked. */
		askedBy?: string;
		/** Where the task opens; the task label becomes a link. */
		taskHref?: string;
		onanswer?: (question: BoardQuestion, answer: string) => Promise<AnswerOutcome>;
		compact?: boolean;
	} = $props();

	const warning = $derived(question.kind === 'warning');
	const canAnswer = $derived(question.status === 'open' && onanswer !== undefined);
	let readingExpanded = $state(false);
	let readingDialog = $state<HTMLElement | null>(null);
	let text = $state('');
	let busy = $state(false);
	let problem = $state<string | undefined>(undefined);

	$effect(() => {
		if (readingDialog === null) return;
		return fitQuestionDialogToViewport(readingDialog);
	});

	async function send(answer: string): Promise<void> {
		const trimmed = answer.trim();
		if (trimmed.length === 0 || busy || !canAnswer || onanswer === undefined) return;
		busy = true;
		problem = undefined;
		try {
			const outcome = await onanswer(question, trimmed);
			if (outcome.kind === 'answered') {
				text = '';
				readingExpanded = false;
			} else if (outcome.kind === 'conflict') {
				problem =
					outcome.newer === undefined || outcome.newer.status !== 'open'
						? warning
							? 'This warning was already acknowledged or withdrawn.'
							: 'This question was already answered or withdrawn.'
						: 'The coordinator changed this question. Read it again and send your answer.';
			} else problem = outcome.message;
		} catch (cause) {
			problem = cause instanceof Error ? cause.message : 'The answer could not be sent. Try again.';
		} finally {
			busy = false;
		}
	}

	function acknowledge(): void {
		void send(text.trim().length === 0 ? 'Acknowledged' : text);
	}

	function onKeydown(event: KeyboardEvent): void {
		if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
			event.preventDefault();
			if (warning) acknowledge();
			else void send(text);
		}
	}
</script>

{#snippet answerForm(expanded: boolean)}
	{#if !warning && question.options.length > 0}
		<div class="flex flex-wrap gap-1.5 {expanded ? 'question-answer-options' : ''}" role="group" aria-label="Suggested answers">
			{#each question.options as option (option)}
				<button
					type="button"
					disabled={busy}
					class="max-w-full rounded-full border border-(--chat-border) bg-(--chat-surface) px-2.5 py-1 text-left text-xs font-medium break-words text-(--chat-fg) transition-colors hover:border-(--accent-2) hover:bg-(--chat-surface-2) disabled:opacity-50"
					onclick={() => send(option)}
				>
					{markdownText(option)}
				</button>
			{/each}
		</div>
	{/if}

	<div class="flex items-end gap-1.5">
		<Textarea
			bind:value={text}
			rows={expanded || compact ? 1 : 2}
			disabled={busy}
			placeholder={warning ? 'Add a note (optional)' : question.options.length > 0 ? 'Or answer in your own words' : 'Your answer'}
			aria-label={warning ? `Note for ${question.id}` : `Answer to ${question.id}`}
			class="min-h-9 max-h-32 min-w-0 flex-1 resize-none rounded-lg border-(--chat-border) bg-(--chat-surface)/50 px-2.5 py-1.5 {expanded ? 'question-answer-input text-base md:text-base' : 'text-xs md:text-xs'}"
			onkeydown={onKeydown}
		/>
		{#if warning}
			<Button size="sm" disabled={busy} onclick={acknowledge} title="Acknowledge (Ctrl+Enter)" aria-label="Acknowledge {question.id}">
				<CheckIcon />Acknowledge
			</Button>
		{:else}
			<Button
				size="icon-sm"
				disabled={busy || text.trim().length === 0}
				onclick={() => send(text)}
				aria-label="Send the answer to {question.id}"
				title="Send (Ctrl+Enter)"
			>
				<SendIcon />
			</Button>
		{/if}
	</div>
	{#if problem}
		<p class="text-xs break-words {expanded ? 'max-h-16 overflow-y-auto' : ''} text-(--chat-danger)" role="alert">{problem}</p>
	{/if}
{/snippet}

<div
	class="flex min-w-0 flex-col gap-2 rounded-2xl border px-3 py-2.5 {warning
		? 'border-(--chat-warning)/50 bg-(--chat-warning)/10'
		: 'border-(--accent-2)/40 bg-(--accent-2)/8'}"
	data-question={question.id}
	data-kind={warning ? 'warning' : 'question'}
>
	<div class="flex min-w-0 items-start gap-2">
		{#if warning}
			<TriangleAlertIcon class="mt-0.5 size-4 shrink-0 text-(--chat-warning)" aria-hidden="true" />
		{:else}
			<CircleHelpIcon class="mt-0.5 size-4 shrink-0 text-(--accent-2)" aria-hidden="true" />
		{/if}
		<div class="min-w-0 flex-1">
			<p class="text-xs text-(--chat-fg-subtle)">
				{#if askedBy}
					<span class="asked-by inline-flex max-w-full items-center gap-1 rounded-md px-1.5 py-px align-middle font-medium" data-asked-by
						><LayersIcon class="size-3 shrink-0" aria-hidden="true" /><span class="truncate">{askedBy}</span></span
					>
				{/if}
				{#if warning}<span class="font-semibold text-(--chat-warning)">Warning</span> ·{/if}
				<span class="font-mono">{question.id}</span>
				{#if taskLabel}
					·
					{#if taskHref}
						<a href={taskHref} class="break-words underline-offset-2 hover:text-(--chat-fg) hover:underline">{taskLabel}</a>
					{:else}
						<span class="break-words">{taskLabel}</span>
					{/if}
				{/if}
			</p>
			<CardMarkdown source={question.text} />
		</div>
		<Dialog.Root bind:open={readingExpanded}>
			<Dialog.Trigger>
				{#snippet child({ props })}
					<Button {...props} variant="ghost" size="icon-sm" class="shrink-0" aria-label="Expand {warning ? 'warning' : 'question'} {question.id}" title="Expand {warning ? 'warning' : 'question'}">
						<Maximize2Icon class="size-4" aria-hidden="true" />
					</Button>
				{/snippet}
			</Dialog.Trigger>
			<Dialog.Content bind:ref={readingDialog} class="question-reading-dialog flex max-h-[90dvh] min-h-0 flex-col gap-3 p-4 sm:max-w-4xl sm:p-6" data-question-reading>
				<Dialog.Header class="shrink-0 pr-8">
					<Dialog.Title>{warning ? 'Warning' : 'Question'} {question.id}</Dialog.Title>
					<Dialog.Description class="max-h-10 overflow-y-auto">{taskLabel ?? (canAnswer && !warning ? 'Read the full text and answer below.' : 'Read the full text.')}</Dialog.Description>
				</Dialog.Header>
				<!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard users need to scroll the full text.) -->
				<div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1" tabindex="0" role="region" aria-label="Full text of {question.id}">
					<Markdown source={question.text} userMessage class="question-reading-markdown" />
				</div>
				{#if canAnswer && !warning}
					<div class="flex shrink-0 flex-col gap-2 border-t border-(--chat-border) pt-3" data-question-answer-footer>
						{@render answerForm(true)}
					</div>
				{/if}
			</Dialog.Content>
		</Dialog.Root>
	</div>

	{#if canAnswer}{@render answerForm(false)}{/if}
</div>

<style>
	:global(.question-reading-dialog) {
		top: var(--question-viewport-center, 50%);
		height: min(52rem, calc(var(--question-viewport-height, 100dvh) - 2rem));
		max-height: calc(var(--question-viewport-height, 100dvh) - 2rem);
	}

	:global(.question-answer-input) {
		max-height: min(6rem, calc(var(--question-viewport-height, 100dvh) * 0.2));
	}

	.question-answer-options {
		max-height: min(7rem, calc(var(--question-viewport-height, 100dvh) * 0.18));
		overflow-y: auto;
		overscroll-behavior: contain;
	}

	:global(.md.question-reading-markdown) {
		font-size: 1.125rem;
		line-height: 1.7;
	}

	.asked-by {
		color: var(--primary);
		background: color-mix(in oklab, var(--primary) 12%, transparent);
	}
</style>
