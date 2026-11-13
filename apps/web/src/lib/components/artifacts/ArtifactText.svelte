<script module lang="ts">
	/** The reader's last Page/Source choice for an HTML artifact, kept while the page lives. */
	let htmlView: 'page' | 'source' | undefined;
</script>

<script lang="ts">
	import { overlayScroll } from '#lib/scrollbars.js';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import WrapTextIcon from '@lucide/svelte/icons/wrap-text';
	import CodeXmlIcon from '@lucide/svelte/icons/code-xml';
	import BookOpenTextIcon from '@lucide/svelte/icons/book-open-text';
	import type { HarnessClient } from '@aiki/client';
	import type { Artifact } from '@aiki/protocol';
	import CopyButton from '#lib/components/CopyButton.svelte';
	import Markdown from '#lib/components/markdown/Markdown.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { ARTIFACT_FRAME_SANDBOX, isHtmlArtifact, openArtifactPreview } from '#lib/artifact-preview.js';
	import { formatBytes, isMarkdownArtifact, MEDIA_RETRY_LIMIT, TEXT_PREVIEW_BYTES } from '#lib/artifacts.js';
	import { useArtifactSource } from '#lib/artifacts.svelte.js';
	import { ArtifactReadError, artifactReadProblem, readArtifactText } from '#lib/artifact-text.js';

	/**
	 * A text artifact (a log, a report) read in place: its first `TEXT_PREVIEW_BYTES`, monospace, wrapped or not. A
	 * Markdown one is rendered, with its source a toggle away. An HTML one is the page itself, in a sandboxed frame (see
	 * `lib/artifact-preview.ts`), with its source a toggle away and Copy always copying the source. A token the backend
	 * refuses is renewed and read again. `roomy` is the full viewer's, where the dialog scrolls the page itself: the text
	 * then grows to its own length and the page fills the room the dialog has. An HTML artifact also offers a new tab
	 * with the same sandboxed page.
	 */
	let {
		artifact,
		client,
		compact = false,
		roomy = false
	}: { artifact: Artifact; client: HarnessClient; compact?: boolean; roomy?: boolean } = $props();

	let content = $state<string | undefined>(undefined);
	let problem = $state<string | undefined>(undefined);
	let truncated = $state(false);
	let wrap = $state(true);
	let showSource = $state(false);
	let view = $state<'page' | 'source' | undefined>(htmlView);
	const markdown = $derived(isMarkdownArtifact(artifact));
	const html = $derived(isHtmlArtifact(artifact));
	const rendered = $derived(markdown && !showSource);
	/**
	 * Whether an HTML artifact shows its source. The reader's own choice wins; otherwise a page cut short by the preview
	 * limit opens as source, because half a document renders as something the worker never wrote.
	 */
	const htmlSource = $derived(view !== undefined ? view === 'source' : truncated);
	const page = $derived(html && !htmlSource);
	/** The two ways an HTML artifact is read, in the header's segmented control. */
	const VIEWS = [
		{ key: 'page', label: 'Page' },
		{ key: 'source', label: 'Source' }
	] as const;
	let failures = 0;
	let attempt = $state(0);
	let tabProblem = $state('');

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

	function setView(next: 'page' | 'source'): void {
		view = next;
		htmlView = next;
	}

	/** The HTML page in a tab of its own, sandboxed away from this app's origin (see `lib/artifact-preview.ts`). */
	function openTab(): void {
		if (content === undefined) return;
		tabProblem = openArtifactPreview(content, artifact.name) ? '' : 'The browser blocked the new tab. Allow pop-ups for this site and try again.';
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
		{#if html}
			<div class="flex shrink-0 items-center rounded-md bg-(--chat-surface-2)/70 p-0.5" role="group" aria-label="Show the page or its source" data-artifact-html-view>
				{#each VIEWS as option (option.key)}
					<button
						type="button"
						class="rounded px-1.5 py-0.5 font-medium aria-pressed:bg-(--chat-bg) aria-pressed:text-(--accent-2) hover:text-(--chat-fg)"
						aria-pressed={(option.key === 'page') === page}
						onclick={() => setView(option.key)}
						title={option.key === 'page' ? 'Show the page as it renders' : 'Show the HTML source'}
						data-artifact-view={option.key}
					>{option.label}</button>
				{/each}
			</div>
		{/if}
		{#if !rendered && !page}
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
		{#if html && content !== undefined}
			<Button variant="ghost" size="icon-sm" onclick={openTab} title="Open in a new tab" aria-label="Open in a new tab" data-artifact-new-tab>
				<ExternalLinkIcon />
			</Button>
		{/if}
		{#if content !== undefined}
			<CopyButton text={content} label="Copy the text" />
		{/if}
	</div>
	{#if tabProblem}<p class="border-b border-(--chat-border) px-3 py-1.5 text-xs text-(--chat-danger)" role="alert">{tabProblem}</p>{/if}
	{#if content !== undefined}
		{#if page}
			<div class="relative">
				<iframe
					title={artifact.name}
					sandbox={ARTIFACT_FRAME_SANDBOX}
					referrerpolicy="no-referrer"
					srcdoc={content}
					class="page-frame block w-full border-0 bg-white"
					class:compact
					class:roomy
					data-artifact-page
				></iframe>
			</div>
		{:else if rendered}
			<div class="relative">
			<div use:overlayScroll={'parent'} class="text-body rendered overflow-auto px-4 py-3" class:compact class:roomy data-artifact-markdown>
				<Markdown source={content} />
			</div>
			</div>
		{:else}
			<div class="relative">
			<pre use:overlayScroll={'parent'} class="text-body m-0 overflow-auto px-3 py-2.5 font-mono text-[0.78rem] leading-relaxed" class:wrap class:compact class:roomy>{content}</pre>
			</div>
		{/if}
		{#if truncated}
			<p class="border-t border-(--chat-border) px-3 py-1.5 text-xs text-(--chat-fg-subtle)" data-artifact-truncated>
				The first {formatBytes(TEXT_PREVIEW_BYTES)}{artifact.size > 0 ? ` of ${formatBytes(artifact.size)}` : ''};
				{#if html}{page ? 'the page is drawn from that part only' : 'a page cannot be shown whole, so this is its source'}; {/if}download it for the rest.
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
	/* The full viewer's dialog scrolls the page; the text itself must not become a second scroll area. */
	.text-body.roomy {
		max-height: none;
		overflow: visible;
		overscroll-behavior: auto;
	}
	.text-body.rendered {
		white-space: normal;
		overflow-x: hidden;
	}
	.text-body.wrap {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	/*
	 * The rendered page. It is its own document, so no `roomy` height rule of the text body applies: the frame takes the
	 * room the dialog has above its title and note (the roomy HTML dialog is at most `min(90dvh, 64rem)` tall), and in
	 * the chat or a list it keeps the text body's frame.
	 */
	.page-frame {
		height: min(60dvh, 36rem);
	}
	.page-frame.compact {
		height: 16rem;
	}
	.page-frame.roomy {
		height: clamp(16rem, calc(90dvh - 14rem), 46rem);
	}
</style>
