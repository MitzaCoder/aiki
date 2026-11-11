<script lang="ts">
	import MessageSquareWarningIcon from '@lucide/svelte/icons/message-square-warning';
	import type { BackendConnection } from '#lib/harness.svelte.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	let { backend, projectId, taskId }: { backend: BackendConnection; projectId: string; taskId: string } = $props();
	let open = $state(false);
	let sections = $state('both');
	let reason = $state('');
	let busy = $state(false);
	let problem = $state('');
	let saved = $state(false);
	async function submit() {
		if (busy) return;
		busy = true;
		problem = '';
		try {
			const response = await backend.client.request({
				type: 'board.report.stale', projectId, taskId,
				...(sections === 'both' ? {} : { sections: [sections as 'results' | 'next'] }),
				...(reason.trim() ? { reason: reason.trim() } : {})
			});
			if (response.type === 'error') throw new Error(response.error.message);
			saved = true;
			open = false;
		} catch (error) {
			problem = error instanceof Error ? error.message : String(error);
		} finally { busy = false; }
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Trigger aria-label="This looks out of date" title="This looks out of date" class="inline-flex size-8 items-center justify-center rounded-md text-(--chat-fg-muted) hover:bg-(--chat-surface-2) hover:text-(--chat-fg) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" onclick={() => { saved = false; problem = ''; sections = 'both'; reason = ''; }}><MessageSquareWarningIcon class="size-4" aria-hidden="true" /></Dialog.Trigger>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>This looks out of date</Dialog.Title>
			<Dialog.Description>Ask for a report update. The task status and existing text stay unchanged.</Dialog.Description>
		</Dialog.Header>
		<form class="flex flex-col gap-4" onsubmit={(event) => { event.preventDefault(); void submit(); }}>
			<label class="flex flex-col gap-1 text-sm">Sections
				<select bind:value={sections} class="rounded-md border border-(--chat-border) bg-(--chat-surface) p-2">
					<option value="both">Results and Next</option><option value="results">Results only</option><option value="next">Next only</option>
				</select>
			</label>
			<label class="flex flex-col gap-1 text-sm">Reason (optional)
				<input bind:value={reason} maxlength={160} class="rounded-md border border-(--chat-border) bg-(--chat-surface) p-2" />
				<span class="text-xs text-(--chat-fg-subtle)">{reason.length}/160</span>
			</label>
			{#if problem}<p role="alert" class="text-sm text-destructive">{problem}</p>{/if}
			<Dialog.Footer><Button type="button" variant="outline" onclick={() => { open = false; }}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? 'Marking…' : 'Mark out of date'}</Button></Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
{#if saved}<span role="status" class="text-[0.6875rem] text-(--chat-fg-subtle)">Report marked out of date.</span>{/if}
