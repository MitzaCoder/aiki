<script lang="ts">
	import { untrack } from 'svelte';
	import Composer from '#lib/components/chat/Composer.svelte';
	import { inputContent, type HeldImage } from '#lib/chat/images.js';
	import { draftKey } from '#lib/drafts.js';
	import { draftChannel } from '#lib/draft-channel.js';
	import type { BackendConnection } from '#lib/harness.svelte.js';

	/** Keyed by task in TaskSheet: its draft and send result cannot leak to the next opened task. */
	let { backend, projectId, taskId }: { backend: BackendConnection; projectId: string; taskId: string } = $props();
	const draftId = untrack(() => `task-reply:${taskId}`);
	let sent = $state(false);
	let problem = $state<string | undefined>(undefined);

	async function send(text: string, _pickedTask?: string, images: HeldImage[] = []): Promise<boolean> {
		problem = undefined;
		sent = false;
		try {
			// The task's own draft is cleared by Composer. Never clear the coordinator's separate chat draft.
			await backend.client.submit(projectId, inputContent(text, images), { whenBusy: 'steer', taskId, keepDraft: true });
			sent = true;
			return true;
		} catch (error) {
			problem = error instanceof Error ? error.message : String(error);
			return false;
		}
	}
</script>

<div aria-label="Reply about {taskId}" data-task-composer>
	<Composer
		models={[]}
		model={null}
		thinkingLevel={null}
		thinkingLevels={[]}
		showModelPicker={false}
		draftKey={draftKey(backend.id, projectId, draftId)}
		draftChannel={draftChannel(backend, projectId, draftId)}
		disabled={!backend.ready}
		placeholder="Say something about {taskId}…"
		onModelChange={() => {}}
		onThinkingChange={() => {}}
		onstop={() => {}}
		onsend={send}
	/>
	<p class="mt-1.5 truncate px-2 text-xs text-(--chat-fg-subtle)" title="Replies go to the coordinator about {taskId}.">
		To the coordinator · {taskId}
	</p>
	<span class="sr-only" role="status" data-reply-sent={sent ? '' : undefined}>{sent ? 'Sent. The reply appears in chat.' : ''}</span>
	{#if problem}<p class="mt-1.5 text-xs break-words text-(--chat-danger)" role="alert">{problem}</p>{/if}
</div>
