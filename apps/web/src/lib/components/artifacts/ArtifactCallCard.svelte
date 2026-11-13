<script lang="ts">
	import CheckIcon from '@lucide/svelte/icons/check';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import XIcon from '@lucide/svelte/icons/x';
	import { slide } from 'svelte/transition';
	import { artifactFromCall, artifactSaveCall, artifactTitle, baseName, formatBytes, formatMediaDuration, kindFromName } from '#lib/artifacts.js';
	import { artifactScope, useArtifactFeed } from '#lib/artifacts.svelte.js';
	import { toolCardStatus, type ToolCardStatus, type ToolPart } from '#lib/transcript.js';
	import ArtifactDialog from './ArtifactDialog.svelte';
	import ArtifactKindIcon from './ArtifactKindIcon.svelte';
	import ArtifactPlayer from './ArtifactPlayer.svelte';
	import ArtifactThumb from './ArtifactThumb.svelte';

	/**
	 * An `artifact_save` call in the chat as the artifact itself: a video plays in place, an image opens in the lightbox,
	 * the rest show a thumbnail that opens the artifact in full. Its record comes from the project's newest artifacts; one
	 * older than those is shown from the call's own arguments, since its URL is asked for by ID. A failed call stays a red
	 * line that opens into the error.
	 */
	let { part }: { part: ToolPart } = $props();

	const scope = artifactScope();
	const current = $derived(scope?.());
	const call = $derived(artifactSaveCall(part));
	const status: ToolCardStatus = $derived(toolCardStatus(part));
	const failed = $derived(status === 'error' || status === 'exited');
	const feed = useArtifactFeed(() =>
		current?.available === true && call.artifactId !== undefined ? { client: current.client, projectId: current.projectId, limit: 200 } : undefined
	);
	const artifact = $derived.by(() => {
		if (current === undefined || call.artifactId === undefined) return undefined;
		return feed.current?.artifacts.find((entry) => entry.id === call.artifactId) ?? artifactFromCall(current.projectId, call.artifactId, call);
	});
	/** Deleted since: the list read it and no longer holds it. */
	const deleted = $derived(
		artifact !== undefined && feed.current?.loaded === true && artifact.createdAt === '' && feed.current.artifacts.length < 200
	);
	const name = $derived(call.path === undefined ? 'a file' : baseName(call.path));
	const heading = $derived(artifact === undefined ? (call.title ?? name) : artifactTitle(artifact));
	const kind = $derived(artifact?.kind ?? kindFromName(name));
	const facts = $derived(
		artifact === undefined
			? ''
			: [formatMediaDuration(artifact.durationSeconds), artifact.size >= 0 ? formatBytes(artifact.size) : ''].filter(Boolean).join(' · ')
	);
	let open = $state(false);
	let dialogOpen = $state(false);
</script>

<div class="my-2 overflow-hidden rounded-2xl border border-(--chat-border) bg-(--chat-surface)/60" data-status={status} data-artifact-call>
	<div class="flex min-w-0 items-center gap-2.5 px-3 py-2">
		<span class="tool-icon grid size-7 shrink-0 place-items-center rounded-lg"><ArtifactKindIcon {kind} class="size-3.5" /></span>
		<span class="flex min-w-0 flex-1 flex-col">
			<span class="truncate text-[0.8125rem] font-semibold" title={heading}>{heading}</span>
			<span class="truncate text-[0.6875rem] text-(--chat-fg-subtle)">
				{#if failed}Could not save {name}{:else if status === 'preparing' || status === 'running'}Saving {name}…{:else if deleted}Deleted{:else}Saved {name}{facts ? ` · ${facts}` : ''}{/if}
			</span>
		</span>
		{#if (artifact?.versionCount ?? 1) > 1}
			<span class="shrink-0 text-[0.625rem] text-(--chat-fg-subtle)" data-version-count>{artifact?.versionCount} versions</span>
		{/if}
		{#if failed}
			<button type="button" class="flex shrink-0 items-center gap-1 text-xs text-(--chat-danger)" onclick={() => (open = !open)} aria-expanded={open}>
				<XIcon class="size-3.5" /> failed <ChevronRightIcon class="size-3.5 transition-transform {open ? 'rotate-90' : ''}" />
			</button>
		{:else if status === 'preparing' || status === 'running'}
			<LoaderCircleIcon class="size-3.5 shrink-0 animate-spin text-(--accent-2)" />
		{:else if artifact !== undefined && !deleted}
			<button type="button" class="shrink-0 rounded-md px-1.5 py-0.5 text-xs font-medium text-(--accent-2) hover:bg-(--accent-2)/10" onclick={() => (dialogOpen = true)}>
				Details
			</button>
		{:else if status === 'done'}
			<CheckIcon class="size-3.5 shrink-0 text-(--chat-success)" />
		{/if}
	</div>

	{#if failed && open}
		<pre class="error-output border-t border-(--chat-border)" transition:slide={{ duration: 180 }}>{part.output || 'The artifact was not saved.'}</pre>
	{:else if artifact !== undefined && current !== undefined && !deleted}
		{#if artifact.kind === 'video' || artifact.kind === 'image'}
			<div class="px-2 pb-2">
				<ArtifactPlayer {artifact} client={current.client} compact />
			</div>
		{:else}
			<button type="button" class="flex w-full min-w-0 items-center gap-2.5 border-t border-(--chat-border) px-3 py-2 text-left hover:bg-(--chat-surface-2)/60" onclick={() => (dialogOpen = true)}>
				<ArtifactThumb {artifact} client={current.client} class="h-9 w-12 rounded-lg" duration={false} />
				<span class="min-w-0 flex-1 truncate text-xs text-(--chat-fg-muted)">{artifact.kind === 'text' ? 'Read it' : artifact.kind === 'audio' ? 'Listen' : 'Download or view the details'}</span>
				<ChevronRightIcon class="size-3.5 text-(--chat-fg-subtle)" />
			</button>
		{/if}
		<ArtifactDialog {artifact} client={current.client} bind:open={dialogOpen} />
	{/if}
</div>

<style>
	.tool-icon {
		color: var(--accent-2);
		background: color-mix(in oklab, var(--accent-2) 12%, transparent);
	}
	[data-status='error'],
	[data-status='exited'] {
		border-color: color-mix(in oklab, var(--chat-danger) 30%, var(--chat-border));
	}
	[data-status='error'] .tool-icon,
	[data-status='exited'] .tool-icon {
		color: var(--chat-danger);
		background: color-mix(in oklab, var(--chat-danger) 12%, transparent);
	}
	.error-output {
		margin: 0;
		padding: 0.5rem 0.875rem 0.875rem;
		font-family: var(--font-mono);
		font-size: 0.78rem;
		line-height: 1.6;
		white-space: pre-wrap;
		word-break: break-word;
		color: var(--chat-danger);
	}
</style>
