<script lang="ts">
	import XIcon from '@lucide/svelte/icons/x';
	import type { BoardTaskStatus } from '@mihai-harness/protocol';
	import { useTaskLinks } from '#lib/task-links.svelte.js';
	import { taskStatusToneClass } from '#lib/tasks.js';

	/**
	 * A board task as a small pill: its ID and title, with a dot in the status' colour. A link when it has an `href`,
	 * removable when it has `onremove`. The status comes from the board when the screen offers task links.
	 */
	let {
		taskId,
		title,
		status,
		href,
		onremove,
		class: className = ''
	}: {
		taskId: string;
		title?: string;
		status?: BoardTaskStatus;
		href?: string;
		onremove?: () => void;
		class?: string;
	} = $props();

	const links = useTaskLinks();
	const liveStatus = $derived(status ?? links()?.status(taskId));

	const base =
		'inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border border-(--chat-border) bg-(--chat-surface-2)/60 px-2 py-0.5 text-xs align-middle';
</script>

{#snippet label()}
	{#if liveStatus}<span class="task-status-dot {taskStatusToneClass(liveStatus)}" aria-hidden="true"></span>{/if}
	<span class="shrink-0 font-mono font-semibold text-(--accent-2)">{taskId}</span>
	{#if title}<span class="min-w-0 truncate text-(--chat-fg)">{title}</span>{/if}
{/snippet}

{#if href !== undefined}
	<a {href} class="{base} transition-colors hover:bg-(--chat-surface-2) {className}" data-task-chip={taskId} title={title ? `${taskId} · ${title}` : taskId}>
		{@render label()}
	</a>
{:else}
	<span class="{base} {onremove ? 'pr-0.5' : ''} {className}" data-task-chip={taskId} title={title ? `${taskId} · ${title}` : taskId}>
		{@render label()}
		{#if onremove}
			<button
				type="button"
				class="-my-1 grid size-7 shrink-0 place-items-center rounded-full text-(--chat-fg-subtle) transition-colors hover:bg-(--chat-surface-2) hover:text-(--chat-fg)"
				onclick={onremove}
				aria-label="Remove {taskId}"
				title="Remove {taskId}"
			>
				<XIcon class="size-3.5" />
			</button>
		{/if}
	</span>
{/if}
