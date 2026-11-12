<script lang="ts">
	import XIcon from '@lucide/svelte/icons/x';
	import { taskFilter } from '#lib/tasks-view.svelte.js';

	/** Focus is set from a task's sheet; no chip or empty row when it is clear. */
	let { class: className = '' }: { class?: string } = $props();
</script>

{#if taskFilter.focus !== null}
	<span
		class="inline-flex h-7 items-center gap-1 rounded-full border border-(--accent-2)/40 bg-(--accent-2)/10 pr-1 pl-2.5 text-xs font-medium text-(--accent-2) {className}"
		data-filter-focus={taskFilter.focus}
	>
		Linked to <span class="font-mono">{taskFilter.focus}</span>
		<button
			type="button"
			class="grid size-5 place-items-center rounded-full hover:bg-(--accent-2)/20"
			aria-label="Show every task again"
			title="Show every task again"
			onclick={() => taskFilter.clearFocus()}
		>
			<XIcon class="size-3" aria-hidden="true" />
		</button>
	</span>
{/if}
