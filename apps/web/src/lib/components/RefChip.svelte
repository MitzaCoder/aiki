<script lang="ts">
	import type { ProjectLinks, RefStatus } from '@mihai-harness/protocol';
	import { refHref, refStatusToneClass, refTooltip } from '#lib/refs.js';
	import { refLabel } from '#lib/tasks.js';

	/**
	 * A ticket or pull request as a small chip: its key or number, with a dot in its state's colour when the backend read
	 * it. A ref the settings can link opens it in a new tab and has a card (`RefCardHost`) in place of a tooltip; one they
	 * cannot is plain text the user can select.
	 */
	let {
		ref,
		links,
		status,
		class: className = ''
	}: { ref: string; links: ProjectLinks | undefined; status: RefStatus | undefined; class?: string } = $props();

	// The backend's address is the canonical one (a bare #12 resolves to /issues/12, which GitHub forwards).
	const href = $derived(status?.url ?? refHref(ref, links));
	const label = $derived(refLabel(ref, links));
	const tooltip = $derived(refTooltip(ref, label, links, status));
	const tone = $derived(status === undefined ? '' : refStatusToneClass(status));
</script>

{#snippet body()}
	{#if status !== undefined}<span class="task-status-dot ref-chip-dot" aria-hidden="true"></span>{/if}<span class="truncate">{label}</span>
{/snippet}

{#if href !== undefined}
	<a
		{href}
		target="_blank"
		rel="noopener noreferrer"
		class="task-ref ref-chip {tone} {className}"
		aria-label="{tooltip.split('\n')[0]}, opens in a new tab"
	>
		{@render body()}
	</a>
{:else}
	<span class="task-ref ref-chip select-all {tone} {className}" title={tooltip}>{@render body()}</span>
{/if}
