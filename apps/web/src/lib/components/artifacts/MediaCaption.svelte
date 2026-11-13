<script lang="ts">
	import InfoIcon from '@lucide/svelte/icons/info';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import TagIcon from '@lucide/svelte/icons/tag';
	import type { Artifact } from '@kemiri/protocol';
	import { fade } from 'svelte/transition';
	import { MediaQuery } from 'svelte/reactivity';
	import Markdown from '#lib/components/markdown/Markdown.svelte';
	import { artifactTitle, formatBytes, formatMediaDuration, kindLabel, savedByLabel } from '#lib/artifacts.js';
	import { MEDIA_MOTION, tagsOf } from '#lib/media-gallery.js';
	import { exactTime, relativeTime } from '#lib/relative-time.js';
	import { linkNoteTimes } from '#lib/video-player.js';
	import TagEditor from './TagEditor.svelte';

	/**
	 * Under a slide: the title, what the file is, its tags as chips (a click shows only that tag), and the note as Markdown,
	 * clamped to three lines with "more". It cross-fades when the slide changes. With `canEdit` a pencil opens the tag editor
	 * (`TagEditor`); `ondetails` adds an Info button that opens the artifact's full dialog.
	 */
	let {
		artifact,
		task,
		project,
		canEdit = false,
		busy = false,
		problem,
		onedit,
		onfilter,
		ondetails,
		onstartedit
	}: {
		artifact: Artifact | undefined;
		/** Tags used on this task's media, then the project's, for the editor's completion. */
		task: readonly string[];
		project: readonly string[];
		canEdit?: boolean;
		busy?: boolean;
		problem?: string | undefined;
		onedit: (artifact: Artifact, tags: string[]) => void;
		onfilter?: (tag: string) => void;
		ondetails?: (artifact: Artifact) => void;
		/** The tag editor opened (the parent may read the project's tags for completion now). */
		onstartedit?: () => void;
	} = $props();

	const reduced = new MediaQuery('(prefers-reduced-motion: reduce)');
	let editing = $state(false);
	let noteOpen = $state(false);
	let noteBox = $state<HTMLElement>();
	let overflowing = $state(false);

	$effect(() => {
		if (editing) onstartedit?.();
	});

	// A new row for the same artifact (its tags changed) must not close the editor: depend on the ID, not the object.
	const artifactId = $derived(artifact?.id);
	$effect(() => {
		void artifactId;
		editing = false;
		noteOpen = false;
	});

	$effect(() => {
		const box = noteBox;
		// Unbinding sets it to null, not undefined.
		if (!box) return;
		const measure = (): void => {
			overflowing = noteOpen || box.scrollHeight > box.clientHeight + 1;
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(box);
		return () => observer.disconnect();
	});

	function facts(item: Artifact): string[] {
		return [
			kindLabel(item.kind),
			formatMediaDuration(item.durationSeconds),
			item.size >= 0 ? formatBytes(item.size) : '',
			savedByLabel(item),
			(item.versionCount ?? 1) > 1 ? `${item.versionCount} versions` : ''
		].filter((fact) => fact !== '');
	}

	const duration = $derived(reduced.current ? 0 : MEDIA_MOTION.captionMs);
</script>

<div class="caption grid min-w-0" data-media-caption>
	{#key artifactId}
		{#if artifact !== undefined}
			{@const tags = tagsOf(artifact)}
			{@const note = artifact.note?.trim() ? (artifact.kind === 'video' ? linkNoteTimes(artifact.note, artifact.durationSeconds ?? undefined) : artifact.note) : undefined}
			<div class="cell flex min-w-0 flex-col gap-1.5" in:fade={{ duration, delay: 20 }} out:fade={{ duration: duration * 0.6 }}>
				<div class="flex min-w-0 items-start gap-2">
					<h4 class="min-w-0 flex-1 text-sm leading-snug font-semibold break-words" data-caption-title>{artifactTitle(artifact)}</h4>
					{#if ondetails}
						<button type="button" class="icon-button" aria-label="Details of {artifactTitle(artifact)}" title="Details, download, delete" onclick={() => ondetails(artifact)}>
							<InfoIcon class="size-4" />
						</button>
					{/if}
				</div>
				<p class="flex flex-wrap items-center gap-x-1.5 text-xs text-(--chat-fg-subtle)">
					{#each facts(artifact) as fact, at (at)}
						{#if at > 0}<span aria-hidden="true">·</span>{/if}<span>{fact}</span>
					{/each}
					{#if artifact.createdAt}
						<span aria-hidden="true">·</span>
						<time datetime={artifact.createdAt} title={exactTime(artifact.createdAt)}>{relativeTime(artifact.createdAt, Date.now())}</time>
					{/if}
				</p>

				{#if editing && canEdit}
					<TagEditor {tags} {task} {project} {busy} {problem} onchange={(next) => onedit(artifact, next)} onclose={() => (editing = false)} />
				{:else}
					<div class="flex min-w-0 flex-wrap items-center gap-1" data-caption-tags>
						{#each tags as tag (tag)}
							{#if onfilter}
								<button type="button" class="tag-chip" onclick={() => onfilter(tag)} aria-label="Show only {tag}" title="Show only {tag}">{tag}</button>
							{:else}
								<span class="tag-chip">{tag}</span>
							{/if}
						{/each}
						{#if canEdit}
							<button type="button" class="edit-tags inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs" onclick={() => (editing = true)} aria-label={tags.length > 0 ? 'Edit tags' : 'Add tags'} data-edit-tags>
								{#if tags.length > 0}<PencilIcon class="size-3" />{:else}<TagIcon class="size-3" /> Add tags{/if}
							</button>
						{/if}
					</div>
				{/if}

				{#if note !== undefined}
					<div class="min-w-0 text-sm" data-caption-note>
						<div bind:this={noteBox} class="note" class:clamped={!noteOpen}>
							<Markdown source={note} class="report-md" />
						</div>
						{#if overflowing}
							<button type="button" class="more mt-0.5 text-xs font-medium" aria-expanded={noteOpen} onclick={() => (noteOpen = !noteOpen)}>
								{noteOpen ? 'less' : 'more'}
							</button>
						{/if}
					</div>
				{/if}
			</div>
		{/if}
	{/key}
</div>

<style>
	.cell {
		grid-area: 1 / 1;
	}
	.note.clamped {
		display: -webkit-box;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.note :global(.md) {
		font-size: 0.8125rem;
		line-height: 1.5;
	}
	.note :global(.md > :first-child) {
		margin-top: 0;
	}
	.note :global(.md > :last-child) {
		margin-bottom: 0;
	}
	.tag-chip {
		border-radius: 9999px;
		padding: 0.125rem 0.55rem;
		font-size: 0.6875rem;
		font-weight: 500;
		color: var(--chat-fg-muted);
		background: color-mix(in oklab, var(--accent-2) 10%, transparent);
		box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--accent-2) 24%, transparent);
	}
	button.tag-chip {
		transition:
			background-color 120ms,
			color 120ms;
	}
	button.tag-chip:hover {
		color: var(--chat-fg);
		background: color-mix(in oklab, var(--accent-2) 20%, transparent);
	}
	.edit-tags {
		color: var(--chat-fg-subtle);
		border: 1px dashed var(--chat-border-strong, var(--chat-border));
		transition:
			color 120ms,
			background-color 120ms;
	}
	.edit-tags:hover {
		color: var(--chat-fg);
		background: color-mix(in oklab, var(--chat-surface-2) 80%, transparent);
	}
	.more {
		color: var(--accent-2);
	}
	.more:hover {
		text-decoration: underline;
	}
	.icon-button {
		display: grid;
		place-items: center;
		flex: none;
		width: 1.5rem;
		height: 1.5rem;
		margin-block: -0.125rem;
		border-radius: 9999px;
		color: var(--chat-fg-subtle);
		transition:
			background-color 120ms,
			color 120ms;
	}
	.icon-button:hover {
		color: var(--chat-fg);
		background: color-mix(in oklab, var(--chat-surface-2) 80%, transparent);
	}
	button:focus-visible {
		outline: 2px solid var(--accent-2);
		outline-offset: 1px;
	}
</style>
