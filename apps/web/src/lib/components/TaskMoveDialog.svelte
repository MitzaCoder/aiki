<script lang="ts">
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import type { MoveQuestion } from '#lib/kanban.js';
	import type { BoardTask } from '@mihai-harness/protocol';

	/**
	 * What a move asks before it goes: why a task goes back from review to Working (required; the agents get it with
	 * the move), or what a task moved to Blocked waits on (optional; it becomes the task's blocked reason).
	 */
	let {
		request = $bindable(),
		onconfirm
	}: {
		/** The move waiting on an answer; undefined closes the dialog. */
		request: { task: Pick<BoardTask, 'id' | 'title'>; question: Exclude<MoveQuestion, 'none'> } | undefined;
		onconfirm: (text: string) => void;
	} = $props();

	let text = $state('');
	const required = $derived(request?.question === 'reason');
	const ready = $derived(!required || text.trim().length > 0);

	$effect(() => {
		void request;
		text = '';
	});

	function confirm(): void {
		if (request === undefined || !ready) return;
		const answer = text.trim();
		request = undefined;
		onconfirm(answer);
	}

	function onkeydown(event: KeyboardEvent): void {
		if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
			event.preventDefault();
			confirm();
		}
	}
</script>

<Dialog.Root
	open={request !== undefined}
	onOpenChange={(open) => {
		if (!open) request = undefined;
	}}
>
	<Dialog.Content class="sm:max-w-md" data-move-dialog>
		{#if request !== undefined}
			<Dialog.Header>
				<Dialog.Title>{required ? `Send ${request.task.id} back to work` : `Move ${request.task.id} to Blocked`}</Dialog.Title>
				<Dialog.Description>
					{#if required}
						Say what still needs doing. The agents get this with the task, “{request.task.title}”.
					{:else}
						What is it waiting on? The agents see this on the task. You can leave it empty.
					{/if}
				</Dialog.Description>
			</Dialog.Header>
			<div class="flex flex-col gap-1.5">
				<Label for="move-reason" class="text-xs font-medium">{required ? 'What still needs doing' : 'Waiting on (optional)'}</Label>
				<Textarea
					id="move-reason"
					bind:value={text}
					rows={3}
					maxlength={2000}
					placeholder={required ? 'The login still fails on Safari.' : 'The API key from the platform team.'}
					class="min-h-20 text-sm md:text-sm"
					{onkeydown}
				/>
			</div>
			<Dialog.Footer>
				<Dialog.Close>
					{#snippet child({ props })}
						<Button {...props} variant="outline" size="sm">Cancel</Button>
					{/snippet}
				</Dialog.Close>
				<Button size="sm" type="button" disabled={!ready} onclick={confirm}>
					{required ? 'Send back to Working' : 'Move to Blocked'}
				</Button>
			</Dialog.Footer>
		{/if}
	</Dialog.Content>
</Dialog.Root>
