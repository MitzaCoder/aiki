<script lang="ts">
	import { splitTaskMentions } from '#lib/task-chat.js';
	import { useTaskLinks } from '#lib/task-links.svelte.js';
	import TaskChip from './TaskChip.svelte';

	/**
	 * A line of the harness' words with each task it names as a link to that task, inline: put it in an element that
	 * truncates, so a long line ends in one ellipsis. `titles` adds the task's title to the
	 * link, for text that only has the ID.
	 */
	let { text, titles = false }: { text: string; titles?: boolean } = $props();

	const links = useTaskLinks();
	const pieces = $derived.by(() => {
		const current = links();
		return current === undefined ? [{ text }] : splitTaskMentions(text, (id) => current.title(id) !== undefined);
	});
</script>

{#each pieces as piece, index (index)}
	{#if 'taskId' in piece}
		<TaskChip taskId={piece.taskId} title={titles ? links()?.title(piece.taskId) : undefined} href={links()?.href(piece.taskId)} />
	{:else}
		{piece.text}
	{/if}
{/each}
