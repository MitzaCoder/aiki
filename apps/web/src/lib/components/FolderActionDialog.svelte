<script lang="ts" module>
	import type { DirectoryEntry } from '@aiki/protocol';

	export type FolderAction =
		| { kind: 'create'; parent: string }
		| { kind: 'rename'; entry: DirectoryEntry }
		| { kind: 'delete'; entry: DirectoryEntry };
</script>

<script lang="ts">
	import Banner from '#lib/components/Banner.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import { deleteConfirmation } from '#lib/folder-picker.js';
	import { validateFolderName } from '@aiki/protocol';

	let {
		action,
		onsubmit,
		onclose
	}: {
		/** What is being asked; undefined keeps the dialog closed. */
		action: FolderAction | undefined;
		/** Do it. A rejection is shown in the dialog, which stays open. `name` is the typed name (create, rename). */
		onsubmit: (action: FolderAction, name: string) => Promise<void>;
		onclose: () => void;
	} = $props();

	let name = $state('');
	let error = $state<string | undefined>(undefined);
	let busy = $state(false);
	let input = $state<HTMLInputElement | null>(null);
	/** The action the fields were last reset for, so a re-render does not wipe what is typed. */
	let shown: FolderAction | undefined;

	const open = $derived(action !== undefined);
	const problem = $derived(action !== undefined && action.kind !== 'delete' ? validateFolderName(name) : undefined);
	const unchanged = $derived(action?.kind === 'rename' && name.trim() === action.entry.name);

	$effect(() => {
		if (action === shown) return;
		shown = action;
		name = action?.kind === 'rename' ? action.entry.name : '';
		error = undefined;
		busy = false;
	});

	async function submit(event?: Event): Promise<void> {
		event?.preventDefault();
		if (action === undefined || busy) return;
		if (action.kind !== 'delete' && (problem !== undefined || unchanged)) return;
		busy = true;
		error = undefined;
		try {
			await onsubmit(action, name.trim());
			onclose();
		} catch (value) {
			error = value instanceof Error ? value.message : String(value);
		} finally {
			busy = false;
		}
	}

	const copy = $derived.by(() => {
		if (action === undefined) return { title: '', description: '', confirm: '' };
		if (action.kind === 'create') {
			return { title: 'New folder', description: `Create a folder in ${action.parent}.`, confirm: 'Create' };
		}
		if (action.kind === 'rename') {
			return {
				title: `Rename “${action.entry.name}”`,
				description: 'The folder keeps its contents. Projects that use it must be removed first.',
				confirm: 'Rename'
			};
		}
		const text = deleteConfirmation(action.entry);
		return { title: text.title, description: text.message, confirm: text.confirmLabel };
	});
</script>

<Dialog.Root
	{open}
	onOpenChange={(next) => {
		if (!next && !busy) onclose();
	}}
>
	<Dialog.Content
		class="gap-4 sm:max-w-md"
		showCloseButton={false}
		onOpenAutoFocus={(event) => {
			if (action?.kind === 'delete' || input === null) return;
			// Typing a name starts at once; the rename's whole name is selected.
			event.preventDefault();
			input.focus();
			input.select();
		}}
	>
		<Dialog.Header class="gap-1">
			<Dialog.Title class="text-base font-semibold break-words">{copy.title}</Dialog.Title>
			<Dialog.Description class="text-sm break-words text-muted-foreground">{copy.description}</Dialog.Description>
		</Dialog.Header>
		<form class="flex flex-col gap-3" onsubmit={submit}>
			{#if action !== undefined && action.kind !== 'delete'}
				<div class="flex flex-col gap-1.5">
					<Label for="folder-action-name">Folder name</Label>
					<Input
						id="folder-action-name"
						bind:ref={input}
						bind:value={name}
						autocomplete="off"
						autocapitalize="off"
						spellcheck={false}
						aria-invalid={name !== '' && problem !== undefined}
						aria-describedby="folder-action-hint"
					/>
					<p id="folder-action-hint" class="min-h-4 text-xs text-muted-foreground">
						{name !== '' && problem !== undefined ? problem : ''}
					</p>
				</div>
			{/if}
			{#if error}
				<Banner tone="error">{error}</Banner>
			{/if}
			<Dialog.Footer class="flex-row justify-end gap-2">
				<Button type="button" variant="outline" disabled={busy} onclick={onclose}>Cancel</Button>
				<Button
					type="submit"
					variant={action?.kind === 'delete' ? 'destructive' : 'default'}
					disabled={busy || (action?.kind !== 'delete' && (problem !== undefined || unchanged))}
				>
					{#if busy}<Spinner data-icon="inline-start" />{/if}
					{copy.confirm}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
