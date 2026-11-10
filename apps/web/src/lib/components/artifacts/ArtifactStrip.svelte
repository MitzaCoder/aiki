<script lang="ts">
	import type { ArtifactFilter } from '@aiki/client';
	import type { Artifact } from '@aiki/protocol';
	import type { BackendConnection } from '#lib/harness.svelte.js';
	import { artifactTitle } from '#lib/artifacts.js';
	import { artifactScope, useArtifactFeed } from '#lib/artifacts.svelte.js';
	import ArtifactDialog from './ArtifactDialog.svelte';
	import ArtifactThumb from './ArtifactThumb.svelte';

	/**
	 * A row of small thumbnails for a card (a thread's, a board task's): the newest few, "+N" for the rest, each opening
	 * the artifact in full. Nothing at all while there are none or the backend has no artifacts. Live like every list.
	 * Without `backend` and `projectId` it uses the ones the screen offers (`provideArtifactScope`).
	 */
	let {
		backend,
		projectId,
		filters = {},
		items,
		savedUntil,
		max = 5,
		class: className = ''
	}: {
		backend?: BackendConnection;
		projectId?: string;
		filters?: ArtifactFilter;
		/** Show these instead of reading a list, for a screen that holds a wider list already. */
		items?: readonly Artifact[];
		/** Only what was saved by then (epoch ms): a thread's earlier finish does not show what it saved later. */
		savedUntil?: number;
		/** How many thumbnails before "+N". */
		max?: number;
		class?: string;
	} = $props();

	const scope = artifactScope();
	const target = $derived(
		backend !== undefined && projectId !== undefined
			? { client: backend.client, projectId, available: backend.supports('artifacts') }
			: scope?.()
	);
	const available = $derived(target?.available === true);
	const feed = useArtifactFeed(() =>
		target !== undefined && available && items === undefined
			? {
					client: target.client,
					projectId: target.projectId,
					filter: { threadId: filters.threadId, workerId: filters.workerId, taskId: filters.taskId }
				}
			: undefined
	);
	const all = $derived(
		(items ?? feed.current?.artifacts ?? []).filter(
			(artifact) => savedUntil === undefined || Date.parse(artifact.createdAt) <= savedUntil
		)
	);
	let expanded = $state(false);
	const shown = $derived(expanded ? all : all.slice(0, max));
	let openId = $state<string | undefined>(undefined);
	let dialogOpen = $state(false);
	const opened = $derived(all.find((artifact) => artifact.id === openId));
</script>

{#if target !== undefined && available && all.length > 0}
	<div class="flex min-w-0 flex-wrap items-center gap-1.5 {className}" role="group" aria-label="Artifacts" data-artifact-strip>
		{#each shown as artifact (artifact.id)}
			<button
				type="button"
				class="strip-item overflow-hidden rounded-lg"
				title={artifactTitle(artifact)}
				aria-label="Open {artifactTitle(artifact)}"
				onclick={(event) => {
					event.stopPropagation();
					openId = artifact.id;
					dialogOpen = true;
				}}
				data-artifact={artifact.id}
			>
				<ArtifactThumb {artifact} client={target.client} class="h-9 w-13" duration={false} />
			</button>
		{/each}
		{#if all.length > max}
			<button
				type="button"
				class="h-9 rounded-lg border border-(--chat-border) px-2 text-xs font-medium text-(--chat-fg-muted) hover:bg-(--chat-surface-2)"
				onclick={(event) => {
					event.stopPropagation();
					expanded = !expanded;
				}}
				aria-expanded={expanded}
			>
				{expanded ? 'Fewer' : `+${all.length - max}`}
			</button>
		{/if}
	</div>
	<ArtifactDialog artifact={opened} client={target.client} bind:open={dialogOpen} />
{/if}

<style>
	.strip-item {
		box-shadow: 0 0 0 1px var(--chat-border);
		transition:
			box-shadow 120ms,
			transform 120ms;
	}
	.strip-item:hover {
		box-shadow: 0 0 0 1px var(--chat-border-strong);
		transform: translateY(-1px);
	}
	.strip-item:focus-visible {
		outline: 2px solid var(--accent-2);
		outline-offset: 1px;
	}
</style>
