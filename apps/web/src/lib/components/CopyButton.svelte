<script lang="ts">
	import CheckIcon from '@lucide/svelte/icons/check';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import { copyText } from '#lib/clipboard.js';

	/** Copy `text` to the clipboard, showing a tick for a moment. */
	let {
		text,
		class: className = '',
		label = 'Copy'
	}: { text: string | (() => string); class?: string; label?: string } = $props();

	let copied = $state(false);
	let timer: ReturnType<typeof setTimeout> | undefined;

	async function copy(): Promise<void> {
		if (!(await copyText(typeof text === 'function' ? text() : text))) return;
		copied = true;
		clearTimeout(timer);
		timer = setTimeout(() => (copied = false), 1500);
	}

	$effect(() => () => clearTimeout(timer));
</script>

<button
	type="button"
	class="icon-btn {className}"
	onclick={copy}
	aria-label={copied ? 'Copied' : label}
	title={copied ? 'Copied' : label}
>
	{#if copied}
		<CheckIcon class="size-3.5 text-(--chat-success)" />
	{:else}
		<CopyIcon class="size-3.5" />
	{/if}
</button>
