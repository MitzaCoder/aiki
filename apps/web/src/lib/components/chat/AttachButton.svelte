<script lang="ts">
	import PaperclipIcon from '@lucide/svelte/icons/paperclip';
	import { imageFilesOf } from '#lib/chat/images.js';
	import type { MessageImages } from '#lib/chat/message-images.svelte.js';
	import { INPUT_MAX_IMAGES } from '@aiki/protocol';

	/** The attach button next to a message box: opens the file picker for images (several at once) and adds them. */
	let {
		images,
		onfiles,
		disabled = false,
		class: className = ''
	}: { images: MessageImages; onfiles?: (files: File[]) => Promise<void>; disabled?: boolean; class?: string } = $props();

	let input = $state<HTMLInputElement | null>(null);

	function picked(): void {
		const chosen = input?.files;
		if (chosen === null || chosen === undefined) return;
		if (onfiles) { void onfiles(Array.from(chosen)); if (input) input.value = ''; return; }
		const files = imageFilesOf({ files: chosen });
		if (files.length === 0 && chosen.length > 0) images.error = 'Only images can be attached';
		else void images.add(files);
		if (input != null) input.value = '';
	}
</script>

<input bind:this={input} type="file" accept={onfiles ? undefined : "image/*"} multiple hidden onchange={picked} data-attach-input />
<button
	type="button"
	class="grid size-9 place-items-center rounded-full text-(--chat-fg-subtle) transition-colors hover:bg-(--chat-surface-2) hover:text-(--chat-fg) active:scale-95 disabled:opacity-40 {className}"
	onclick={() => input?.click()}
	disabled={disabled || images.count >= INPUT_MAX_IMAGES}
	aria-label={onfiles ? "Attach files" : "Attach images"}
	title={onfiles ? "Attach files (or paste or drop them)" : "Attach images (or paste or drop them)"}
	data-attach-button
>
	<PaperclipIcon class="size-4" />
</button>
