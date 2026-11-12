<script lang="ts">
	import { overlayScroll } from '#lib/scrollbars.js';
	import WrapTextIcon from '@lucide/svelte/icons/wrap-text';
	import CodeXmlIcon from '@lucide/svelte/icons/code-xml';
	import BookOpenTextIcon from '@lucide/svelte/icons/book-open-text';
	import type { HarnessClient } from '@aiki/client';
	import type { Artifact } from '@aiki/protocol';
	import CopyButton from '#lib/components/CopyButton.svelte';
	import Markdown from '#lib/components/markdown/Markdown.svelte';
	import { formatBytes, isMarkdownArtifact, MEDIA_RETRY_LIMIT, TEXT_PREVIEW_BYTES } from '#lib/artifacts.js';
	import { useArtifactSource } from '#lib/artifacts.svelte.js';
	import { ArtifactReadError, artifactReadProblem, readArtifactText } from '#lib/artifact-text.js';

	/**
	 * A text artifact (a log, a report) read in place: its first `TEXT_PREVIEW_BYTES`, monospace, wrapped or not. A
	 * Markdown one is rendered, with its source a toggle away. A token the backend refuses is renewed and read again.
	 */
	let {
		artifact,
		client,
		compact = false
	}: { artifact: Artifact; client: HarnessClient; compact?: boolean } = $props();

	let content = $state<string | undefined>(undefined);
	let problem = $state<string | undefined>(undefined);
	let truncated = $state(false);
	let wrap = $state(true);
	let showSource = $state(false);
	const markdown = $derived(isMarkdownArtifact(artifact));
	const rendered = $derived(markdown && !showSource);
	let failures = 0;
	let attempt = $state(0);

	const source = useArtifactSource(() => ({ client, projectId: artifact.projectId, artifactId: artifact.id }));
	const url = $derived(source.current?.url);

	$effect(() => {
		attempt;
		if (url === undefined) return;
		const controller = new AbortController();
		void read(url, controller.signal);
		return () => controller.abort();
	});

	async function read(from: string, signal: AbortSignal): Promise<void> {
		try {
			const preview = await readArtifactText(from, artifact.size, signal);
			if (signal.aborted) return;
			truncated = preview.truncated;
			content = preview.content;
			problem = undefined;
			failures = 0;
		} catch (error) {
			if (signal.aborted) return;
			if (error instanceof ArtifactReadError && [401, 403, 410].includes(error.status) && failures < MEDIA_RETRY_LIMIT) {
				failures += 1;
				const recovered = await source.current?.recover();
				if (signal.aborted) return;
				const renewed = source.current?.url;
				if (recovered && renewed) {
					// A URL minted in the same second can be identical; retry explicitly.
					await read(renewed, signal);
					return;
				}
			}
			problem = artifactReadProblem(error);
		}
	}

	function retry(): void {
		failures = 0;
		problem = undefined;
		if (url === undefined) void source.current?.recover();
		attempt += 1;
	}
</script>

<div class="overflow-hidden rounded-2xl border border-(--chat-border) bg-(--chat-bg)/60" data-artifact-text>
	<div class="flex items-center gap-1 border-b border-(--chat-border) px-2.5 py-1 text-xs text-(--chat-fg-subtle)">
		<span class="min-w-0 flex-1 truncate font-mono">{artifact.name}</span>
		{#if markdown}
			<button
				type="button"
				class="grid size-7 place-items-center rounded-md hover:bg-(--chat-surface-2) aria-pressed:text-(--accent-2)"
				aria-pressed={showSource}
				onclick={() => (showSource = !showSource)}
				title={showSource ? 'Show it rendered' : 'Show the Markdown source'}
				aria-label="Show the Markdown source"
			>
				{#if showSource}<BookOpenTextIcon class="size-3.5" />{:else}<CodeXmlIcon class="size-3.5" />{/if}
			</button>
		{/if}
		{#if !rendered}
			<button
				type="button"
				class="grid size-7 place-items-center rounded-md hover:bg-(--chat-surface-2) aria-pressed:text-(--accent-2)"
				aria-pressed={wrap}
				onclick={() => (wrap = !wrap)}
				title={wrap ? 'Do not wrap lines' : 'Wrap lines'}
				aria-label="Wrap lines"
			>
				<WrapTextIcon class="size-3.5" />
			</button>
		{/if}
		{#if content !== undefined}
			<CopyButton text={content} label="Copy the text" />
		{/if}
	</div>
	{#if content !== undefined}
		{#if rendered}
			<div class="relative">
			<div use:overlayScroll={'parent'} class="text-body rendered overflow-auto px-4 py-3" class:compact data-artifact-markdown>
				<Markdown source={content} />
			</div>
			</div>
		{:else}
			<div class="relative">
			<pre use:overlayScroll={'parent'} class="text-body m-0 overflow-auto px-3 py-2.5 font-mono text-[0.78rem] leading-relaxed" class:wrap class:compact>{content}</pre>
			</div>
		{/if}
		{#if truncated}
			<p class="border-t border-(--chat-border) px-3 py-1.5 text-xs text-(--chat-fg-subtle)">
				The first {formatBytes(TEXT_PREVIEW_BYTES)}{artifact.size > 0 ? ` of ${formatBytes(artifact.size)}` : ''}; download it for the rest.
			</p>
		{/if}
	{:else if problem || source.current?.error}
		<div class="px-3 py-3 text-xs" role="alert">
			<p class="text-(--chat-danger)">{problem ?? source.current?.error}</p>
			<button type="button" class="mt-2 min-h-9 rounded-md border border-(--chat-border) px-3 font-medium text-(--chat-fg) hover:bg-(--chat-surface-2)" onclick={retry}>Retry</button>
		</div>
	{:else}
		<p class="px-3 py-3 text-xs text-(--chat-fg-subtle)">Reading…</p>
	{/if}
</div>

<style>
	.text-body {
		max-height: min(60dvh, 36rem);
		white-space: pre;
		tab-size: 4;
		color: var(--chat-fg);
	}
	.text-body.compact {
		max-height: 16rem;
	}
	.text-body.rendered {
		white-space: normal;
		overflow-x: hidden;
	}
	.text-body.wrap {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
</style>
