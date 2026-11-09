<script lang="ts">
	import { overlayScroll } from '#lib/scrollbars.js';
	import CopyButton from '#lib/components/CopyButton.svelte';
	import WrapToggle from '#lib/components/WrapToggle.svelte';
	import CodeBlock from '#lib/components/markdown/CodeBlock.svelte';
	import { formatArguments, toolCardStatus, type ToolPart } from '#lib/transcript.js';
	import { langFromPath, resultText, shortPath, splitNotice } from '#lib/chat/tools.js';
	import DiffView from './DiffView.svelte';

	/**
	 * What one tool call opens into: the command, the diff, the file content or
	 * the output. Shared by a call's own card and a line inside a coding group.
	 */
	let { part, cwd }: { part: ToolPart; cwd?: string } = $props();

	const status = $derived(toolCardStatus(part));
	const args = $derived((part.arguments ?? {}) as Record<string, unknown>);
	const path = $derived(typeof args.path === 'string' ? args.path : undefined);
	const output = $derived(splitNotice(resultText(part.output)));
	const diff = $derived(
		typeof part.details === 'object' && part.details !== null
			? (part.details as { diff?: unknown }).diff
			: undefined
	);
	const edits = $derived(
		Array.isArray(args.edits) ? (args.edits as { oldText?: string; newText?: string }[]) : []
	);
</script>

{#if part.viaScript !== undefined}
	<details class="via-script border-b border-(--chat-border)/60">
		<summary class="cursor-pointer px-3.5 py-1.5 text-xs text-(--chat-fg-subtle) select-none">via script</summary>
		<CodeBlock code={part.viaScript.code} lang="javascript" bare />
	</details>
{/if}

{#if part.name === 'bash'}
	<div class="section-label">
		<span>Command</span>
		<span class="flex items-center gap-0.5">
			<WrapToggle defaultWrap />
			<CopyButton text={String(args.command ?? '')} />
		</span>
	</div>
	<CodeBlock code={String(args.command ?? '')} lang="bash" bare wrapByDefault streaming={status === 'preparing'} />
{:else if part.name === 'edit'}
	{#if typeof diff === 'string'}
		<DiffView {diff} />
	{:else if edits.length > 0}
		{#each edits as edit, index (index)}
			<div class="section-label"><span>Edit {index + 1}</span></div>
			<DiffView
				diff={[
					...(edit.oldText ?? '').split('\n').map((line) => `- ${line}`),
					...(edit.newText ?? '').split('\n').map((line) => `+ ${line}`)
				].join('\n')}
			/>
		{/each}
	{:else}
		<div class="section-label"><span>Arguments</span></div>
		<CodeBlock code={formatArguments(args)} lang="json" bare />
	{/if}
{:else if part.name === 'write'}
	<div class="section-label">
		<span>{shortPath(path ?? '', cwd)}</span>
		<CopyButton text={String(args.content ?? '')} />
	</div>
	<div class="relative">
	<div use:overlayScroll={'parent'} class="max-h-96 overflow-auto">
		<CodeBlock
			code={String(args.content ?? '')}
			lang={langFromPath(path)}
			bare
			streaming={status === 'preparing'}
		/>
	</div>
	</div>
{:else if part.name !== 'read'}
	<div class="section-label"><span>Arguments</span></div>
	<CodeBlock code={formatArguments(args)} lang="json" bare />
{/if}

{#if part.output !== undefined && part.name !== 'write' && (part.name !== 'edit' || status === 'error')}
	{#if output.body}
		<div class="section-label">
			<span>{status === 'error' ? 'Error' : 'Output'}</span>
			<CopyButton text={output.body} />
		</div>
		<div class="relative">
		<div use:overlayScroll={'parent'} class="max-h-96 overflow-auto" class:error={status === 'error'}>
			{#if part.name === 'read' && status !== 'error'}
				<CodeBlock code={output.body} lang={langFromPath(path)} bare />
			{:else}
				<pre class="output">{output.body}</pre>
			{/if}
		</div>
		</div>
	{/if}
	{#if output.notice}
		<p class="px-3.5 pb-2.5 text-xs text-(--chat-fg-subtle) italic">{output.notice}</p>
	{/if}
{:else if status === 'running' || status === 'preparing'}
	<p class="shimmer-text px-3.5 py-2.5 text-xs">Running…</p>
{/if}

{#each part.diagnostics as diagnostic, index (index)}
	<p
		class="px-3.5 pb-2 text-xs {diagnostic.severity === 'error'
			? 'text-(--chat-danger)'
			: 'text-(--chat-warning)'}"
	>
		{diagnostic.severity === 'error' ? 'Error: ' : diagnostic.severity === 'warn' ? 'Warning: ' : ''}{diagnostic.message ??
			''}
	</p>
{/each}

<style>
	.output {
		margin: 0;
		padding: 0.5rem 0.875rem 0.875rem;
		font-family: var(--font-mono);
		font-size: 0.78rem;
		line-height: 1.6;
		white-space: pre-wrap;
		word-break: break-word;
		color: var(--chat-fg-muted);
	}
	.error .output {
		color: var(--chat-danger);
	}
</style>
