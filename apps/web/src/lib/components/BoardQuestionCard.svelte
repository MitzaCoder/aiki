<script lang="ts">
	import CardMarkdown from './markdown/CardMarkdown.svelte';
	import Markdown from './markdown/Markdown.svelte';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import Maximize2Icon from '@lucide/svelte/icons/maximize-2';
	import { markdownText } from '@aiki/protocol';
	import CheckIcon from '@lucide/svelte/icons/check';
	import CircleHelpIcon from '@lucide/svelte/icons/circle-help';
	import LayersIcon from '@lucide/svelte/icons/layers';
	import SendIcon from '@lucide/svelte/icons/send';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import type { AnswerOutcome } from '#lib/board.svelte.js';
	import type { BoardQuestion } from '@aiki/protocol';

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
		onanswer: (question: BoardQuestion, answer: string) => Promise<AnswerOutcome>;
		compact?: boolean;
	} = $props();

	const warning = $derived(question.kind === 'warning');
	let text = $state('');
	let busy = $state(false);
	let problem = $state<string | undefined>(undefined);

	async function send(answer: string): Promise<void> {
		const trimmed = answer.trim();
		if (trimmed.length === 0 || busy) return;
		busy = true;
		problem = undefined;
		const outcome = await onanswer(question, trimmed);
		busy = false;
		if (outcome.kind === 'answered') text = '';
		else if (outcome.kind === 'conflict') {
			problem =
				outcome.newer === undefined || outcome.newer.status !== 'open'
					? warning
						? 'This warning was already acknowledged or withdrawn.'
						: 'This question was already answered or withdrawn.'
					: 'The coordinator changed this question. Read it again and send your answer.';
		} else problem = outcome.message;
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
		<Dialog.Root>
			<Dialog.Trigger>
				{#snippet child({ props })}
					<Button {...props} variant="ghost" size="icon-sm" class="shrink-0" aria-label="Expand {warning ? 'warning' : 'question'} {question.id}" title="Expand {warning ? 'warning' : 'question'}">
						<Maximize2Icon class="size-4" aria-hidden="true" />
					</Button>
				{/snippet}
			</Dialog.Trigger>
			<Dialog.Content class="flex max-h-[90dvh] min-h-0 flex-col gap-4 sm:max-w-4xl" data-question-reading>
				<Dialog.Header class="shrink-0 pr-8">
					<Dialog.Title>{warning ? 'Warning' : 'Question'} {question.id}</Dialog.Title>
					<Dialog.Description>{taskLabel ?? 'Read the full text. Close to answer on the card.'}</Dialog.Description>
				</Dialog.Header>
				<!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard users need to scroll the full text.) -->
				<div class="min-h-0 overflow-y-auto overscroll-contain px-1" tabindex="0" role="region" aria-label="Full text of {question.id}">
					<Markdown source={question.text} userMessage class="question-reading-markdown" />
				</div>
			</Dialog.Content>
		</Dialog.Root>
	</div>

	{#if !warning && question.options.length > 0}
		<div class="flex flex-wrap gap-1.5" role="group" aria-label="Suggested answers">
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
			rows={compact ? 1 : 2}
			placeholder={warning ? 'Add a note (optional)' : question.options.length > 0 ? 'Or answer in your own words' : 'Your answer'}
			aria-label={warning ? `Note for ${question.id}` : `Answer to ${question.id}`}
			class="min-h-9 max-h-32 min-w-0 flex-1 resize-none rounded-lg border-(--chat-border) bg-(--chat-surface)/50 px-2.5 py-1.5 text-xs md:text-xs"
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
		<p class="text-xs break-words text-(--chat-danger)" role="alert">{problem}</p>
	{/if}
</div>

<style>
	:global(.md.question-reading-markdown) {
		font-size: 1.125rem;
		line-height: 1.7;
	}

	.asked-by {
		color: var(--primary);
		background: color-mix(in oklab, var(--primary) 12%, transparent);
	}
</style>
