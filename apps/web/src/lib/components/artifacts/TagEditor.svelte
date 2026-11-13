<script lang="ts">
	import CheckIcon from '@lucide/svelte/icons/check';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import XIcon from '@lucide/svelte/icons/x';
	import { ARTIFACT_MAX_TAGS, ARTIFACT_MAX_TAG_LENGTH } from '@kemiri/protocol';
	import { onMount } from 'svelte';
	import { addTags, removeTag, suggestTags } from '#lib/media-gallery.js';

	/**
	 * Edits one artifact's tags in place: the tags as removable chips, an input that completes from the task's tags, then the
	 * project's, then the suggested ones (shown as chips to tap), and Done. Enter or a comma adds what is typed (or the
	 * suggestion picked with ↓/↑), Backspace on an empty input takes the last tag off, Escape closes. Every change is sent at
	 * once through `onchange`; the parent gives the stored tags back.
	 */
	let {
		tags,
		task,
		project,
		busy = false,
		problem,
		onchange,
		onclose
	}: {
		tags: readonly string[];
		task: readonly string[];
		project: readonly string[];
		busy?: boolean;
		problem?: string | undefined;
		onchange: (tags: string[]) => void;
		onclose: () => void;
	} = $props();

	let typed = $state('');
	let picked = $state(-1);
	let input = $state<HTMLInputElement>();

	const suggestions = $derived(suggestTags(typed, { current: tags, task, project }));
	const full = $derived(tags.length >= ARTIFACT_MAX_TAGS);
	const listId = `tag-suggestions-${Math.random().toString(36).slice(2, 8)}`;

	onMount(() => input?.focus({ preventScroll: true }));

	$effect(() => {
		void typed;
		picked = -1;
	});

	function add(text: string): void {
		const next = addTags(tags, text);
		typed = '';
		if (next.length === tags.length && next.every((tag, index) => tag === tags[index])) return;
		onchange(next);
	}

	/** A comma or semicolon typed, pasted or composed (phone keyboards send no usable key for it) ends a tag. */
	function oninput(): void {
		if (/[,;]/.test(typed)) add(typed);
	}

	function onkeydown(event: KeyboardEvent): void {
		if (event.isComposing) return;
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			onclose();
		} else if (event.key === 'Enter' || event.key === ',') {
			event.preventDefault();
			event.stopPropagation();
			const choice = picked >= 0 ? suggestions[picked] : undefined;
			if (choice !== undefined) add(choice);
			else if (typed.trim() !== '') add(typed);
			else if (event.key === 'Enter') onclose();
		} else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			if (suggestions.length === 0) return;
			event.preventDefault();
			event.stopPropagation();
			const step = event.key === 'ArrowDown' ? 1 : -1;
			picked = (picked + step + suggestions.length + 1) % (suggestions.length + 1) - 1;
		} else if (event.key === 'Backspace' && typed === '' && tags.length > 0) {
			onchange(removeTag(tags, tags[tags.length - 1] as string));
		} else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
			// The carousel's arrows must not move the slide while typing.
			event.stopPropagation();
		}
	}
</script>

<div class="editor flex min-w-0 flex-col gap-1.5" role="group" aria-label="Edit tags" data-tag-editor>
	<div class="field flex min-w-0 flex-wrap items-center gap-1 rounded-xl px-1.5 py-1">
		{#each tags as tag (tag)}
			<span class="tag-chip removable inline-flex items-center gap-0.5 rounded-full py-0.5 pr-0.5 pl-2 text-xs font-medium">
				{tag}
				<button type="button" class="remove grid size-5 place-items-center rounded-full" aria-label="Remove the tag {tag}" onclick={() => onchange(removeTag(tags, tag))}>
					<XIcon class="size-3" />
				</button>
			</span>
		{/each}
		<input
			bind:this={input}
			bind:value={typed}
			class="min-w-[6rem] flex-1 bg-transparent px-1.5 py-1 text-base outline-none placeholder:text-(--chat-fg-subtle) sm:text-sm"
			type="text"
			role="combobox"
			aria-label="Add a tag"
			aria-autocomplete="list"
			aria-expanded={suggestions.length > 0}
			aria-controls={listId}
			aria-activedescendant={picked >= 0 ? `${listId}-${picked}` : undefined}
			placeholder={full ? `At most ${ARTIFACT_MAX_TAGS} tags` : 'Add a tag…'}
			maxlength={ARTIFACT_MAX_TAG_LENGTH * 2}
			disabled={full}
			autocapitalize="none"
			autocomplete="off"
			spellcheck="false"
			enterkeyhint="done"
			{oninput}
			{onkeydown}
		/>
		<button type="button" class="done inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium" onclick={onclose} aria-label="Done editing tags">
			<CheckIcon class="size-3.5" /> Done
		</button>
	</div>
	{#if suggestions.length > 0 && !full}
		<ul id={listId} class="flex flex-wrap gap-1" role="listbox" aria-label="Suggested tags">
			{#each suggestions as suggestion, at (suggestion)}
				<li id="{listId}-{at}" role="option" aria-selected={picked === at}>
					<button type="button" class="suggestion inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs" class:picked={picked === at} tabindex="-1" onclick={() => add(suggestion)} disabled={busy}>
						<PlusIcon class="size-3" aria-hidden="true" />{suggestion}
					</button>
				</li>
			{/each}
		</ul>
	{/if}
	{#if problem}
		<p class="text-xs text-(--chat-danger)" role="alert">{problem}</p>
	{/if}
</div>

<style>
	.field {
		border: 1px solid var(--chat-border-strong, var(--chat-border));
		background: color-mix(in oklab, var(--chat-surface) 70%, transparent);
	}
	.field:focus-within {
		border-color: color-mix(in oklab, var(--accent-2) 55%, var(--chat-border));
		box-shadow: 0 0 0 3px color-mix(in oklab, var(--accent-2) 16%, transparent);
	}
	.tag-chip {
		color: var(--chat-fg);
		background: color-mix(in oklab, var(--accent-2) 14%, transparent);
		box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--accent-2) 30%, transparent);
	}
	.remove {
		color: var(--chat-fg-muted);
		transition: background-color 120ms;
	}
	.remove:hover,
	.remove:focus-visible {
		background: color-mix(in oklab, var(--chat-fg) 14%, transparent);
		color: var(--chat-fg);
		outline: none;
	}
	.done {
		color: var(--accent-2);
		background: color-mix(in oklab, var(--accent-2) 12%, transparent);
	}
	.done:hover,
	.done:focus-visible {
		background: color-mix(in oklab, var(--accent-2) 22%, transparent);
		outline: none;
	}
	.suggestion {
		color: var(--chat-fg-muted);
		border: 1px dashed var(--chat-border-strong, var(--chat-border));
		transition:
			background-color 120ms,
			color 120ms;
	}
	.suggestion:hover,
	.suggestion.picked {
		color: var(--chat-fg);
		background: color-mix(in oklab, var(--accent-2) 12%, transparent);
		border-style: solid;
	}
	.suggestion:active {
		scale: 0.96;
	}
</style>
