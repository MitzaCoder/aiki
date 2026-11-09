<script lang="ts">
	import type { Snippet } from 'svelte';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import { taskSectionIcons } from '#lib/task-section-icons.js';
	import type { TaskSectionKind } from '#lib/task-sections.js';

	let {
		title,
		kind,
		count,
		expanded,
		ontoggle,
		meta
	}: {
		title: string;
		kind: TaskSectionKind;
		count?: string | number;
		expanded?: boolean;
		ontoggle?: () => void;
		meta?: Snippet;
	} = $props();
	const Icon = $derived(taskSectionIcons[kind]);
</script>

{#snippet label()}
	<span class="section-icon"><Icon class="size-[1.125rem]" aria-hidden="true" /></span>
	<span>{title}</span>
	{#if count !== undefined}<span class="section-count" data-section-count>{count}</span>{/if}
	{#if ontoggle}<span class="section-chevron"><ChevronRightIcon class="size-4 {expanded ? 'rotate-90' : ''}" aria-hidden="true" /></span
		>{/if}
{/snippet}

<div class="section-heading" class:collapsed={expanded === false}>
	<h3>
		{#if ontoggle}
			<button type="button" aria-expanded={expanded} aria-controls="task-section-{kind}-content" onclick={ontoggle}
				>{@render label()}</button
			>
		{:else}
			<span class="task-heading-label">{@render label()}</span>
		{/if}
	</h3>
	{#if meta}<div class="section-meta">{@render meta()}</div>{/if}
</div>

<style>
	.section-heading {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin: -1rem -1rem 0.85rem;
		padding: 0.8rem 1rem;
		border-bottom: 1px solid var(--chat-border);
		border-radius: 0.9rem 0.9rem 0 0;
		background: color-mix(in oklab, var(--accent-2) 4%, var(--chat-surface));
	}
	.section-heading.collapsed {
		margin-bottom: -1rem;
		border-bottom: 0;
		border-radius: 0.9rem;
	}
	h3 {
		flex: 1;
		min-width: 0;
		color: var(--chat-fg);
		font-size: 1rem;
		font-weight: 720;
		letter-spacing: -0.015em;
	}
	.task-heading-label,
	button {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		min-height: 2rem;
	}
	button {
		width: 100%;
		text-align: left;
		cursor: pointer;
		border-radius: 0.5rem;
	}
	button:focus-visible {
		outline: 2px solid var(--accent-2);
		outline-offset: 5px;
	}
	.section-icon {
		display: grid;
		place-items: center;
		width: 1.5rem;
		height: 1.5rem;
		flex-shrink: 0;
		color: var(--accent-2);
	}
	.section-count {
		border-radius: 999px;
		padding: 0.18rem 0.5rem;
		color: var(--accent-2);
		background: color-mix(in oklab, var(--accent-2) 12%, transparent);
		font-size: 0.6875rem;
		font-weight: 600;
		letter-spacing: 0;
		white-space: nowrap;
	}
	.section-chevron {
		margin-left: auto;
		flex-shrink: 0;
		color: var(--chat-fg-subtle);
	}
	.section-meta {
		margin-left: auto;
		font-size: 0.6875rem;
		color: var(--chat-fg-subtle);
	}
</style>
