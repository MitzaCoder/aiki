<script lang="ts">
	import WrapTextIcon from '@lucide/svelte/icons/wrap-text';
	import { codeWrap } from '#lib/code-wrap.svelte.js';

	/** The "Wrap" switch of a code block. One choice for every block; `defaultWrap` is what a block does before it is made. */
	let { defaultWrap = false }: { defaultWrap?: boolean } = $props();
	const pressed = $derived(codeWrap.wraps(defaultWrap));
</script>

<button
	type="button"
	class="icon-btn"
	class:active={pressed}
	data-wrap-toggle
	aria-label="Wrap code"
	aria-pressed={pressed}
	title={pressed ? 'Wrapping: click to scroll sideways' : 'Scrolling: click to wrap'}
	onclick={() => codeWrap.toggle(defaultWrap)}
>
	<WrapTextIcon class="size-3.5" />
</button>
