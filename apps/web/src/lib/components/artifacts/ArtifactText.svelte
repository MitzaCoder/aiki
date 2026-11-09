<script lang="ts">
	import { overlayScroll } from '#lib/scrollbars.js';
	import WrapTextIcon from '@lucide/svelte/icons/wrap-text';
	import CodeXmlIcon from '@lucide/svelte/icons/code-xml';
	import BookOpenTextIcon from '@lucide/svelte/icons/book-open-text';
	import type { HarnessClient } from '@mihai-harness/client';
	import type { Artifact } from '@mihai-harness/protocol';
	import CopyButton from '#lib/components/CopyButton.svelte';
	import Markdown from '#lib/components/markdown/Markdown.svelte';
	import { formatBytes, isMarkdownArtifact, MEDIA_RETRY_LIMIT, TEXT_PREVIEW_BYTES } from '#lib/artifacts.js';
	import { useArtifactSource } from '#lib/artifacts.svelte.js';

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

	const source = useArtifactSource(() => ({ client, projectId: artifact.projectId, artifactId: artifact.id }));
	const url = $derived(source.current?.url);

	$effect(() => {
		if (url === undefined) return;
		const controller = new AbortController();
		void read(url, controller.signal);
		return () => controller.abort();
	});

	async function read(from: string, signal: AbortSignal): Promise<void> {
		try {
			const response = await fetch(from, { headers: { Range: `bytes=0-${TEXT_PREVIEW_BYTES - 1}` }, signal });
			if (response.status === 401 || response.status === 403 || response.status === 410) {
				if (failures < MEDIA_RETRY_LIMIT) {
					failures += 1;
					await source.current?.recover();
					return;
				}
			}
			if (!response.ok) throw new Error(`The backend answered ${response.status}.`);
			const bytes = new Uint8Array(await response.arrayBuffer());
			const total = Number(/\/(\d+)$/.exec(response.headers.get('content-range') ?? '')?.[1] ?? artifact.size);
			truncated = bytes.length < total || bytes.length >= TEXT_PREVIEW_BYTES;
			content = new TextDecoder().decode(bytes.subarray(0, TEXT_PREVIEW_BYTES));
			problem = undefined;
			failures = 0;
		} catch (error) {
			if (signal.aborted) return;
			problem = error instanceof Error ? error.message : String(error);
		}
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
	{:else if problem}
		<p class="px-3 py-3 text-xs text-(--chat-danger)">Could not read it: {problem}</p>
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
