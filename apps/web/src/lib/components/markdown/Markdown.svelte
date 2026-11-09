<script lang="ts">
	import { toBlocks } from '#lib/markdown/parse.js';
	import { useRefLinks } from '#lib/ref-links.svelte.js';
	import { linkRefMentions } from '#lib/refs.js';
	import CodeBlock from './CodeBlock.svelte';
	import { useTaskLinks } from '#lib/task-links.svelte.js';
	import { linkTaskMentions } from '#lib/task-chat.js';
	import { overlayScrollWithin } from '#lib/scrollbars.js';

	/**
	 * Rendered model markdown; code blocks get highlighting and a copy button. On a project's screens, ticket keys and PR
	 * numbers its link settings know become links (`provideRefLinks`).
	 */
	let {
		source,
		streaming = false,
		userMessage = false,
		class: className = ''
	}: { source: string; streaming?: boolean; userMessage?: boolean; class?: string } = $props();

	const refLinks = useRefLinks();
	const taskLinks = useTaskLinks();
	const linked = $derived.by(() => {
		const tasks = taskLinks();
		const markdown = userMessage && tasks !== undefined ? linkTaskMentions(source, { title: tasks.title }) : source;
		const links = refLinks()?.links;
		return links === undefined ? markdown : linkRefMentions(markdown, links, { streaming });
	});
	const blocks = $derived(toBlocks(linked, streaming, userMessage));
</script>

<div class="md {className}" class:streaming class:md-user={userMessage} use:overlayScrollWithin={'.md-table'}>
	{#each blocks as block (block.key)}
		{#if block.kind === 'code'}
			<CodeBlock code={block.code} lang={block.lang} streaming={!block.closed} />
		{:else}
			<!-- Sanitized with DOMPurify in toBlocks(). -->
			{@html block.html}
		{/if}
	{/each}
</div>
