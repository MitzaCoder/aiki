<script lang="ts">
	import { useTaskLinks } from '#lib/task-links.svelte.js';
	import TaskChip from './TaskChip.svelte';

	/** The task a line is about, as a pill that opens it; `fallbackTitle` stands in when the board does not hold the task. */
	let { taskId, fallbackTitle, showTitle = true }: { taskId: string; fallbackTitle?: string; showTitle?: boolean } = $props();

	const links = useTaskLinks();
	const title = $derived(showTitle ? (links()?.title(taskId) ?? fallbackTitle) : undefined);
</script>

<TaskChip {taskId} {title} href={links()?.href(taskId)} />
