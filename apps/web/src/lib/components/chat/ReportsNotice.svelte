<script lang="ts">
	import ClipboardListIcon from '@lucide/svelte/icons/clipboard-list';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { projectHref } from '#lib/backends.js';
	import { taskHref } from '#lib/task-chat.js';
	import { useTaskLinks } from '#lib/task-links.svelte.js';
	import type { TranscriptItem } from '#lib/transcript.js';
	import TaskLine from './TaskLine.svelte';

	let { item }: { item: Extract<TranscriptItem, { kind: 'reports' }> } = $props();
	const links = useTaskLinks();
	function openTask(taskId: string): void {
		const href = links()?.href(taskId) ?? (page.params.backend && page.params.id
			? `${projectHref(page.params.backend, page.params.id)}${taskHref(taskId)}` : taskHref(taskId));
		void goto(href);
	}
</script>

<TaskLine icon={ClipboardListIcon} timestamp={item.timestamp} data-reports-notice {details}>
	{#snippet children()}
		<div class="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 py-1.5 text-xs text-(--chat-fg-muted)">
			<span>Reports out of date</span>
			{#each item.notice.sections as section (`${section.taskId}:${section.section}`)}
				<div class="flex min-w-0 max-w-full items-center gap-1.5">
					<button type="button" data-report-task={section.taskId}
						class="shrink-0 rounded-full border border-(--chat-border) bg-(--chat-surface-2)/60 px-2 py-1 text-xs hover:bg-(--chat-surface-2)"
						aria-label="Open {section.taskId}, {section.section} report out of date"
						onclick={() => openTask(section.taskId)}>
						{section.taskId} · {section.section}
					</button>
					<span class="min-w-0 max-w-52 truncate" title={section.reason}>{section.reason}</span>
				</div>
			{/each}
		</div>
	{/snippet}
</TaskLine>

{#snippet details()}
	<pre class="max-h-80 overflow-auto px-3.5 py-2.5 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap text-(--chat-fg-muted)">{item.notice.raw}</pre>
{/snippet}
