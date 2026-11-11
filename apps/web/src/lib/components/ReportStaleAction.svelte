<script lang="ts">
	import { onDestroy } from 'svelte';
	import CheckIcon from '@lucide/svelte/icons/check';
	import MessageSquareWarningIcon from '@lucide/svelte/icons/message-square-warning';
	import XIcon from '@lucide/svelte/icons/x';
	import type { BackendConnection } from '#lib/harness.svelte.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { reportUpdateRequest } from '#lib/report-update.js';

	let { backend, projectId, taskId }: { backend: BackendConnection; projectId: string; taskId: string } = $props();
	let busy = $state(false);
	let problem = $state('');
	let saved = $state(false);
	let confirmationTimer: ReturnType<typeof setTimeout> | undefined;
	let errorTimer: ReturnType<typeof setTimeout> | undefined;
	onDestroy(() => { clearTimeout(confirmationTimer); clearTimeout(errorTimer); });

	async function requestUpdate(): Promise<void> {
		if (busy || saved) return;
		busy = true;
		problem = '';
		clearTimeout(errorTimer);
		try {
			const response = await backend.client.request(reportUpdateRequest(projectId, taskId));
			if (response.type === 'error') throw new Error(response.error.message);
			saved = true;
			confirmationTimer = setTimeout(() => { saved = false; }, 4000);
		} catch (error) {
			problem = error instanceof Error ? error.message : String(error);
			errorTimer = setTimeout(() => { problem = ''; }, 8000);
		} finally { busy = false; }
	}
</script>

<Button variant="ghost" size={saved ? 'sm' : 'icon-sm'} disabled={busy || saved} onclick={() => void requestUpdate()}
	aria-label={saved ? 'Asked the agent to update' : busy ? 'Asking the agent to update' : 'This looks out of date — ask the agent to update'}
	title="This looks out of date — ask the agent to update" class="text-(--chat-fg-muted) disabled:opacity-100">
	{#if saved}<CheckIcon class="size-4" aria-hidden="true" /><span class="text-[0.6875rem]">Asked the agent to update</span>
	{:else}<MessageSquareWarningIcon class="size-4" aria-hidden="true" />{/if}
</Button>
<span class="sr-only" aria-live="polite" role="status">{saved ? 'Asked the agent to update' : ''}</span>
{#if problem}
	<span role="alert" class="fixed bottom-5 left-1/2 z-60 flex w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 items-center gap-3 rounded-xl border border-destructive/40 bg-popover px-4 py-3 text-sm text-destructive shadow-lg">
		<span class="min-w-0 flex-1">Could not ask for an update: {problem}</span>
		<Button variant="ghost" size="icon-sm" aria-label="Dismiss update error" onclick={() => { problem = ''; }}><XIcon class="size-4" /></Button>
	</span>
{/if}
