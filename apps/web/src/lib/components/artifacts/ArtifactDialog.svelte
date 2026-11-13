<script module lang="ts">
	/** The reader's last choice to show or hide a video's details, kept while the page lives. */
	let detailsChoice: boolean | undefined;
</script>

<script lang="ts">
	import { overlayScroll } from '#lib/scrollbars.js';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import PanelRightCloseIcon from '@lucide/svelte/icons/panel-right-close';
	import PanelRightOpenIcon from '@lucide/svelte/icons/panel-right-open';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import type { HarnessClient } from '@aiki/client';
	import type { Artifact } from '@aiki/protocol';
	import { MediaQuery } from 'svelte/reactivity';
	import CopyButton from '#lib/components/CopyButton.svelte';
	import Markdown from '#lib/components/markdown/Markdown.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import { artifactTitle, formatBytes, formatMediaDuration, isMarkdownArtifact, kindLabel, savedByLabel } from '#lib/artifacts.js';
	import { isHtmlArtifact } from '#lib/artifact-preview.js';
	import { artifactDialogSizing } from '#lib/dialog-layout.js';
	import { downloadArtifact, useArtifactFeed } from '#lib/artifacts.svelte.js';
	import { artifactVersions, selectedArtifactVersion } from '#lib/artifact-versions.js';
	import { exactTime, relativeTime } from '#lib/relative-time.js';
	import { linkNoteTimes, noteTimeFromHref, panelFitsBeside } from '#lib/video-player.js';
	import ArtifactPlayer from './ArtifactPlayer.svelte';
	import ArtifactVideo from './ArtifactVideo.svelte';

	/**
	 * One artifact in full: the player, its title, its note as Markdown, who saved it, for which task and when, where the
	 * file came from, and buttons to download or delete it (deleting asks first). A video on a wide enough window takes
	 * nearly the whole window, with the title on a line above it and the rest in a panel beside it that folds away; it
	 * opens beside the video only when it costs the video nothing, until the reader picks. Its download button is in the
	 * player's bar. Times in a video's note seek it.
	 */
	let {
		artifact: suppliedArtifact,
		client,
		open = $bindable(false),
		autoplay = true,
		ondeleted
	}: {
		artifact: Artifact | undefined;
		client: HarnessClient;
		open?: boolean;
		autoplay?: boolean;
		/** After the backend deleted it. */
		ondeleted?: (artifactId: string) => void;
	} = $props();

	const versionFeed = useArtifactFeed(() => open && suppliedArtifact !== undefined
		? { client, projectId: suppliedArtifact.projectId, filter: { artifactId: suppliedArtifact.id } } : undefined);
	const latestArtifact = $derived(versionFeed.current?.artifacts.find((row) => row.id === suppliedArtifact?.id) ?? suppliedArtifact);
	let selectedVersion = $state<number | undefined>(undefined);
	const versions = $derived(latestArtifact === undefined ? [] : artifactVersions(latestArtifact));
	const artifact = $derived(latestArtifact === undefined ? undefined : selectedArtifactVersion(latestArtifact, selectedVersion));
	const versionIndex = $derived(versions.findIndex((snapshot) => snapshot.id === artifact?.id));

	/** The details panel beside a video, in pixels (`w-80`). */
	const DETAILS_WIDTH = 320;

	const wide = new MediaQuery('(min-width: 48rem) and (min-height: 30rem)');
	const theater = $derived(artifact?.kind === 'video' && wide.current);
	/** A Markdown or HTML page gets the taller dialog, and an HTML page the wider one; other kinds keep their size. */
	const sizing = $derived(
		artifact === undefined
			? artifactDialogSizing({})
			: artifactDialogSizing({
					markdown: artifact.kind === 'text' && isMarkdownArtifact(artifact),
					html: artifact.kind === 'text' && isHtmlArtifact(artifact)
				})
	);

	let confirming = $state(false);
	let busy = $state<'delete' | 'download' | undefined>(undefined);
	let problem = $state<string | undefined>(undefined);
	let details = $state(false);
	let video = $state<ArtifactVideo | null>(null);
	let scroller = $state<HTMLElement>();

	$effect(() => {
		if (!open) {
			selectedVersion = undefined;
			confirming = false;
			problem = undefined;
		}
	});

	$effect(() => {
		if (!open || !theater) return;
		// The stage is the window less the dialog's margin, its header and padding.
		details = detailsChoice ?? panelFitsBeside(window.innerWidth - 56, window.innerHeight - 112, DETAILS_WIDTH, 16 / 9);
	});

	const facts = $derived(
		artifact === undefined
			? []
			: [
					kindLabel(artifact.kind),
					formatMediaDuration(artifact.durationSeconds),
					artifact.size >= 0 ? formatBytes(artifact.size) : '',
					savedByLabel(artifact)
				].filter((fact) => fact !== '')
	);

	const note = $derived(
		artifact?.note && artifact.kind === 'video' ? linkNoteTimes(artifact.note, artifact.durationSeconds ?? undefined) : artifact?.note
	);

	function toggleDetails(): void {
		details = !details;
		detailsChoice = details;
	}

	function onnoteclick(event: MouseEvent): void {
		const anchor = (event.target as Element).closest('a');
		const seconds = noteTimeFromHref(anchor?.getAttribute('href') ?? null);
		if (seconds === undefined || video == null) return;
		event.preventDefault();
		video.seek(seconds);
		if (!theater) scroller?.scrollTo({ top: 0, behavior: 'smooth' });
	}

	async function download(): Promise<void> {
		if (artifact === undefined) return;
		busy = 'download';
		problem = undefined;
		try {
			await downloadArtifact(client, artifact);
		} catch (error) {
			problem = error instanceof Error ? error.message : String(error);
		} finally {
			busy = undefined;
		}
	}

	async function remove(): Promise<void> {
		if (artifact === undefined) return;
		const id = latestArtifact!.id;
		busy = 'delete';
		problem = undefined;
		try {
			await client.deleteArtifact(artifact.projectId, id);
			open = false;
			ondeleted?.(id);
		} catch (error) {
			problem = error instanceof Error ? error.message : String(error);
		} finally {
			busy = undefined;
			confirming = false;
		}
	}
</script>

{#snippet versionControls()}
	{#if versions.length > 1 && artifact !== undefined}
		<div class="flex shrink-0 items-center gap-1 text-xs text-(--chat-fg-muted)" data-artifact-versions>
			<Button size="xs" variant="ghost" aria-label="Previous version" title="Previous version" disabled={versionIndex <= 0} onclick={() => selectedVersion = versions[versionIndex - 1]?.version}>←</Button>
			<span class="whitespace-nowrap" aria-live="polite" title={exactTime(artifact.createdAt)}>v{artifact.version ?? 1} of {latestArtifact?.versionCount ?? versions.length} · {relativeTime(artifact.createdAt, Date.now())}</span>
			<Button size="xs" variant="ghost" aria-label="Next version" title="Next version" disabled={versionIndex >= versions.length - 1} onclick={() => selectedVersion = versions[versionIndex + 1]?.version}>→</Button>
		</div>
	{/if}
{/snippet}

{#snippet factsLine(item: Artifact)}
	{#each facts as fact, index (index)}
		{#if index > 0}<span aria-hidden="true">·</span>{/if}
		<span>{fact}</span>
	{/each}
	{#if item.taskId}
		<span aria-hidden="true">·</span>
		<span>for <span class="font-mono">{item.taskId}</span></span>
	{/if}
	{#if item.createdAt}
		<span aria-hidden="true">·</span>
		<time datetime={item.createdAt} title={exactTime(item.createdAt)}>{relativeTime(item.createdAt, Date.now())}</time>
	{/if}
{/snippet}

{#snippet extras(item: Artifact)}
	{#if note}
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div class="rounded-xl border border-(--chat-border) bg-(--chat-surface)/40 px-3 py-2 text-sm" onclick={onnoteclick} data-artifact-note>
			<Markdown source={note} />
		</div>
	{/if}

	{#if item.sourcePath}
		<div class="flex min-w-0 items-center gap-1 text-xs text-(--chat-fg-subtle)">
			<span class="shrink-0">Saved from</span>
			<code class="min-w-0 flex-1 truncate font-mono text-(--chat-fg-muted)" title={item.sourcePath}>{item.sourcePath}</code>
			<CopyButton text={item.sourcePath} label="Copy the path" class="shrink-0" />
		</div>
	{/if}

	{#if problem}
		<p class="text-xs break-words text-(--chat-danger)" role="alert">{problem}</p>
	{/if}
{/snippet}

{#snippet deletion(item: Artifact, withDownload: boolean)}
	{#if confirming}
		<p class="min-w-0 flex-1 text-xs text-(--chat-fg-muted)">Delete {item.name} from the backend? This cannot be undone.</p>
		<Button size="sm" variant="ghost" onclick={() => (confirming = false)} disabled={busy === 'delete'}>Keep it</Button>
		<Button size="sm" variant="destructive" onclick={remove} disabled={busy === 'delete'} data-confirm-delete>
			{#if busy === 'delete'}<LoaderCircleIcon class="size-3.5 animate-spin" />{/if}
			Delete
		</Button>
	{:else}
		<Button size="sm" variant="ghost" class="text-(--chat-danger)" onclick={() => (confirming = true)}>
			<Trash2Icon class="size-3.5" /> Delete
		</Button>
		{#if withDownload}
			<span class="flex-1"></span>
			<Button size="sm" onclick={download} disabled={busy === 'download'}>
				{#if busy === 'download'}<LoaderCircleIcon class="size-3.5 animate-spin" />{:else}<DownloadIcon class="size-3.5" />{/if}
				Download
			</Button>
		{/if}
	{/if}
{/snippet}

<Dialog.Root bind:open>
	{#if theater && artifact !== undefined}
		<Dialog.Content
			class="artifact-dialog flex h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
			data-artifact-dialog
			data-theater
			onEscapeKeydown={(event) => {
				// Escape in the speed menu closes the menu only.
				if ((event.target as Element | null)?.closest?.('[role="menu"]')) event.preventDefault();
			}}
			onOpenAutoFocus={(event) => {
				// Space and the other keys go to the player, not the first button.
				event.preventDefault();
				video?.focus();
			}}
		>
			<div class="flex min-h-14 items-center gap-2 border-b border-(--chat-border) py-2 pr-14 pl-4">
				<Dialog.Header class="min-w-0 flex-1 gap-0 text-left">
					<Dialog.Title class="truncate text-sm leading-snug font-semibold" title={artifactTitle(artifact)}>{artifactTitle(artifact)}</Dialog.Title>
					<Dialog.Description class="flex min-w-0 items-center gap-x-2 overflow-hidden text-xs whitespace-nowrap text-(--chat-fg-subtle)">
						{@render factsLine(artifact)}
					</Dialog.Description>
					{#if problem && !details}
						<p class="truncate text-xs text-(--chat-danger)" role="alert" title={problem}>{problem}</p>
					{/if}
				</Dialog.Header>
				{@render versionControls()}
				<Button size="sm" variant="ghost" class={details ? "bg-(--chat-fg)/8" : ""} onclick={toggleDetails} aria-pressed={details} aria-controls="artifact-details" data-details-toggle>
					{#if details}<PanelRightCloseIcon class="size-3.5" />{:else}<PanelRightOpenIcon class="size-3.5" />{/if}
					Details
					{#if artifact.note && !details}
						<span class="size-1.5 rounded-full bg-(--accent-2)" aria-hidden="true"></span><span class="sr-only">(has a note)</span>
					{/if}
				</Button>
			</div>
			<div class="flex min-h-0 flex-1">
				<div class="stage grid min-w-0 flex-1 place-items-center p-3">
					{#key artifact.id}
						<ArtifactVideo bind:this={video} {artifact} {client} {autoplay} theater shortcuts ondownload={download} downloading={busy === 'download'} />
					{/key}
				</div>
				{#if details}
					<aside id="artifact-details" class="flex w-80 shrink-0 flex-col border-l border-(--chat-border)" aria-label="Details">
						<div class="relative flex min-h-0 flex-1 flex-col">
						<div use:overlayScroll={'parent'} class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-4">
							{#if !artifact.note && !artifact.sourcePath}
								<p class="text-xs text-(--chat-fg-subtle)">No note was saved with this video.</p>
							{/if}
							{@render extras(artifact)}
						</div>
						</div>
						<div class="flex flex-wrap items-center gap-2 border-t border-(--chat-border) px-4 py-3">
							{@render deletion(artifact, false)}
						</div>
					</aside>
				{/if}
			</div>
		</Dialog.Content>
	{:else}
		<Dialog.Content class="artifact-dialog flex {sizing} flex-col gap-0 overflow-hidden p-0" data-artifact-dialog>
			{#if artifact !== undefined}
				{#if versions.length > 1}
					<div class="flex flex-wrap items-center gap-x-3 border-b border-(--chat-border) py-2 pr-12 pl-4">
						<span class="min-w-0 truncate text-sm font-medium">{artifactTitle(artifact)}</span>
						{@render versionControls()}
					</div>
				{/if}
				<div class="relative flex min-h-0 flex-1 flex-col">
				<div bind:this={scroller} use:overlayScroll={'parent'} class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
					<div class="p-3 pt-12 sm:p-4 sm:pt-12">
						{#key artifact.id}
							{#if artifact.kind === 'video'}
								<ArtifactVideo bind:this={video} {artifact} {client} {autoplay} ondownload={download} downloading={busy === 'download'} />
							{:else}
								<ArtifactPlayer {artifact} {client} {autoplay} roomy />
							{/if}
						{/key}
					</div>
					<div class="flex flex-col gap-3 px-4 pb-4 sm:px-5">
						<Dialog.Header class="gap-1 text-left">
							<Dialog.Title class="text-base leading-snug font-semibold break-words">{artifactTitle(artifact)}</Dialog.Title>
							<Dialog.Description class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-(--chat-fg-subtle)">
								{@render factsLine(artifact)}
							</Dialog.Description>
						</Dialog.Header>
						{@render extras(artifact)}
					</div>
				</div>
				</div>

				<div class="flex flex-wrap items-center gap-2 border-t border-(--chat-border) px-4 py-3 sm:px-5" style="padding-bottom: max(0.75rem, env(safe-area-inset-bottom))">
					{@render deletion(artifact, true)}
				</div>
			{/if}
		</Dialog.Content>
	{/if}
</Dialog.Root>

<style>
	/* The video fills this, keeping its shape (`ArtifactVideo`'s `theater`). */
	.stage {
		container-type: size;
		background: color-mix(in oklab, var(--chat-bg) 92%, black);
	}
</style>
