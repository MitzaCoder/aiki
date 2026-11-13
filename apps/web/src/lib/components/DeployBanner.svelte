<script lang="ts">
	import XIcon from '@lucide/svelte/icons/x';
	import { deployProblem } from '@kemiri/client';
	import type { DeployStatus, ServerStatus } from '@kemiri/protocol';
	import Banner from '#lib/components/Banner.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { deployBanner, isDeployDismissed } from '#lib/server-status.js';

	/**
	 * A banner for the last deploy when it needs attention: it failed, it rolled back, or it
	 * says `ok` for a commit other than the running release. Dismissible per attempt, so the
	 * next deploy shows again; the key and the stored list live in `lib/server-status.ts`.
	 */
	let {
		status,
		dismissed = [],
		ondismiss,
		now = Date.now()
	}: {
		status: ServerStatus | undefined;
		dismissed?: readonly string[];
		ondismiss?: (deploy: DeployStatus) => void;
		now?: number;
	} = $props();

	const problem = $derived(deployProblem(status));
	const view = $derived(problem === undefined ? undefined : deployBanner(problem, now));
	const visible = $derived(problem !== undefined && !isDeployDismissed(dismissed, problem.deploy));
</script>

{#if problem && view && visible}
	<Banner tone={view.tone}>
		<div class="flex items-start gap-2">
			<div class="flex min-w-0 flex-1 flex-col gap-0.5">
				<p class="font-semibold">
					{view.title}:
					<span class="font-mono">{view.commit}</span>
					<span class="font-normal">{view.description}</span>
				</p>
				<p class="break-words">{view.detail}</p>
				<p class="break-words opacity-90">{view.note}</p>
				<p class="text-xs opacity-75">
					<time datetime={problem.deploy.at}>{view.when}</time>
				</p>
			</div>
			{#if ondismiss}
				<Button
					variant="ghost"
					size="icon-sm"
					class="shrink-0"
					type="button"
					onclick={() => ondismiss?.(problem.deploy)}
					aria-label="Dismiss this deploy message"
					title="Dismiss until the next deploy"
				>
					<XIcon />
				</Button>
			{/if}
		</div>
	</Banner>
{/if}
