<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import type { TaskSectionKind } from '#lib/task-sections.js';
	import TaskSectionHeader from '#lib/components/TaskSectionHeader.svelte';

	let {
		title,
		kind,
		count,
		expanded,
		ontoggle,
		meta,
		children,
		class: className = '',
		...attributes
	}: HTMLAttributes<HTMLElement> & {
		title: string;
		kind: TaskSectionKind;
		count?: string | number;
		expanded?: boolean;
		ontoggle?: () => void;
		meta?: Snippet;
		children: Snippet;
	} = $props();
</script>

<section {...attributes} id="task-section-{kind}" aria-label={title} class="task-section {className}" data-task-section={kind} data-section-nav-count={count}>
	<TaskSectionHeader {title} {kind} {count} {expanded} {ontoggle} {meta} />
	<div id="task-section-{kind}-content" class="section-content" hidden={expanded === false}>
		{#if expanded !== false}{@render children()}{/if}
	</div>
</section>

<style>
	.task-section {
		display: flex;
		flex-direction: column;
		gap: 0;
		min-width: 0;
		scroll-margin-top: var(--task-section-offset, 1rem);
		padding: 1rem;
		border: 1px solid var(--chat-border);
		border-radius: 0.9rem;
		background: var(--chat-surface);
	}
	.section-content {
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
		min-width: 0;
	}
	.section-content[hidden] {
		display: none;
	}
</style>
