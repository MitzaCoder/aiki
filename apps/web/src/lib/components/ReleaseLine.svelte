<script lang="ts">
	import GitCommitHorizontalIcon from '@lucide/svelte/icons/git-commit-horizontal';
	import type { DeployStatus, ReleaseInfo } from '@kemiri/protocol';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { releaseView } from '#lib/server-status.js';
	import { cn } from '#lib/utils.js';

	/**
	 * The release a backend runs: its short commit, the commit's description and when it was
	 * deployed. `compact` keeps only the commit and moves the description and time into the
	 * hover text, for the chat header; the home page has room for the whole line.
	 *
	 * Three states: `undefined` draws nothing (not loaded, or the backend does not advertise
	 * `server-status`), `null` means the server runs from a checkout, and a release shows.
	 * `deploy`, the last attempt, adds a note when it left this backend on an older release
	 * because nothing the backend runs changed, or while it catches up to a commit it missed.
	 */
	let {
		release,
		deploy,
		now = Date.now(),
		compact = false,
		class: className
	}: {
		release: ReleaseInfo | null | undefined;
		deploy?: DeployStatus | null;
		now?: number;
		compact?: boolean;
		class?: string;
	} = $props();

	const view = $derived(release ? releaseView(release, now, deploy) : undefined);
</script>

{#if release === undefined}
	<!-- Not known yet, or the backend has no server-status: say nothing rather than guess. -->
{:else if release === null}
	<Badge
		variant="outline"
		class={cn('text-muted-foreground', className)}
		title="This server runs from a checkout, not from a deployed release."
	>
		Checkout
	</Badge>
{:else if view}
	<div class={cn('flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1', className)}>
		<Badge variant="outline" class="font-mono text-[0.6875rem]" title={view.title}>
			<GitCommitHorizontalIcon data-icon="inline-start" />
			{view.commit}
		</Badge>
		{#if compact}
			<span class="truncate text-xs text-muted-foreground" title={[view.title, view.unchanged, view.pending].filter(Boolean).join('\n')}
				>deployed {view.when}</span
			>
		{:else}
			<span class="min-w-0 flex-1 truncate text-xs" title={view.description}>{view.description}</span>
			<span class="shrink-0 text-xs text-muted-foreground">
				deployed <time datetime={release.deployedAt} title={view.title}>{view.when}</time>
			</span>
			{#if view.unchanged}
				<span class="basis-full truncate text-xs text-muted-foreground">{view.unchanged}</span>
			{/if}
			{#if view.pending}
				<span class="basis-full truncate text-xs text-amber-700 dark:text-amber-300" title={view.pending}>{view.pending}</span>
			{/if}
		{/if}
	</div>
{/if}
